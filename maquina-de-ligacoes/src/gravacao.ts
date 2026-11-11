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
 *
 * ⚠️ MEDIDO em 11/11/2026 (a 4b gravou 19 s de uma ligação de 24 s): o ffmpeg
 * aberto no "atendeu" perdia o começo (ele leva segundos para subir dentro do
 * contêiner, e a 2ª entrada abre ~1,3 s depois da 1ª) e o SIGINT perdia os
 * ~2 s finais, que ainda estavam a caminho. A sondagem (`-analyzeduration`) e
 * o fragmento do PulseAudio não mudam nada. Por isso:
 * - o ffmpeg abre no COMEÇO do pedido (ligar/atender, antes da ponte), e o que
 *   veio antes do atendimento sai no fim por um corte (`-ss`, cópia do fluxo).
 *   O corte usa o carimbo de início que o ffmpeg imprime de cada entrada
 *   (`start:`, relógio de parede — o demuxer do PulseAudio carimba por ele):
 *   o segundo do arquivo é "relógio − start" (conferido com um tom: erro de
 *   ~0,3 s). Sem o carimbo, a gravação fica inteira;
 * - parar espera a CAUDA antes do SIGINT;
 * - sem atendimento, nada fica: a pasta é apagada.
 *
 * ⚠️ O SOM DE CADA LADO (11/11/2026): o Gemini INVENTOU um monólogo inteiro
 * sobre um lado que só tinha um bipe e silêncio. Depois do corte, cada lado
 * passa pelo `silencedetect`, e os trechos com som vão numa etiqueta do
 * próprio Ogg (`CB_SOM`, no cabeçalho do Opus): o CRM descarta o trecho
 * transcrito sem som por perto (`soComSom`, `dialogo.ts`). Medir ou etiquetar
 * que falha deixa o arquivo como está (o CRM, sem a etiqueta, não filtra).
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rename, rm, rmdir, stat } from 'node:fs/promises'
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
/** Os ~2 s finais que o SIGINT perdia, com folga (medido em 11/11/2026). */
export const CAUDA_MS = 2_500
/**
 * O que fica de antes do atendimento: o "atendeu" da tela chega com até um
 * tique de atraso, e o "Alô" do cliente não pode sair cortado.
 */
export const MARGEM_DO_CORTE_MS = 1_500
/** Carimbo plausível de relógio de parede (depois de 2020), em ms. */
const RELOGIO_MINIMO_MS = 1_600_000_000_000

/** Uma gravação em curso. */
export interface Gravacao {
  /**
   * Para e deixa os arquivos prontos para o envio. `atendidaEm` (relógio
   * desta máquina, ms): o que veio antes dele (menos a margem) sai; nulo =
   * ninguém atendeu, e a pasta é apagada.
   */
  parar(atendidaEm: number | null): Promise<void>
}

/**
 * O início de cada entrada (ms de relógio de parede), lido da saída do ffmpeg
 * com `-loglevel info`: `Input #1, pulse, from '…':` e, logo abaixo,
 * `Duration: N/A, start: 1794402557.954830, bitrate: …`. Nulo = não veio.
 */
export function iniciosDasEntradas(linhas: readonly string[]): [number | null, number | null] {
  const inicios: [number | null, number | null] = [null, null]
  let entrada: number | null = null
  for (const linha of linhas) {
    const cabeca = /Input #(\d+),/.exec(linha)
    if (cabeca) {
      entrada = Number(cabeca[1])
      continue
    }
    const inicio = /\bstart: (\d+(?:\.\d+)?)/.exec(linha)
    if (!inicio || (entrada !== 0 && entrada !== 1) || inicios[entrada] !== null) continue
    const ms = Math.round(Number(inicio[1]) * 1000)
    if (Number.isFinite(ms) && ms > RELOGIO_MINIMO_MS) inicios[entrada] = ms
  }
  return inicios
}

/**
 * Quantos segundos cortar do começo de um arquivo cuja entrada começou em
 * `inicioMs`. Nulo = nada a cortar (menos de 0,2 s) ou sem como saber.
 */
export function segundosACortar(atendidaEm: number, inicioMs: number | null): number | null {
  if (inicioMs === null) return null
  const segundos = (atendidaEm - MARGEM_DO_CORTE_MS - inicioMs) / 1000
  // Mais de uma hora antes do atendimento não é uma ligação: o carimbo mente.
  if (!(segundos > 0.2) || segundos > 3600) return null
  return Math.round(segundos * 1000) / 1000
}

export function argumentosDoCorte(origem: string, destino: string, segundos: number): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-ss', segundos.toFixed(3), '-i', origem, '-c', 'copy', '-y', destino]
}

