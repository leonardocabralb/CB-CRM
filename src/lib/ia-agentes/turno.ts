// ============================================================
// O TURNO do agente de IA (docs/PLANO-agentes-de-ia.md, D24–D27 e E5–E10).
//
// Um turno = reivindicar o pendente → conferir tudo de novo → (áudio) →
// gerar → conferir de novo → PASSAR (D25) ou reservar e enviar → encerrar. A
// ingestão só enfileira (`entrada.ts`), com o agente da etapa, o card e a
// etapa; este módulo roda no `after()` do disparo ou na rede do cron.
//
// ⚠️⚠️ As regras que seguram o turno, e o motivo de cada uma:
//  - O turno responde SÓ enquanto o card continua na etapa com que foi
//    enfileirado e o agente continua dono dela (`lerQuemAtende` +
//    `quemResponde`, a MESMA leitura da entrada, antes de gerar e antes de
//    enviar; a última palavra é da reserva, no banco). Card movido, etapa
//    que trocou de agente, agente desligado: descarta.
//  - CERCA DE POSSE em toda escrita no turno (`status = 'rodando'` e o
//    `rodando_desde` do PRÓPRIO claim): o recolhedor pode ter tomado a linha
//    de um processo lento. A exceção é o id do provedor da resposta
//    (`gravarIdEnviado`), que o eco precisa ler mesmo depois do recolhimento.
//  - NUNCA reenviar. Erro no meio do envio (tempo esgotado, 5xx, rede) pode
//    ter entregado a mensagem: vira `incerto` e transfere para gente. Só a
//    recusa COMPROVADA do provedor (4xx) ou erro antes da primeira chamada a
//    ele garante que nada saiu (`antesDoProvedor`, `meta-send.ts`).
//  - Falha de CONFIGURAÇÃO (chave, modelo, provedor fora do ar) NÃO transfere
//    (E8): a pausa 'transferencia' é permanente, o problema é passageiro, e o
//    alerta de atraso já chama a equipe. Transferem: o sentinela, a resposta
//    vazia, o teto de respostas (que a reserva conta pelas mensagens do
//    agente), o áudio que não se ouve, o envio incerto e a passagem que não
//    dá para fazer.
//  - Mensagem mais nova do cliente NA MESMA CONEXÃO descarta o turno (E10)
//    — só a que ABRE turno (`abreTurno`, a régua da entrada).
//  - Gente respondeu: a IA PAUSA ('gente', D26) — quem pausa é o gatilho da
//    1049 (também com turno vivo na conversa); o turno só lê a pausa.
//  - A transferência não passa por cima de pausa que já existe.
//  - PASSAGEM (D25): a triagem responde `[[PASSAR:n]]`; o card vai para a
//    etapa do agente n (UPDATE condicional: ainda na etapa do turno e
//    aberto), fica uma anotação, e um turno NOVO do agente de destino
//    (`veio_de_passagem`) responde à MESMA mensagem. Esse não passa de novo:
//    se tentar, transfere para gente. Com automação ligada escutando a etapa
//    de destino, ELA fala e o turno do destino não nasce (E4).
//  - Evento de funil ainda não drenado cuja etapa tem automação escutando
//    REAGENDA o turno (a boas-vindas da etapa ainda vai sair), por até
//    `JANELA_DO_AUDIO_MS` contada do gatilho (`funilAindaVaiFalar`).
//  - O que o agente VÊ além da conversa (F3): os blocos de acesso marcados e
//    os trechos da base DELE, lidos UMA vez por turno, antes de gerar
//    (`lerOQueOAgenteVe`). Bloco que não se lê vai como "unavailable", base
//    que falha fica vazia — nenhum dos dois derruba o turno. O RETRATO do que
//    entrou no pedido é gravado em `cb_ia_turnos.contexto` (1052), com a
//    cerca de posse, antes da geração.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { concluirDigitando, mostrarDigitando } from '@/lib/ai/digitando'
import { generateReply } from '@/lib/ai/generate'
import { AiError, mensagemSeguraDeAiError, type AiConfig, type AiUsage } from '@/lib/ai/types'
import { logAiUsage } from '@/lib/ai/usage'
import { drenarEventosDeFunil } from '@/lib/automations/drain-events'
import { etapaTemQuemFale } from '@/lib/automations/engine'
import { recusaComprovada } from '@/lib/automations/retentativa'
import { donoDaConta } from '@/lib/cb-channels/resolve-inbound'
import {
  CanalExigidoIndisponivelError,
  EnviadaSemRegistroError,
  engineSendText,
} from '@/lib/flows/meta-send'
import { lerChave } from '@/lib/ia-chaves/repo'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { transcreverAudio } from '@/lib/transcricao/transcrever'

import { lerOQueOAgenteVe } from './acesso'
import type { IaAgente } from './agente'
import { consultaDaUltimaMensagem, PRAZO_DO_EMBEDDING_MS } from './conhecimento'
import { lerConversaDaConexao } from './contexto'
import {
  agendarDisparo,
  enfileirarTurno,
  JANELA_DO_AUDIO_MS,
  PRAZO_DO_TURNO_MS,
  REAGENDAR_AUDIO_MS,
  RESERVA_DO_ENVIO_MS,
  type TurnoNaFila,
} from './fila'
import { dentroDoHorario } from './horario'
import { lerPassagem, montarPedidoDoAgente } from './pedido'
import { abreTurno, lerQuemAtende, quemResponde, TIPOS_QUE_ABREM_TURNO, type CardDoContato } from './quem-responde'
import { obterAgente } from './repo'
import { textosDaPassagem, textosDaTransferencia, type MotivoDeTransferencia } from './textos-do-servidor'

/** A linha de `cb_ia_turnos` que o claim devolve. */
export interface LinhaDoTurno {
  id: string
  account_id: string
  conversation_id: string
  canal_id: string | null
  /** O agente da etapa, gravado pela entrada (ou pela passagem). */
  ia_agente_id: string | null
  /** O card e a etapa em que ele estava quando o turno nasceu (D24). */
  deal_id: string | null
  stage_id: string | null
  /** O turno que a triagem abriu para o agente de destino (D25): não passa de novo. */
  veio_de_passagem: boolean
  mensagem_gatilho_id: string | null
  mensagem_inicial_id: string | null
  rodando_desde: string
}

interface Gatilho {
  id: string
  message_id: string | null
  gravada_em: string | null
  content_type: string
  content_text: string | null
  media_type: string | null
}

