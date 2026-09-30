import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

import { AtlasError, criarClienteAtlas, type ClienteAtlas, type CodigoDoErroAtlas } from "./cliente";
import { ambienteDoAtlas } from "./enderecos";

/**
 * Conectar e desconectar o Atlas — o I/O da conexão (`cb_atlas_config`, 1071).
 *
 * Conectar = provar a chave com o `whoami` do Atlas (SÓ LEITURA: nada é
 * gravado lá), conferir que as permissões que o passo "Criar cliente no
 * Atlas" usa estão ligadas no escritório, e só então gravar a chave CIFRADA.
 * A chave nunca volta por rota nenhuma, nem mascarada.
 *
 * ⚠️ Chave de OUTRO escritório do Atlas é RECUSADA enquanto houver fichas
 * ligadas a clientes do escritório anterior (`outro_escritorio`): os ids são
 * de lá, e o botão e a faixa apontariam para cliente alheio. A saída hoje é
 * apagar esses vínculos à mão (pendência da Fase 2 no plano).
 *
 * ⚠️ AMBIENTE (`api_url`, ver `enderecos.ts`): a instância apontada para
 * outro Atlas (o staging, no preview que grava no banco da produção) não
 * conecta por cima nem desconecta a conexão de outro ambiente
 * (`outro_ambiente`), e a chave de um ambiente nunca é mandada ao outro.
 */

/** O que o passo usa: procurar (Consultar), criar e reativar. */
export const PERMISSOES_NECESSARIAS = ["read_client", "create_client", "update_client"] as const;

