// ============================================================
// A chave de SESSÃO do token de acesso.
//
// O JWT do Supabase carrega `session_id` (claim obrigatória no tipo do
// auth-js), e ela é a única forma de o navegador responder "este login é o
// mesmo de antes?" — o `SIGNED_IN` do `onAuthStateChange` dispara a cada
// carga de página e a cada volta à aba, então não serve como "acabou de
// entrar". O Meu dia usa esta chave para não reaparecer numa sessão que já
// confirmou o resumo.
//
// ⚠️ Decodificado SEM verificar a assinatura, de propósito: é chave de
// interface (compara com um valor guardado no próprio navegador), nunca de
// autorização. Quem autoriza é o servidor, que valida o token de verdade.
// `getClaims()` custaria rede (recorre ao `/user` em token HS256 e busca o
// JWKS nos demais) para responder o que já está no cookie.
// ============================================================

function base64UrlParaTexto(trecho: string): string {
  const b64 = trecho.replace(/-/g, '+').replace(/_/g, '/');
  const preenchido = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binario = atob(preenchido);
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * O `session_id` do token, ou `null` quando não há token, o token não tem a
 * forma de um JWT, o payload não decodifica ou a claim não é uma string
 * não-vazia. Nunca lança: quem chama decide o que fazer sem a chave.
 */
export function sessionIdDoToken(jwt: string | null | undefined): string | null {
  if (!jwt) return null;
  const partes = jwt.split('.');
  if (partes.length < 2 || !partes[1]) return null;
  try {
    const claims: unknown = JSON.parse(base64UrlParaTexto(partes[1]));
    if (!claims || typeof claims !== 'object') return null;
    const id = (claims as { session_id?: unknown }).session_id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}
