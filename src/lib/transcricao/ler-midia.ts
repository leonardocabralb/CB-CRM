// ============================================================
// Leitura de IMAGEM e PDF do cliente — a irmã de `transcrever.ts`, com a
// MESMA mecânica (docs/PLANO-agentes-de-ia.md, "Leitura de imagem e PDF").
//
// A leitura vira TEXTO, uma vez, guardado na própria mensagem, e o agente de
// IA recebe o texto (`ia-agentes/contexto.ts`) — funciona com qualquer
// provedor do agente, porque quem LÊ é escolhido pela chave da conta
// (Gemini → OpenAI → Anthropic, `escolher-leitor.ts`; os adaptadores estão em
// `leitores.ts`). Nada de multimodal no `generateReply`.
//
// ⚠️⚠️ Grava nas colunas `messages.transcricao*` (943), as MESMAS do áudio:
// para uma imagem ou um documento elas querem dizer "o texto lido da mídia".
// Conferido que nenhum leitor as mostra fora do áudio — a bolha
// (`TranscricaoDeAudio`) e a aba Arquivos (`previaDaTranscricao`) só as leem
// em áudio, a busca (929) e a API v1 não as leem, e o Radar passou a usá-las
// SÓ em áudio (`worker.ts`). Quem criar um leitor novo de `transcricao*`
// filtra por `content_type = 'audio'` ou trata a leitura de mídia de propósito.
// O status gravado é o do CHECK da 943 (`transcrevendo`, `pronta`, `falhou`,
// `recusada`) — "transcrevendo" aqui é "lendo".
//
// O contrato, o da transcrição com três diferenças:
//  - o CADEADO `UPDATE…RETURNING` (dois processos vivos no deploy), com o
//    teto de tentativas DENTRO do WHERE e a travada de 10 min recolhida;
//  - problema de CONFIGURAÇÃO devolve `sem_leitor` SEM GRAVAR e sem gastar
//    tentativa (sem chave, chave ilegível, formato que só OUTRO provedor lê —
//    o HEIC sem Gemini): cadastrar a chave certa reativa a leitura. O
//    documento sem tipo que o download revela ser desses grava o `media_type`
//    que o Storage disse, para a próxima vez recusar ANTES de baixar;
//  - `recusada` GRAVADA só para o irreversível da própria mensagem: tipo que
//    nenhum provedor lê (docx, planilha…), arquivo grande demais para o
//    provedor escolhido, arquivo sem URL acessível ao servidor, tentativas
//    esgotadas;
//  - ⚠️ a falha PASSAGEIRA não gasta tentativa (`falhaPassageira`: chave,
//    modelo, cota, provedor fora do ar, tempo esgotado, rede): o turno
//    reagenda a cada 10 s, e três soluços seguidos carimbavam `recusada` para
//    sempre num arquivo legível. Quem dá o ritmo das retentativas é o turno
//    (`prepararMidias`: na janela da mensagem e até o teto de espera; depois,
//    uma por mensagem nova do cliente). Contam as falhas que dizem algo do
//    ARQUIVO: 4xx do provedor, resposta vazia, leitura bloqueada;
//  - cerca de posse na escrita final e na falha (`transcricao_desde`);
//  - custo em `ai_usage_log` no modo da transcrição, com o provedor e o
//    modelo usados, ANTES de julgar a resposta.
// Diferente do áudio: parar no teto de tokens NÃO é recusa — o texto lido
// até ali é gravado com o corte declarado (`textoParaGravar`). Mas a leitura
// BLOQUEADA (recitação, segurança, recusa do modelo, resposta incompleta por
// outro motivo — `LeituraDoProvedor.bloqueio`) é falha: o que veio junto
// nunca vira o conteúdo do arquivo. O prazo da chamada é o da leitura
// (`TEMPO_DA_LEITURA_MS`: 45 s imagem, 90 s PDF), não o do chat.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { logAiUsage } from '@/lib/ai/usage'