/** Corta o começo de um arquivo no lugar; falhou, o arquivo fica inteiro. Nunca lança. */
async function cortarInicio(caminho: string, segundos: number, registrar: (linha: string) => void): Promise<void> {
  const provisorio = `${caminho}.corte.ogg`
  const ok = await new Promise<boolean>((pronto) => {
    const corte = spawn('ffmpeg', argumentosDoCorte(caminho, provisorio, segundos), { stdio: 'ignore' })
    corte.once('error', () => pronto(false))
    corte.once('exit', (codigo) => pronto(codigo === 0))
  })
  try {
    if (ok && (await stat(provisorio)).size > 0) return await rename(provisorio, caminho)
    registrar(`gravação: o corte de ${caminho} falhou; fica inteira`)
  } catch (erro) {
    registrar(`gravação: o corte de ${caminho} falhou (${erro instanceof Error ? erro.message : String(erro)}); fica inteira`)
  }
  await rm(provisorio, { force: true }).catch(() => {})
}

/** A etiqueta do Ogg com os trechos com som (o CRM a lê: `somDaGravacao`, `dialogo.ts`). */
export const ETIQUETA_DO_SOM = 'CB_SOM'
/** Abaixo disto é silêncio: o ruído da sala fica em ~−60 dB, a fala passa de −35 (medido em 11/11/2026). */
const LIMIAR_DO_SILENCIO = '-40dB'
/** Silêncio mais curto que isto é pausa da fala, não silêncio. */
const SILENCIO_MINIMO_S = 0.5

export function argumentosDaMedicao(arquivo: string): string[] {
  return [
    '-hide_banner',
    '-nostats',
    '-i',
    arquivo,
    '-af',
    `silencedetect=n=${LIMIAR_DO_SILENCIO}:d=${SILENCIO_MINIMO_S}`,
    '-f',
    'null',
    '-',
  ]
}

/**
 * Os trechos COM som (segundos), do que o `silencedetect` imprimiu: o
 * complemento dos silêncios dentro da duração. Nulo = sem a duração (não dá
 * para dizer onde acaba o último trecho). O silêncio que vai até o fim pode
 * vir sem `silence_end` (o ffmpeg 5.1 da imagem não o imprime no fim).
 */
export function trechosComSom(linhas: readonly string[]): Array<[number, number]> | null {
  let duracao: number | null = null
  const silencios: Array<[number, number | null]> = []
  for (const linha of linhas) {
    const d = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(linha)
    if (d && duracao === null) duracao = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])
    const comeco = /silence_start: (-?\d+(?:\.\d+)?)/.exec(linha)
    if (comeco) silencios.push([Math.max(0, Number(comeco[1])), null])
    const fim = /silence_end: (-?\d+(?:\.\d+)?)/.exec(linha)
    const aberto = silencios[silencios.length - 1]
    if (fim && aberto && aberto[1] === null) aberto[1] = Number(fim[1])
  }
  if (duracao === null || !Number.isFinite(duracao)) return null
  const som: Array<[number, number]> = []
  let desde = 0
  for (const [inicio, fim] of silencios) {
    if (inicio > desde) som.push([desde, Math.min(inicio, duracao)])
    desde = Math.max(desde, fim ?? duracao)
  }
  if (desde < duracao) som.push([desde, duracao])
  // Uma casa decimal. Sobra de menos de 50 ms não é som: o `silence_end` do
  // fim sai em 6 s num arquivo cuja duração diz 6,01 (medido no ffmpeg 8).
  return som
    .filter(([a, b]) => b - a >= 0.05)
    .map(([a, b]): [number, number] => [Math.floor(a * 10) / 10, Math.ceil(b * 10) / 10])
}

/** O valor da etiqueta: `0.0-1.2,3.4-8.9`, ou `nenhum` (o ffmpeg descarta etiqueta vazia). */
export function valorDaEtiqueta(som: ReadonlyArray<readonly [number, number]>): string {
  return som.length ? som.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join(',') : 'nenhum'
}

export function argumentosDaEtiqueta(origem: string, destino: string, valor: string): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-i', origem, '-map', '0', '-c', 'copy', '-metadata', `${ETIQUETA_DO_SOM}=${valor}`, '-y', destino]
}

/** Roda o ffmpeg; devolve a saída de erro (onde ele escreve) e se saiu com 0. Nunca lança. */
function rodarFfmpeg(argumentos: string[]): Promise<{ ok: boolean; saida: string }> {
  return new Promise((pronto) => {
    const processo = spawn('ffmpeg', argumentos, { stdio: ['ignore', 'ignore', 'pipe'] })
    let saida = ''
    processo.stderr.setEncoding('utf8')
    // Só o começo importa para a duração; os silêncios vêm em linhas curtas.
    processo.stderr.on('data', (texto: string) => {
      if (saida.length < 2_000_000) saida += texto
    })
    processo.once('error', () => pronto({ ok: false, saida }))
    processo.once('exit', (codigo) => pronto({ ok: codigo === 0, saida }))
  })
}