export type CodigoDaConexao =
  | CodigoDoErroAtlas
  | "db_error"
  | "nao_conectado"
  | "chave_ilegivel"
  | "outro_escritorio"
  | "permissoes_faltando"
  | "outro_ambiente"
  /** A rota recusa a cola antes de falar com o Atlas (tamanho, espaço no meio). */
  | "chave_mal_colada";

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
  opcoes: { cliente?: FabricaDeCliente; ambiente?: string | null } = {},
): Promise<ResultadoDaConexao> {
  const ambiente = opcoes.ambiente === undefined ? ambienteDoAtlas() : opcoes.ambiente;

  // 0) A instância de TESTE não grava por cima da conexão de outro ambiente
  //    (a do Atlas de verdade, no banco que o preview compartilha). A de
  //    verdade pode substituir uma de teste esquecida.
  if (ambiente !== null) {
    const { data: atual, error } = await admin.from("cb_atlas_config").select("api_url").eq("account_id", accountId).maybeSingle();
    if (error) return { ok: false, codigo: "db_error" };
    if (atual && (atual.api_url ?? null) !== ambiente) return { ok: false, codigo: "outro_ambiente" };
  }

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
      api_url: ambiente,
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

/**
 * Apaga a conexão. Os VÍNCULOS ficam: reconectar o mesmo escritório os
 * reaproveita. A instância de teste só apaga a conexão do PRÓPRIO ambiente.
 */
export async function desconectarAtlas(
  admin: SupabaseClient,
  accountId: string,
  ambiente: string | null = ambienteDoAtlas(),
): Promise<{ ok: true } | { ok: false; codigo: CodigoDaConexao }> {
  if (ambiente !== null) {
    const { data: atual, error } = await admin.from("cb_atlas_config").select("api_url").eq("account_id", accountId).maybeSingle();
    if (error) return { ok: false, codigo: "db_error" };
    if (atual && (atual.api_url ?? null) !== ambiente) return { ok: false, codigo: "outro_ambiente" };
  }
  let apagar = admin.from("cb_atlas_config").delete().eq("account_id", accountId);
  if (ambiente !== null) apagar = apagar.eq("api_url", ambiente);
  const { error } = await apagar;
  if (error) return { ok: false, codigo: "db_error" };
  return { ok: true };
}

/** A chave guardada, decifrada — para o passo da automação. Nunca lança. */
export async function lerChaveDoAtlas(
  admin: SupabaseClient,
  accountId: string,
  ambiente: string | null = ambienteDoAtlas(),
): Promise<
  { ok: true; chave: string; tenantId: string } | { ok: false; codigo: "nao_conectado" | "db_error" | "chave_ilegivel" | "outro_ambiente" }
> {
  const { data, error } = await admin
    .from("cb_atlas_config")
    .select("api_key, api_url, atlas_tenant_id")
    .eq("account_id", accountId)
    .maybeSingle();
  // Erro de leitura NÃO é "desconectado" (CLAUDE.md 8b).
  if (error) return { ok: false, codigo: "db_error" };
  if (!data) return { ok: false, codigo: "nao_conectado" };
  // A chave do staging nunca vai à API de verdade, nem o contrário.
  if ((data.api_url ?? null) !== ambiente) return { ok: false, codigo: "outro_ambiente" };
  const chave = decifrar(data.api_key);
  if (!chave) return { ok: false, codigo: "chave_ilegivel" };
  return { ok: true, chave, tenantId: String(data.atlas_tenant_id) };
}

/**
 * Os códigos que dizem "a CONEXÃO parou de servir" — ela vai a erro, e o
 * cartão mostra o motivo. `chave_ilegivel` é nosso (a `ENCRYPTION_KEY`
 * mudou, a cifra estragou); `sem_permissao` é a permissão desligada no Atlas
 * DEPOIS de conectar. Sem eles aqui, o cartão diria "conectado" com todo
 * passo falhando. O próximo sucesso limpa — menos `sem_permissao`: um
 * sucesso prova só a permissão que ele usou (vincular prova Consultar;
 * reativar, Atualizar), nunca as três. Esse aviso só sai por `conferirConexao`
 * (o botão "Conferir de novo" do cartão, que refaz o `whoami`) ou reconectando.
 */
const CODIGOS_DA_CHAVE: CodigoDaConexao[] = ["chave_invalida", "api_fora_do_plano", "chave_ilegivel", "sem_permissao"];
const LIMPOS_POR_SUCESSO = CODIGOS_DA_CHAVE.filter((c) => c !== "sem_permissao");

/**
 * A chave ainda vale? Chamada por quem usou a chave: chave recusada marca a
 * conexão em erro; sucesso carimba `conferido_em` e limpa SÓ esses códigos.
 * Nunca lança.
 */
export async function registrarConferencia(
  admin: SupabaseClient,
  accountId: string,
  codigo: CodigoDoErroAtlas | "chave_ilegivel" | null,
  ambiente: string | null = ambienteDoAtlas(),
): Promise<void> {
  const agora = new Date().toISOString();
  if (codigo !== null && !CODIGOS_DA_CHAVE.includes(codigo)) return;
  // Só a conexão DESTE ambiente: o staging recusando uma chave não marca a de verdade.
  const daConexao = (patch: Record<string, unknown>) => {
    const q = admin.from("cb_atlas_config").update(patch).eq("account_id", accountId);
    return ambiente === null ? q.is("api_url", null) : q.eq("api_url", ambiente);
  };
  const { error } =
    codigo === null ? await daConexao({ conferido_em: agora }) : await daConexao({ status: "erro", last_error: codigo, updated_at: agora });
  if (error) console.error("[atlas] não foi possível registrar a conferência da chave:", error.message);
  if (codigo === null) {
    const { error: erroLimpeza } = await daConexao({ status: "conectado", last_error: null, updated_at: agora }).in("last_error", LIMPOS_POR_SUCESSO);
    if (erroLimpeza) console.error("[atlas] não foi possível limpar o aviso da chave:", erroLimpeza.message);
  }
}

/**
 * "Conferir de novo" (o cartão, admin): refaz o `whoami` com a chave GUARDADA
 * — nada é gravado no Atlas — e reescreve o estado da conexão deste ambiente.
 * É a única saída do `sem_permissao` sem colar a chave outra vez (o Atlas a
 * mostra uma vez só).
 */
export async function conferirConexao(
  admin: SupabaseClient,
  accountId: string,
  opcoes: { cliente?: FabricaDeCliente; ambiente?: string | null } = {},
): Promise<ResultadoDaConexao> {
  const ambiente = opcoes.ambiente === undefined ? ambienteDoAtlas() : opcoes.ambiente;
  const conexao = await lerChaveDoAtlas(admin, accountId, ambiente);
  if (!conexao.ok) {
    if (conexao.codigo === "chave_ilegivel") await registrarConferencia(admin, accountId, "chave_ilegivel", ambiente);
    return { ok: false, codigo: conexao.codigo };
  }
  const agora = new Date().toISOString();
  const daConexao = (patch: Record<string, unknown>) => {
    const q = admin.from("cb_atlas_config").update(patch).eq("account_id", accountId);
    return ambiente === null ? q.is("api_url", null) : q.eq("api_url", ambiente);
  };
  let identidade;
  try {
    identidade = await fabricaDe(opcoes)(conexao.chave).whoami();
  } catch (e) {
    await registrarConferencia(admin, accountId, codigoDe(e), ambiente);
    return { ok: false, codigo: codigoDe(e) };
  }
  const faltando = PERMISSOES_NECESSARIAS.filter((p) => identidade.permissoes[p] !== true);
  // Escritório trocado por trás da mesma chave não acontece (a chave é DELE); ainda assim, não se afirma "ok" sobre outro tenant.
  if (identidade.tenantId !== conexao.tenantId) {
    const { error } = await daConexao({ status: "erro", last_error: "outro_escritorio", updated_at: agora });
    return error ? { ok: false, codigo: "db_error" } : { ok: false, codigo: "outro_escritorio" };
  }
  const { error } =
    faltando.length > 0
      ? await daConexao({ status: "erro", last_error: "sem_permissao", conferido_em: agora, updated_at: agora })
      : await daConexao({ status: "conectado", last_error: null, escritorio: identidade.escritorio, conferido_em: agora, updated_at: agora });
  if (error) return { ok: false, codigo: "db_error" };
  return faltando.length > 0 ? { ok: false, codigo: "permissoes_faltando", faltando } : { ok: true, escritorio: identidade.escritorio };
}
