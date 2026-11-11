import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MARGEM_DO_CORTE_MS,
  argumentosDaEtiqueta,
  argumentosDaMedicao,
  argumentosDoCorte,
  argumentosDoFfmpeg,
  comecarGravacao,
  enviarGravacoes,
  iniciosDasEntradas,
  segundosACortar,
  trechosComSom,
  valorDaEtiqueta,
} from './gravacao.js'

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres'
const pastas: string[] = []
afterEach(async () => {
  for (const p of pastas.splice(0)) await rm(p, { recursive: true, force: true })
})

async function base() {
  const pasta = await mkdtemp(join(tmpdir(), 'gravacoes-'))
  pastas.push(pasta)
  return pasta
}

describe('o ffmpeg', () => {
  it('lê as duas vozes do PulseAudio e escreve o estéreo e os dois lados', () => {
    const args = argumentosDoFfmpeg('/gravacoes/lig-1').join(' ')
    expect(args).toContain('-thread_queue_size 512 -f pulse -channels 1 -sample_rate 48000 -i voz_cliente')
    expect(args).toContain('-thread_queue_size 512 -f pulse -channels 1 -sample_rate 48000 -i entrada_mic.monitor')
    expect(args).toContain('[0:a][1:a]amerge=inputs=2,pan=stereo|c0=c0|c1=c1[estereo]')
    expect(args).toContain('-map [estereo] -c:a libopus -b:a 24k -application voip /gravacoes/lig-1/estereo.ogg')
    expect(args).toContain('-map 0:a -c:a libopus -b:a 16k -application voip /gravacoes/lig-1/cliente.ogg')
    expect(args).toContain('-map 1:a -c:a libopus -b:a 16k -application voip /gravacoes/lig-1/atendente.ogg')
  })

  it('recusa id de ligação que sairia da pasta', async () => {
    await expect(comecarGravacao('../fora', () => {}, await base())).rejects.toThrow('inválido')
  })

  it('imprime o início de cada entrada (-loglevel info), sem o progresso', () => {
    const args = argumentosDoFfmpeg('/gravacoes/lig-1').join(' ')
    expect(args).toContain('-nostats -loglevel info')
  })
})

describe('o corte do que veio antes do atendimento (medido em 11/11/2026)', () => {
  // A saída real do ffmpeg 5 com o PulseAudio, medida na máquina.
  const SAIDA = [
    "Input #0, pulse, from 'voz_cliente':",
    'Duration: N/A, start: 1794402486.189276, bitrate: 768 kb/s',
    'Stream #0:0: Audio: pcm_s16le, 48000 Hz, mono, s16, 768 kb/s',
    "Input #1, pulse, from 'entrada_mic.monitor':",
    'Duration: N/A, start: 1794402487.533851, bitrate: 768 kb/s',
  ]

  it('lê o início de cada entrada, em ms de relógio de parede', () => {
    expect(iniciosDasEntradas(SAIDA)).toEqual([1794402486189, 1794402487534])
  })

  it('carimbo ausente ou implausível (sem relógio de parede) não vale', () => {
    expect(iniciosDasEntradas(SAIDA.slice(0, 3))).toEqual([1794402486189, null])
    expect(iniciosDasEntradas(["Input #0, pulse, from 'x':", 'Duration: N/A, start: 0.000000, bitrate: 1 kb/s'])).toEqual([
      null,
      null,
    ])
    expect(iniciosDasEntradas(['start: 1794402486.189276'])).toEqual([null, null])
  })

  it('corta até o atendimento, deixando a margem para o "Alô"', () => {
    const inicio = 1_794_402_486_000
    const atendidaEm = inicio + 12_000
    expect(segundosACortar(atendidaEm, inicio)).toBe((12_000 - MARGEM_DO_CORTE_MS) / 1000)
  })

  it('nada a cortar: atendida antes de a gravação começar, quase junto, ou sem o carimbo', () => {
    const inicio = 1_794_402_486_000
    expect(segundosACortar(inicio + 500, inicio)).toBeNull()
    expect(segundosACortar(inicio + MARGEM_DO_CORTE_MS + 100, inicio)).toBeNull()
    expect(segundosACortar(inicio + 20_000, null)).toBeNull()
    // Mais de uma hora: o carimbo mente, a gravação fica inteira.
    expect(segundosACortar(inicio + 2 * 3_600_000, inicio)).toBeNull()
  })

  it('o corte copia o fluxo (sem recodificar) a partir do segundo dado', () => {
    expect(argumentosDoCorte('/g/lig-1/estereo.ogg', '/g/lig-1/estereo.ogg.corte.ogg', 10.5).join(' ')).toBe(
      '-hide_banner -loglevel error -ss 10.500 -i /g/lig-1/estereo.ogg -c copy -y /g/lig-1/estereo.ogg.corte.ogg',
    )
  })
})