/** Como o turno termina. `abandonado` = a posse foi perdida: nada se escreve. */
export type Desfecho =
  | { status: 'respondeu'; mensagemEnviadaId: string; erro?: string }
  | { status: 'transferiu'; motivo: MotivoDeTransferencia }
  | { status: 'incerto'; erro: string }
  | {
      status: 'passou' | 'descartado' | 'pausado_no_meio' | 'fora_do_horario' | 'sem_resposta' | 'falhou'
      erro?: string
    }
  | { status: 'reagendar' }
  | { status: 'abandonado' }

// ------------------------------------------------------------
// Escrita no turno, sempre com a cerca de posse
// ------------------------------------------------------------

async function gravarNoTurno(
  db: SupabaseClient,
  turno: LinhaDoTurno,
  campos: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await db
    .from('cb_ia_turnos')
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq('id', turno.id)
    .eq('status', 'rodando')
    .eq('rodando_desde', turno.rodando_desde)
    .select('id')
  if (error) {
    console.error('[ia-agentes] escrita no turno falhou:', turno.id, error.message)
    return false
  }
  return (data?.length ?? 0) > 0
}

/**
 * O id do provedor da resposta, ANTES do INSERT dela: é o que a ingestão do
 * eco consulta (E5, `eco.ts`). ⚠️ A ÚNICA escrita do turno SEM a cerca de
 * posse — cercada só pelo id do turno e por `mensagem_enviada_id` ainda nulo:
 * com o turno recolhido no meio do envio, o eco ainda precisa reconhecer a
 * resposta. Não reescreve `status` (o desfecho que o recolhedor gravou fica).
 */
async function gravarIdEnviado(db: SupabaseClient, turno: LinhaDoTurno, id: string): Promise<void> {
  const { error } = await db
    .from('cb_ia_turnos')
    .update({ mensagem_enviada_id: id, updated_at: new Date().toISOString() })
    .eq('id', turno.id)
    .is('mensagem_enviada_id', null)
  if (error) console.error('[ia-agentes] gravar o id da resposta falhou:', turno.id, error.message)
}

/**
 * `conversations.ia_agente_id` = o ÚLTIMO agente que respondeu nesta conversa
 * — é o que arma a pausa por gente (o gatilho da 1049 só pausa conversa com
 * agente). Melhor esforço: a resposta já saiu.
 */
async function marcarUltimoAgente(db: SupabaseClient, turno: LinhaDoTurno, agenteId: string): Promise<void> {
  try {
    const { error } = await db
      .from('conversations')
      .update({ ia_agente_id: agenteId })
      .eq('id', turno.conversation_id)
      .eq('account_id', turno.account_id)
      .neq('status', 'closed')
    if (error) console.error('[ia-agentes] gravar o agente da conversa falhou:', turno.id, error.message)
  } catch (err) {
    console.error('[ia-agentes] gravar o agente da conversa falhou:', turno.id, err)
  }
}

// ------------------------------------------------------------
// Transferência para gente
// ------------------------------------------------------------

/**
 * O que a transferência fez: `transferiu` (pausou, e daí atribuiu e anotou);
 * `nada_mudou` (a conversa JÁ estava pausada, ou encerrada — nada foi
 * escrito); `falhou` (a pausa não pôde ser gravada).
 */
export type ResultadoDaTransferencia = 'transferiu' | 'nada_mudou' | 'falhou'

/**
 * Pausa a IA na conversa (`'transferencia'`), atribui o destino do agente
 * quando ninguém é responsável, e deixa uma anotação interna de verdade
 * (autor sem usuário, nome congelado "IA · <agente>").
 *
 * ⚠️ Só se a conversa ainda NÃO está pausada (nem encerrada): o advogado que
 * responde pelo celular enquanto o modelo pensa já pausou por `'gente'`, e a
 * transferência não troca o motivo nem anota por cima. Zero linhas =
 * `nada_mudou`, e nada mais é escrito. Melhor esforço: erro vira log.
 */
export async function transferirParaGente(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string | null
    nomeDoAgente: string
    transferirPara: string | null
    motivo: MotivoDeTransferencia
  },
): Promise<ResultadoDaTransferencia> {
  const agora = new Date().toISOString()
  try {
    const { data: pausadas, error } = await db
      .from('conversations')
      .update({ ai_autoreply_disabled: true, ia_pausada_por: 'transferencia', ia_pausada_em: agora })
      .eq('id', args.conversationId)
      .eq('account_id', args.accountId)
      .eq('ai_autoreply_disabled', false)
      .neq('status', 'closed')
      .select('id')
    if (error) {
      console.error('[ia-agentes] pausar na transferência falhou:', error.message)
      return 'falhou'
    }
    if (!pausadas || pausadas.length === 0) return 'nada_mudou'

    if (args.transferirPara) {
      // O destino tem de ser MEMBRO desta conta hoje: a pessoa pode ter saído.
      const { data: membro } = await db
        .from('profiles')
        .select('user_id')
        .eq('user_id', args.transferirPara)
        .eq('account_id', args.accountId)
        .maybeSingle()
      if (membro) {
        // Só quando ninguém é responsável: nunca tirar a conversa de alguém.
        await db
          .from('conversations')
          .update({ assigned_agent_id: args.transferirPara })
          .eq('id', args.conversationId)
          .eq('account_id', args.accountId)
          .is('assigned_agent_id', null)
      }
    }

    const { autor, texto } = await textosDaTransferencia(args.nomeDoAgente, args.motivo)
    await anotar(db, { ...args, autor, texto })
    return 'transferiu'
  } catch (err) {
    console.error('[ia-agentes] transferência falhou:', err)
    return 'falhou'
  }
}

/** Anotação interna sem usuário (autor congelado "IA · <agente>"). Melhor esforço. */
async function anotar(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; contactId: string | null; autor: string; texto: string },
): Promise<void> {
  const { error } = await db.from('cb_conversation_notes').insert({
    account_id: args.accountId,
    conversation_id: args.conversationId,
    contact_id: args.contactId,
    author_user_id: null,
    autor_nome: args.autor,
    texto: args.texto,
  })
  if (error) console.error('[ia-agentes] anotação da IA falhou:', error.message)
}

// ------------------------------------------------------------
// As conferências (antes de gerar e antes de enviar)
// ------------------------------------------------------------

