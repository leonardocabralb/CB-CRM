import type { SupabaseClient } from "@supabase/supabase-js";

import { gerarTokenDaUrl, gerarTokenDeAutenticacao } from "@/lib/asaas/webhook";
import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

import { criarClienteZapSign, ZapSignError, type ClienteZapSign, type CodigoDoErroZapSign } from "./cliente";
import { EVENTO_ASSINADO } from "./leitura";

/**
 * Conectar, reativar o webhook e desconectar o ZapSign — o I/O da conexão.
 *
 * Conectar = provar o token (`GET /templates/?page=1`: 401/403 é token
 * inválido, 402 é conta sem plano de API — sem ele o CRM não relê o documento
 * assinado), ler o plano (`GET /info-plan`, informativo), gravar tudo CIFRADO
 * e criar o webhook `doc_signed` com a CREDENCIAL no cabeçalho
 * (`Authorization: Bearer <segredo>`; o ZapSign não assina com HMAC).
 *
 * ⚠️⚠️ O webhook só é criado a partir do PRÓPRIO host público
 * (`podeCriarDaqui`, a guarda do Asaas): o `.env.local` do preview carrega a
 * URL da produção, e criar dali registraria no ZapSign um endereço que só
 * atende depois do deploy. Conectado de outro lugar, o webhook fica
 * `ausente` e o cartão oferece "Reativar webhook" — que só vale no host
 * público também.
 *
 * ⚠️ Reaproveita antes de criar: reconectar com o MESMO token mantém o
 * webhook que já existe (o ZapSign não tem rota de listar webhooks — o id
 * guardado é a única memória dele). Token de outra conta do ZapSign = o
 * webhook antigo é apagado com o token ANTIGO e um novo é criado. O token da
 * URL e a credencial são reaproveitados sempre que legíveis: um webhook vivo
 * continua autenticando.
 */

export const TIPO_DO_WEBHOOK = EVENTO_ASSINADO;

export function urlDoWebhook(origem: string, token: string): string {
  return `${origem.replace(/\/+$/, "")}/api/cb/zapsign/webhook/${token}`;
}

/** O cabeçalho que o ZapSign devolve em cada entrega — e que a rota confere. */
export function cabecalhoDoWebhook(segredo: string): { nome: string; valor: string } {
  return { nome: "Authorization", valor: `Bearer ${segredo}` };
}

export type CodigoDaConexao =
  | CodigoDoErroZapSign
  | "url_inalcancavel"
  | "fora_do_host"
  | "db_error"
  | "nao_conectado"
  | "token_ilegivel";

export type EstadoDoWebhook = "ativo" | "ausente" | "erro";

type FabricaDeCliente = (token: string, segredos?: string[]) => ClienteZapSign;

export interface OpcoesDaConexao {
  /** A origem pública do CRM (`origemPublica()`), ou nula quando não é alcançável de fora. */
  origem: string | null;
  /** O pedido veio do próprio host público (`podeCriarDaqui`)? Só então se mexe em webhook. */
  podeCriarWebhook: boolean;
  cliente?: FabricaDeCliente;
}

function codigoDe(e: unknown): CodigoDoErroZapSign {
  return e instanceof ZapSignError ? e.codigo : "zapsign_error";
}

function fabricaDe(opcoes: { cliente?: FabricaDeCliente }): FabricaDeCliente {
  return opcoes.cliente ?? ((t, s) => criarClienteZapSign(t, fetch, s ?? []));
}

function decifrar(texto: unknown): string | null {
  if (typeof texto !== "string" || texto === "") return null;
  try {
    return decrypt(texto);
  } catch {
    return null;
  }
}

/** Por que o webhook não pode ser criado AQUI (nulo = pode). */
function motivoParaNaoCriar(opcoes: OpcoesDaConexao): CodigoDaConexao | null {
  if (!opcoes.origem) return "url_inalcancavel";
  if (!opcoes.podeCriarWebhook) return "fora_do_host";
  return null;
}

/** Apaga um webhook no ZapSign; "já não existe" conta como apagado. Devolve se sumiu. */
async function apagarWebhook(cliente: ClienteZapSign, id: string): Promise<boolean> {
  try {
    await cliente.apagarWebhook(id);
    return true;
  } catch (e) {
    if (codigoDe(e) === "nao_encontrado") return true;
    console.warn("[zapsign] não foi possível apagar o webhook antigo:", e instanceof Error ? e.message : e);
    return false;
  }
}

export type ResultadoDaConexao =
  | { ok: true; plano: string | null; webhook: EstadoDoWebhook; webhookErro: CodigoDaConexao | null }
  | { ok: false; codigo: CodigoDaConexao };