describe('o som de cada lado (a etiqueta CB_SOM, 11/11/2026)', () => {
  // As linhas na forma que o ffmpeg imprime (o prefixo muda de versão).
  const duracao = '  Duration: 00:00:29.91, start: -0.993521, bitrate: 11 kb/s'
  const silencio = (inicio: number, fim?: number) =>
    fim === undefined
      ? [`[silencedetect @ 0x55d] silence_start: ${inicio}`]
      : [`[Parsed_silencedetect_0 @ 0xa73] silence_start: ${inicio}`, `[Parsed_silencedetect_0 @ 0xa73] silence_end: ${fim} | silence_duration: ${fim - inicio}`]

  it('mede pelo silencedetect, sem recodificar nada', () => {
    expect(argumentosDaMedicao('/g/lig-1/cliente.ogg').join(' ')).toBe(
      '-hide_banner -nostats -i /g/lig-1/cliente.ogg -af silencedetect=n=-40dB:d=0.5 -f null -',
    )
  })

  it('o som é o que sobra entre os silêncios, até a duração', () => {
    expect(trechosComSom([duracao, ...silencio(0, 0.609646), ...silencio(1.010312, 2.35375), ...silencio(26.9, 29.91)])).toEqual([
      [0.6, 1.1],
      [2.3, 26.9],
    ])
  })

  it('o silêncio que vai até o fim pode vir sem silence_end (ffmpeg 5.1)', () => {
    expect(trechosComSom([duracao, ...silencio(1, 2), ...silencio(3.2)])).toEqual([
      [0, 1],
      [2, 3.2],
    ])
    expect(trechosComSom([duracao, ...silencio(20)])).toEqual([[0, 20]])
  })

  it('lado todo em silêncio: nenhum trecho; sem silêncio nenhum: o arquivo inteiro', () => {
    expect(trechosComSom(['  Duration: 00:00:06.01, start: 0.000000', ...silencio(0, 6)])).toEqual([])
    expect(trechosComSom(['  Duration: 00:00:06.01, start: 0.000000', ...silencio(0)])).toEqual([])
    expect(trechosComSom(['  Duration: 00:01:02.50, start: 0.000000'])).toEqual([[0, 62.5]])
  })

  it('sem a duração não dá para medir: nulo (o arquivo vai sem etiqueta)', () => {
    expect(trechosComSom(silencio(1, 2))).toBeNull()
    expect(trechosComSom([])).toBeNull()
  })

  it('o valor da etiqueta: uma casa decimal, ou "nenhum" (o ffmpeg descarta a vazia)', () => {
    expect(valorDaEtiqueta([[0, 1.2], [3.4, 8.9]])).toBe('0.0-1.2,3.4-8.9')
    expect(valorDaEtiqueta([])).toBe('nenhum')
  })

  it('a etiqueta entra copiando o fluxo (o áudio não muda)', () => {
    expect(argumentosDaEtiqueta('/g/a.ogg', '/g/a.ogg.som.ogg', 'nenhum').join(' ')).toBe(
      '-hide_banner -loglevel error -i /g/a.ogg -map 0 -c copy -metadata CB_SOM=nenhum -y /g/a.ogg.som.ogg',
    )
  })
})

describe('o envio das gravações', () => {
  async function comArquivos() {
    const raiz = await base()
    await mkdir(join(raiz, 'lig-1'))
    await writeFile(join(raiz, 'lig-1', 'estereo.ogg'), 'OggS estereo')
    await writeFile(join(raiz, 'lig-1', 'cliente.ogg'), 'OggS cliente')
    await writeFile(join(raiz, 'lig-1', 'atendente.ogg'), '')
    await mkdir(join(raiz, 'lig-2'))
    await writeFile(join(raiz, 'lig-2', 'estereo.ogg'), 'OggS gravando')
    return raiz
  }

  it('manda cada arquivo, apaga o confirmado e pula a ligação em curso', async () => {
    const raiz = await comArquivos()
    const enviados: { url: string; autorizacao: string; corpo: string }[] = []
    await enviarGravacoes({
      url: 'http://crm.exemplo.test',
      segredo: SEGREDO,
      registrar: () => {},
      emCurso: 'lig-2',
      base: raiz,
      enviar: async (url, init) => {
        enviados.push({
          url: String(url),
          autorizacao: new Headers(init?.headers).get('authorization') ?? '',
          corpo: Buffer.from(init?.body as Uint8Array).toString(),
        })
        return new Response(null, { status: 200 })
      },
    })
    expect(enviados.map((e) => e.url)).toEqual([
      'http://crm.exemplo.test/api/cb/ligacoes/gravacao/lig-1/estereo.ogg',
      'http://crm.exemplo.test/api/cb/ligacoes/gravacao/lig-1/cliente.ogg',
    ])
    expect(enviados[0]).toMatchObject({ autorizacao: `Bearer ${SEGREDO}`, corpo: 'OggS estereo' })
    expect((await readdir(raiz)).sort()).toEqual(['lig-2'])
  })

  it('o que o CRM não confirmou fica para depois', async () => {
    const raiz = await comArquivos()
    const registros: string[] = []
    await enviarGravacoes({
      url: 'http://crm.exemplo.test',
      segredo: SEGREDO,
      registrar: (l) => registros.push(l),
      emCurso: null,
      base: raiz,
      enviar: async () => new Response(null, { status: 503 }),
    })
    expect((await readdir(join(raiz, 'lig-1'))).sort()).toEqual(['cliente.ogg', 'estereo.ogg'])
    expect(registros.some((r) => r.includes('503'))).toBe(true)
  })

  it('sem CRM, nada sai da pasta', async () => {
    const raiz = await comArquivos()
    await enviarGravacoes({ url: null, segredo: SEGREDO, registrar: () => {}, emCurso: null, base: raiz })
    expect((await readdir(raiz)).sort()).toEqual(['lig-1', 'lig-2'])
  })
})
