// ============================================================
// A imagem que o comprador manda para a marca, conferida pelo CONTEÚDO
// (puro: serve à rota `/api/cb/marca` e, se quiser, à aba no navegador).
//
// Por que conferir o conteúdo, e não só o tipo declarado: o tipo vem do
// navegador (ou de quem montar o pedido à mão) e vira o `contentType` do
// objeto no bucket público. Um "PNG" que é outra coisa quebraria o ícone da
// aba e do app instalado sem erro nenhum; um SVG com script ficaria
// hospedado numa URL pública com o nosso nome.
//
// ⚠️ O SVG é conferido por LISTA DE RECUSA sobre o texto, não por um parser:
// o que não for reconhecido como seguro é recusado (`svg_inseguro`), mesmo
// quando inofensivo — um logo exportado raramente tem script, link externo
// ou entidade, e quem cair aqui manda o PNG.
// ============================================================

import {
  COLUNA_DA_PECA,
  PECAS_DA_MARCA,
  TETO_DE_BYTES_DA_MARCA,
  TIPOS_DA_PECA,
  type PecaDaMarca,
} from '@/lib/marca'

export type ErroDaPeca =
  | 'tipo_nao_aceito'
  | 'arquivo_grande'
  | 'arquivo_corrompido'
  | 'svg_inseguro'
  | 'simbolo_pequeno'
  | 'simbolo_grande'
  | 'simbolo_nao_quadrado'

export type ExtensaoDaPeca = 'png' | 'webp' | 'svg'

export type ResultadoDaPeca =
  /** `tipo` é o MIME normalizado: é ele que vai como `contentType`. */
  | { ok: true; extensao: ExtensaoDaPeca; tipo: string }
  | { ok: false; erro: ErroDaPeca }

/**
 * O nome de cada peça no formulário da rota (e no `peca` dos erros):
 * a coluna sem o `_path` — `horizontal_escuro`, não `horizontalEscuro`.
 */
export const CAMPO_DA_PECA = Object.fromEntries(
  PECAS_DA_MARCA.map((peca) => [peca, COLUNA_DA_PECA[peca].replace(/_path$/, '')]),
) as Record<PecaDaMarca, string>

/**
 * Menor lado do símbolo, em pixels: o ícone de 192 do Android é gerado
 * dele, e ampliar um símbolo menor borra o ícone da tela de início.
 */
export const LADO_MINIMO_DO_SIMBOLO = 192

/**
 * Maior lado do símbolo, em pixels. ⚠️ O teto de BYTES não basta: um PNG de
 * cor chapada com 10000 × 10000 px comprime para menos de 1 MB, e o
 * `next/og` (`icon.tsx`, `apple-icon.tsx`) decodifica a imagem embutida
 * INTEIRA (largura × altura × 4 bytes, ~400 MB nesse caso) a cada ícone
 * gerado — o favicon é pedido a cada página, e o processo é um só para
 * todo mundo. O maior ícone gerado tem 512 px (`TAMANHOS_DO_ICONE`):
 * 2048 é folga de 4× (~16 MB decodificados).
 */
export const LADO_MAXIMO_DO_SIMBOLO = 2048

/**
 * Proporção aceita do símbolo (largura ÷ altura). Ele é desenhado num
 * quadrado (aba do navegador, ícone do app): fora disso, sobra faixa vazia
 * ou o desenho achata.
 */
export const PROPORCAO_DO_SIMBOLO = { minima: 0.8, maxima: 1.25 } as const

