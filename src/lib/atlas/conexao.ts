import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

import { AtlasError, criarClienteAtlas, type ClienteAtlas, type CodigoDoErroAtlas } from "./cliente";
import { ambienteDoAtlas, noAmbiente } from "./enderecos";

/**
 * Conectar e desconectar o Atlas — o I/O da conexão (`cb_atlas_config`, 1071).
 *
 * Conectar = provar a chave com o `whoami` do Atlas (SÓ LEITURA: nada é
 * gravado lá), conferir que as permissões que o passo "Criar cliente no
 * Atlas" usa estão ligadas no escritório, e só então gravar a chave CIFRADA.
 * A chave nunca volta por rota nenhuma, nem mascarada.
 *
 * ⚠️ Chave de OUTRO escritório do Atlas é RECUSADA enquanto houver fichas
 * ligadas, NESTE ambiente, a clientes do escritório anterior
 * (`outro_escritorio`, com quantos): os ids são de lá, e o botão e a faixa
 * apontariam para cliente alheio. A saída é o admin confirmar no cartão
 * (`apagarVinculosAnteriores`): os vínculos do escritório anterior DESTE
 * ambiente são apagados, e a conexão segue. Vínculos de teste do staging não
 * barram a conexão de verdade (e vice-versa).
 *
 * ⚠️ Conectar ZERA o estado da leitura das situações (1072): o cursor do
 * Atlas vale em qualquer ambiente, e um cursor ou um `situacoes_lidas_ate`
 * herdado do staging (ou do escritório anterior) faria a produção pular, em
 * silêncio, a primeira listagem completa. Um ciclo em curso perde a cerca de
 * posse e para na próxima prova dela (`situacoes.ts`: cada página, vínculo
 * automático e escrita da lixeira a provam antes).
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
  | { ok: false; codigo: CodigoDaConexao; faltando?: string[]; vinculosAnteriores?: number };

/** O estado da leitura das situações (1072), zerado a cada conexão. */
export const ESTADO_DA_LEITURA_ZERADO = {
  sincronizando_desde: null,
  last_sync_attempt_at: null,
  last_sync_at: null,
  situacoes_lidas_ate: null,
  mudancas_desde: null,
  mudancas_cursor: null,
  mudancas_iniciada_em: null,
  listagem_completa_em: null,
  listagem_iniciada_em: null,
  listagem_cursor: null,
  sync_erro: null,
} as const;

export async function conectarAtlas(
  admin: SupabaseClient,
  accountId: string,
  userId: string,
  chave: string,
  opcoes: { cliente?: FabricaDeCliente; ambiente?: string | null; apagarVinculosAnteriores?: boolean } = {},
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

  // 2) Os vínculos que já existem NESTE ambiente são deste escritório? Sem a
  //    confirmação do admin, vínculo do escritório anterior RECUSA a conexão.
  if (opcoes.apagarVinculosAnteriores !== true) {
    const alheios = admin.from("cb_atlas_clientes").select("id", { count: "exact", head: true }).eq("account_id", accountId).neq("atlas_tenant_id", identidade.tenantId);
    const { count, error: erroVinculos } = await noAmbiente(alheios, ambiente);
    // Sem a contagem não se sabe: falha fechada (nunca "nenhum vínculo alheio").
    if (erroVinculos || typeof count !== "number") return { ok: false, codigo: "db_error" };
    if (count > 0) return { ok: false, codigo: "outro_escritorio", vinculosAnteriores: count };
  }

  // 3) Grava cifrado, com a leitura das situações do zero.
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
      ...ESTADO_DA_LEITURA_ZERADO,
    },
    { onConflict: "account_id" },
  );
  if (error) return { ok: false, codigo: "db_error" };

  // 4) Com a confirmação, os vínculos do escritório anterior saem SÓ DEPOIS
  //    de a conexão nova estar gravada: se a gravação falhasse (a cifra, o
  //    banco), nada teria sido apagado — é a ação que não se desfaz. Se o
  //    apagar falhar, a conexão nova já vale, mas a resposta é db_error: os
  //    vínculos velhos ocupam a chave das fichas, e "apagar" de novo os tira.
  if (opcoes.apagarVinculosAnteriores === true) {
    const { error: erroApagar } = await noAmbiente(
      admin.from("cb_atlas_clientes").delete().eq("account_id", accountId).neq("atlas_tenant_id", identidade.tenantId),
      ambiente,
    );
    // A conexão nova já vale, mas os vínculos velhos ocupam a chave das fichas:
    // o cartão tem de dizer que falhou, para o admin repetir.
    if (erroApagar) {
      console.error("[atlas] conexão gravada, mas os vínculos do escritório anterior não saíram:", erroApagar.message);
      return { ok: false, codigo: "db_error" };
    }
  }
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
  /**
   * A cerca de posse da leitura periódica (`sincronizando_desde` = o carimbo
   * do cadeado): uma reconexão no meio zera o cadeado, e o erro da chave VELHA
   * não marca a conexão NOVA.
   */
  cerca: { sincronizandoDesde: string } | null = null,
): Promise<void> {
  const agora = new Date().toISOString();
  if (codigo !== null && !CODIGOS_DA_CHAVE.includes(codigo)) return;
  // Só a conexão DESTE ambiente: o staging recusando uma chave não marca a de verdade.
  const daConexao = (patch: Record<string, unknown>) => {
    const q = admin.from("cb_atlas_config").update(patch).eq("account_id", accountId);
    const noAmb = ambiente === null ? q.is("api_url", null) : q.eq("api_url", ambiente);
    return cerca ? noAmb.eq("sincronizando_desde", cerca.sincronizandoDesde) : noAmb;
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
