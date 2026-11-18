// ============================================================
// Telefone de verdade que não pode voltar ao repositório.
//
// O repositório é público. Um telefone de verdade, copiado como exemplo por
// quem escrevia teste, foi tirado dos testes, comentários e documentação e
// voltou no dia seguinte (com outro DDD, inclusive); saiu de novo no PR
// #533. Lembrar não segurou: este pino segura. Exemplo de telefone é o
// fictício `5583980000016` / "(83) 98000-0016" (vizinhos …0017, …0018).
//
// Como: cada trecho com cara de telefone vira só dígitos, e cada janela de
// 8 dígitos seguidos é comparada pelo SHA-256 com PROIBIDOS. Os 8 dígitos
// finais de um celular brasileiro são o número sem DDI, DDD e nono dígito:
// uma janela pega todas as grafias. O separador é tudo o que
// `telefoneDigitado` (`src/lib/contacts/telefone.ts`) aceita entre os
// dígitos, mais o `+` e a quebra de linha (o número partido em duas linhas
// de um texto quebrado). ⚠️ Separador novo lá entra aqui também. Escape no
// fonte (`‑`, `\u{2011}`, `\x2d`) é lido como o caractere. Passam o
// pedaço com menos de 8 dígitos, o número cortado por letra e a entidade
// HTML (`&#8209;`).
//
// ⚠️ O número não se escreve aqui, e a falha não o imprime (o log do CI de
// repositório público é público): só arquivo e linha.
//
// ⚠️ O hash barra o número ESCRITO (o que os robôs colhem), não quem quer
// descobri-lo: 8 dígitos são 100 milhões de combinações, testadas em
// segundos. O histórico do Git o guarda de todo jeito; se um dia ele for
// reescrito, esta lista sai junto (ou vai para um segredo do CI).
//
// Varre o que o Git versiona e o que ainda vai versionar (não ignorado):
// o teste novo reprova já na máquina, antes do `git add`.
// ============================================================

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()

/**
 * SHA-256 dos 8 dígitos finais de cada telefone proibido, com o motivo.
 * Entrada nova: `printf %s <os 8 dígitos> | shasum -a 256`.
 */
const PROIBIDOS: ReadonlyArray<{ sha256: string; motivo: string }> = [
  {
    sha256: 'c53e8e0bcaeac31453985e51d8954b2a9afdbf0af3bf3da26e1883db475acb04',
    motivo: 'telefone de verdade que já vazou como exemplo',
  },
]

/** Os 8 dígitos finais do fictício da convenção: provam que a varredura enxerga o repositório. */
const FICTICIO = '80000016'

// Um dígito, depois dígitos e separadores, terminando em dígito. Os
// separadores de `telefoneDigitado`: `\s` (com a quebra de linha), `().-`,
// os traços U+2010–U+2015, o sinal de menos U+2212 e todo invisível de
// formatação (\p{Cf}: as marcas de direção que o celular cola, o hífen
// invisível); mais o `+`. Letra separa (o "ramal" não junta).
const TRECHO = /\d(?:[\d\s().+\-‐-―−\p{Cf}]*\d)?/gu

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex')

/** Escape no fonte vira o caractere, menos a quebra de linha (contaria uma linha a mais). */
function comEscapesLidos(texto: string): string {
  const caractere = (escrito: string, hex: string) => {
    const codigo = parseInt(hex, 16)
    return codigo === 0x0a || codigo === 0x0d || codigo > 0x10ffff ? escrito : String.fromCodePoint(codigo)
  }
  return texto
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, caractere)
    .replace(/\\u([0-9a-fA-F]{4})/g, caractere)
    .replace(/\\x([0-9a-fA-F]{2})/g, caractere)
}

type Achado = { linha: number; sha256: string }

