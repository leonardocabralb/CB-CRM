/**
 * O endereço da API do Atlas Gestor. É o MESMO para todo escritório (o Atlas
 * é multi-inquilino: quem diz de qual escritório é a CHAVE), por isso é uma
 * constante do produto, como o `ORIGEM_ZAPSIGN`.
 *
 * `ATLAS_API_URL` (servidor) troca o endereço — serve para testar contra o
 * STAGING do Atlas no preview. ⚠️ O preview grava no banco da PRODUÇÃO
 * (CLAUDE.md 8b): a conexão feita lá com uma chave de staging fica gravada na
 * conta real e precisa ser desconectada antes do deploy.
 */

export const API_DO_ATLAS = "https://tdhgpaurcjinhbandmvb.supabase.co/functions/v1/client-webhook";

/** Só `https://`; qualquer outra coisa na variável cai no endereço do produto. */
export function urlDaApiDoAtlas(env: string | undefined = process.env.ATLAS_API_URL): string {
  const valor = env?.trim();
  if (!valor) return API_DO_ATLAS;
  try {
    const u = new URL(valor);
    return u.protocol === "https:" ? u.toString() : API_DO_ATLAS;
  } catch {
    return API_DO_ATLAS;
  }
}