/** Teto da leitura das mensagens mais novas (a régua do conteúdo roda em JS). */
const MAIS_NOVAS_LIDAS = 50

/**
 * Chegou mensagem do cliente MAIS NOVA na mesma conexão que ABRE turno (E10)?
 * Só essa descarta: o turno dela é o substituto. A régua é `abreTurno`, a
 * MESMA do portão da entrada — figurinha, localização, botão e texto sem nada
 * visível não abrem turno, e descartar por elas deixava o cliente sem
 * resposta. Apagada não conta.
 */
async function haMensagemMaisNova(db: SupabaseClient, turno: LinhaDoTurno, gatilho: Gatilho): Promise<boolean> {
  if (!gatilho.gravada_em || !turno.canal_id) return false
  const { data, error } = await db
    .from('messages')
    .select('id, content_type, content_text, media_type')
    .eq('conversation_id', turno.conversation_id)
    .eq('channel_id', turno.canal_id)
    .eq('sender_type', 'customer')
    .in('content_type', [...TIPOS_QUE_ABREM_TURNO])
    .is('deleted_at', null)
    .gt('gravada_em', gatilho.gravada_em)
    .order('gravada_em', { ascending: true })
    .limit(MAIS_NOVAS_LIDAS)
  if (error) throw new Error(`leitura de mensagem mais nova falhou: ${error.message}`)
  return ((data ?? []) as Array<{ content_type: string; content_text: string | null; media_type: string | null }>).some(
    (m) => abreTurno({ tipo: m.content_type, texto: m.content_text, mime: m.media_type }),
  )
}

/**
 * O ROBÔ ou uma AUTOMAÇÃO mandou mensagem nesta conversa, POR ESTA CONEXÃO,
 * depois da mensagem-gatilho (E4)? Os dois gravam `sender_type = 'bot'` sem
 * `ia_agente_id`. Só a MESMA conexão (D4). O caso é o toque em botão durante
 * a rajada: ele não abre turno, mas a automação de `button_response`
 * responde, e o turno do texto responderia de novo. Apagada não conta.
 */
async function haSaidaDoRoboDepois(db: SupabaseClient, turno: LinhaDoTurno, gatilho: Gatilho): Promise<boolean> {
  if (!gatilho.gravada_em || !turno.canal_id) return false
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', turno.conversation_id)
    .eq('channel_id', turno.canal_id)
    .eq('sender_type', 'bot')
    .is('ia_agente_id', null)
    .is('deleted_at', null)
    .gt('gravada_em', gatilho.gravada_em)
    .limit(1)
  if (error) throw new Error(`leitura de resposta do robô falhou: ${error.message}`)
  return (data?.length ?? 0) > 0
}

/** Teto da leitura dos eventos de funil pendentes do contato. */
const EVENTOS_PENDENTES_LIDOS = 20

/**
 * FALA ADIADA DO FUNIL NA RAJADA (E4). "Mover card", "Criar negócio", o
 * roteador de funil e a PASSAGEM só gravam um evento em
 * `cb_automation_events`; a automação da etapa de destino — a boas-vindas —
 * roda DEPOIS, no dreno. Há evento deste CONTATO ainda não drenado cuja etapa
 * tem quem escute? O turno REAGENDA, e na volta, drenado o evento, a saída da
 * automação o descarta (`haSaidaDoRoboDepois`, e a reserva).
 *
 * Só dentro de `JANELA_DO_AUDIO_MS` contada do `gravada_em` do gatilho:
 * passada a janela o dreno falhou, e o cliente não pode ficar sem resposta.
 * Leitura que falha DENTRO dela = reagenda. `true` = reagendar.
 */
async function funilAindaVaiFalar(
  db: SupabaseClient,
  turno: LinhaDoTurno,
  contactId: string | null,
  gatilho: Gatilho,
): Promise<boolean> {
  if (!contactId || !gatilho.gravada_em) return false
  const gravada = Date.parse(gatilho.gravada_em)
  if (!Number.isFinite(gravada) || Date.now() - gravada >= JANELA_DO_AUDIO_MS) return false
  try {
    const { data, error } = await db
      .from('cb_automation_events')
      .select('to_stage_id')
      .eq('account_id', turno.account_id)
      .eq('contact_id', contactId)
      .eq('tipo', 'deal_stage_changed')
      .is('processado_em', null)
      .limit(EVENTOS_PENDENTES_LIDOS)
    if (error) {
      console.error('[ia-agentes] leitura dos eventos de funil pendentes falhou (reagenda):', error.message)
      return true
    }
    const etapas = new Set(
      ((data ?? []) as Array<{ to_stage_id: string | null }>)
        .map((e) => e.to_stage_id)
        .filter((e): e is string => typeof e === 'string'),
    )
    for (const etapa of etapas) {
      if (await etapaTemQuemFale(db, turno.account_id, etapa)) return true
    }
    return false
  } catch (err) {
    console.error('[ia-agentes] conferir a fala adiada do funil falhou (reagenda):', err)
    return true
  }
}

type Conferencia =
  | { ok: true; contactId: string | null; card: CardDoContato; agente: IaAgente }
  | { ok: false; desfecho: Desfecho }

/**
 * O card continua na etapa do turno, a etapa continua do MESMO agente, ligado
 * e dono da conexão (D24/D27 — `lerQuemAtende` + `quemResponde`, as leituras
 * da entrada), a conversa aberta e sem pausa (a de gente inclusive), o
 * gatilho lá e sem edição, sem mensagem mais nova nem saída do
 * robô/automação? E nenhuma
 * automação de funil ainda por falar (reagenda)? Roda antes de gerar e de
 * novo antes de enviar ou passar.
 */
