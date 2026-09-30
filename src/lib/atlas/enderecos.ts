/**
 * O endereço da API do Atlas Gestor. É o MESMO para todo escritório (o Atlas
 * é multi-inquilino: quem diz de qual escritório é a CHAVE), por isso é uma
 * constante do produto, como o `ORIGEM_ZAPSIGN`.
 *
 * `ATLAS_API_URL` (servidor) troca o endereço — serve para testar contra o
 * STAGING do Atlas no preview. ⚠️ O preview grava no banco da PRODUÇÃO
 * (CLAUDE.md 8b), por isso a conexão guarda o AMBIENTE em que nasceu
 * (`cb_atlas_config.api_url`, nulo = o Atlas de verdade), e `conexao.ts` o
 * confere: a instância apontada para outro ambiente não sobrescreve nem
 * apaga a conexão real, e nenhuma usa a chave de outro ambiente.
 */

export const API_DO_ATLAS = "https://tdhgpaurcjinhbandmvb.supabase.co/functions/v1/client-webhook";

/**
 * O ambiente desta instância: o endereço de `ATLAS_API_URL` quando ele vale
 * (só `https://`) e é outro que o do produto; `null` = o Atlas de verdade.
 * Nulo, e não o endereço, para a conexão sobreviver ao Atlas trocar a URL do
 * produto numa versão futura.
 */
export function ambienteDoAtlas(env: string | undefined = process.env.ATLAS_API_URL): string | null {
  const valor = env?.trim();
  if (!valor) return null;
  try {
    const u = new URL(valor);
    if (u.protocol !== "https:") return null;
    const url = u.toString();
    return url === API_DO_ATLAS ? null : url;
  } catch {
    return null;
  }
}

/** Só `https://`; qualquer outra coisa na variável cai no endereço do produto. */
export function urlDaApiDoAtlas(env: string | undefined = process.env.ATLAS_API_URL): string {
  return ambienteDoAtlas(env) ?? API_DO_ATLAS;
}
