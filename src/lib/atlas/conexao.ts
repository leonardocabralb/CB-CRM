import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

import { AtlasError, criarClienteAtlas, type ClienteAtlas, type CodigoDoErroAtlas } from "./cliente";

/**
 * Conectar e desconectar o Atlas — o I/O da conexão (`cb_atlas_config`, 1071).
 *
 * Conectar = provar a chave com o `whoami` do Atlas (SÓ LEITURA: nada é
 * gravado lá), conferir que as permissões que o passo "Criar cliente no
 * Atlas" usa estão ligadas no escritório, e só então gravar a chave CIFRADA.
 * A chave nunca volta por rota nenhuma, nem mascarada.
 *
 * ⚠️ Chave de OUTRO escritório do Atlas não reaproveita os vínculos já
 * gravados (`cb_atlas_clientes.atlas_tenant_id`): os ids de cliente são do
 * escritório antigo, e o botão e a faixa apontariam para cliente alheio.
 */

/** O que o passo usa: procurar (Consultar), criar e reativar. */
export const PERMISSOES_NECESSARIAS = ["read_client", "create_client", "update_client"] as const;

export type CodigoDaConexao =
  | CodigoDoErroAtlas
  | "db_error"
  | "nao_conectado"
  | "chave_ilegivel"
  | "outro_escritorio"
  | "permissoes_faltando";

type FabricaDeCliente = (chave: string) => ClienteAtlas;

function fabricaDe(opcoes: { cliente?: FabricaDeCliente }): FabricaDeCliente {
  return opcoes.cliente ?? ((c) => criarClienteAtlas(c));
}

export function codigoDe(e: unknown): CodigoDoErroAtlas {
  return e instanceof AtlasError ? e.codigo : "atlas_error";
}

function decifrar(texto: unknown): string | null {
  if (typeof texto !== "string" || texto === "") return null;
  try {
    return decrypt(texto);
  } catch {
    return null;
  }
}

export type ResultadoDaConexao =
  | { ok: true; escritorio: string | null }
  | { ok: false; codigo: CodigoDaConexao; faltando?: string[] };

export async function conectarAtlas(
  admin: SupabaseClient,
  accountId: string,
  userId: string,
  chave: string,
  opcoes: { cliente?: FabricaDeCliente } = {},
): Promise<ResultadoDaConexao> {
  // 1) A chave vale? De qual escritório é? O que ele deixa fazer?
  let identidade;
  try {
    identidade = await fabricaDe(opcoes)(chave).whoami();
  } catch (e) {
    console.warn(`[atlas] conexão recusada (${codigoDe(e)}):`, e instanceof Error ? e.message : e);
    return { ok: false, codigo: codigoDe(e) };
  }
  const faltando = PERMISSOES_NECESSARIAS.filter((p) => identidade.permissoes[p] !== true);
  if (faltando.length > 0) return { ok: false, codigo: "permissoes_faltando", faltando };

  // 2) Os vínculos que já existem são deste escritório?
  const { data: alheio, error: erroVinculos } = await admin
    .from("cb_atlas_clientes")
    .select("id")
    .eq("account_id", accountId)
    .neq("atlas_tenant_id", identidade.tenantId)
    .limit(1);
  if (erroVinculos) return { ok: false, codigo: "db_error" };
  if ((alheio ?? []).length > 0) return { ok: false, codigo: "outro_escritorio" };

  // 3) Grava cifrado.
  const agora = new Date().toISOString();
  const { error } = await admin.from("cb_atlas_config").upsert(
    {
      account_id: accountId,
      api_key: encrypt(chave),
      atlas_tenant_id: identidade.tenantId,
      escritorio: identidade.escritorio,
      status: "conectado",
      last_error: null,
      conectado_em: agora,
      conferido_em: agora,
      created_by: userId,
      updated_at: agora,
    },
    { onConflict: "account_id" },
  );
  if (error) return { ok: false, codigo: "db_error" };
  return { ok: true, escritorio: identidade.escritorio };
}

/** Apaga a conexão. Os VÍNCULOS ficam: reconectar o mesmo escritório os reaproveita. */
export async function desconectarAtlas(
  admin: SupabaseClient,
  accountId: string,
): Promise<{ ok: true } | { ok: false; codigo: CodigoDaConexao }> {
  const { error } = await admin.from("cb_atlas_config").delete().eq("account_id", accountId);
  if (error) return { ok: false, codigo: "db_error" };
  return { ok: true };
}

/** A chave guardada, decifrada — para o passo da automação. Nunca lança. */
export async function lerChaveDoAtlas(
  admin: SupabaseClient,
  accountId: string,
): Promise<{ ok: true; chave: string; tenantId: string } | { ok: false; codigo: "nao_conectado" | "db_error" | "chave_ilegivel" }> {
  const { data, error } = await admin
    .from("cb_atlas_config")
    .select("api_key, atlas_tenant_id")
    .eq("account_id", accountId)
    .maybeSingle();
  // Erro de leitura NÃO é "desconectado" (CLAUDE.md 8b).
  if (error) return { ok: false, codigo: "db_error" };
  if (!data) return { ok: false, codigo: "nao_conectado" };
  const chave = decifrar(data.api_key);
  if (!chave) return { ok: false, codigo: "chave_ilegivel" };
  return { ok: true, chave, tenantId: String(data.atlas_tenant_id) };
}

/** Os códigos que dizem "a CHAVE parou de valer" — a conexão vai a erro. */
const CODIGOS_DA_CHAVE: CodigoDoErroAtlas[] = ["chave_invalida", "api_fora_do_plano"];

/**
 * A chave ainda vale? Chamada por quem usou a chave: chave recusada marca a
 * conexão em erro; sucesso carimba `conferido_em` e limpa SÓ esses códigos.
 * Nunca lança.
 */
export async function registrarConferencia(admin: SupabaseClient, accountId: string, codigo: CodigoDoErroAtlas | null): Promise<void> {
  const agora = new Date().toISOString();
  if (codigo !== null && !CODIGOS_DA_CHAVE.includes(codigo)) return;
  const { error } =
    codigo === null
      ? await admin.from("cb_atlas_config").update({ conferido_em: agora }).eq("account_id", accountId)
      : await admin.from("cb_atlas_config").update({ status: "erro", last_error: codigo, updated_at: agora }).eq("account_id", accountId);
  if (error) console.error("[atlas] não foi possível registrar a conferência da chave:", error.message);
  if (codigo === null) {
    const { error: erroLimpeza } = await admin
      .from("cb_atlas_config")
      .update({ status: "conectado", last_error: null, updated_at: agora })
      .eq("account_id", accountId)
      .in("last_error", CODIGOS_DA_CHAVE);
    if (erroLimpeza) console.error("[atlas] não foi possível limpar o aviso da chave:", erroLimpeza.message);
  }
}
