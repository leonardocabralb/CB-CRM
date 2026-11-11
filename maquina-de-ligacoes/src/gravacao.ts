/**
 * A gravação da ligação (docs/PLANO-ligar-pelo-crm.md, §8.5 e §8.13).
 *
 * Do "atendeu" ao "desligou", um ffmpeg lê as duas fontes do PulseAudio e
 * escreve três arquivos em /gravacoes/<ligação>/:
 * - estereo.ogg: Opus 24 kbps, o cliente no canal esquerdo e o atendente no
 *   direito (o formato que o operador escolheu, guardado por 180 dias);
 * - cliente.ogg e atendente.ogg: cada lado sozinho, Opus 16 kbps, para a
 *   transcrição saber quem falou (saem do Storage quando o texto fica pronto).
 * O Ogg sai escrito aos pedaços: se o contêiner cair no meio, fica o que foi
 * gravado até ali.
 *
 * O envio: a máquina manda cada arquivo ao CRM, que o guarda no Storage (a
 * chave do Supabase nunca vem para cá); com o "recebido", apaga a cópia dela.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, rmdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const PASTA_DAS_GRAVACOES = '/gravacoes'
export const ARQUIVOS_DA_GRAVACAO = ['estereo.ogg', 'cliente.ogg', 'atendente.ogg'] as const
/** A voz do cliente: o monitor do alto-falante do Chrome, remapeado (iniciar.sh). */
const FONTE_DO_CLIENTE = 'voz_cliente'
/** A voz do atendente: o que a ponte toca na entrada do microfone do WhatsApp. */
const FONTE_DO_ATENDENTE = 'entrada_mic.monitor'
const ESPERA_DO_FFMPEG_MS = 10_000
const TEMPO_DO_ENVIO_MS = 60_000
const ID_DA_LIGACAO = /^[A-Za-z0-9-]{1,64}$/

export function argumentosDoFfmpeg(pasta: string): string[] {
  // A fila de 8 quadros do padrão encheu na ligação recebida de 10/11 ("Thread
  // message queue blocking"): com duas entradas ao vivo, a fila maior evita
  // perder áudio quando o processador aperta.
  const entrada = (fonte: string) => [
    '-thread_queue_size',
    '512',
    '-f',
    'pulse',
    '-channels',
    '1',
    '-sample_rate',
    '48000',
    '-i',
    fonte,
  ]
  const opus = (kbps: number) => ['-c:a', 'libopus', '-b:a', `${kbps}k`, '-application', 'voip']
  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    ...entrada(FONTE_DO_CLIENTE),
    ...entrada(FONTE_DO_ATENDENTE),
    '-filter_complex',
    '[0:a][1:a]amerge=inputs=2,pan=stereo|c0=c0|c1=c1[estereo]',
    '-map',
    '[estereo]',
    ...opus(24),
    join(pasta, 'estereo.ogg'),
    '-map',
    '0:a',
    ...opus(16),
    join(pasta, 'cliente.ogg'),
    '-map',
    '1:a',
    ...opus(16),
    join(pasta, 'atendente.ogg'),
  ]
}

export async function comecarGravacao(
  ligacao: string,
  registrar: (linha: string) => void,
  base: string = PASTA_DAS_GRAVACOES,
): Promise<{ parar(): Promise<void> }> {
  if (!ID_DA_LIGACAO.test(ligacao)) throw new Error('id de ligação inválido')
  const pasta = join(base, ligacao)
  await mkdir(pasta, { recursive: true })
  const ffmpeg = spawn('ffmpeg', argumentosDoFfmpeg(pasta), { stdio: ['ignore', 'ignore', 'pipe'] })
  ffmpeg.stderr.setEncoding('utf8')
  ffmpeg.stderr.on('data', (texto: string) => {
    for (const linha of texto.split('\n')) if (linha.trim()) registrar(`ffmpeg: ${linha.trim()}`)
  })
  const fim = new Promise<void>((pronto) => ffmpeg.once('exit', () => pronto()))
  ffmpeg.once('error', (erro) => registrar(`ffmpeg não abriu: ${erro.message}`))
  return {
    async parar() {
      if (ffmpeg.exitCode !== null || ffmpeg.signalCode !== null) return
      // SIGINT: o ffmpeg fecha os arquivos direito (o SIGKILL deixaria o fim cortado).
      ffmpeg.kill('SIGINT')
      const teto = setTimeout(() => ffmpeg.kill('SIGKILL'), ESPERA_DO_FFMPEG_MS)
      await fim
      clearTimeout(teto)
    },
  }
}

export interface OpcoesDoEnvio {
  url: string | null
  segredo: string
  registrar: (linha: string) => void
  /** A ligação ainda gravando: a pasta dela fica para depois. */
  emCurso: string | null
  base?: string
  enviar?: typeof fetch
}

/** Manda ao CRM o que estiver em /gravacoes e apaga o que ele confirmou. Nunca lança. */
export async function enviarGravacoes(opcoes: OpcoesDoEnvio): Promise<void> {
  if (!opcoes.url) return
  const base = opcoes.base ?? PASTA_DAS_GRAVACOES
  const enviar = opcoes.enviar ?? fetch
  let pastas: string[]
  try {
    pastas = await readdir(base)
  } catch (erro) {
    opcoes.registrar(`gravações: a pasta não abriu: ${erro instanceof Error ? erro.message : String(erro)}`)
    return
  }
  for (const ligacao of pastas) {
    if (ligacao === opcoes.emCurso || !ID_DA_LIGACAO.test(ligacao)) continue
    const pasta = join(base, ligacao)
    for (const nome of ARQUIVOS_DA_GRAVACAO) {
      const caminho = join(pasta, nome)
      try {
        const tamanho = (await stat(caminho)).size
        if (tamanho === 0) {
          await rm(caminho)
          continue
        }
        const resposta = await enviar(`${opcoes.url}/api/cb/ligacoes/gravacao/${ligacao}/${nome}`, {
          method: 'PUT',
          headers: { authorization: `Bearer ${opcoes.segredo}`, 'content-type': 'audio/ogg' },
          body: await readFile(caminho),
          signal: AbortSignal.timeout(TEMPO_DO_ENVIO_MS),
        })
        if (resposta.ok) await rm(caminho)
        else opcoes.registrar(`gravação ${ligacao}/${nome}: o CRM respondeu ${resposta.status}; fica para depois`)
      } catch (erro) {
        const codigo = (erro as NodeJS.ErrnoException).code
        if (codigo === 'ENOENT') continue
        opcoes.registrar(`gravação ${ligacao}/${nome}: ${erro instanceof Error ? erro.message : String(erro)}; fica para depois`)
      }
    }
    // Vazia, a pasta sai; com arquivo que não foi, fica (o rmdir recusa).
    await rmdir(pasta).catch(() => {})
  }
}
