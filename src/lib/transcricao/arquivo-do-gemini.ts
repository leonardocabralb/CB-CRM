// ============================================================
// O documento GRANDE vai ao Gemini pela Files API, não dentro do pedido
// (`LIMITE_INLINE_DO_GEMINI`, `leitores.ts`): o pedido inline é limitado a
// 20 MB contando o base64, e o contrato escaneado de 21 MB era `recusada`.
//
// A forma é a do exemplo REST da documentação (https://ai.google.dev/api/files
// e https://ai.google.dev/gemini-api/docs/files, conferidos em 08/11/2026):
//  1. `POST /upload/v1beta/files` com `X-Goog-Upload-Protocol: resumable` e
//     `X-Goog-Upload-Command: start` — a URL do envio volta no cabeçalho
//     `x-goog-upload-url`;
//  2. `POST <essa URL>` com os bytes, `X-Goog-Upload-Command: upload, finalize`
//     e `X-Goog-Upload-Offset: 0` — volta `{ file: { name, uri, state } }`;
//  3. a leitura usa `file_data` com a `uri` (`pedidoDeLeitura`);
//  4. `DELETE /v1beta/<name>` logo depois: documento de cliente não fica no
//     Google (a doc apaga sozinha em 48 h; aqui não se espera por isso).
// Medido em 08/11/2026: 21 MB subiram em 5 s, já `ACTIVE`; lidos em 49 s.
//
// ⚠️ A chave vai SEMPRE no cabeçalho (`x-goog-api-key`), nunca na URL. A URL
// do envio vem da RESPOSTA: só é seguida em https no host do Gemini, sem
// redirecionamento (a regra do "cursor vindo da resposta", CLAUDE.md 8e).
// ============================================================

const HOST_DO_GEMINI = 'generativelanguage.googleapis.com'
/**
 * O prazo do ENVIO (início + bytes + espera do processamento), à parte do da
 * leitura: 50 MB no pior caso. Somado ao resto, a pior rodada fica em ~164 s
 * (20 s de download + 30 s de envio + 90 s de leitura + a prévia), abaixo dos
 * 4 min do recolhedor (`RECOLHER_TURNO_MS`).
 */
export const TEMPO_DO_ENVIO_MS = 30_000
export const URL_DO_UPLOAD_DO_GEMINI = `https://${HOST_DO_GEMINI}/upload/v1beta/files`
/** Quanto se espera um arquivo em `PROCESSING` virar `ACTIVE` (medido: o PDF já volta `ACTIVE`). */
const ESPERA_DO_PROCESSAMENTO_MS = 10_000
const INTERVALO_DA_CONSULTA_MS = 2_000

export type ArquivoNoGemini = { ok: true; nome: string; uri: string } | { ok: false; status: number | null; erro: string }

/** `files/<id>` — o único formato de nome que se segue de volta (consulta e exclusão). */
function nomeValido(nome: unknown): nome is string {
  return typeof nome === 'string' && /^files\/[A-Za-z0-9_-]+$/.test(nome)
}

/** A URL do envio, só se for https no host do Gemini. */
export function urlDoEnvioValida(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === HOST_DO_GEMINI ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * Envia os bytes e devolve o `name` e a `uri` do arquivo já utilizável. Nunca
 * lança: rede e tempo esgotado voltam com `status: null` (passageiros, como
 * no `ler-midia.ts`). O `signal` é o prazo do ENVIO inteiro.
 */
export async function subirAoGemini(args: {
  chave: string
  bytes: Uint8Array
  mime: string
  signal: AbortSignal
}): Promise<ArquivoNoGemini> {
  try {
    const inicio = await fetch(URL_DO_UPLOAD_DO_GEMINI, {
      method: 'POST',
      headers: {
        'x-goog-api-key': args.chave,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(args.bytes.byteLength),
        'X-Goog-Upload-Header-Content-Type': args.mime,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'leitura' } }),
      redirect: 'error',
      signal: args.signal,
    })
    if (!inicio.ok) return { ok: false, status: inicio.status, erro: `envio ao Gemini recusado (HTTP ${inicio.status})` }
    const url = urlDoEnvioValida(inicio.headers.get('x-goog-upload-url'))
    if (!url) return { ok: false, status: null, erro: 'o Gemini não devolveu um endereço de envio válido' }

    const envio = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Length': String(args.bytes.byteLength),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      // Cópia num `Uint8Array` próprio: o `Buffer` do Node pode apontar para
      // um `SharedArrayBuffer`.
      body: new Uint8Array(args.bytes),
      redirect: 'error',
      signal: args.signal,
    })
    if (!envio.ok) return { ok: false, status: envio.status, erro: `envio ao Gemini falhou (HTTP ${envio.status})` }
    const arquivo = ((await envio.json().catch(() => null)) as { file?: { name?: unknown; uri?: unknown; state?: unknown } } | null)?.file
    if (!arquivo || !nomeValido(arquivo.name) || typeof arquivo.uri !== 'string') {
      return { ok: false, status: null, erro: 'o Gemini não devolveu o arquivo enviado' }
    }
    const nome = arquivo.name
    let estado = arquivo.state
    const ate = Date.now() + ESPERA_DO_PROCESSAMENTO_MS
    while (estado === 'PROCESSING' && Date.now() < ate) {
      await new Promise((r) => setTimeout(r, INTERVALO_DA_CONSULTA_MS))
      const consulta = await fetch(`https://${HOST_DO_GEMINI}/v1beta/${nome}`, {
        headers: { 'x-goog-api-key': args.chave },
        redirect: 'error',
        signal: args.signal,
      })
      estado = consulta.ok ? ((await consulta.json().catch(() => null)) as { state?: unknown } | null)?.state : estado
    }
    // Sem estado (forma fora do padrão) segue: a leitura acusa se não der.
    if (estado === 'PROCESSING' || estado === 'FAILED') {
      void apagarDoGemini(args.chave, nome)
      return {
        ok: false,
        status: estado === 'FAILED' ? 422 : null,
        erro: estado === 'FAILED' ? 'o Gemini não conseguiu processar o arquivo' : 'o Gemini ainda processava o arquivo',
      }
    }
    return { ok: true, nome, uri: arquivo.uri }
  } catch (err) {
    const tempo = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
    return { ok: false, status: null, erro: tempo ? 'tempo esgotado no envio ao Gemini' : 'falha de rede no envio ao Gemini' }
  }
}

/** Apaga o arquivo do Gemini. Nunca lança: o que sobrar a doc apaga em 48 h. */
export async function apagarDoGemini(chave: string, nome: string): Promise<void> {
  if (!nomeValido(nome)) return
  try {
    const r = await fetch(`https://${HOST_DO_GEMINI}/v1beta/${nome}`, {
      method: 'DELETE',
      headers: { 'x-goog-api-key': chave },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) console.warn(`[ler-midia] o Gemini não apagou ${nome} (HTTP ${r.status}); some sozinho em 48 h`)
  } catch {
    console.warn(`[ler-midia] o Gemini não apagou ${nome} (rede); some sozinho em 48 h`)
  }
}