import { escolherLeitor } from './escolher-leitor'
import {
  erroDoProvedor,
  extensao,
  falhaPassageira,
  LIMITE_DE_BYTES,
  lerRespostaDeLeitura,
  mimeDaExtensao,
  mimeLimpo,
  MODELO_DE_LEITURA,
  nomeParaOProvedor,
  ORDEM_DA_LEITURA,
  pedidoDeLeitura,
  provedorLe,
  TEMPO_DA_LEITURA_MS,
  textoParaGravar,
  tipoDoMime,
  type TipoDeLeitura,
} from './leitores'
import { TIMEOUT_DOWNLOAD_MS } from './transcrever'

const TENTATIVAS_MAX = 3
const TRAVADA_MIN = 10
/** Espelho da transcrição: o webhook grava a mensagem PRIMEIRO e o arquivo segundos depois. */
const JANELA_DOWNLOAD_MS = 2 * 60_000

/** Os tipos de mensagem que se leem aqui (o áudio é da transcrição). */
export const TIPOS_QUE_SE_LEEM: readonly string[] = ['image', 'document']

/**
 * Os motivos GRAVADOS (terminais). Vão para o agente no contexto ("could not
 * be read: …"), por isso curtos.
 */
export const RECUSA = {
  tipo: 'tipo de arquivo que o agente não lê',
  grande: 'arquivo grande demais para ler',
  semArquivo: 'arquivo sem acesso para o servidor',
  esgotadas: 'tentativas esgotadas — o arquivo não pôde ser lido',
} as const

export type ResultadoLeitura =
  | { status: 'pronta'; texto: string }
  | { status: 'lendo' }
  | { status: 'falhou'; erro: string }
  | { status: 'recusada'; erro: string }
  /**
   * Nenhuma chave cadastrada lê este arquivo AGORA (configuração): nada
   * gravado, nenhuma tentativa gasta. O `erro` é para a equipe (manda às
   * Integrações) — nunca vai ao modelo, que só fica sabendo que o arquivo não
   * pôde ser lido (`contexto.ts`, `MOTIVO_SEM_LEITOR`).
   */
  | { status: 'sem_leitor'; erro: string }

interface MensagemDeMidia {
  id: string
  conversation_id: string
  content_type: string
  media_url: string | null
  media_type: string | null
  media_filename: string | null
  created_at: string | null
  deleted_at: string | null
  transcricao: string | null
  transcricao_status: string | null
  transcricao_erro: string | null
  transcricao_tentativas: number
  conversation: { account_id: string; channel_id: string | null } | null
}

export type ClasseDaMidia =
  | { tipo: TipoDeLeitura; mime: string }
  /** Nenhum provedor lê (docx, planilha, zip, bmp…): terminal. */
  | { tipo: 'outro' }
  /** Documento sem mime nem extensão: decide-se pelo `Content-Type` do download. */
  | { tipo: 'desconhecido' }

/**
 * O que a mensagem é, ANTES do download. Nesta ordem:
 *  1. o `media_type` gravado — quando existe, decide (legível ou `outro`);
 *  2. a extensão do NOME que o cliente deu (`media_filename`, 969) — num
 *     documento, uma extensão que ninguém lê (".docx") já é `outro`;
 *  3. a extensão da URL do bucket, só quando é de um tipo legível: o caminho
 *     leva ".bin" quando o nome não tinha extensão (`buildMediaPath`), e isso
 *     não diz nada sobre o arquivo;
 *  4. imagem sem nada disso é JPEG — é o que o WhatsApp entrega como foto; o
 *     documento fica para o `Content-Type` do download.
 * PURA (testada).
 */