async function conferir(db: SupabaseClient, turno: LinhaDoTurno, gatilho: Gatilho): Promise<Conferencia> {
  if (!turno.canal_id || !turno.ia_agente_id || !turno.deal_id || !turno.stage_id) {
    return { ok: false, desfecho: { status: 'descartado', erro: 'turno sem agente, card ou conexão' } }
  }
  const leitura = await lerQuemAtende(db, {
    accountId: turno.account_id,
    conversationId: turno.conversation_id,
    canalId: turno.canal_id,
  })
  if (!leitura) return { ok: false, desfecho: { status: 'descartado', erro: 'conversa' } }
  const decisao = quemResponde({
    ...leitura,
    canalId: turno.canal_id,
    conteudo: { tipo: gatilho.content_type, texto: gatilho.content_text, mime: gatilho.media_type },
    ehRespostaDeBotao: false,
    roboConsumiu: false,
    automacaoFalou: false,
  })
  if (decisao.quem === 'ninguem') {
    return decisao.motivo === 'pausada'
      ? { ok: false, desfecho: { status: 'pausado_no_meio' } }
      : { ok: false, desfecho: { status: 'descartado', erro: decisao.motivo } }
  }
  if (
    decisao.agenteId !== turno.ia_agente_id ||
    decisao.dealId !== turno.deal_id ||
    decisao.stageId !== turno.stage_id ||
    !leitura.card
  ) {
    return { ok: false, desfecho: { status: 'descartado', erro: 'o card mudou de etapa ou a etapa mudou de agente' } }
  }
  const agente = await obterAgente(turno.account_id, decisao.agenteId)
  if (!agente) return { ok: false, desfecho: { status: 'descartado', erro: 'agente indisponível' } }

  // O cliente pode ter APAGADO ou EDITADO a mensagem durante a espera ou a
  // geração (a edição cifrada da Evolution 2.4 carimba `edited_at` e mantém
  // o texto antigo): responder seria responder ao que ele retirou.
  const { data: aindaLa, error: erroDoGatilho } = await db
    .from('messages')
    .select('deleted_at, edited_at')
    .eq('id', gatilho.id)
    .maybeSingle()
  if (erroDoGatilho) throw new Error(`releitura da mensagem falhou: ${erroDoGatilho.message}`)
  const linha = aindaLa as { deleted_at: string | null; edited_at: string | null } | null
  if (!linha || linha.deleted_at) return { ok: false, desfecho: { status: 'descartado', erro: 'o cliente apagou a mensagem' } }
  if (linha.edited_at) return { ok: false, desfecho: { status: 'descartado', erro: 'o cliente editou a mensagem' } }

  if (await haMensagemMaisNova(db, turno, gatilho)) {
    return { ok: false, desfecho: { status: 'descartado', erro: 'mensagem mais nova do cliente' } }
  }
  if (await haSaidaDoRoboDepois(db, turno, gatilho)) {
    return { ok: false, desfecho: { status: 'descartado', erro: 'o robô ou uma automação respondeu' } }
  }
  // Depois da saída do robô, de propósito: a automação que JÁ falou descarta
  // (final); a que ainda vai falar só adia.
  if (await funilAindaVaiFalar(db, turno, leitura.contactId, gatilho)) {
    return { ok: false, desfecho: { status: 'reagendar' } }
  }
  return { ok: true, contactId: leitura.contactId, card: leitura.card, agente }
}

// ------------------------------------------------------------
// Áudio (E9)
// ------------------------------------------------------------

/** Quantos áudios da rajada o turno transcreve (os MAIS NOVOS). */
const AUDIOS_DA_RAJADA = 5

/**
 * Os áudios da RAJADA (da primeira à última mensagem do turno, nesta
 * conexão) precisam estar transcritos antes de gerar. `null` = pode seguir.
 * Marca `andamento.transcreveu` quando algum áudio passou a ter transcrição
 * NESTA rodada. ⚠️ Lidos em ordem DECRESCENTE e invertidos: com mais áudios
 * que o teto, a ordem crescente deixava de fora os mais novos — o gatilho
 * inclusive.
 */
async function prepararAudios(
  db: SupabaseClient,
  turno: LinhaDoTurno,
  gatilho: Gatilho,
  andamento: Andamento,
): Promise<Desfecho | null> {
  if (!turno.canal_id || !gatilho.gravada_em) return null
  let desde = gatilho.gravada_em
  if (turno.mensagem_inicial_id && turno.mensagem_inicial_id !== gatilho.id) {
    const { data: inicial } = await db
      .from('messages')
      .select('gravada_em')
      .eq('id', turno.mensagem_inicial_id)
      .maybeSingle()
    if (inicial?.gravada_em) desde = inicial.gravada_em as string
  }
  const { data, error } = await db
    .from('messages')
    .select('id, gravada_em, transcricao, transcricao_status')
    .eq('conversation_id', turno.conversation_id)
    .eq('channel_id', turno.canal_id)
    .eq('sender_type', 'customer')
    .eq('content_type', 'audio')
    .is('deleted_at', null)
    .gte('gravada_em', desde)
    .lte('gravada_em', gatilho.gravada_em)
    .order('gravada_em', { ascending: false })
    .limit(AUDIOS_DA_RAJADA)
  if (error) throw new Error(`leitura dos áudios falhou: ${error.message}`)

  for (const audio of [...(data ?? [])].reverse()) {
    if (audio.transcricao_status === 'pronta' && audio.transcricao) continue
    const r = await transcreverAudio(db, { accountId: turno.account_id, messageId: audio.id as string })
    if (r.status === 'pronta') {
      andamento.transcreveu = true
      continue
    }
    if (r.status === 'recusada') return { status: 'transferiu', motivo: 'audio' }
    // `transcrevendo`, ou `falhou` (arquivo ainda baixando, Gemini fora do
    // ar): dentro da janela, reagenda; depois dela, gente ouve.
    const gravada = Date.parse((audio.gravada_em as string | null) ?? '')
    const idade = Number.isFinite(gravada) ? Date.now() - gravada : Number.POSITIVE_INFINITY
    if (r.status === 'transcrevendo' || idade < JANELA_DO_AUDIO_MS) return { status: 'reagendar' }
    return { status: 'transferiu', motivo: 'audio' }
  }
  return null
}

// ------------------------------------------------------------
// A passagem (D25)
// ------------------------------------------------------------

/**
 * Os agentes de `pode_passar_para` que podem receber AGORA (ligados, não
 * arquivados, donos da conexão do turno), na ordem da numeração que o pedido
 * mostra ao modelo. Leitura que falha deixa o agente de fora.
 */
async function agentesParaPassar(turno: LinhaDoTurno, agente: IaAgente): Promise<IaAgente[]> {
  if (agente.podePassarPara.length === 0 || !turno.canal_id) return []
  const canal = turno.canal_id
  const lidos = await Promise.all(agente.podePassarPara.map((id) => obterAgente(turno.account_id, id).catch(() => null)))
  return lidos.filter((a): a is IaAgente => !!a && a.ativo && !a.arquivadoEm && a.conexoes.includes(canal))
}

