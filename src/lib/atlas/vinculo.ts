import type { SupabaseClient } from "@supabase/supabase-js";

import { criarClienteAtlas, type ClienteAtlas } from "./cliente";
import { codigoDe, lerChaveDoAtlas, registrarConferencia } from "./conexao";
import { conectadoNoAmbiente, type ErroDoVinculo } from "./do-contato";
import { ambienteDoAtlas, noAmbiente } from "./enderecos";
import { appUrlSegura } from "./leitura";

/**
 * O vínculo feito por GENTE (Fase 2, PR B): o administrador cola na aba
 * Atlas o link da ficha do Atlas (`ligarVinculo`) ou desfaz o vínculo
 * (`desligarVinculo`). A rota é `PUT /api/cb/atlas/contato/[contactId]/vinculo`,
 * `requireRole('admin')` (decisão do operador, 30/09/2026): um vínculo errado
 * faz o passo "Criar cliente" reativar o cadastro de OUTRA pessoa e, na Fase
 * 4, move o card pela situação dela.
 *
 * - ⚠️ Toda consulta e escrita leva a cerca de AMBIENTE (`noAmbiente`) e toda
 *   linha nova grava `api_url` (1072): o preview contra o staging grava no
 *   banco da produção.
 * - ⚠️ O que se grava vem da RESPOSTA do Atlas (`get_client`), nunca do texto
 *   colado: do link só se tira o id. Cliente de outro escritório dá
 *   `not_found` lá — o vínculo com outro escritório é impossível.
 * - Os conflitos locais (a ficha já ligada, o cliente ligado a outra ficha)
 *   são conferidos ANTES de falar com o Atlas: a cota (60/min) é do
 *   escritório, dividida com o n8n e com o passo que não repete. O 23505 da
 *   escrita relê e responde o conflito certo.
 * - ⚠️ Desvincular grava a RECUSA (`cb_atlas_recusas`) ANTES de apagar o
 *   vínculo: sem ela, a leitura e o passo religariam o mesmo cliente; na
 *   ordem inversa, uma falha no meio deixaria a ficha sem vínculo e sem
 *   recusa. Vincular à mão apaga a recusa do par.
 * - ⚠️ Toda escrita confere as linhas (`.select('id')`): em service role o
 *   `.eq('account_id')` é a única cerca, e zero linhas volta sem erro.
 */

const TABELA = "cb_atlas_clientes";
const RECUSAS = "cb_atlas_recusas";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_SOLTO = new RegExp(`^${UUID}$`, "i");
/** `…/#/clients/<uuid>`, com `?tab=…` depois ou sem (contrato §9). O host não importa. */
const LINK_DA_FICHA = new RegExp(`^\\S*#/clients/(${UUID})(?:\\?\\S*)?$`, "i");

/** Puro: o id do cliente do Atlas no link colado (ou o uuid solto); qualquer outra coisa, `null`. */
export function idDoLink(link: unknown): string | null {
  if (typeof link !== "string") return null;
  const t = link.trim();
  if (t === "" || t.length > 2000) return null;
  if (UUID_SOLTO.test(t)) return t.toLowerCase();
  const m = LINK_DA_FICHA.exec(t);
  return m ? m[1].toLowerCase() : null;
}

export type ResultadoDoVinculo = { ok: true; jaEstava: boolean } | { ok: false; codigo: ErroDoVinculo };

type FabricaDeCliente = (chave: string) => ClienteAtlas;

const falha = (codigo: ErroDoVinculo): ResultadoDoVinculo => ({ ok: false, codigo });

function ehUnicidade(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: unknown }).code === "23505";
}

type Conflito =
  | { tipo: "livre"; orfa: string | null }
  | { tipo: "mesmo"; id: string; naLixeira: boolean }
  | { tipo: "erro"; codigo: ErroDoVinculo };

