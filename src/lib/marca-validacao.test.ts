import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { TETO_DE_BYTES_DA_MARCA } from '@/lib/marca'
import {
  CAMPO_DA_PECA,
  dimensoesDoPng,
  ehWebp,
  svgSeguro,
  validarPeca,
} from './marca-validacao'

// ============================================================
// A imagem da marca é conferida pelo CONTEÚDO, não pelo tipo declarado.
// Cada código de erro da rota (`/api/cb/marca`) nasce aqui; os bytes são
// montados no teste — o PNG é um PNG de verdade (assinatura, IHDR com CRC,
// IDAT comprimido, IEND), gerado sem arquivo de fora.
// ============================================================

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = TABELA_CRC[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function bloco(tipo: string, dados: Uint8Array): Uint8Array {
  const corpo = new Uint8Array([...Buffer.from(tipo, 'ascii'), ...dados])
  const saida = new Uint8Array(12 + dados.length)
  const v = new DataView(saida.buffer)
  v.setUint32(0, dados.length)
  saida.set(corpo, 4)
  v.setUint32(8 + dados.length, crc32(corpo))
  return saida
}
/** PNG RGBA transparente, válido, com as dimensões pedidas. */
function png(largura: number, altura: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, largura)
  v.setUint32(4, altura)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8 bits, RGBA, deflate, filtro 0, sem entrelaçar
  const linhas = new Uint8Array(altura * (1 + largura * 4)) // filtro 0 + pixels zerados
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...bloco('IHDR', ihdr),
    ...bloco('IDAT', new Uint8Array(deflateSync(linhas))),
    ...bloco('IEND', new Uint8Array()),
  ])
}
const webp = () =>
  new Uint8Array([...Buffer.from('RIFF'), 26, 0, 0, 0, ...Buffer.from('WEBPVP8L'), 0, 0, 0, 0])