const EXTENSAO_DO_TIPO: Record<string, ExtensaoDaPeca> = {
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

const ASSINATURA_DO_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * `image/png; charset=binary` (colagem) → `image/png`. O bucket tem lista
 * EXATA de tipos: sem normalizar, o upload seria recusado no Storage.
 */
export function normalizarTipo(tipo: string): string {
  return tipo.split(';')[0]!.trim().toLowerCase()
}

function ascii(bytes: Uint8Array, inicio: number, fim: number): string {
  return String.fromCharCode(...bytes.subarray(inicio, fim))
}

/**
 * Largura e altura de um PNG, lidas do IHDR (o primeiro bloco, logo depois
 * da assinatura). `null` = não é PNG, ou está truncado antes das dimensões.
 */
export function dimensoesDoPng(
  bytes: Uint8Array,
): { largura: number; altura: number } | null {
  if (bytes.length < 24) return null
  if (!ASSINATURA_DO_PNG.every((b, i) => bytes[i] === b)) return null
  const dados = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dados.getUint32(8) !== 13 || ascii(bytes, 12, 16) !== 'IHDR') return null
  const largura = dados.getUint32(16)
  const altura = dados.getUint32(20)
  if (largura === 0 || altura === 0) return null
  return { largura, altura }
}

/** WebP: contêiner RIFF com a marca `WEBP`. */
export function ehWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP'
}

