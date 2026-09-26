// ============================================================
// O TURNO do agente de IA (docs/PLANO-agentes-de-ia.md, 5.7, e E5–E10).
//
// Um turno = reivindicar o pendente → conferir tudo de novo → (áudio) →
// gerar → conferir de novo → enviar → encerrar. A ingestão só enfileira
// (`entrada.ts`); este módulo roda no `after()` do disparo ou na rede do cron.
//
// ⚠️⚠️ As regras que seguram o turno, e o motivo de cada uma:
//  - CERCA DE POSSE em toda escrita no turno (`status = 'rodando'` e o
//    `rodando_desde` do PRÓPRIO claim): o recolhedor pode ter tomado a linha
//    de um processo lento, e sem a cerca os dois escreveriam. A exceção é o
//    id do provedor da resposta (`gravarIdEnviado`), que o eco precisa ler
//    mesmo depois do recolhimento.
//  - NUNCA reenviar. Erro no meio do envio (tempo esgotado, 5xx, rede) pode
//    ter entregado a mensagem: vira `incerto` e transfere para gente. Só a
//    recusa COMPROVADA do provedor (4xx) ou erro antes da primeira chamada a
//    ele garante que nada saiu (`antesDoProvedor`, `meta-send.ts`).
//  - Falha de CONFIGURAÇÃO (chave, modelo, provedor fora do ar) NÃO transfere
//    (E8): a pausa 'transferencia' é permanente, o problema é passageiro, e o
//    alerta de atraso já chama a equipe. Transferem: o sentinela, a resposta
//    vazia, o teto de respostas, o áudio que não se ouve e o envio incerto.
//  - Mensagem mais nova do cliente NA MESMA CONEXÃO descarta o turno (E10)
//    — só a que ABRE turno (`abreTurno`, a régua da entrada): o turno dela
//    já está na fila.
//  - A transferência não passa por cima de pausa que já existe
//    (`transferirParaGente`): a de gente é a que a automação pode retomar.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { mostrarDigitando } from '@/lib/ai/digitando'
import { generateReply } from '@/lib/ai/generate'
import { AiError, mensagemSeguraDeAiError, type AiConfig, type AiUsage } from '@/lib/ai/types'
import { logAiUsage } from '@/lib/ai/usage'
import { donoDaConta } from '@/lib/cb-channels/resolve-inbound'
import {
  CanalExigidoIndisponivelError,
  EnviadaSemRegistroError,
  engineSendText,
} from '@/lib/flows/meta-send'
import { lerChave } from '@/lib/ia-chaves/repo'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { transcreverAudio } from '@/lib/transcricao/transcrever'
import { EvolutionApiError } from '@/lib/whatsapp/transport/evolution-client'
import { MetaApiError } from '@/lib/whatsapp/meta-api'

import type { IaAgente } from './agente'
import { lerConversaDaConexao } from './contexto'
import {
  agendarDisparo,
  JANELA_DO_AUDIO_MS,
  PRAZO_DO_TURNO_MS,
  REAGENDAR_AUDIO_MS,
  RESERVA_DO_ENVIO_MS,
  type TurnoNaFila,
} from './fila'
import { dentroDoHorario } from './horario'
import { montarPedidoDoAgente } from './pedido'
import { abreTurno, TIPOS_QUE_ABREM_TURNO } from './quem-responde'
import { obterAgente } from './repo'
import { textosDaTransferencia, type MotivoDeTransferencia } from './textos-do-servidor'

/** A linha de `cb_ia_turnos` que o claim devolve. */
export interface LinhaDoTurno {
  id: string
  account_id: string
  conversation_id: string
  canal_id: string | null
  ia_agente_id: string | null
  mensagem_gatilho_id: string | null
  mensagem_inicial_id: string | null
  rodando_desde: string
}

interface Conversa {
  id: string
  contact_id: string | null
  group_id: string | null
  status: string
  ia_agente_id: string | null
  ai_autoreply_disabled: boolean
  ai_reply_count: number
}

interface Gatilho {
  id: string
  message_id: string | null
  gravada_em: string | null
}

