import type { SupabaseClient } from "@supabase/supabase-js";

import { registrarTeste, type ResultadoDoTeste } from "@/lib/integracoes/credencial";
import { decrypt } from "@/lib/whatsapp/encryption";

import { criarClienteMeta, MetaAdsError, type ClienteMeta } from "./cliente";

/**
 * "Testar agora" do Meta Ads (1127): o token GUARDADO ainda lê a conta de
 * anúncios gravada? A mesma prova do conectar (`GET /act_<id>?fields=name,
 * currency`), só leitura. O resultado vai para a conexão pela régua de
 * `registrarTeste`: os códigos do TOKEN (e o da cifra) entram por aqui;
 * `limite`, `rede` e `meta_error` não dizem nada sobre o token.
 *
 * ⚠️ `sem_permissao` entra, mas NÃO sai por aqui: a sincronização o grava
 * quando falha em `/campaigns` ou `/insights`, e ler a conta não prova que
 * essas leituras voltaram. Quem o limpa é a próxima sincronização que passa
 * (o cron sincroniza toda conexão, com erro ou sem).
 *
 * ⚠️ A mensagem da Meta ecoa o token: aqui só o CÓDIGO sai (`MetaAdsError`
 * já passou a mensagem por `semSegredo`, e ela nem é lida).
 */
const MARCA_DO_TESTE = ["token_invalido", "sem_permissao", "conta_nao_encontrada", "chave_ilegivel"];
const LIMPA_DO_TESTE = ["token_invalido", "conta_nao_encontrada", "chave_ilegivel"];

export async function conferirMetaAds(
  admin: SupabaseClient,
  accountId: string,
  opcoes: { cliente?: (token: string) => ClienteMeta } = {},
): Promise<ResultadoDoTeste> {
  const { data, error } = await admin
    .from("cb_meta_ads_config")
    .select("access_token, ad_account_id")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) return { ok: false, codigo: "db_error" };
  if (!data) return { ok: false, codigo: "nao_conectado" };
  const resultado = await testarTokenGuardado(data.access_token, String(data.ad_account_id), opcoes.cliente ?? ((t) => criarClienteMeta(t)));
  await registrarTeste(admin, "cb_meta_ads_config", accountId, resultado, { marca: MARCA_DO_TESTE, limpa: LIMPA_DO_TESTE }, { coluna: "access_token", valor: String(data.access_token) });
  return resultado;
}

async function testarTokenGuardado(
  cifrado: unknown,
  adAccountId: string,
  fabrica: (token: string) => ClienteMeta,
): Promise<ResultadoDoTeste> {
  let token: string;
  try {
    token = decrypt(cifrado as string);
  } catch {
    return { ok: false, codigo: "chave_ilegivel" };
  }
  try {
    await fabrica(token).conta(adAccountId);
    return { ok: true };
  } catch (e) {
    return { ok: false, codigo: e instanceof MetaAdsError ? e.codigo : "meta_error" };
  }
}