/** Mede o som de um lado e o grava na etiqueta, no lugar. Falhou, o arquivo fica como está. Nunca lança. */
async function marcarSom(caminho: string, registrar: (linha: string) => void): Promise<void> {
  const provisorio = `${caminho}.som.ogg`
  try {
    const medida = await rodarFfmpeg(argumentosDaMedicao(caminho))
    const som = medida.ok ? trechosComSom(medida.saida.split('\n')) : null
    if (!som) {
      registrar(`gravação: a medição do som de ${caminho} falhou; vai sem etiqueta`)
      return
    }
    const escrita = await rodarFfmpeg(argumentosDaEtiqueta(caminho, provisorio, valorDaEtiqueta(som)))
    if (escrita.ok && (await stat(provisorio)).size > 0) return await rename(provisorio, caminho)
    registrar(`gravação: a etiqueta do som de ${caminho} falhou; vai sem etiqueta`)
  } catch (erro) {
    registrar(`gravação: o som de ${caminho} falhou (${erro instanceof Error ? erro.message : String(erro)}); vai sem etiqueta`)
  }
  await rm(provisorio, { force: true }).catch(() => {})
}

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
    // `info` imprime o início de cada entrada (`start:`), de onde sai o corte
    // do que veio antes do atendimento; `-nostats` cala o progresso.
    '-nostats',
    '-loglevel',
    'info',
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
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((pronto) => setTimeout(pronto, ms)),
): Promise<Gravacao> {
  if (!ID_DA_LIGACAO.test(ligacao)) throw new Error('id de ligação inválido')
  const pasta = join(base, ligacao)
  await mkdir(pasta, { recursive: true })
  const ffmpeg = spawn('ffmpeg', argumentosDoFfmpeg(pasta), { stdio: ['ignore', 'ignore', 'pipe'] })
  // Só as linhas dos inícios ficam guardadas (o resto vai ao registro).
  const doInicio: string[] = []
  let pedaco = ''
  ffmpeg.stderr.setEncoding('utf8')
  ffmpeg.stderr.on('data', (texto: string) => {
    // A linha pode chegar partida entre dois pedaços: o resto espera o próximo.
    const linhas = (pedaco + texto).split('\n')
    pedaco = linhas.pop() ?? ''
    for (const crua of linhas) {
      const linha = crua.trim()
      if (!linha) continue
      if (/Input #\d+,|\bstart: /.test(linha) && doInicio.length < 20) doInicio.push(linha)
      registrar(`ffmpeg: ${linha}`)
    }
  })
  const vivo = () => ffmpeg.exitCode === null && ffmpeg.signalCode === null
  const fim = new Promise<void>((pronto) => ffmpeg.once('exit', () => pronto()))
  ffmpeg.once('error', (erro) => registrar(`ffmpeg não abriu: ${erro.message}`))
  return {
    async parar(atendidaEm) {
      // Atendida: grava a cauda que ainda está a caminho antes de parar.
      if (atendidaEm !== null && vivo()) await esperar(CAUDA_MS)
      if (vivo()) {
        // SIGINT: o ffmpeg fecha os arquivos direito (o SIGKILL deixaria o fim cortado).
        ffmpeg.kill('SIGINT')
        const teto = setTimeout(() => ffmpeg.kill('SIGKILL'), ESPERA_DO_FFMPEG_MS)
        await fim
        clearTimeout(teto)
      }
      if (atendidaEm === null) {
        // Ninguém atendeu: não há conversa a guardar (só o toque e o atendente).
        await rm(pasta, { recursive: true, force: true }).catch(() => {})
        return
      }
      const inicios = iniciosDasEntradas(pedaco ? [...doInicio, pedaco] : doInicio)
      for (const nome of ARQUIVOS_DA_GRAVACAO) {
        // O estéreo segue a 1ª entrada (o cliente); o atendente, a 2ª.
        const inicio = inicios[nome === 'atendente.ogg' ? 1 : 0]
        if (inicio === null) {
          registrar(`gravação ${ligacao}/${nome}: sem o início do ffmpeg; fica inteira`)
          continue
        }
        const segundos = segundosACortar(atendidaEm, inicio)
        if (segundos !== null) await cortarInicio(join(pasta, nome), segundos, registrar)
      }
      // Depois do corte: o horário da etiqueta é o do arquivo que vai ao CRM.
      for (const nome of ['cliente.ogg', 'atendente.ogg']) await marcarSom(join(pasta, nome), registrar)
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