/**
 * A etapa de destino do agente: a dele no MESMO funil do card (a de menor
 * posição), senão a primeira do funil mais antigo em que ele atua. `null` =
 * o agente não atua em etapa nenhuma. Lança em erro de leitura.
 */
async function etapaDoAgente(
  db: SupabaseClient,
  accountId: string,
  agenteId: string,
  funilDoCard: string,
): Promise<{ id: string; pipelineId: string } | null> {
  const { data: linhas, error } = await db
    .from('cb_ia_agente_etapas')
    .select('stage_id')
    .eq('ia_agente_id', agenteId)
    .eq('account_id', accountId)
  if (error) throw new Error(`leitura das etapas do agente falhou: ${error.message}`)
  const ids = ((linhas ?? []) as Array<{ stage_id: string }>).map((l) => l.stage_id)
  if (ids.length === 0) return null
  const { data: etapas, error: erroEtapas } = await db
    .from('pipeline_stages')
    .select('id, pipeline_id, position')
    .in('id', ids)
  if (erroEtapas) throw new Error(`leitura das etapas falhou: ${erroEtapas.message}`)
  const lista = ((etapas ?? []) as Array<{ id: string; pipeline_id: string; position: number }>).sort(
    (a, b) => a.position - b.position,
  )
  if (lista.length === 0) return null
  const noMesmoFunil = lista.find((e) => e.pipeline_id === funilDoCard)
  if (noMesmoFunil) return { id: noMesmoFunil.id, pipelineId: noMesmoFunil.pipeline_id }
  const { data: funis, error: erroFunis } = await db
    .from('pipelines')
    .select('id')
    .in('id', [...new Set(lista.map((e) => e.pipeline_id))])
    .order('created_at', { ascending: true })
    .limit(1)
  if (erroFunis) throw new Error(`leitura dos funis falhou: ${erroFunis.message}`)
  const primeiro = ((funis ?? []) as Array<{ id: string }>)[0]?.id
  const etapa = lista.find((e) => e.pipeline_id === primeiro)
  return etapa ? { id: etapa.id, pipelineId: etapa.pipeline_id } : null
}

/**
 * A triagem respondeu `[[PASSAR:n]]`: move o card para a etapa do agente n
 * (UPDATE condicional — o card ainda aberto e na etapa do turno), anota, e
 * enfileira o turno do destino sobre a MESMA mensagem (`veio_de_passagem`,
 * sem a espera da rajada) — menos quando uma automação ligada escuta a etapa
 * de destino: aí ela fala, e o destino responde a próxima mensagem (E4).
 * Passagem de passagem, agente n que não serve e card que já saiu da etapa
 * TRANSFEREM para gente.
 */
async function passar(
  db: SupabaseClient,
  turno: LinhaDoTurno,
  gatilho: Gatilho,
  conferido: { contactId: string | null; card: CardDoContato; agente: IaAgente },
  opcoes: IaAgente[],
  n: number,
): Promise<Desfecho> {
  if (turno.veio_de_passagem) return { status: 'transferiu', motivo: 'sentinela' }
  const destino = opcoes[n - 1]
  if (!destino || !turno.canal_id || !turno.deal_id || !turno.stage_id) {
    return { status: 'transferiu', motivo: 'sentinela' }
  }
  const etapa = await etapaDoAgente(db, turno.account_id, destino.id, conferido.card.pipelineId)
  if (!etapa) return { status: 'transferiu', motivo: 'sentinela' }

  // `pipeline_id` e `stage_id` num UPDATE só (a trilha da 912 conta a troca
  // de funil numa linha).
  const { data: movidos, error } = await db
    .from('deals')
    .update({ pipeline_id: etapa.pipelineId, stage_id: etapa.id })
    .eq('id', turno.deal_id)
    .eq('account_id', turno.account_id)
    .eq('stage_id', turno.stage_id)
    .eq('status', 'open')
    .select('id')
  if (error) return { status: 'falhou', erro: `mover o card falhou: ${error.message}` }
  if (!movidos || movidos.length === 0) return { status: 'transferiu', motivo: 'sentinela' }
  // A automação da etapa de destino (a boas-vindas) roda já, como a tela faz.
  void drenarEventosDeFunil().catch(() => {})

  const { autor, texto } = await textosDaPassagem(conferido.agente.nome, destino.nome)
  await anotar(db, {
    accountId: turno.account_id,
    conversationId: turno.conversation_id,
    contactId: conferido.contactId,
    autor,
    texto,
  })

  // Alguma automação ligada escuta a etapa de destino: ELA fala desta vez, e
  // o agente responde a partir da próxima mensagem do cliente — a regra da
  // entrada (E4). Esperar pelo dreno não basta: o evento é reivindicado antes
  // de a automação rodar, e um "Aguardar" ou a retentativa do envio faria a
  // boas-vindas sair DEPOIS da resposta do agente (Codex, #309).
  if (await etapaTemQuemFale(db, turno.account_id, etapa.id)) return { status: 'passou' }

  const novo = await enfileirarTurno(db, {
    accountId: turno.account_id,
    conversationId: turno.conversation_id,
    canalId: turno.canal_id,
    iaAgenteId: destino.id,
    dealId: turno.deal_id,
    stageId: etapa.id,
    mensagemId: gatilho.id,
    veioDePassagem: true,
  })
  // A fila recusou o turno do destino (erro do banco): o card já mudou e
  // ninguém responderia — a conversa vai para a equipe (Codex, #309).
  if (!novo) return { status: 'transferiu', motivo: 'sentinela' }
  // Quem o roda é `rodarPendentesDaConversa`, logo que este termina; o
  // disparo agendado é a segunda porta (relógios diferentes), e a rede do
  // cron a terceira. A reivindicação é atômica: roda uma vez só.
  agendarTurno(novo)
  return { status: 'passou' }
}

// ------------------------------------------------------------
// O envio
// ------------------------------------------------------------

/**
 * Nada saiu? Erro antes da primeira chamada ao provedor, ou a recusa
 * COMPROVADA dele (4xx). Tudo o mais pode ter saído.
 */
export function nadaSaiu(err: unknown, tentou: boolean): boolean {
  if (!tentou) return true
  if (err instanceof CanalExigidoIndisponivelError) return true
  // A MESMA régua do motor (E4): as duas pontas não podem divergir.
  return recusaComprovada(err)
}

