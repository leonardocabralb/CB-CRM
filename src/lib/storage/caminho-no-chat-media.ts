// ============================================================
// O caminho de um arquivo NOSSO no `chat-media` — ESPELHO em TS de
// `cb_caminho_no_chat_media(url, conta)` (migration 1097, seção 3).
//
// ⚠️⚠️ A regra MORA NO BANCO: é ela que decide o que a fotografia da Lixeira
// cita (`cb_lixeira_arquivos`), o que entra na fila de arquivos a apagar
// (`cb_lixeira_purgar_um`) e o que a reivindicação devolve
// (`cb_reivindicar_arquivos_a_apagar`). Este espelho existe para a drenagem
// (`arquivos-a-apagar.ts`) conferir DE NOVO cada caminho antes do
// `storage.remove`, do lado de cá da rede: um defeito na fila nunca apaga
// arquivo de outra conta nem do acervo. Mudou um lado, muda o outro — o pino
// `caminho-no-chat-media.test.ts` roda os MESMOS exemplos da conferência
// 14.2 da 1097 e lê o `.sql` para conferir que eles estão lá.
//
// Linha a linha, na ordem do SQL:
//   1. URL ou conta ausente → nulo.
//   2. Contém `/object/public/chat-media/` → o que vem depois, sem `?…` e
//      sem `#…` (a URL pública; `split_part` nos dois).
//   3. Tem esquema (`https:`, `data:`…) ou começa com `/` → nulo (URL
//      externa, `flow-media`, caminho absoluto de outro lugar).
//   4. Senão, o texto cru é o candidato (o `media_path` das agendadas e do
//      acervo).
//   E o candidato só vale se: não é vazio; começa com `account-<conta>/`; NÃO
//   começa com `account-<conta>/acervo/` (o acervo tem dono próprio); não tem
//   `..`, `%` (nome codificado: na dúvida, o arquivo fica) nem `\`; não tem
//   `//` nem termina em `/`.
// ============================================================

const MARCA_DA_URL_PUBLICA = '/object/public/chat-media/';

/** `^[A-Za-z][A-Za-z0-9+.-]*:` do SQL: o texto começa com um esquema de URL. */
const TEM_ESQUEMA = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * `p_conta::text` no SQL: o uuid na forma canônica (minúsculas, com hífens).
 * O cast do Postgres ESTOURA com texto que não é uuid; aqui isso vira nulo —
 * o lado seguro (o arquivo fica).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O caminho do objeto no `chat-media` quando `url` (a URL pública OU o
 * caminho cru) é um arquivo da `conta` fora do acervo; nulo para todo o resto.
 */
export function caminhoNoChatMedia(
  url: string | null | undefined,
  conta: string | null | undefined
): string | null {
  if (url == null || conta == null || !UUID.test(conta)) return null;
  const prefixo = `account-${conta.toLowerCase()}/`;

  let v: string | null;
  const marca = url.indexOf(MARCA_DA_URL_PUBLICA);
  if (marca >= 0) {
    v = url
      .slice(marca + MARCA_DA_URL_PUBLICA.length)
      .split('?')[0]
      .split('#')[0];
  } else if (TEM_ESQUEMA.test(url) || url.startsWith('/')) {
    v = null;
  } else {
    v = url;
  }

  if (v === null || v === '') return null;
  if (!v.startsWith(prefixo)) return null;
  if (v.startsWith(`${prefixo}acervo/`)) return null;
  if (v.includes('..') || v.includes('%') || v.includes('\\')) return null;
  if (v.includes('//') || v.endsWith('/')) return null;
  return v;
}