export async function conectarZapSign(
  admin: SupabaseClient,
  accountId: string,
  userId: string,
  token: string,
  opcoes: OpcoesDaConexao,
): Promise<ResultadoDaConexao> {
  const fabrica = fabricaDe(opcoes);
  const cliente = fabrica(token);

  // 1) O token vale, e a conta tem plano de API?
  try {
    await cliente.modelos(1);
  } catch (e) {
    console.warn(`[zapsign] conexão recusada (${codigoDe(e)}):`, e instanceof Error ? e.message : e);
    return { ok: false, codigo: codigoDe(e) };
  }
  let plano: string | null = null;
  try {
    plano = (await cliente.plano())?.nome ?? null;
  } catch (e) {
    // Informativo — exceto a falta de plano, que impede a releitura.
    if (codigoDe(e) === "sem_plano") return { ok: false, codigo: "sem_plano" };
    console.warn("[zapsign] plano não lido:", e instanceof Error ? e.message : e);
  }

  // 2) O que já havia: token da URL, credencial e webhook são reaproveitados.
  const { data: anterior, error: erroLeitura } = await admin
    .from("cb_zapsign_config")
    .select("api_token, webhook_url_token, webhook_secret, webhook_id, webhook_estado")
    .eq("account_id", accountId)
    .maybeSingle();
  if (erroLeitura) return { ok: false, codigo: "db_error" };

  const tokenDaUrl = typeof anterior?.webhook_url_token === "string" && anterior.webhook_url_token ? anterior.webhook_url_token : gerarTokenDaUrl();
  const segredoAntigo = decifrar(anterior?.webhook_secret);
  const segredo = segredoAntigo ?? gerarTokenDeAutenticacao();
  const tokenAntigo = decifrar(anterior?.api_token);
  const idAntigo = typeof anterior?.webhook_id === "string" && anterior.webhook_id ? anterior.webhook_id : null;

  // 3) O webhook.
  let webhookId: string | null = idAntigo;
  let estado: EstadoDoWebhook = idAntigo && anterior?.webhook_estado === "ativo" ? "ativo" : "ausente";
  let webhookErro: CodigoDaConexao | null = null;
  const mantem = idAntigo !== null && estado === "ativo" && segredoAntigo !== null && tokenAntigo === token;
  if (!mantem) {
    const naoCriar = motivoParaNaoCriar(opcoes);
    if (naoCriar) {
      // Nada se mexe no ZapSign daqui. Com o token trocado, o webhook antigo
      // (da outra conta) deixa de ser "o nosso ativo"; com a credencial nova
      // (a antiga ilegível), ele manda a velha e a rota o recusa.
      if (tokenAntigo !== token || segredoAntigo === null) estado = "ausente";
      webhookErro = estado === "ativo" ? null : naoCriar;
    } else {
      if (idAntigo) await apagarWebhook(fabrica(tokenAntigo ?? token, [segredo]), idAntigo);
      try {
        const criado = await fabrica(token, [segredo]).criarWebhook({
          url: urlDoWebhook(opcoes.origem as string, tokenDaUrl),
          tipo: TIPO_DO_WEBHOOK,
          cabecalho: cabecalhoDoWebhook(segredo),
        });
        webhookId = criado.id;
        estado = "ativo";
      } catch (e) {
        webhookErro = codigoDe(e);
        webhookId = null;
        estado = "erro";
        console.warn(`[zapsign] criação do webhook recusada (${webhookErro}):`, e instanceof Error ? e.message : e);
      }
    }
  }

  const agora = new Date().toISOString();
  const { error } = await admin.from("cb_zapsign_config").upsert(
    {
      account_id: accountId,
      api_token: encrypt(token),
      webhook_url_token: tokenDaUrl,
      webhook_secret: encrypt(segredo),
      webhook_id: webhookId,
      webhook_estado: estado,
      plano,
      status: "conectado",
      last_error: webhookErro,
      conectado_em: agora,
      conferido_em: agora,
      created_by: userId,
      updated_at: agora,
    },
    { onConflict: "account_id" },
  );
  if (error) return { ok: false, codigo: "db_error" };
  return { ok: true, plano, webhook: estado, webhookErro };
}