function configDoAgente(agente: IaAgente, apiKey: string): AiConfig {
  return {
    provider: agente.provedor,
    model: agente.modelo,
    radarModel: null,
    apiKey,
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: agente.tetoRespostas,
    handoffAgentId: null,
    embeddingsApiKey: null,
  }
}

// ------------------------------------------------------------
// A condução
// ------------------------------------------------------------

interface Andamento {
  agente: IaAgente | null
  contactId: string | null
  usage: AiUsage | null
  /** A primeira chamada ao provedor de MENSAGEM aconteceu. */
  tentouEnviar: boolean
  enviadaId: string | null
  /** Algum áudio da rajada foi transcrito NESTA rodada (`prepararAudios`). */
  transcreveu: boolean
  /**
   * Cancela o "digitando…" (`mostrarDigitando`). O envio o CONCLUI antes de a
   * resposta sair (`concluirDigitando`), e `executarTurno` o cancela em TODA
   * saída — senão o pedido em voo chegava à Meta depois de o turno desistir.
   */
  cancelarDigitando: AbortController
}

async function conduzir(
  db: SupabaseClient,
  turno: LinhaDoTurno,
  inicio: number,
  andamento: Andamento,
): Promise<Desfecho> {
  if (!turno.mensagem_gatilho_id || !turno.canal_id) return { status: 'descartado', erro: 'sem mensagem ou conexão' }
  const { data: gatilhoLido, error: erroGatilho } = await db
    .from('messages')
    .select('id, message_id, gravada_em, deleted_at, edited_at, content_type, content_text, media_type')
    .eq('id', turno.mensagem_gatilho_id)
    .maybeSingle()
  if (erroGatilho) throw new Error(`leitura da mensagem falhou: ${erroGatilho.message}`)
  if (!gatilhoLido || gatilhoLido.deleted_at) return { status: 'descartado', erro: 'a mensagem sumiu ou foi apagada' }
  if (gatilhoLido.edited_at) return { status: 'descartado', erro: 'o cliente editou a mensagem' }
  const gatilho = gatilhoLido as Gatilho

  const primeira = await conferir(db, turno, gatilho)
  if (!primeira.ok) return primeira.desfecho
  const { agente } = primeira
  andamento.agente = agente
  andamento.contactId = primeira.contactId

  if (!dentroDoHorario(agente.horario, new Date())) return { status: 'fora_do_horario' }

  const audio = await prepararAudios(db, turno, gatilho, andamento)
  if (audio) return audio

  const conversa = await lerConversaDaConexao(db, {
    conversationId: turno.conversation_id,
    canalId: turno.canal_id,
  })
  if (conversa.length === 0) return { status: 'descartado', erro: 'conversa vazia nesta conexão' }

  let apiKey: string | null
  try {
    const lida = await lerChave(turno.account_id, agente.provedor)
    if (lida.ilegivel) return { status: 'falhou', erro: 'a chave do provedor não decifra' }
    apiKey = lida.chave
  } catch {
    return { status: 'falhou', erro: 'leitura da chave falhou' }
  }
  if (!apiKey) return { status: 'falhou', erro: `sem chave do provedor ${agente.provedor}` }

  const opcoes = await agentesParaPassar(turno, agente)

  // PRÉVIA do prazo ANTES de gastar a vaga da conta: a leitura do que o agente
  // vê (F3) ainda pode levar até `PRAZO_DO_EMBEDDING_MS`, e o turno que a
  // transcrição quase esgotou reagendaria DEPOIS de ter gasto a vaga — 30
  // áudios assim secavam a cota da conta (Codex, #312).
  if (PRAZO_DO_TURNO_MS - (Date.now() - inicio) - RESERVA_DO_ENVIO_MS - PRAZO_DO_EMBEDDING_MS < 3_000) {
    if (andamento.transcreveu) return { status: 'reagendar' }
    return { status: 'falhou', erro: 'o prazo do turno acabou antes de gerar' }
  }

  // Teto por CONTA sobre a chave compartilhada: uma rajada de 200 clientes ao
  // mesmo tempo não pode estourar o limite do provedor. Passou → sem resposta
  // (a mensagem fica na caixa para gente; o alerta de atraso segue valendo).
  // ⚠️ Conta só quando VAI gerar: o áudio ainda baixando reagenda a cada 10 s,
  // e contado antes gastava a cota da conta sem gerar nada (Codex, #309). E
  // ANTES de ler o que o agente vê (F3): o turno barrado não lê dado do
  // cliente nem paga a busca da base.
  const limite = checkRateLimit(`ai-autoreply:${turno.account_id}`, RATE_LIMITS.aiAutoReplyAccount)
  if (!limite.success) return { status: 'sem_resposta', erro: 'limite de respostas por minuto da conta' }

  // O que o agente vê além da conversa (F3), lido antes de medir o prazo que
  // sobra para gerar. Nunca lança.
  const visto = await lerOQueOAgenteVe(db, {
    accountId: turno.account_id,
    agente,
    contactId: primeira.contactId,
    dealId: turno.deal_id,
    consulta: consultaDaUltimaMensagem(conversa),
    agora: new Date(),
  })
  // O RETRATO (1052): é o que responde "por que a IA fez isso?" depois que a
  // ficha, o card ou o documento mudarem. Escrita separada do desfecho, com a
  // cerca de posse: ERRO de banco é melhor esforço (segue), mas ZERO linhas é
  // posse perdida — o recolhedor tomou o turno enquanto o contexto carregava,
  // e gerar pagaria o provedor por uma resposta que não sai (Codex, #312).
  const { data: comRetrato, error: erroRetrato } = await db
    .from('cb_ia_turnos')
    .update({ contexto: visto.retrato, updated_at: new Date().toISOString() })
    .eq('id', turno.id)
    .eq('status', 'rodando')
    .eq('rodando_desde', turno.rodando_desde)
    .select('id')
  if (erroRetrato) console.error('[ia-agentes] gravar o retrato do turno falhou:', turno.id, erroRetrato.message)
  else if ((comRetrato?.length ?? 0) === 0) return { status: 'abandonado' }

  const restante = PRAZO_DO_TURNO_MS - (Date.now() - inicio) - RESERVA_DO_ENVIO_MS
  if (restante < 3_000) {
    // A transcrição comeu o prazo: ela é idempotente e já ficou gravada, e o
    // turno seguinte começa com o prazo cheio. ⚠️ Só quando ela AVANÇOU nesta
    // rodada — é o que impede o laço.
    if (andamento.transcreveu) return { status: 'reagendar' }
    return { status: 'falhou', erro: 'o prazo do turno acabou antes de gerar' }
  }

  // "Digitando…" só quando vai gerar (só conexão Meta; nunca lança). Corre em
  // paralelo com a geração, mas a resposta o ESPERA antes de sair
  // (`concluirDigitando`), e toda saída sem envio o cancela (`executarTurno`).
  // ⚠️ A Meta marca a mensagem do cliente como LIDA junto (P6).
  const digitando = mostrarDigitando(db, {
    accountId: turno.account_id,
    conversationId: turno.conversation_id,
    channelId: turno.canal_id,
    inboundMessageId: gatilho.message_id,
    sinal: andamento.cancelarDigitando.signal,
  })

  let texto: string
  let handoff: boolean
  try {
    const r = await generateReply({
      config: configDoAgente(agente, apiKey),
      systemPrompt: montarPedidoDoAgente({
        instrucoes: agente.instrucoes,
        regras: agente.regras,
        agora: new Date(),
        passagens: opcoes.map((a) => ({ nome: a.nome, descricao: a.descricao })),
        blocos: visto.blocos,
        conhecimento: visto.trechos.map((t) => t.content),
      }),
      messages: conversa,
      timeoutMs: restante,
    })
    texto = r.text
    handoff = r.handoff
    andamento.usage = r.usage
  } catch (err) {
    return {
      status: 'falhou',
      erro: err instanceof AiError ? mensagemSeguraDeAiError(err) : 'erro inesperado ao gerar',
    }
  }

  // Registrado com ou sem transferência: a chamada ao provedor aconteceu.
  void logAiUsage(db, {
    accountId: turno.account_id,
    conversationId: turno.conversation_id,
    mode: 'agente',
    channelId: turno.canal_id,
    provider: agente.provedor,
    model: agente.modelo,
    usage: andamento.usage,
    iaAgenteId: agente.id,
    iaAgenteNome: agente.nome,
    turnoId: turno.id,
  })

  if (handoff || !texto.trim()) return { status: 'transferiu', motivo: 'sentinela' }
  const passagem = lerPassagem(texto)

  // O "digitando…" termina (ou é cancelado, passados 2 s) ANTES da última
  // conferência, e não entre a reserva e o envio.
  await concluirDigitando(digitando, andamento.cancelarDigitando)

  // De novo, com a resposta pronta: o advogado pode ter respondido, o card
  // pode ter mudado de etapa, a conversa pode ter sido pausada ou o agente
  // desligado enquanto o modelo pensava.
  const segunda = await conferir(db, turno, gatilho)
  if (!segunda.ok) return segunda.desfecho

  if (passagem !== null) return passar(db, turno, gatilho, segunda, opcoes, passagem)

  const dono = await donoDaConta(db, turno.account_id)
  if (!dono) return { status: 'falhou', erro: 'a conta não tem dono' }
  const contactId = segunda.contactId
  if (!contactId) return { status: 'descartado', erro: 'conversa sem contato' }

  // A ÚLTIMA palavra, no banco, numa escrita atômica: o turno ainda
  // `rodando` e da posse; conversa aberta e sem pausa; o card aberto e na
  // etapa do turno; o agente ligado e dono dela; nenhuma mensagem mais nova do
  // cliente nem saída do robô nesta conexão; e o teto (as respostas do agente
  // desde que o card entrou na etapa ou a IA foi retomada).
  const { data: reserva, error: erroReserva } = await db.rpc('cb_ia_reservar_envio', {
    p_turno_id: turno.id,
    p_rodando_desde: turno.rodando_desde,
  })
  if (erroReserva) return { status: 'falhou', erro: `reservar a resposta falhou: ${erroReserva.message}` }
  if (reserva === 'teto') return { status: 'transferiu', motivo: 'teto' }
  if (reserva === 'pausada') return { status: 'pausado_no_meio', erro: 'pausada antes do envio' }
  // Qualquer outra recusa descarta, sem enviar e sem transferir: transferir
  // por um motivo que não é teto pausaria a IA até alguém clicar "Retomar".
  if (reserva !== 'ok') return { status: 'descartado', erro: `a reserva recusou o envio: ${String(reserva)}` }

  // A posse, carimbando o começo do envio (o recolhedor distingue "morreu
  // antes de enviar" de "morreu no meio"). ⚠️ DEPOIS da reserva: "`rodando`
  // sem `enviando_desde`" quer dizer "ainda não pode ter enviado", e a
  // entrada descarta exatamente esse (`descartarPendente`). Perdida = nada
  // saiu.
  const tokens = andamento.usage
  const posse = await gravarNoTurno(db, turno, {
    enviando_desde: new Date().toISOString(),
    iteracoes: 1,
    tokens_entrada: tokens?.promptTokens ?? null,
    tokens_saida: tokens?.completionTokens ?? null,
    tokens_total: tokens?.totalTokens ?? null,
  })
  if (!posse) return { status: 'abandonado' }

  try {
    const r = await engineSendText({
      accountId: turno.account_id,
      userId: dono,
      conversationId: turno.conversation_id,
      contactId,
      text: texto,
      aiGenerated: true,
      preferredChannelId: turno.canal_id,
      exigirCanal: true,
      iaAgenteId: agente.id,
      antesDoProvedor: () => {
        andamento.tentouEnviar = true
      },
      aoSair: async (id) => {
        andamento.enviadaId = id
        await gravarIdEnviado(db, turno, id)
      },
    })
    await marcarUltimoAgente(db, turno, agente.id)
    return { status: 'respondeu', mensagemEnviadaId: r.whatsapp_message_id }
  } catch (err) {
    if (err instanceof EnviadaSemRegistroError) {
      await marcarUltimoAgente(db, turno, agente.id)
      return { status: 'respondeu', mensagemEnviadaId: err.providerMessageId, erro: err.message }
    }
    const detalhe = err instanceof Error ? err.message : String(err)
    if (nadaSaiu(err, andamento.tentouEnviar)) return { status: 'falhou', erro: `envio recusado: ${detalhe}` }
    return { status: 'incerto', erro: `não dá para saber se saiu: ${detalhe}` }
  }
}