const texto = (s: string) => new TextEncoder().encode(s)
const svg = (miolo: string) =>
  texto(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">${miolo}</svg>`)

const arquivo = (tipo: string, bytes: Uint8Array) => ({ tipo, tamanho: bytes.byteLength, bytes })

describe('dimensoesDoPng — lê o IHDR', () => {
  it('largura e altura de um PNG de verdade', () => {
    expect(dimensoesDoPng(png(512, 300))).toEqual({ largura: 512, altura: 300 })
  })

  it('null para o que não é PNG, o truncado e o de lado zero', () => {
    expect(dimensoesDoPng(texto('GIF89a e mais bytes para passar de 24'))).toBeNull()
    expect(dimensoesDoPng(png(10, 10).subarray(0, 23))).toBeNull()
    const semIhdr = png(10, 10)
    semIhdr.set(Buffer.from('IHDX'), 12)
    expect(dimensoesDoPng(semIhdr)).toBeNull()
    expect(dimensoesDoPng(png(0, 10))).toBeNull()
  })

  it('lê de uma fatia (byteOffset ≠ 0) sem confundir o começo do buffer', () => {
    const grande = new Uint8Array([1, 2, 3, ...png(256, 256)])
    expect(dimensoesDoPng(grande.subarray(3))).toEqual({ largura: 256, altura: 256 })
  })
})

describe('ehWebp', () => {
  it('RIFF…WEBP sim; RIFF de outra coisa (WAVE) não', () => {
    expect(ehWebp(webp())).toBe(true)
    const wave = webp()
    wave.set(Buffer.from('WAVE'), 8)
    expect(ehWebp(wave)).toBe(false)
    expect(ehWebp(texto('RIFF'))).toBe(false)
  })
})

describe('CAMPO_DA_PECA — o nome no formulário é a coluna sem _path', () => {
  it('snake_case, derivado da coluna', () => {
    expect(CAMPO_DA_PECA).toEqual({
      simbolo: 'simbolo',
      horizontalEscuro: 'horizontal_escuro',
      horizontalClaro: 'horizontal_claro',
      verticalEscuro: 'vertical_escuro',
      verticalClaro: 'vertical_claro',
    })
  })
})

describe('validarPeca — tipo e tamanho', () => {
  it('aceita PNG no símbolo e devolve a extensão e o tipo NORMALIZADO', () => {
    expect(validarPeca('simbolo', arquivo('image/PNG; charset=binary', png(512, 512)))).toEqual({
      ok: true,
      extensao: 'png',
      tipo: 'image/png',
    })
  })

  it('tipo_nao_aceito: o símbolo é só PNG; nenhuma peça aceita JPEG', () => {
    expect(validarPeca('simbolo', arquivo('image/webp', webp()))).toEqual({ ok: false, erro: 'tipo_nao_aceito' })
    expect(validarPeca('simbolo', arquivo('image/svg+xml', svg('')))).toEqual({ ok: false, erro: 'tipo_nao_aceito' })
    expect(validarPeca('horizontalEscuro', arquivo('image/jpeg', png(10, 10)))).toEqual({ ok: false, erro: 'tipo_nao_aceito' })
    expect(validarPeca('verticalClaro', arquivo('', png(10, 10)))).toEqual({ ok: false, erro: 'tipo_nao_aceito' })
  })

  it('WebP e SVG valem nas horizontais e verticais', () => {
    expect(validarPeca('horizontalClaro', arquivo('image/webp', webp()))).toEqual({ ok: true, extensao: 'webp', tipo: 'image/webp' })
    expect(validarPeca('verticalEscuro', arquivo('image/svg+xml', svg('<path d="M0 0h10v10z"/>')))).toEqual({
      ok: true,
      extensao: 'svg',
      tipo: 'image/svg+xml',
    })
  })

  it('arquivo_grande: pelo tamanho declarado OU pelos bytes, acima do teto do bucket', () => {
    const bytes = png(256, 256)
    expect(validarPeca('simbolo', { tipo: 'image/png', tamanho: TETO_DE_BYTES_DA_MARCA + 1, bytes })).toEqual({
      ok: false,
      erro: 'arquivo_grande',
    })
    const enorme = new Uint8Array(TETO_DE_BYTES_DA_MARCA + 1)
    enorme.set(bytes)
    expect(validarPeca('horizontalEscuro', { tipo: 'image/png', tamanho: 10, bytes: enorme })).toEqual({
      ok: false,
      erro: 'arquivo_grande',
    })
    // No teto exato, passa.
    const noTeto = new Uint8Array(TETO_DE_BYTES_DA_MARCA)
    noTeto.set(bytes)
    expect(validarPeca('horizontalEscuro', arquivo('image/png', noTeto)).ok).toBe(true)
  })
})

describe('validarPeca — o conteúdo é o que o tipo diz', () => {
  it('arquivo_corrompido: "PNG" que não é PNG, PNG truncado, "WebP" que não é WebP', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Uint8Array(40)])
    expect(validarPeca('simbolo', arquivo('image/png', jpeg))).toEqual({ ok: false, erro: 'arquivo_corrompido' })
    expect(validarPeca('horizontalEscuro', arquivo('image/png', png(10, 10).subarray(0, 20)))).toEqual({
      ok: false,
      erro: 'arquivo_corrompido',
    })
    expect(validarPeca('horizontalEscuro', arquivo('image/png', new Uint8Array()))).toEqual({
      ok: false,
      erro: 'arquivo_corrompido',
    })
    expect(validarPeca('horizontalEscuro', arquivo('image/webp', png(10, 10)))).toEqual({
      ok: false,
      erro: 'arquivo_corrompido',
    })
  })

  it('arquivo_corrompido: "SVG" que não é texto UTF-8, ou que não tem <svg', () => {
    expect(validarPeca('horizontalEscuro', arquivo('image/svg+xml', png(10, 10)))).toEqual({
      ok: false,
      erro: 'arquivo_corrompido',
    })
    expect(validarPeca('horizontalEscuro', arquivo('image/svg+xml', texto('<html><body>oi</body></html>')))).toEqual({
      ok: false,
      erro: 'arquivo_corrompido',
    })
  })

  it('arquivo_corrompido: SVG que o navegador leria em OUTRA codificação (o texto conferido não seria o que ele vê)', () => {
    // BOM do UTF-16 na frente de um SVG que, lido como UTF-8, parece limpo.
    const bomUtf16 = new Uint8Array([0xff, 0xfe, ...svg('<rect width="1" height="1"/>')])
    expect(validarPeca('horizontalEscuro', arquivo('image/svg+xml', bomUtf16))).toEqual({
      ok: false,
      erro: 'arquivo_corrompido',
    })
    // UTF-16 sem BOM: `<\0s\0c\0r\0i\0p\0t\0` — o navegador vê `<script`.
    const utf16 = new Uint8Array([...svg(''), ...Buffer.from('<script>', 'utf16le')])
    expect(validarPeca('horizontalEscuro', arquivo('image/svg+xml', utf16))).toEqual({
      ok: false,
      erro: 'arquivo_corrompido',
    })
    // ISO-2022-JP: ESC ( B troca para ASCII sem gerar caractere.
    expect(validarPeca('horizontalEscuro', arquivo('image/svg+xml', svg('<scr\x1b(Bipt>alert(1)</script>')))).toEqual({
      ok: false,
      erro: 'arquivo_corrompido',
    })
    // Latin-1 acentuado não é UTF-8.
    const latin1 = new Uint8Array([...svg('<text>Cora'), 0xe7, ...texto('ão</text>')])
    expect(validarPeca('horizontalEscuro', arquivo('image/svg+xml', latin1))).toEqual({
      ok: false,
      erro: 'arquivo_corrompido',
    })
    // Tabulação e quebras de linha (inclusive CRLF) são texto normal.
    expect(validarPeca('horizontalEscuro', arquivo('image/svg+xml', svg('\r\n\t<rect width="1" height="1"/>\n'))).ok).toBe(true)
  })

  it('SVG com BOM e com prefixo de namespace no elemento raiz passa', () => {
    const comBom = new Uint8Array([0xef, 0xbb, 0xbf, ...svg('<rect width="1" height="1"/>')])
    expect(validarPeca('horizontalEscuro', arquivo('image/svg+xml', comBom)).ok).toBe(true)
    const prefixado = texto('<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:rect width="1" height="1"/></s:svg>')
    expect(validarPeca('horizontalEscuro', arquivo('image/svg+xml', prefixado)).ok).toBe(true)
  })
})