/** Como o turno termina. `abandonado` = a posse foi perdida: nada se escreve. */
export type Desfecho =
  | { status: 'respondeu'; mensagemEnviadaId: string; erro?: string }
  | { status: 'transferiu'; motivo: MotivoDeTransferencia }
  | { status: 'incerto'; erro: string }
  | { status: 'descartado' | 'pausado_no_meio' | 'fora_do_horario' | 'sem_resposta' | 'falhou'; erro?: string }
  | { status: 'reagendar' }
  | { status: 'abandonado' }

const COLUNAS_DA_CONVERSA = 'id, contact_id, group_id, status, ia_agente_id, ai_autoreply_disabled, ai_reply_count'

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
 * posse — cercada só pelo id do turno e por `mensagem_enviada_id` ainda nulo.
 * Se o recolhedor tomou o turno no meio do envio (processo lento), com a
 * cerca o id se perdia: o eco da Evolution não era reconhecido, virava
 * mensagem do celular e o gatilho da 1044 pausava o agente por "gente".
 * Não reescreve `status`: o desfecho que o recolhedor gravou fica (ele leu o
 * id nulo e escreveu `incerto` — a conversa já foi para gente, e nada é
 * reenviado: o recolhedor nunca re-executa, e o turno que perdeu a posse não
 * escreve mais nada, `encerrar` inclusive).
 */
async function gravarIdEnviado(db: SupabaseClient, turno: LinhaDoTurno, id: string): Promise<void> {
  const { error } = await db
    .from('cb_ia_turnos')
    .update({ mensagem_enviada_id: id, updated_at: new Date().toISOString() })
    .eq('id', turno.id)
    .is('mensagem_enviada_id', null)
  if (error) console.error('[ia-agentes] gravar o id da resposta falhou:', turno.id, error.message)
}

// ------------------------------------------------------------
// Transferência para gente
// ------------------------------------------------------------

/**
 * O que a transferência fez: `transferiu` (pausou, e daí atribuiu e anotou);
 * `nada_mudou` (a conversa JÁ estava pausada, ou não é mais deste agente —
 * nada foi escrito); `falhou` (a pausa não pôde ser gravada).
 */
export type ResultadoDaTransferencia = 'transferiu' | 'nada_mudou' | 'falhou'

/**
 * Pausa a IA na conversa (`'transferencia'`), atribui o destino do agente
 * quando ninguém é responsável, e deixa uma anotação interna de verdade
 * (autor sem usuário, nome congelado "IA · <agente>"). Cercada pelo agente:
 * se a conversa já é de outro agente (ou de nenhum), nada muda.
 *
 * ⚠️ E só se a conversa ainda NÃO está pausada. Sem essa cerca, o advogado
 * que responde pelo celular enquanto o modelo pensa (o gatilho da 1044 grava
 * a pausa `'gente'`) tinha a pausa TROCADA por `'transferencia'`: a
 * automação deixava de poder retomar o agente (D17 — `'gente'` retoma,
 * `'transferencia'` não), e sobravam anotação e atribuição sobre conversa que
 * alguém já tinha pegado. O mesmo vale para o botão Pausar e para outra
 * transferência. Zero linhas = `nada_mudou`, e nada mais é escrito.
 * Melhor esforço: erro vira log, o turno termina assim mesmo.
 */
export async function transferirParaGente(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string | null
    iaAgenteId: string
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
      .eq('ia_agente_id', args.iaAgenteId)
      .eq('ai_autoreply_disabled', false)
      .select('id')
    if (error) {
      console.error('[ia-agentes] pausar na transferência falhou:', error.message)
      return 'falhou'
    }
    if (!pausadas || pausadas.length === 0) return 'nada_mudou'

    if (args.transferirPara) {
      // O destino tem de ser MEMBRO desta conta hoje: `transferir_para` é
      // conferido ao salvar o agente, mas a pessoa pode ter saído depois.
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
    const { error: erroNota } = await db.from('cb_conversation_notes').insert({
      account_id: args.accountId,
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      author_user_id: null,
      autor_nome: autor,
      texto,
    })
    if (erroNota) console.error('[ia-agentes] anotação da transferência falhou:', erroNota.message)
    return 'transferiu'
  } catch (err) {
    console.error('[ia-agentes] transferência falhou:', err)
    return 'falhou'
  }
}