// O que um SVG de logo não tem e um SVG malicioso tem. Cada um vale em
// qualquer caixa e com prefixo de namespace (`<svg:script>`).
const PROIBIDOS: RegExp[] = [
  // Elementos que executam ou embutem outro documento.
  /<\s*(?:[\w-]+:)?(?:script|foreignObject|iframe|embed|object)\b/i,
  // Atributo de evento (`onload=`, `onclick=`, `onbegin=`…), também colado
  // ao nome do elemento por barra (`<svg/onload=…>`).
  /[\s"'/](?:[\w-]+:)?on[a-z]+\s*=/i,
  // `javascript:` com espaço, tabulação ou quebra no meio (o navegador os
  // ignora dentro de uma URL).
  /j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/i,
  // Entidade declarada no DOCTYPE: esconderia qualquer texto acima atrás de
  // um `&nome;` (e é a porta do "bilhão de risadas").
  /<!ENTITY/i,
  // Animação que REESCREVE um link (`<set attributeName="href" to="…">`).
  /attributeName\s*=\s*["']\s*(?:[\w-]+:)?href/i,
  // CSS que busca recurso de fora (no `<style>`, no atributo `style` ou num
  // atributo de apresentação como `fill`): `@import` e `image-set(` aceitam
  // o endereço como texto puro; `url(` só vale para dentro do próprio
  // arquivo (`url(#gradiente)`), o mesmo critério do `href`.
  /@import\b/i,
  /image-set\s*\(/i,
  // ⚠️ Sem `\s*["']?\s*` seguidos: com só espaço depois do `url(`, os dois
  // `\s*` repartiriam o espaço de n² jeitos (1 MB de espaço trava a rota).
  /url\((?!\s*(?:["']\s*)?#)/i,
]

// Todo atributo `href` (com ou sem prefixo: `xlink:href`, `a:href`).
const HREF = /(?:^|[\s"'/])(?:[\w-]+:)?href\s*=\s*(["'])([\s\S]*?)\1/gi

function ponto(codigo: number): string {
  try {
    return String.fromCodePoint(codigo)
  } catch {
    return ''
  }
}

/**
 * Entidades NUMÉRICAS decodificadas (`&#106;` → `j`): o parser do XML as
 * decodifica dentro dos atributos, então `jav&#x61;script:` é
 * `javascript:` para o navegador.
 */
function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => ponto(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => ponto(parseInt(dec, 10)))
}

/**
 * Escapes do CSS decodificados (`\75 rl(` → `url(`, `@\69 mport` →
 * `@import`, `\u\r\l(` → `url(`): o CSS os resolve ANTES de reconhecer a palavra, então
 * `\75 rl(https://…)` é um `url(…)` para o navegador. Aplicado ao texto
 * inteiro (não só ao CSS): fora dele, no máximo recusa a mais.
 */
function decodificarEscapesDoCss(texto: string): string {
  return texto.replace(
    /\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|([^\n\r\f]))/gi,
    (_, hex: string | undefined, letra: string | undefined) =>
      hex ? ponto(parseInt(hex, 16)) : letra!,
  )
}

function trechoSeguro(texto: string): boolean {
  if (PROIBIDOS.some((padrao) => padrao.test(texto))) return false
  // Link só para dentro do próprio arquivo (`#gradiente`). Externo,
  // `data:` e `javascript:` ficam de fora — inclusive a imagem embutida em
  // base64 (quem tem isso manda o PNG).
  for (const [, , valor] of texto.matchAll(HREF)) {
    if (!valor!.trim().startsWith('#')) return false
  }
  return true
}

/**
 * O texto de um SVG não tem nada que execute, embuta outro documento ou
 * aponte para fora (link, `url(` e `@import` do CSS). Conferido no texto
 * CRU, no texto com as entidades numéricas decodificadas (o que o XML
 * entrega) e nesse mesmo texto com os escapes do CSS decodificados (o que
 * o CSS lê) — o navegador vê os três.
 */
export function svgSeguro(texto: string): boolean {
  const semEntidades = decodificarEntidades(texto)
  return (
    trechoSeguro(texto) &&
    trechoSeguro(semEntidades) &&
    trechoSeguro(decodificarEscapesDoCss(semEntidades))
  )
}

/**
 * Confere uma peça: o tipo é aceito PARA ESSA PEÇA, cabe no teto, e o
 * conteúdo é o que o tipo diz. O símbolo, além disso, precisa ter o lado
 * entre o mínimo e o máximo e ser quase quadrado.
 */
export function validarPeca(
  peca: PecaDaMarca,
  arquivo: { tipo: string; tamanho: number; bytes: Uint8Array },
): ResultadoDaPeca {
  const tipo = normalizarTipo(arquivo.tipo)
  const extensao = EXTENSAO_DO_TIPO[tipo]
  if (!extensao || !TIPOS_DA_PECA[peca].includes(tipo)) {
    return { ok: false, erro: 'tipo_nao_aceito' }
  }
  const { bytes } = arquivo
  if (arquivo.tamanho > TETO_DE_BYTES_DA_MARCA || bytes.byteLength > TETO_DE_BYTES_DA_MARCA) {
    return { ok: false, erro: 'arquivo_grande' }
  }

  if (extensao === 'png') {
    const dimensoes = dimensoesDoPng(bytes)
    if (!dimensoes) return { ok: false, erro: 'arquivo_corrompido' }
    if (peca === 'simbolo') {
      const { largura, altura } = dimensoes
      if (Math.min(largura, altura) < LADO_MINIMO_DO_SIMBOLO) {
        return { ok: false, erro: 'simbolo_pequeno' }
      }
      if (Math.max(largura, altura) > LADO_MAXIMO_DO_SIMBOLO) {
        return { ok: false, erro: 'simbolo_grande' }
      }
      const proporcao = largura / altura
      if (
        proporcao < PROPORCAO_DO_SIMBOLO.minima ||
        proporcao > PROPORCAO_DO_SIMBOLO.maxima
      ) {
        return { ok: false, erro: 'simbolo_nao_quadrado' }
      }
    }
  } else if (extensao === 'webp') {
    if (!ehWebp(bytes)) return { ok: false, erro: 'arquivo_corrompido' }
  } else {
    // ⚠️ As conferências abaixo leem o texto como UTF-8, e o navegador lê
    // pela codificação que o arquivo DECLARA. Em UTF-16 (um NUL entre as
    // letras) ou ISO-2022-JP (ESC troca de modo sem gerar caractere), o
    // navegador veria um `<script` que este texto não mostra inteiro. Byte
    // de controle não cabe em XML 1.0 (só tabulação e quebras), e byte que
    // não é UTF-8 (o BOM do UTF-16, Latin-1 acentuado) também fica de fora:
    // nenhum dos dois passa por aqui.
    if (bytes.some((b) => b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)) {
      return { ok: false, erro: 'arquivo_corrompido' }
    }
    let texto: string
    try {
      texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return { ok: false, erro: 'arquivo_corrompido' }
    }
    if (!/<(?:[\w-]+:)?svg[\s/>]/i.test(texto)) {
      return { ok: false, erro: 'arquivo_corrompido' }
    }
    if (!svgSeguro(texto)) return { ok: false, erro: 'svg_inseguro' }
  }

  return { ok: true, extensao, tipo }
}
