import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { argumentosDoFfmpeg, comecarGravacao, enviarGravacoes } from './gravacao.js'

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