// ------------------------------------------------------------
// As conferências (antes de gerar e antes de enviar)
// ------------------------------------------------------------

async function lerConversa(db: SupabaseClient, turno: LinhaDoTurno): Promise<Conversa | null> {
  const { data, error } = await db
    .from('conversations')
    .select(COLUNAS_DA_CONVERSA)
    .eq('id', turno.conversation_id)
    .eq('account_id', turno.account_id)
    .maybeSingle()
  if (error) throw new Error(`leitura da conversa falhou: ${error.message}`)
  return (data as Conversa | null) ?? null
}

/** Teto da leitura das mensagens mais novas (a régua do conteúdo roda em JS). */
const MAIS_NOVAS_LIDAS = 50

/**
 * Chegou mensagem do cliente MAIS NOVA na mesma conexão que ABRE turno (E10)?
 * Só essa descarta: o turno dela é o substituto. ⚠️ A régua é `abreTurno`, a
 * MESMA do portão da entrada, sobre a linha GRAVADA — figurinha (`image` com
 * `image/webp`), localização, botão e texto sem nada visível não abrem turno,
 * e descartar por elas deixava o cliente sem resposta nenhuma (texto +
 * figurinha). Apagada também não conta: ela não abriu turno que sobreviva
 * (o turno dela descarta a si mesmo). Filtro de conteúdo em JS: "algo
 * visível" e o MIME da figurinha não cabem num filtro do PostgREST.
 */