/** A ficha e o cliente, NESTE ambiente: já ligados um ao outro, a outro, ou livres (com a linha órfã a adotar). */
async function conflitoLocal(
  admin: SupabaseClient,
  accountId: string,
  ambiente: string | null,
  contactId: string,
  atlasClientId: string,
  tenantId: string,
): Promise<Conflito> {
  const [daFicha, doCliente] = await Promise.all([
    noAmbiente(admin.from(TABELA).select("id, atlas_client_id, atlas_tenant_id, excluido_no_atlas_em").eq("account_id", accountId).eq("contact_id", contactId), ambiente).maybeSingle(),
    noAmbiente(admin.from(TABELA).select("id, contact_id").eq("account_id", accountId).eq("atlas_client_id", atlasClientId), ambiente).maybeSingle(),
  ]);
  if (daFicha.error || doCliente.error) return { tipo: "erro", codigo: "db_error" };
  if (daFicha.data) {
    // Vínculo do escritório ANTERIOR (invisível na tela) ocupa a chave da
    // ficha: só a reconexão confirmada no cartão o apaga.
    if (String(daFicha.data.atlas_tenant_id) !== tenantId) return { tipo: "erro", codigo: "outro_escritorio" };
    if (String(daFicha.data.atlas_client_id).toLowerCase() === atlasClientId) {
      return { tipo: "mesmo", id: String(daFicha.data.id), naLixeira: daFicha.data.excluido_no_atlas_em != null };
    }
    return { tipo: "erro", codigo: "ja_vinculado" };
  }
  if (doCliente.data?.contact_id) return { tipo: "erro", codigo: "ligado_a_outra_ficha" };
  return { tipo: "livre", orfa: doCliente.data ? String(doCliente.data.id) : null };
}

/** Depois de um conflito na escrita (23505, a órfã adotada por outro): relê e responde o certo. */
async function releitura(
  admin: SupabaseClient,
  accountId: string,
  ambiente: string | null,
  contactId: string,
  atlasClientId: string,
  tenantId: string,
): Promise<ResultadoDoVinculo> {
  const c = await conflitoLocal(admin, accountId, ambiente, contactId, atlasClientId, tenantId);
  if (c.tipo === "mesmo") return { ok: true, jaEstava: true };
  if (c.tipo === "erro") return falha(c.codigo);
  return falha("db_error");
}

export async function ligarVinculo(
  admin: SupabaseClient,
  entrada: { accountId: string; contactId: string; userId: string; link: unknown },
  opcoes: { cliente?: FabricaDeCliente; ambiente?: string | null } = {},
): Promise<ResultadoDoVinculo> {
  const { accountId, contactId, userId } = entrada;
  const atlasClientId = idDoLink(entrada.link);
  if (!atlasClientId) return falha("link_invalido");
  const ambiente = opcoes.ambiente === undefined ? ambienteDoAtlas() : opcoes.ambiente;

  const { data: contato, error: erroContato } = await admin.from("contacts").select("id").eq("id", contactId).eq("account_id", accountId).maybeSingle();
  if (erroContato) return falha("db_error");
  if (!contato) return falha("contato_nao_encontrado");

  const conexao = await lerChaveDoAtlas(admin, accountId, ambiente);
  if (!conexao.ok) {
    if (conexao.codigo === "chave_ilegivel") await registrarConferencia(admin, accountId, "chave_ilegivel", ambiente);
    return falha(conexao.codigo);
  }

  // 1) Os conflitos locais, antes de gastar a cota do Atlas. O MESMO par já
  //    ligado não fala com o Atlas — salvo o vínculo marcado NA LIXEIRA: é o
  //    "Conferir no Atlas" da aba, depois de restaurar lá (restaurar não muda
  //    o `status_changed_at`, e só a listagem completa limparia a marca).
  const conflito = await conflitoLocal(admin, accountId, ambiente, contactId, atlasClientId, conexao.tenantId);
  if (conflito.tipo === "mesmo" && !conflito.naLixeira) return { ok: true, jaEstava: true };
  if (conflito.tipo === "erro") return falha(conflito.codigo);

  // 2) O cliente existe no Atlas DESTE escritório? `null` = o `not_found` do
  //    Atlas: não existe, é de outro escritório ou está na lixeira.
  let lido;
  try {
    lido = await (opcoes.cliente ?? ((c) => criarClienteAtlas(c)))(conexao.chave).ler(atlasClientId);
  } catch (e) {
    const codigo = codigoDe(e);
    // "Consultar clientes" é OBRIGATÓRIA: desligada (e a chave recusada) marca a conexão.
    await registrarConferencia(admin, accountId, codigo, ambiente);
    if (codigo === "chave_invalida" || codigo === "api_fora_do_plano" || codigo === "sem_permissao" || codigo === "limite") return falha(codigo);
    return falha("indisponivel");
  }
  if (!lido) return falha(conflito.tipo === "mesmo" ? "ainda_na_lixeira" : "nao_encontrado");
  await registrarConferencia(admin, accountId, null, ambiente);

  if (conflito.tipo === "mesmo") {
    // Restaurado no Atlas: sai SÓ a marca. A situação fica para a leitura
    // periódica, que decide se a mudança é evento (`decidirMudanca`) —
    // gravá-la aqui calaria uma mudança feita enquanto estava na lixeira.
    const { data, error } = await noAmbiente(
      admin.from(TABELA).update({ excluido_no_atlas_em: null, updated_at: new Date().toISOString() }).eq("id", conflito.id).eq("account_id", accountId).eq("contact_id", contactId),
      ambiente,
    ).select("id");
    if (error) return falha("db_error");
    if (data && data.length > 0) return { ok: true, jaEstava: true };
    // Zero linhas: desvinculado (ou religado) no meio — relê e responde o que há.
    const agoraHa = await conflitoLocal(admin, accountId, ambiente, contactId, atlasClientId, conexao.tenantId);
    if (agoraHa.tipo === "mesmo") return { ok: true, jaEstava: true };
    return falha(agoraHa.tipo === "erro" ? agoraHa.codigo : "sem_vinculo");
  }

  // 3) O vínculo, com o que o Atlas RESPONDEU.
  const agora = new Date().toISOString();
  const linha = {
    contact_id: contactId,
    atlas_tenant_id: conexao.tenantId,
    app_url: appUrlSegura(lido.appUrl, atlasClientId),
    situacao: lido.status,
    situacao_desde: lido.situacaoDesde ?? null,
    situacao_lida_em: agora,
    origem: "manual",
    casou_por: null,
    vinculado_por: userId,
    excluido_no_atlas_em: null,
    updated_at: agora,
  };
  if (conflito.orfa) {
    // A linha ÓRFÃ do cliente (a ficha antiga foi apagada): esta ficha a adota
    // — só se continua órfã.
    const { data, error } = await noAmbiente(
      admin.from(TABELA).update(linha).eq("id", conflito.orfa).eq("account_id", accountId).is("contact_id", null),
      ambiente,
    ).select("id");
    if (error && !ehUnicidade(error)) return falha("db_error");
    if (error || !data || data.length === 0) return releitura(admin, accountId, ambiente, contactId, atlasClientId, conexao.tenantId);
  } else {
    const { data, error } = await admin
      .from(TABELA)
      .insert({ account_id: accountId, api_url: ambiente, atlas_client_id: atlasClientId, ...linha })
      .select("id");
    if (ehUnicidade(error)) return releitura(admin, accountId, ambiente, contactId, atlasClientId, conexao.tenantId);
    if (error || !data || data.length === 0) return falha("db_error");
  }

  // 4) A recusa do par, se houver, sai: gente disse que É este cliente.
  const { error: erroRecusa } = await noAmbiente(
    admin.from(RECUSAS).delete().eq("account_id", accountId).eq("contact_id", contactId).eq("atlas_client_id", atlasClientId),
    ambiente,
  );
  if (erroRecusa) console.error("[atlas] vínculo gravado, mas a recusa antiga do par não saiu:", erroRecusa.message);
  return { ok: true, jaEstava: false };
}