// ------------------------------------------------------------
// O encerramento
// ------------------------------------------------------------

async function encerrar(
  db: SupabaseClient,
  turno: LinhaDoTurno,
  desfecho: Desfecho,
  andamento: Andamento,
): Promise<void> {
  if (desfecho.status === 'abandonado') return

  if (desfecho.status === 'reagendar') {
    const executarApos = new Date(Date.now() + REAGENDAR_AUDIO_MS).toISOString()
    const { data, error } = await db
      .from('cb_ia_turnos')
      .update({
        status: 'aguardando',
        rodando_desde: null,
        executar_apos: executarApos,
        // O retrato é da rodada que acabou: a próxima grava o seu (revisão da F3).
        contexto: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', turno.id)
      .eq('status', 'rodando')
      .eq('rodando_desde', turno.rodando_desde)
      .select('id')
    if (!error && data && data.length > 0) {
      agendarTurno({ id: turno.id, executarApos })
      return
    }
    // 23505: já há outro pendente nesta conexão (mensagem mais nova) — ele
    // cuida da conversa, este sai.
    if (error?.code === '23505') {
      await gravarNoTurno(db, turno, { status: 'descartado', erro: 'mensagem mais nova do cliente', terminado_em: new Date().toISOString() })
      return
    }
    if (error) console.error('[ia-agentes] reagendar o turno falhou:', error.message)
    return
  }

  const erro =
    desfecho.status === 'transferiu'
      ? desfecho.motivo
      : 'erro' in desfecho
        ? (desfecho.erro ?? null)
        : null
  const terminadoEm = new Date().toISOString()
  // Com a cerca de posse: turno que OUTRO caminho já marcou (a entrada o
  // descartou, o recolhedor o tomou) não é sobrescrito.
  const escreveu = await gravarNoTurno(db, turno, {
    status: desfecho.status,
    erro,
    terminado_em: terminadoEm,
    ...(desfecho.status === 'respondeu' ? { mensagem_enviada_id: desfecho.mensagemEnviadaId } : {}),
  })
  if (!escreveu) return

  const motivo: MotivoDeTransferencia | null =
    desfecho.status === 'transferiu' ? desfecho.motivo : desfecho.status === 'incerto' ? 'incerto' : null
  if (!motivo || !andamento.agente) return
  const transferencia = await transferirParaGente(db, {
    accountId: turno.account_id,
    conversationId: turno.conversation_id,
    contactId: andamento.contactId,
    nomeDoAgente: andamento.agente.nome,
    transferirPara: andamento.agente.transferirPara,
    motivo,
  })
  // Alguém pausou antes (a equipe respondeu enquanto o modelo pensava, o
  // botão Pausar): o agente NÃO transferiu — o registro diz o que houve. O
  // `incerto` fica: ele fala do ENVIO, não da transferência.
  if (transferencia === 'nada_mudou' && desfecho.status === 'transferiu') {
    const { error } = await db
      .from('cb_ia_turnos')
      .update({
        status: 'pausado_no_meio',
        erro: `não transferiu (${desfecho.motivo}): a conversa já estava pausada ou encerrada`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', turno.id)
      .eq('status', 'transferiu')
      .eq('terminado_em', terminadoEm)
    if (error) console.error('[ia-agentes] corrigir o desfecho da transferência falhou:', turno.id, error.message)
  }
}

// ------------------------------------------------------------
// As portas
// ------------------------------------------------------------

async function reivindicar(db: SupabaseClient, turnoId: string): Promise<LinhaDoTurno | null> {
  const { data, error } = await db.rpc('cb_ia_reivindicar_turno', { p_turno_id: turnoId })
  if (error) {
    console.error('[ia-agentes] reivindicar o turno falhou:', turnoId, error.message)
    return null
  }
  const linha = (Array.isArray(data) ? data[0] : data) as LinhaDoTurno | undefined
  return linha && typeof linha.rodando_desde === 'string' ? linha : null
}

/**
 * Roda UM turno, se ele estiver pendente e vencido e a conversa livre.
 * Nunca lança. Depois de um turno reivindicado, roda os pendentes vencidos da
 * mesma conversa (o de outra conexão, o que ficou esperando este acabar, e o
 * do agente de destino de uma passagem).
 */
export async function executarTurno(turnoId: string): Promise<void> {
  const db = supabaseAdmin()
  const turno = await reivindicar(db, turnoId)
  if (!turno) return

  const inicio = Date.now()
  const andamento: Andamento = {
    agente: null,
    contactId: null,
    usage: null,
    tentouEnviar: false,
    enviadaId: null,
    transcreveu: false,
    cancelarDigitando: new AbortController(),
  }
  let desfecho: Desfecho
  try {
    desfecho = await conduzir(db, turno, inicio, andamento)
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err)
    console.error('[ia-agentes] o turno quebrou:', turno.id, detalhe)
    // O mesmo critério do envio: depois do id do provedor, a mensagem saiu;
    // no meio do envio, não se sabe; antes, nada saiu.
    desfecho = andamento.enviadaId
      ? { status: 'respondeu', mensagemEnviadaId: andamento.enviadaId, erro: detalhe }
      : andamento.tentouEnviar
        ? { status: 'incerto', erro: detalhe }
        : { status: 'falhou', erro: detalhe }
  } finally {
    // O "digitando…" não sobrevive ao turno: em toda saída SEM envio o pedido
    // ainda em voo é cancelado aqui.
    andamento.cancelarDigitando.abort()
  }

  try {
    await encerrar(db, turno, desfecho, andamento)
  } catch (err) {
    console.error('[ia-agentes] encerrar o turno falhou:', turno.id, err)
  }
  await rodarPendentesDaConversa(turno.conversation_id)
}

/** Os pendentes VENCIDOS de uma conversa, um de cada vez. Nunca lança. */
export async function rodarPendentesDaConversa(conversationId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin()
      .from('cb_ia_turnos')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('status', 'aguardando')
      .lte('executar_apos', new Date().toISOString())
      .order('executar_apos', { ascending: true })
      .limit(3)
    if (error) {
      console.error('[ia-agentes] ler os pendentes da conversa falhou:', error.message)
      return
    }
    for (const t of data ?? []) await executarTurno(t.id as string)
  } catch (err) {
    console.error('[ia-agentes] rodar os pendentes da conversa falhou:', err)
  }
}

/** Agenda o turno para depois do `executar_apos` (a espera da rajada). */
export function agendarTurno(turno: TurnoNaFila): void {
  agendarDisparo(turno, executarTurno)
}