describe('validarPeca — svg_inseguro', () => {
  const inseguros: Record<string, string> = {
    script: '<script>alert(1)</script>',
    'script com prefixo': '<svg:script>alert(1)</svg:script>',
    'script em maiúsculas': '<SCRIPT>alert(1)</SCRIPT>',
    'atributo de evento': '<rect onload="alert(1)" width="1"/>',
    'evento colado por barra': '<g/onclick=alert(1)></g>',
    'javascript: num valor': '<set attributeName="fill" to="javascript:alert(1)"/>',
    'javascript: com tabulação': '<set attributeName="fill" to="java\tscript:alert(1)"/>',
    'javascript: em entidade numérica': '<set attributeName="fill" to="jav&#x61;script:alert(1)"/>',
    'javascript: em entidade decimal': '<set attributeName="fill" to="&#106;avascript:alert(1)"/>',
    foreignObject: '<foreignObject><div>x</div></foreignObject>',
    iframe: '<iframe src="https://exemplo.test"/>',
    embed: '<embed src="https://exemplo.test/x.swf"/>',
    object: '<object data="https://exemplo.test/x"/>',
    'href externo': '<a href="https://exemplo.test"><rect width="1" height="1"/></a>',
    'xlink:href externo': '<use xlink:href="https://exemplo.test/sprite.svg#a"/>',
    'imagem embutida (data:)': '<image href="data:image/png;base64,AAAA" width="1" height="1"/>',
    'href com aspas simples': "<use href='//exemplo.test/x.svg#a'/>",
    'animação que reescreve o link': '<a href="#a"><set attributeName="href" to="#b"/></a>',
    'entidade declarada': '<!ENTITY x "y">',
    '@import no <style>': '<style>@import url("https://exemplo.test/x.css");</style>',
    '@import com texto puro': "<style>@import 'https://exemplo.test/x.css';</style>",
    'url( externo no atributo style': '<rect style="fill:url(https://exemplo.test/p.svg#g)" width="1" height="1"/>',
    'url( externo num atributo de apresentação': '<rect fill="url(\'//exemplo.test/p.svg#g\')" width="1" height="1"/>',
    'url( externo em @font-face': '<style>@font-face{font-family:x;src:url(https://exemplo.test/f.woff)}</style>',
    'image-set( com texto puro': '<style>.a{background:image-set("https://exemplo.test/a.png" 1x)}</style>',
    'url( escrito com escape hexadecimal do CSS': '<style>.a{fill:\\75 rl(https://exemplo.test/p.svg#g)}</style>',
    'url( escrito com escape de letra do CSS': '<style>.a{fill:\\u\\r\\l(https://exemplo.test/p.svg#g)}</style>',
    '@import escrito com escape do CSS': '<style>@\\69 mport "https://exemplo.test/x.css";</style>',
    'escape do CSS dentro de entidade do XML': '<style>.a{fill:&#92;75 rl(https://exemplo.test/p.svg#g)}</style>',
  }
  for (const [caso, miolo] of Object.entries(inseguros)) {
    it(caso, () => {
      expect(validarPeca('horizontalEscuro', arquivo('image/svg+xml', svg(miolo)))).toEqual({
        ok: false,
        erro: 'svg_inseguro',
      })
    })
  }

  it('url( seguido de muito espaço responde na hora (sem retrocesso quadrático)', () => {
    // Com dois `\s*` seguidos na regra, 300 mil espaços levavam dezenas de
    // segundos — e a validação roda na rota, no processo de todo mundo.
    const inicio = performance.now()
    expect(svgSeguro(`<svg><style>.a{fill:url(${' '.repeat(300_000)}x)}</style></svg>`)).toBe(false)
    expect(performance.now() - inicio).toBeLessThan(1000)
  })

  it('DOCTYPE com entidade (o jeito de esconder texto atrás de &nome;)', () => {
    const comEntidade = texto(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY js "javascript:">]><svg xmlns="http://www.w3.org/2000/svg"><a href="&js;alert(1)"/></svg>',
    )
    expect(validarPeca('horizontalEscuro', arquivo('image/svg+xml', comEntidade))).toEqual({
      ok: false,
      erro: 'svg_inseguro',
    })
  })

  it('o que um logo exportado tem passa: link interno, gradiente, estilo, DOCTYPE sem entidade', () => {
    expect(
      svgSeguro(
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' +
          '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' +
          // O Inkscape grava o caminho da exportação, com barras invertidas
          // no Windows: não é CSS, e a decodificação dos escapes não o recusa.
          ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:export-filename="C:\\Users\\fulano\\logo.png">' +
          '<defs><linearGradient id="g"><stop offset="0" stop-opacity="1"/></linearGradient>' +
          '<path id="p" d="M0 0h10"/></defs>' +
          '<style>.a{fill:url(#g);font-family:Inter}.b{fill:url( "#g" )}</style>' +
          '<rect fill="url(\'#g\')" clip-path="url(#c)" width="1" height="1"/>' +
          '<use xlink:href="#p" class="a"/><use href=" #p"/>' +
          '<text font-size="4" opacity="0.5">Marca</text></svg>',
      ),
    ).toBe(true)
  })
})