/** As linhas (contadas de 1) em que começa uma janela de 8 dígitos com o hash em `hashes`. */
function achados(texto: string, hashes: ReadonlySet<string>): Achado[] {
  const lido = comEscapesLidos(texto)
  const inicios = [0]
  for (let i = 0; i < lido.length; i++) if (lido[i] === '\n') inicios.push(i + 1)
  const linhaDe = (posicao: number) => {
    let baixo = 0
    let alto = inicios.length - 1
    while (baixo < alto) {
      const meio = (baixo + alto + 1) >> 1
      if (inicios[meio] <= posicao) baixo = meio
      else alto = meio - 1
    }
    return baixo + 1
  }

  const saida: Achado[] = []
  const vistos = new Set<string>()
  for (const m of lido.matchAll(TRECHO)) {
    // Sem teto de tamanho: dois números separados por espaço são UM trecho.
    // Guarda onde está cada dígito, para dizer a linha da janela.
    let digitos = ''
    const posicoes: number[] = []
    for (let k = 0; k < m[0].length; k++) {
      const c = m[0][k]
      if (c >= '0' && c <= '9') {
        digitos += c
        posicoes.push(m.index + k)
      }
    }
    for (let j = 0; j + 8 <= digitos.length; j++) {
      const hash = sha256(digitos.slice(j, j + 8))
      if (!hashes.has(hash)) continue
      const linha = linhaDe(posicoes[j])
      const chave = `${linha}:${hash}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      saida.push({ linha, sha256: hash })
    }
  }
  return saida
}

function arquivosDoRepositorio(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: RAIZ,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
}

/** O texto do arquivo, ou `null` para binário e para o que não é arquivo na árvore. */
function lerTexto(arquivo: string): string | null {
  let conteudo: Buffer
  try {
    conteudo = readFileSync(join(RAIZ, arquivo))
  } catch (e) {
    // Apagado na árvore e ainda no índice, ou um repositório aninhado que o
    // Git lista como pasta ("dir/"): não há texto a ler.
    const codigo = (e as NodeJS.ErrnoException).code
    if (codigo === 'ENOENT' || codigo === 'EISDIR') return null
    throw e
  }
  // Binário (imagem, fonte): o NUL nos primeiros bytes é o mesmo sinal que o Git usa.
  if (conteudo.subarray(0, 8000).includes(0)) return null
  return conteudo.toString('utf8')
}

const hashesProibidos = new Set(PROIBIDOS.map((p) => p.sha256))
const motivoDo = new Map(PROIBIDOS.map((p) => [p.sha256, p.motivo]))
const hashDoFicticio = sha256(FICTICIO)

// Uma varredura só, com os proibidos e o fictício juntos.
const porArquivo = new Map<string, Achado[]>()
const procurados = new Set([...hashesProibidos, hashDoFicticio])
for (const arquivo of arquivosDoRepositorio()) {
  const texto = lerTexto(arquivo)
  if (texto === null) continue
  const doArquivo = achados(texto, procurados)
  if (doArquivo.length > 0) porArquivo.set(arquivo, doArquivo)
}

describe('telefones proibidos', () => {
  it('nenhum arquivo traz um telefone proibido, em grafia nenhuma', () => {
    const lista = [...porArquivo].flatMap(([arquivo, doArquivo]) =>
      doArquivo
        .filter((a) => hashesProibidos.has(a.sha256))
        .map((a) => `${arquivo}:${a.linha} — ${motivoDo.get(a.sha256)}`),
    )
    expect(lista, 'troque pelo fictício 5583980000016 / "(83) 98000-0016", na mesma grafia').toEqual([])
  })

  it('a varredura enxerga o repositório: o fictício aparece em código, doc e dicionário', () => {
    const comFicticio = [...porArquivo]
      .filter(([, doArquivo]) => doArquivo.some((a) => a.sha256 === hashDoFicticio))
      .map(([arquivo]) => arquivo)
    expect(comFicticio.length).toBeGreaterThan(20)
    expect([...new Set(comFicticio.map((arquivo) => extname(arquivo)))]).toEqual(
      expect.arrayContaining(['.ts', '.md', '.json']),
    )
  })

  describe('a régua das grafias (provada com o fictício)', () => {
    const so = new Set([hashDoFicticio])
    const acha = (texto: string) => achados(texto, so).length > 0

    it.each([
      ['com DDI, DDD e nono dígito', '5583980000016'],
      ['sem o nono dígito', '558380000016'],
      ['formatado', '+55 (83) 98000-0016'],
      ['com outro DDD', '(81) 98000-0016'],
      ['sem DDD', '98000-0016'],
      ['só os 8 dígitos', '8000-0016'],
      ['com espaços e 00', '0055 83 98000 0016'],
      ['com pontos', '81.98000.0016'],
      ['com traço comprido', '81 98000–0016'],
      ['com o sinal de menos', '81 98000−0016'],
      ['com o hífen invisível', '81 98000­0016'],
      ['com os invisíveis que o celular cola', '‪+55 83 98000-0016‬'],
      ['com escape no fonte', String.raw`81 98000‑0016`],
      ['com o sinal de menos escrito no fonte', String.raw`81 98000−0016`],
      ['com escape de ponto de código', String.raw`81 98000\u{2011}0016`],
      ['com escape hexadecimal', String.raw`81 98000\x2d0016`],
      ['da planilha que virou número', '81980000016.0'],
      ['num JID do WhatsApp', '5583980000016@s.whatsapp.net'],
      ['no meio de uma frase', 'enviou 5583980000016 às 10h'],
      ['ao lado de outro número', '+55 (83) 98000-0016 +55 (83) 98000-0017'],
      ['depois de outro número', '+55 (83) 98000-0017 +55 (83) 98000-0016'],
      ['depois de uma data', '2026-09-23 98000-0016'],
      ['partido em duas linhas', '(81) 98000\n  0016'],
    ])('acha %s', (_, texto) => {
      expect(acha(texto)).toBe(true)
    })

    it.each([
      ['outro número', '98000-0017'],
      ['um pedaço', '(83) 9800'],
      ['dígitos separados por letra', '8000 ramal 0016'],
    ])('não acha %s', (_, texto) => {
      expect(acha(texto)).toBe(false)
    })

    it('diz a linha, uma vez por linha', () => {
      expect(achados('a\nb 98000-0016 e 5583980000016\nc', so)).toEqual([{ linha: 2, sha256: hashDoFicticio }])
    })

    it('o número partido é da linha em que começa', () => {
      expect(achados('a\n(81) 98000\n0016', so)).toEqual([{ linha: 2, sha256: hashDoFicticio }])
    })

    it('a quebra de linha escrita como escape não muda a contagem', () => {
      expect(achados(String.raw`x\u000ay` + '\n98000-0016', so)).toEqual([{ linha: 2, sha256: hashDoFicticio }])
    })
  })
})
