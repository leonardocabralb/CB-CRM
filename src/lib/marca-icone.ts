// ============================================================
// O símbolo da marca como `data:` URL, para os ícones gerados no servidor
// (`icon.tsx`, a aba do navegador; `apple-icon.tsx`, o app instalado).
//
// ⚠️ Só servidor (lê `public/` do disco). A imagem entra EMBUTIDA no
// desenho do `next/og` para que prazo, teto e tipo sejam conferidos aqui,
// onde a falha tem para onde cair.
//
// ⚠️⚠️ NUNCA LANÇA — qualquer falha devolve `null`, e o ícone cai no
// desenho genérico. Um ícone que responde 500 some da aba e da Tela de
// Início sem erro em lugar nenhum; o genérico é feio, mas está lá.
//
// Duas origens, pelo formato do caminho (`Marca.simbolo`):
// - começa com `/`: arquivo de `public/` (o padrão do produto,
//   `ARQUIVOS_PADRAO`) — lido do disco, nunca por HTTP (o servidor não
//   sabe o próprio endereço público, e pedir a si mesmo no meio de uma
//   resposta é pedir para travar);
// - URL absoluta: o Storage da marca própria (`urlPublicaDaMarca`, derivada
//   do caminho gravado pela rota, nunca aceita de fora). Baixada com prazo
//   curto, sem seguir redirecionamento, e com o corpo limitado ao teto do
//   bucket DURANTE a leitura (`lerComTeto`).
//
// O símbolo é só PNG (`TIPOS_DA_PECA.simbolo`): o `next/og` não lê WebP.
// Por isso a assinatura do PNG também é conferida — o `content-type` é o
// que o Storage declarou, não o que o arquivo é.
// ============================================================

import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'

import { lerComTeto } from '@/lib/http/ler-com-teto'
import { TETO_DE_BYTES_DA_MARCA } from '@/lib/marca'

/** Prazo do download do símbolo: o ícone é pedido junto com a página. */
const PRAZO_DO_SIMBOLO_MS = 3000

const ASSINATURA_DO_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function ehPng(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength > ASSINATURA_DO_PNG.length &&
    ASSINATURA_DO_PNG.every((b, i) => bytes[i] === b)
  )
}

/**
 * Memória de UM símbolo (o último que deu certo). O favicon é pedido a cada
 * página aberta e a marca própria mora no Storage: sem ela, cada pedido
 * baixaria a imagem de novo. A chave é o caminho/URL — a rota grava cada
 * versão com nome ÚNICO, então marca trocada é chave nova. Falha nunca entra.
 */
let memoria: { chave: string; dataUrl: string } | null = null

async function lerDoPublico(caminho: string): Promise<Uint8Array | null> {
  const publico = join(process.cwd(), 'public')
  const arquivo = normalize(join(publico, caminho))
  // Cerca de pasta: `..` no caminho não sai de `public/`.
  if (!arquivo.startsWith(publico + sep)) return null
  const bytes = await readFile(arquivo)
  return bytes.byteLength <= TETO_DE_BYTES_DA_MARCA ? bytes : null
}

async function baixar(url: string, fetchFn: typeof fetch): Promise<Uint8Array | null> {
  const protocolo = new URL(url).protocol
  if (protocolo !== 'https:' && protocolo !== 'http:') return null
  const resposta = await fetchFn(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(PRAZO_DO_SIMBOLO_MS),
  })
  const tipo = resposta.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (!resposta.ok || tipo !== 'image/png') {
    await resposta.body?.cancel().catch(() => {})
    return null
  }
  return lerComTeto(resposta, TETO_DE_BYTES_DA_MARCA)
}

/**
 * Cor do traço do desenho GENÉRICO (o balão, quando não há símbolo) sobre o
 * fundo `#rrggbb` da marca: escuro sobre fundo claro, branco sobre escuro.
 * Sem isso, quem escolhe fundo branco para o ícone ganharia um balão branco
 * invisível no dia em que o símbolo falhar.
 */
export function tracoSobre(fundo: string): string {
  const n = Number.parseInt(fundo.slice(1), 16)
  const luz = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return luz > 160 ? '#020617' : '#ffffff'
}

/**
 * O símbolo pronto para `<img src>` do `next/og`, ou `null` (sem símbolo,
 * ou qualquer falha). `fetchFn` existe para o teste.
 */
export async function simboloComoDataUrl(
  simbolo: string | null,
  opcoes: { fetchFn?: typeof fetch } = {},
): Promise<string | null> {
  if (!simbolo) return null
  if (memoria?.chave === simbolo) return memoria.dataUrl
  try {
    const bytes = simbolo.startsWith('/')
      ? await lerDoPublico(simbolo)
      : await baixar(simbolo, opcoes.fetchFn ?? fetch)
    if (!bytes || !ehPng(bytes)) return null
    const dataUrl = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
    memoria = { chave: simbolo, dataUrl }
    return dataUrl
  } catch (erro) {
    console.warn('[marca] símbolo ilegível para o ícone; usando o genérico:', erro)
    return null
  }
}