describe('validarPeca — o símbolo', () => {
  it('simbolo_pequeno: lado menor abaixo de 192 px', () => {
    expect(validarPeca('simbolo', arquivo('image/png', png(191, 191)))).toEqual({ ok: false, erro: 'simbolo_pequeno' })
    expect(validarPeca('simbolo', arquivo('image/png', png(600, 191)))).toEqual({ ok: false, erro: 'simbolo_pequeno' })
    expect(validarPeca('simbolo', arquivo('image/png', png(192, 192))).ok).toBe(true)
  })

  it('simbolo_grande: lado maior acima de 2048 px (o next/og decodifica a imagem inteira)', () => {
    expect(validarPeca('simbolo', arquivo('image/png', png(2049, 2049)))).toEqual({ ok: false, erro: 'simbolo_grande' })
    expect(validarPeca('simbolo', arquivo('image/png', png(2049, 1700)))).toEqual({ ok: false, erro: 'simbolo_grande' })
    expect(validarPeca('simbolo', arquivo('image/png', png(2048, 2048))).ok).toBe(true)
    // Só o símbolo vai ao next/og: a horizontal larga continua valendo.
    expect(validarPeca('horizontalEscuro', arquivo('image/png', png(4000, 400))).ok).toBe(true)
  })

  it('simbolo_nao_quadrado: proporção fora de 0,8–1,25 (as bordas valem)', () => {
    expect(validarPeca('simbolo', arquivo('image/png', png(500, 200)))).toEqual({ ok: false, erro: 'simbolo_nao_quadrado' })
    expect(validarPeca('simbolo', arquivo('image/png', png(256, 321)))).toEqual({ ok: false, erro: 'simbolo_nao_quadrado' })
    expect(validarPeca('simbolo', arquivo('image/png', png(321, 256)))).toEqual({ ok: false, erro: 'simbolo_nao_quadrado' })
    expect(validarPeca('simbolo', arquivo('image/png', png(256, 320))).ok).toBe(true)
    expect(validarPeca('simbolo', arquivo('image/png', png(320, 256))).ok).toBe(true)
  })

  it('as outras peças não têm regra de tamanho nem de proporção', () => {
    expect(validarPeca('horizontalEscuro', arquivo('image/png', png(1200, 100))).ok).toBe(true)
    expect(validarPeca('verticalClaro', arquivo('image/png', png(50, 80))).ok).toBe(true)
  })
})