export function classificarMidia(m: {
  content_type: string
  media_type: string | null
  media_filename?: string | null
  media_url?: string | null
}): ClasseDaMidia {
  const comMime = (mime: string): ClasseDaMidia => {
    const tipo = tipoDoMime(mime)
    return tipo ? { tipo, mime } : { tipo: 'outro' }
  }
  const doTipo = mimeLimpo(m.media_type)
  if (doTipo) return comMime(doTipo)
  const extDoNome = extensao(m.media_filename)
  const doNome = mimeDaExtensao(extDoNome)
  if (doNome) return comMime(doNome)
  if (extDoNome && m.content_type === 'document') return { tipo: 'outro' }
  const daUrl = mimeDaExtensao(extensao(m.media_url))
  if (daUrl) return comMime(daUrl)
  if (m.content_type === 'image') return { tipo: 'imagem', mime: 'image/jpeg' }
  return { tipo: 'desconhecido' }
}

export async function lerMidia(
  admin: SupabaseClient,
  args: { accountId: string; messageId: string },
): Promise<ResultadoLeitura> {
  // Posse ANTES de qualquer coisa (o service-role ignora RLS; `messages` não
  // tem account_id): conta errada é "não existe".
  const { data, error } = await admin
    .from('messages')
    .select(
      'id, conversation_id, content_type, media_url, media_type, media_filename, created_at, deleted_at, transcricao, transcricao_status, transcricao_erro, transcricao_tentativas, conversation:conversations!inner(account_id, channel_id)',
    )
    .eq('id', args.messageId)
    .maybeSingle()
  if (error) return { status: 'falhou', erro: `falha lendo a mensagem: ${error.message}` }

  const msg = data as unknown as MensagemDeMidia | null
  if (!msg || msg.conversation?.account_id !== args.accountId) {
    return { status: 'recusada', erro: 'mensagem não encontrada' }
  }
  if (!TIPOS_QUE_SE_LEEM.includes(msg.content_type)) {
    return { status: 'recusada', erro: 'a mensagem não é imagem nem documento' }
  }
  // Apagada não se lê — a decisão da 929 e da transcrição. Sem gravar.
  if (msg.deleted_at) return { status: 'recusada', erro: 'a mensagem foi apagada' }

  // Idempotência: quem chegar depois lê de graça.
  if (msg.transcricao) return { status: 'pronta', texto: msg.transcricao }
  if (msg.transcricao_status === 'recusada') {
    return { status: 'recusada', erro: msg.transcricao_erro ?? RECUSA.tipo }
  }

  const classe = classificarMidia(msg)
  if (classe.tipo === 'outro') {
    await gravarTerminal(admin, msg.id, RECUSA.tipo)
    return { status: 'recusada', erro: RECUSA.tipo }
  }

  // ⚠️ O proxy RELATIVO da Meta exige sessão de usuário: o servidor buscaria
  // a tela de login. Dentro da janela de download é transitório (o arquivo
  // chega segundos depois da mensagem).
  if (!msg.media_url || !msg.media_url.startsWith('https://')) {
    const idadeMs = msg.created_at ? Date.now() - Date.parse(msg.created_at) : Number.POSITIVE_INFINITY
    if (idadeMs < JANELA_DOWNLOAD_MS) {
      return { status: 'falhou', erro: 'o arquivo ainda está sendo baixado — tente de novo em instantes' }
    }
    await gravarTerminal(admin, msg.id, RECUSA.semArquivo)
    return { status: 'recusada', erro: RECUSA.semArquivo }
  }

  // A chave ANTES do cadeado: sem chave não se grava estado.
  const escolha = await escolherLeitor(args.accountId, ORDEM_DA_LEITURA)
  if (!escolha.ok) {
    if (escolha.motivo === 'erro') {
      return { status: 'falhou', erro: 'não foi possível ler a chave de IA — tente de novo em instantes' }
    }
    return {
      status: 'sem_leitor',
      erro:
        escolha.motivo === 'ilegivel'
          ? 'a chave de IA não pôde ser lida — cadastre-a de novo em Configurações → Integrações'
          : 'sem chave do Gemini, da OpenAI ou da Anthropic — cadastre uma em Configurações → Integrações',
    }
  }
  const { provedor, chave } = escolha
  // Formato que OUTRO provedor lê (o HEIC só o Gemini): configuração, não a
  // mensagem — sem gravar, para ler no dia em que a chave do Gemini entrar.
  if (classe.tipo !== 'desconhecido' && !provedorLe(provedor, classe.tipo, classe.mime)) {
    return { status: 'sem_leitor', erro: `formato que a chave cadastrada não lê (${classe.mime})` }
  }

  // O CADEADO — o da transcrição, com os tipos desta leitura.
  const claimIso = new Date().toISOString()
  const corte = new Date(Date.now() - TRAVADA_MIN * 60_000).toISOString()
  const { data: claim, error: claimErr } = await admin
    .from('messages')
    .update({
      transcricao_status: 'transcrevendo',
      transcricao_desde: claimIso,
      transcricao_tentativas: msg.transcricao_tentativas + 1,
    })
    .eq('id', msg.id)
    .in('content_type', [...TIPOS_QUE_SE_LEEM])
    .is('deleted_at', null)
    .is('transcricao', null)
    .lt('transcricao_tentativas', TENTATIVAS_MAX)
    // O incremento é leitura-então-escrita: amarrar o valor LIDO.
    .eq('transcricao_tentativas', msg.transcricao_tentativas)
    .or(
      `transcricao_status.is.null,transcricao_status.eq.falhou,and(transcricao_status.eq.transcrevendo,transcricao_desde.lt.${corte})`,
    )
    .select('id')
    .maybeSingle()
  if (claimErr) return { status: 'falhou', erro: `falha no cadeado: ${claimErr.message}` }

  if (!claim) {
    // Alguém chegou antes — ou o teto esgotou. O estado REAL, sem cobrar.
    const { data: atualData } = await admin
      .from('messages')
      .select('transcricao, transcricao_status, transcricao_erro, transcricao_tentativas')
      .eq('id', msg.id)
      .maybeSingle()
    const atual = atualData as Pick<
      MensagemDeMidia,
      'transcricao' | 'transcricao_status' | 'transcricao_erro' | 'transcricao_tentativas'
    > | null
    if (atual?.transcricao) return { status: 'pronta', texto: atual.transcricao }
    if (atual?.transcricao_status === 'falhou' && (atual.transcricao_tentativas ?? 0) >= TENTATIVAS_MAX) {
      await gravarTerminal(admin, msg.id, RECUSA.esgotadas)
      return { status: 'recusada', erro: RECUSA.esgotadas }
    }
    if (atual?.transcricao_status === 'recusada') {
      return { status: 'recusada', erro: atual.transcricao_erro ?? RECUSA.tipo }
    }
    return { status: 'lendo' }
  }

  // A tentativa de ANTES deste cadeado: a falha passageira devolve o contador
  // a este valor (não gasta tentativa).
  const tentativasAntes = msg.transcricao_tentativas

  try {
    const controle = new AbortController()
    const tDownload = setTimeout(() => controle.abort(), TIMEOUT_DOWNLOAD_MS)
    let bytes: Buffer
    let tipo: TipoDeLeitura
    let mime: string
    try {
      const resp = await fetch(msg.media_url, { signal: controle.signal })
      if (!resp.ok) {
        // O 404 do bucket é o arquivo que sumiu (conta); 5xx, 408 e 429 são o
        // Storage fora do ar (não conta).
        const passageira = resp.status >= 500 || resp.status === 408 || resp.status === 429
        return await falhar(
          admin,
          msg.id,
          claimIso,
          `download do arquivo falhou (HTTP ${resp.status})`,
          passageira ? tentativasAntes : undefined,
        )
      }
      // O documento sem mime nem extensão decide AQUI, pelo Storage.
      if (classe.tipo === 'desconhecido') {
        const doStorage = mimeLimpo(resp.headers.get('content-type'))
        const t = tipoDoMime(doStorage)
        if (!t || !doStorage) {
          await gravarTerminal(admin, msg.id, RECUSA.tipo, claimIso)
          return { status: 'recusada', erro: RECUSA.tipo }
        }
        if (!provedorLe(provedor, t, doStorage)) {
          // Raro (HEIC mandado como documento sem nome nem tipo): é
          // CONFIGURAÇÃO, não o arquivo — solta o cadeado SEM gastar a
          // tentativa e grava o tipo que o Storage disse: da próxima vez
          // `classificarMidia` o conhece e o `sem_leitor` sai ANTES do
          // download (baixar de novo a cada turno para recusar de novo, não).
          controle.abort()
          await soltarSemGastar(admin, msg, claimIso, doStorage)
          return { status: 'sem_leitor', erro: `formato que a chave cadastrada não lê (${doStorage})` }
        }
        tipo = t
        mime = doStorage
      } else {
        tipo = classe.tipo
        mime = classe.mime
      }
      // Tamanho declarado ANTES de ler o corpo: não baixar 40 MB para recusar.
      const limite = LIMITE_DE_BYTES[provedor][tipo]
      const declarado = Number(resp.headers.get('content-length'))
      if (Number.isFinite(declarado) && declarado > limite) {
        controle.abort()
        await gravarTerminal(admin, msg.id, RECUSA.grande, claimIso)
        return { status: 'recusada', erro: RECUSA.grande }
      }
      // O corpo fica DENTRO do timeout do download.
      bytes = Buffer.from(await resp.arrayBuffer())
    } finally {
      clearTimeout(tDownload)
    }
    if (bytes.byteLength > LIMITE_DE_BYTES[provedor][tipo]) {
      await gravarTerminal(admin, msg.id, RECUSA.grande, claimIso)
      return { status: 'recusada', erro: RECUSA.grande }
    }
    if (bytes.byteLength === 0) return await falhar(admin, msg.id, claimIso, 'download do arquivo veio vazio')

    const pedido = pedidoDeLeitura({
      provedor,
      chave,
      tipo,
      mime,
      base64: bytes.toString('base64'),
      nomeDoArquivo: nomeParaOProvedor(msg.media_filename, tipo),
    })
    const tProvedor = new AbortController()
    const tHandle = setTimeout(() => tProvedor.abort(), TEMPO_DA_LEITURA_MS[tipo])
    let r: Response
    try {
      r = await fetch(pedido.url, {
        method: 'POST',
        headers: pedido.headers,
        body: pedido.body,
        signal: tProvedor.signal,
      })
    } finally {
      clearTimeout(tHandle)
    }
    if (!r.ok) {
      const corpo = await r.text().catch(() => '')
      return await falhar(
        admin,
        msg.id,
        claimIso,
        erroDoProvedor(provedor, r.status, corpo, chave),
        falhaPassageira(r.status) ? tentativasAntes : undefined,
      )
    }
    const lida = lerRespostaDeLeitura(provedor, await r.json().catch(() => null))

    // ⚠️ Custo ANTES de julgar a resposta: a resposta vazia ou cortada já foi
    // COBRADA, e `falhou` retenta até 3×. No modo da transcrição (o painel de
    // Uso não ganha modo novo — o CHECK da 943 já o aceita), com o provedor e
    // o modelo usados de verdade.
    void logAiUsage(admin, {
      accountId: args.accountId,
      conversationId: msg.conversation_id,
      mode: 'transcricao',
      channelId: msg.conversation?.channel_id ?? null,
      provider: provedor,
      model: MODELO_DE_LEITURA[provedor],
      usage: lida.usage,
    })

    // ⚠️ Bloqueada (recitação, segurança, recusa do modelo, incompleta por
    // outro motivo que não o teto): falha da LEITURA, que conta — o pedaço
    // que veio junto, ou a frase de recusa, NUNCA vira o conteúdo do arquivo.
    if (lida.bloqueio) return await falhar(admin, msg.id, claimIso, `o provedor não entregou a leitura: ${lida.bloqueio}`)
    if (!lida.texto) return await falhar(admin, msg.id, claimIso, 'o modelo devolveu resposta vazia')
    const texto = textoParaGravar(lida.texto, lida.cortado)

    const { data: gravado } = await admin
      .from('messages')
      .update({
        transcricao: texto,
        transcricao_status: 'pronta',
        transcricao_em: new Date().toISOString(),
        transcricao_erro: null,
        transcricao_desde: null,
      })
      .eq('id', msg.id)
      // Cerca de posse: recolhidos por outro processo, este resultado é o
      // mais velho — vira no-op, mas o texto ainda serve ao chamador.
      .eq('transcricao_status', 'transcrevendo')
      .eq('transcricao_desde', claimIso)
      .select('id')
      .maybeSingle()
    if (!gravado) {
      console.warn(`[ler-midia] resultado da mensagem ${msg.id} descartado: reivindicada por outro processo`)
    }
    return { status: 'pronta', texto }
  } catch (err) {
    // Tempo esgotado (download ou provedor) e rede (o `fetch` lança
    // `TypeError`) são PASSAGEIROS: não gastam tentativa. O resto conta.
    const tempo = err instanceof Error && err.name === 'AbortError'
    const passageira = tempo || err instanceof TypeError
    const motivo = tempo ? 'tempo esgotado' : err instanceof Error ? err.message : 'erro desconhecido'
    return await falhar(admin, msg.id, claimIso, motivo, passageira ? tentativasAntes : undefined)
  }
}