/** Recria o webhook com o token e a credencial guardados. Só no host público. */
export async function reativarWebhook(
  admin: SupabaseClient,
  accountId: string,
  opcoes: OpcoesDaConexao,
): Promise<{ ok: true } | { ok: false; codigo: CodigoDaConexao }> {
  const naoCriar = motivoParaNaoCriar(opcoes);
  if (naoCriar) return { ok: false, codigo: naoCriar };
  const { data: config, error } = await admin
    .from("cb_zapsign_config")
    .select("api_token, webhook_url_token, webhook_secret, webhook_id")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) return { ok: false, codigo: "db_error" };
  if (!config) return { ok: false, codigo: "nao_conectado" };
  const token = decifrar(config.api_token);
  const segredo = decifrar(config.webhook_secret);
  if (!token || !segredo) return { ok: false, codigo: "token_ilegivel" };

  const cliente = fabricaDe(opcoes)(token, [segredo]);
  if (typeof config.webhook_id === "string" && config.webhook_id) await apagarWebhook(cliente, config.webhook_id);
  const agora = new Date().toISOString();
  try {
    const criado = await cliente.criarWebhook({
      url: urlDoWebhook(opcoes.origem as string, config.webhook_url_token as string),
      tipo: TIPO_DO_WEBHOOK,
      cabecalho: cabecalhoDoWebhook(segredo),
    });
    const { error: erroUpdate } = await admin
      .from("cb_zapsign_config")
      .update({ webhook_id: criado.id, webhook_estado: "ativo", status: "conectado", last_error: null, updated_at: agora })
      .eq("account_id", accountId);
    if (erroUpdate) return { ok: false, codigo: "db_error" };
    return { ok: true };
  } catch (e) {
    const codigo = codigoDe(e);
    console.warn(`[zapsign] reativação do webhook recusada (${codigo}):`, e instanceof Error ? e.message : e);
    await admin
      .from("cb_zapsign_config")
      .update({ webhook_id: null, webhook_estado: "erro", last_error: codigo, updated_at: agora })
      .eq("account_id", accountId);
    return { ok: false, codigo };
  }
}

/**
 * Apaga o webhook no ZapSign e a config. Os eventos e os documentos FICAM,
 * para o histórico. `webhookNaoApagado` = o ZapSign não confirmou: a tela
 * manda apagar pelo painel (Configurações > Integrações > API ZapSign >
 * Webhooks), senão ele insiste numa rota que passa a responder 404.
 */
export async function desconectarZapSign(
  admin: SupabaseClient,
  accountId: string,
  opcoes: { cliente?: FabricaDeCliente } = {},
): Promise<{ ok: true; webhookNaoApagado: boolean } | { ok: false; codigo: CodigoDaConexao }> {
  const { data: config, error: erroLeitura } = await admin
    .from("cb_zapsign_config")
    .select("api_token, webhook_id")
    .eq("account_id", accountId)
    .maybeSingle();
  if (erroLeitura) return { ok: false, codigo: "db_error" };
  let webhookNaoApagado = false;
  if (config && typeof config.webhook_id === "string" && config.webhook_id) {
    const token = decifrar(config.api_token);
    webhookNaoApagado = token ? !(await apagarWebhook(fabricaDe(opcoes)(token), config.webhook_id)) : true;
  }
  const { error } = await admin.from("cb_zapsign_config").delete().eq("account_id", accountId);
  if (error) return { ok: false, codigo: "db_error" };
  return { ok: true, webhookNaoApagado };
}

/**
 * O token ainda vale? Chamada quando a tela lista os modelos: 401/403 marca a
 * conexão em erro (`token_invalido`); sucesso carimba `conferido_em` e limpa
 * SÓ esse código — outro erro gravado é de outra coisa. Nunca lança.
 */
export async function registrarConferencia(admin: SupabaseClient, accountId: string, codigo: CodigoDoErroZapSign | null): Promise<void> {
  const agora = new Date().toISOString();
  const escrita =
    codigo === "token_invalido"
      ? admin.from("cb_zapsign_config").update({ status: "erro", last_error: "token_invalido", updated_at: agora }).eq("account_id", accountId)
      : codigo === null
        ? admin.from("cb_zapsign_config").update({ conferido_em: agora }).eq("account_id", accountId)
        : null;
  if (!escrita) return;
  const { error } = await escrita;
  if (error) console.error("[zapsign] não foi possível registrar a conferência do token:", error.message);
  if (codigo === null) {
    const { error: erroLimpeza } = await admin
      .from("cb_zapsign_config")
      .update({ status: "conectado", last_error: null, updated_at: agora })
      .eq("account_id", accountId)
      .eq("last_error", "token_invalido");
    if (erroLimpeza) console.error("[zapsign] não foi possível limpar o aviso de token inválido:", erroLimpeza.message);
  }
}