export async function desligarVinculo(
  admin: SupabaseClient,
  entrada: { accountId: string; contactId: string; userId: string },
  opcoes: { ambiente?: string | null } = {},
): Promise<ResultadoDoVinculo> {
  const { accountId, contactId, userId } = entrada;
  const ambiente = opcoes.ambiente === undefined ? ambienteDoAtlas() : opcoes.ambiente;

  // O escritório da conexão DESTE ambiente: o vínculo de outro é invisível na tela.
  const { data: config, error: erroConfig } = await admin.from("cb_atlas_config").select("api_url, atlas_tenant_id").eq("account_id", accountId).maybeSingle();
  if (erroConfig) return falha("db_error");
  if (!config || !conectadoNoAmbiente(config, ambiente)) return falha("nao_conectado");

  const { data: vinculo, error: erroVinculo } = await noAmbiente(
    admin.from(TABELA).select("id, atlas_client_id").eq("account_id", accountId).eq("contact_id", contactId).eq("atlas_tenant_id", String(config.atlas_tenant_id)),
    ambiente,
  ).maybeSingle();
  if (erroVinculo) return falha("db_error");
  if (!vinculo) return falha("sem_vinculo");

  // 1) A recusa ANTES: "esta ficha NÃO é este cliente" (o 23505 = já recusado).
  const { error: erroRecusa } = await admin.from(RECUSAS).insert({
    account_id: accountId,
    api_url: ambiente,
    contact_id: contactId,
    atlas_client_id: String(vinculo.atlas_client_id),
    recusado_por: userId,
  });
  if (erroRecusa && !ehUnicidade(erroRecusa)) return falha("db_error");

  // 2) O vínculo sai (nada muda no Atlas).
  const { data: apagados, error: erroApagar } = await noAmbiente(
    admin.from(TABELA).delete().eq("id", String(vinculo.id)).eq("account_id", accountId),
    ambiente,
  ).select("id");
  if (erroApagar) return falha("db_error");
  if (!apagados || apagados.length === 0) return falha("sem_vinculo");
  return { ok: true, jaEstava: false };
}