/**
 * Falha retentável — grava `falhou` com a cerca de posse. Com
 * `tentativasAntes` (a falha PASSAGEIRA), devolve o contador ao valor de antes
 * do cadeado: a tentativa não conta para o teto de 3.
 */
async function falhar(
  admin: SupabaseClient,
  messageId: string,
  claimIso: string,
  motivo: string,
  tentativasAntes?: number,
): Promise<ResultadoLeitura> {
  const { error } = await admin
    .from('messages')
    .update({
      transcricao_status: 'falhou',
      transcricao_erro: motivo.slice(0, 300),
      transcricao_desde: null,
      ...(tentativasAntes === undefined ? {} : { transcricao_tentativas: tentativasAntes }),
    })
    .eq('id', messageId)
    .eq('transcricao_status', 'transcrevendo')
    .eq('transcricao_desde', claimIso)
  if (error) console.error(`[ler-midia] não gravou a falha da mensagem ${messageId}:`, error.message)
  return { status: 'falhou', erro: motivo }
}

/**
 * Solta o cadeado como se ele não tivesse existido (a tentativa não conta, o
 * estado volta ao de antes) e grava o `media_type` que o download revelou —
 * o `sem_leitor` descoberto só depois de baixar. Com a cerca de posse.
 */
async function soltarSemGastar(
  admin: SupabaseClient,
  msg: MensagemDeMidia,
  claimIso: string,
  mediaType: string,
): Promise<void> {
  const { error } = await admin
    .from('messages')
    .update({
      transcricao_status: msg.transcricao_status === 'falhou' ? 'falhou' : null,
      transcricao_desde: null,
      transcricao_tentativas: msg.transcricao_tentativas,
      media_type: mediaType,
    })
    .eq('id', msg.id)
    .eq('transcricao_status', 'transcrevendo')
    .eq('transcricao_desde', claimIso)
  if (error) console.error(`[ler-midia] não soltou o cadeado da mensagem ${msg.id}:`, error.message)
}

/** Estado terminal (`recusada`) — com cerca quando veio de um claim nosso. */
async function gravarTerminal(
  admin: SupabaseClient,
  messageId: string,
  motivo: string,
  claimIso?: string,
): Promise<void> {
  let query = admin
    .from('messages')
    .update({ transcricao_status: 'recusada', transcricao_erro: motivo.slice(0, 300), transcricao_desde: null })
    .eq('id', messageId)
    .is('transcricao', null)
  if (claimIso) query = query.eq('transcricao_desde', claimIso)
  const { error } = await query
  if (error) console.error(`[ler-midia] não gravou a recusa da mensagem ${messageId}:`, error.message)
}