async function haMensagemMaisNova(
  db: SupabaseClient,
  turno: LinhaDoTurno,
  gatilho: Gatilho,
): Promise<boolean> {
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
 * Alguém da EQUIPE respondeu depois da mensagem do cliente (D10)? O gatilho de
 * pausa da 1044 cobre o caso comum, mas não a corrida da ENTRADA: a resposta
 * do advogado que chega entre a leitura da D16 e a atribuição do agente é
 * gravada sem agente ativo na conversa (o gatilho não tem o que pausar), e a
 * mensagem do celular tem o relógio do aparelho — pode ser anterior ao
 * `ia_agente_desde`. Pela ordem de GRAVAÇÃO, a resposta de gente sempre vence
 * (Codex, #292). A resposta do próprio agente (`ia_agente_id`) não conta, nem
 * a APAGADA — o critério do Radar (`use-radar.ts`): o cliente não a vê.
 */
async function haRespostaDeGenteDepois(
  db: SupabaseClient,
  turno: LinhaDoTurno,
  gatilho: Gatilho,
): Promise<boolean> {
  if (!gatilho.gravada_em) return false
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', turno.conversation_id)
    .eq('sender_type', 'agent')
    .is('ia_agente_id', null)
    .is('deleted_at', null)
    .or('sender_id.not.is.null,from_device.is.true')
    .gt('gravada_em', gatilho.gravada_em)
    .limit(1)
  if (error) throw new Error(`leitura de resposta da equipe falhou: ${error.message}`)
  return (data?.length ?? 0) > 0
}

/**
 * O ROBÔ ou uma AUTOMAÇÃO mandou mensagem nesta conversa, POR ESTA CONEXÃO,
 * depois da mensagem-gatilho? Os dois gravam `sender_type = 'bot'`
 * (`engineSendText`, `engineSendMedia`, as interativas e o modelo de
 * `automations/meta-send.ts`) — e só a resposta do AGENTE leva
 * `ia_agente_id`, que não conta. ⚠️ Só a MESMA conexão do turno: o contexto
 * do agente é por conexão (D4), e uma automação que respondeu pela conexão B
 * não responde a quem escreveu pela A (Codex, #292). A mídia, as interativas
 * e o modelo carimbam o canal num UPDATE logo depois do INSERT — no instante
 * entre os dois a linha ainda não conta. Se sim, o
 * cliente já foi respondido e o turno sai: o caso é o toque em botão durante
 * a rajada — ele não abre turno (E9) nem descarta o do texto (E10), mas a
 * automação de `button_response` responde, e o turno do texto responderia de
 * novo 8 s depois (Codex, #292). A entrada cancela o PENDENTE
 * (`descartarPendente`); isto pega o que já estava rodando. ⚠️ O preço,
 * aceito: um aviso da régua ou um lembrete que sai no mesmo instante também
 * cala o agente nesta mensagem — duas respostas é o erro pior. Apagada não
 * conta.
 */
async function haSaidaDoRoboDepois(
  db: SupabaseClient,
  turno: LinhaDoTurno,
  gatilho: Gatilho,
): Promise<boolean> {
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

type Conferencia =
  | { ok: true; conversa: Conversa; agente: IaAgente }
  | { ok: false; desfecho: Desfecho }

/**
 * A conversa continua sendo deste agente, sem pausa, sem mensagem mais nova,
 * sem resposta de gente nem do robô/automação, e o agente continua ligado e
 * dono da conexão? Roda antes de gerar e de novo antes de enviar (o advogado
 * pode ter respondido pelo celular no meio).
 */
async function conferir(
  db: SupabaseClient,
  turno: LinhaDoTurno,
  gatilho: Gatilho,
): Promise<Conferencia> {
  const conversa = await lerConversa(db, turno)
  if (!conversa || conversa.group_id) return { ok: false, desfecho: { status: 'descartado', erro: 'conversa' } }
  if (conversa.status === 'closed') return { ok: false, desfecho: { status: 'descartado', erro: 'conversa encerrada' } }
  if (conversa.ai_autoreply_disabled) return { ok: false, desfecho: { status: 'pausado_no_meio' } }
  if (!turno.ia_agente_id || conversa.ia_agente_id !== turno.ia_agente_id) {
    return { ok: false, desfecho: { status: 'descartado', erro: 'o agente da conversa mudou' } }
  }
  const agente = await obterAgente(turno.account_id, turno.ia_agente_id)
  if (!agente || !agente.ativo || agente.arquivadoEm || !turno.canal_id || !agente.conexoes.includes(turno.canal_id)) {
    return { ok: false, desfecho: { status: 'descartado', erro: 'agente indisponível nesta conexão' } }
  }
  // O cliente pode ter APAGADO a mensagem durante a espera ou a geração: o
  // contexto não a mostra mais, e o modelo responderia a um pedido retirado
  // (Codex, #292). Relida a cada conferência — a leitura do começo é velha na
  // segunda.
  const { data: aindaLa, error: erroDoGatilho } = await db
    .from('messages')
    .select('deleted_at')
    .eq('id', gatilho.id)
    .maybeSingle()
  if (erroDoGatilho) throw new Error(`releitura da mensagem falhou: ${erroDoGatilho.message}`)
  if (!aindaLa || (aindaLa as { deleted_at: string | null }).deleted_at) {
    return { ok: false, desfecho: { status: 'descartado', erro: 'o cliente apagou a mensagem' } }
  }
  if (await haMensagemMaisNova(db, turno, gatilho)) {
    return { ok: false, desfecho: { status: 'descartado', erro: 'mensagem mais nova do cliente' } }
  }
  if (await haRespostaDeGenteDepois(db, turno, gatilho)) {
    // Pausa como o gatilho pausaria (a corrida o deixou de fora), cercada
    // pelo agente e só se ainda não houver pausa.
    await db
      .from('conversations')
      .update({ ai_autoreply_disabled: true, ia_pausada_por: 'gente', ia_pausada_em: new Date().toISOString() })
      .eq('id', turno.conversation_id)
      .eq('account_id', turno.account_id)
      .eq('ia_agente_id', agente.id)
      .eq('ai_autoreply_disabled', false)
    return { ok: false, desfecho: { status: 'pausado_no_meio', erro: 'a equipe respondeu' } }
  }
  if (await haSaidaDoRoboDepois(db, turno, gatilho)) {
    return { ok: false, desfecho: { status: 'descartado', erro: 'o robô ou uma automação respondeu' } }
  }
  return { ok: true, conversa, agente }
}

// ------------------------------------------------------------
// Áudio (E9)
// ------------------------------------------------------------

/**
 * Os áudios da RAJADA (da primeira à última mensagem do turno, nesta
 * conexão) precisam estar transcritos antes de gerar: o agente lê a
 * transcrição. `null` = pode seguir.
 */
async function prepararAudios(
  db: SupabaseClient,
  turno: LinhaDoTurno,
  gatilho: Gatilho,
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
    .order('gravada_em', { ascending: true })
    .limit(5)
  if (error) throw new Error(`leitura dos áudios falhou: ${error.message}`)

  for (const audio of data ?? []) {
    if (audio.transcricao_status === 'pronta' && audio.transcricao) continue
    const r = await transcreverAudio(db, { accountId: turno.account_id, messageId: audio.id as string })
    if (r.status === 'pronta') continue
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
// O envio
// ------------------------------------------------------------

/**
 * Nada saiu? Erro antes da primeira chamada ao provedor, ou a recusa
 * COMPROVADA dele (4xx). Tudo o mais pode ter saído.
 */
export function nadaSaiu(err: unknown, tentou: boolean): boolean {
  if (!tentou) return true
  if (err instanceof CanalExigidoIndisponivelError) return true
  if (err instanceof EvolutionApiError) return err.status >= 400 && err.status < 500
  if (err instanceof MetaApiError) return err.httpStatus >= 400 && err.httpStatus < 500
  return false
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
  conversa: Conversa | null
  usage: AiUsage | null
  /** A primeira chamada ao provedor de MENSAGEM aconteceu. */
  tentouEnviar: boolean
  enviadaId: string | null
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
    .select('id, message_id, gravada_em, deleted_at')
    .eq('id', turno.mensagem_gatilho_id)
    .maybeSingle()
  if (erroGatilho) throw new Error(`leitura da mensagem falhou: ${erroGatilho.message}`)
  if (!gatilhoLido || gatilhoLido.deleted_at) return { status: 'descartado', erro: 'a mensagem sumiu ou foi apagada' }
  const gatilho = gatilhoLido as Gatilho

  const primeira = await conferir(db, turno, gatilho)
  if (!primeira.ok) return primeira.desfecho
  const { agente } = primeira
  andamento.agente = agente
  andamento.conversa = primeira.conversa

  if (!dentroDoHorario(agente.horario, new Date())) return { status: 'fora_do_horario' }
  if (primeira.conversa.ai_reply_count >= agente.tetoRespostas) return { status: 'transferiu', motivo: 'teto' }

  // Teto por CONTA sobre a chave compartilhada: uma rajada de 200 clientes ao
  // mesmo tempo não pode estourar o limite do provedor. Passou → sem resposta
  // (a mensagem fica na caixa para gente; o alerta de atraso segue valendo).
  const limite = checkRateLimit(`ai-autoreply:${turno.account_id}`, RATE_LIMITS.aiAutoReplyAccount)
  if (!limite.success) return { status: 'sem_resposta', erro: 'limite de respostas por minuto da conta' }

  const audio = await prepararAudios(db, turno, gatilho)
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

  const restante = PRAZO_DO_TURNO_MS - (Date.now() - inicio) - RESERVA_DO_ENVIO_MS
  if (restante < 3_000) return { status: 'falhou', erro: 'o prazo do turno acabou antes de gerar' }

  // "Digitando…" só quando vai gerar (só conexão Meta; nunca segura nada).
  void mostrarDigitando(db, {
    accountId: turno.account_id,
    conversationId: turno.conversation_id,
    channelId: turno.canal_id,
    inboundMessageId: gatilho.message_id,
  })

  let texto: string
  let handoff: boolean
  try {
    const r = await generateReply({
      config: configDoAgente(agente, apiKey),
      systemPrompt: montarPedidoDoAgente({ instrucoes: agente.instrucoes, regras: agente.regras, agora: new Date() }),
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

  // De novo, com a resposta pronta: o advogado pode ter respondido, a
  // conversa pode ter sido pausada ou o agente desligado enquanto o modelo
  // pensava.
  const segunda = await conferir(db, turno, gatilho)
  if (!segunda.ok) return segunda.desfecho
  andamento.conversa = segunda.conversa

  // Dono e contato ANTES da vaga do teto: a vaga é consumida por UPDATE, e
  // gastá-la para terminar `falhou`/`descartado` sem nada ter saído encurtava
  // o teto da conversa à toa.
  const dono = await donoDaConta(db, turno.account_id)
  if (!dono) return { status: 'falhou', erro: 'a conta não tem dono' }
  const contactId = segunda.conversa.contact_id
  if (!contactId) return { status: 'descartado', erro: 'conversa sem contato' }

  // A posse, carimbando o começo do envio (o recolhedor distingue "morreu
  // antes de enviar" de "morreu no meio"). Perdida = outro processo recolheu.
  const tokens = andamento.usage
  const posse = await gravarNoTurno(db, turno, {
    enviando_desde: new Date().toISOString(),
    iteracoes: 1,
    tokens_entrada: tokens?.promptTokens ?? null,
    tokens_saida: tokens?.completionTokens ?? null,
    tokens_total: tokens?.totalTokens ?? null,
  })
  if (!posse) return { status: 'abandonado' }

  // A ÚLTIMA palavra, no banco: a vaga do teto só é consumida se a conversa
  // ainda está aberta, sem pausa e com este agente — na MESMA escrita, que a
  // pausa por gente disputa pela trava da linha. Conferir aqui em JS e só
  // depois consumir a vaga deixava a resposta do advogado gravada no meio
  // passar (Codex, #292). Duas mensagens concorrentes não passam do teto.
  const { data: reserva, error: erroReserva } = await db.rpc('cb_ia_reservar_envio', {
    p_account_id: turno.account_id,
    p_conversation_id: turno.conversation_id,
    p_ia_agente_id: agente.id,
    p_max: agente.tetoRespostas,
  })
  if (erroReserva) return { status: 'falhou', erro: `reservar a resposta falhou: ${erroReserva.message}` }
  if (reserva === 'pausada') return { status: 'pausado_no_meio', erro: 'pausada antes do envio' }
  if (reserva === 'mudou') return { status: 'descartado', erro: 'a conversa mudou antes do envio' }
  if (reserva !== 'ok') return { status: 'transferiu', motivo: 'teto' }

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
    return { status: 'respondeu', mensagemEnviadaId: r.whatsapp_message_id }
  } catch (err) {
    if (err instanceof EnviadaSemRegistroError) {
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
      .update({ status: 'aguardando', rodando_desde: null, executar_apos: executarApos, updated_at: new Date().toISOString() })
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
    contactId: andamento.conversa?.contact_id ?? null,
    iaAgenteId: andamento.agente.id,
    nomeDoAgente: andamento.agente.nome,
    transferirPara: andamento.agente.transferirPara,
    motivo,
  })
  // Alguém pausou antes (a equipe respondeu enquanto o modelo pensava, o
  // botão Pausar, outra transferência): o agente NÃO transferiu — o registro
  // diz o que houve. Cercado pela PRÓPRIA escrita de acima (o turno já não é
  // `rodando`, e ninguém mais escreve nele). O `incerto` fica: ele fala do
  // ENVIO (pode ter saído), não da transferência.
  if (transferencia === 'nada_mudou' && desfecho.status === 'transferiu') {
    const { error } = await db
      .from('cb_ia_turnos')
      .update({
        status: 'pausado_no_meio',
        erro: `não transferiu (${desfecho.motivo}): a conversa já estava pausada ou mudou de agente`,
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
 * mesma conversa (o de outra conexão, ou o que ficou esperando este acabar).
 */
export async function executarTurno(turnoId: string): Promise<void> {
  const db = supabaseAdmin()
  const turno = await reivindicar(db, turnoId)
  if (!turno) return

  const inicio = Date.now()
  const andamento: Andamento = { agente: null, conversa: null, usage: null, tentouEnviar: false, enviadaId: null }
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
