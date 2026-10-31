// ============================================================
// O envio do ROBÔ que não saiu vira bolha no fio (decisão do operador,
// 06/10/2026): "deve aparecer que teve a falha", na caixa de entrada e no
// filtro da conexão por onde o envio foi TENTADO — mesmo sem nenhuma
// mensagem, mesmo sem número na conversa.
//
// Quem chama são os remetentes do robô (os dois `meta-send.ts`), na falha do
// PROVEDOR — a tentativa de verdade. Recusa ANTES dela (contato sem telefone,
// modelo sem valor, Instagram) não chegou a nenhuma conexão: fica só no
// registro da execução, como sempre.
//
// ⚠️⚠️ A automação RETENTA (`retentativa.ts`: até 3 vezes, 30 s e 5 min). Uma
// bolha por tentativa poria três "Não enviada" para a mesma mensagem — e uma
// "Não enviada" seguida da mesma mensagem enviada. Por isso o motor passa
// `aoFalhar` e grava só quando DESISTE (`registrarEnvioQueFalhou` no `catch`
// do `executeStepsFrom`); o robô e o agente de IA, que não retentam, gravam
// na hora.
//
// A tentativa da EQUIPE também vira bolha, desde 31/10/2026 (decisão do
// operador: a falha de quem tentou aparece para todos, e sobrevive à recarga).
// Quem grava é a rota do compositor (`/api/whatsapp/send`, que serve a caixa
// de entrada e a ficha), nunca o núcleo: a agendada e a API v1 têm o próprio
// contrato de falha. O núcleo só entrega, no erro, o que ia gravar
// (`SendMessageError.tentativa`); a rota chama `registrarTentativaDaEquipe`.
// A linha é `agent` com o `sender_id` de quem tentou — e continua NÃO sendo
// fala: a pausa da IA, a retomada (1118) e todo leitor de "alguém respondeu?"
// a ignoram, como a do robô.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { semTokenDaMeta } from '@/lib/cb-channels/falha-da-meta'
import { gravarComCanal, preencherCanalDaConversa } from '@/lib/cb-channels/stamp'
import type { MotivoDoEnvio } from '@/lib/inbox/falha-do-envio'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { MetaApiError } from '@/lib/whatsapp/meta-api'
import { EvolutionApiError } from '@/lib/whatsapp/transport/evolution-client'

/** O que o remetente ia gravar se o envio tivesse saído. */
export interface RascunhoDoEnvio {
  accountId: string
  conversationId: string
  /** A conexão por onde o envio foi TENTADO. */
  canalId: string | null
  contentType: string
  /** O que o cliente leria (já assinado), como o envio gravaria em `content_text`. */
  texto: string | null
  /** O que o envio gravaria em `last_message_text`. */
  previa: string
  templateName?: string | null
  mediaUrl?: string | null
  mediaFilename?: string | null
  interactivePayload?: InteractiveMessagePayload | null
  aiGenerated?: boolean
  iaAgenteId?: string | null
  /** A citação, como o envio a gravaria. */
  replyToMessageId?: string | null
  /**
   * O LOGIN de quem tentou, na tentativa da equipe: a linha vira `agent` com
   * este `sender_id`. Sem ele, é o robô (`bot`).
   */
  autor?: string | null
}

/**
 * O que o núcleo de envio de GENTE ia gravar, entregue no erro quando o
 * PROVEDOR falha (`SendMessageError.tentativa`). Sem o autor: quem sabe quem
 * apertou "enviar" é a rota.
 */
export type TentativaDoNucleo = Omit<RascunhoDoEnvio, 'aiGenerated' | 'iaAgenteId' | 'autor'>

/** Quem decide QUANDO gravar (o motor de automações, por causa da retentativa). */
export type AoFalhar = (rascunho: RascunhoDoEnvio) => void

const TETO_DO_DETALHE = 300

/**
 * O motivo, pelo ERRO — a mesma régua de `recusaComprovada`: só 4xx afirma
 * "não saiu". Tempo esgotado, 5xx e erro de rede são `incerto`.
 */
export function classificarFalha(err: unknown): {
  motivo: MotivoDoEnvio
  codigo: number | null
  detalhe: string
} {
  const bruto = err instanceof Error ? err.message : String(err)
  // A mensagem da Meta ECOA o token (`falha-da-meta.ts`): sem o token em mãos,
  // ficam as duas redes por formato.
  const detalhe = semTokenDaMeta(bruto, '').slice(0, TETO_DO_DETALHE)
  if (err instanceof EvolutionApiError) {
    if (err.status < 400 || err.status >= 500) return { motivo: 'incerto', codigo: null, detalhe }
    if (err.semWhatsApp) return { motivo: 'sem_whatsapp', codigo: null, detalhe }
    // O soluço da conexão chega como 400 com este texto (`retentativa.ts`).
    if (/connection closed/i.test(bruto)) return { motivo: 'conexao_fora_do_ar', codigo: null, detalhe }
    return { motivo: 'recusado', codigo: null, detalhe }
  }
  if (err instanceof MetaApiError) {
    if (err.httpStatus >= 400 && err.httpStatus < 500) {
      return { motivo: 'recusado', codigo: err.code, detalhe }
    }
    return { motivo: 'incerto', codigo: err.code, detalhe }
  }
  return { motivo: 'incerto', codigo: null, detalhe }
}

/**
 * O motivo de uma falha do NÚCLEO de envio de gente (`SendMessageError`), para
 * a rota do compositor responder à bolha otimista (19/10/2026). Tipado pela
 * forma, não pela classe: o núcleo não é importado aqui.
 *
 * - Falha do PROVEDOR: a régua do robô (`classificarFalha`) sobre o erro cru
 *   que o núcleo carrega em `cause`. Sem ele, só o 4xx da Evolution afirma
 *   "não saiu"; o resto é `incerto`.
 * - `db_error`: o provedor ACEITOU e o CRM não gravou — saiu. `incerto`, nunca
 *   "barrado", e sem o texto cru do Postgres (nome de constraint não vai à tela).
 * - Qualquer outro código parou NO CRM, antes de chegar a uma conexão
 *   (validação, conversa, conexão sem configuração, modelo, grupo): `barrado`,
 *   com a frase do próprio núcleo.
 */
export function motivoDaFalhaDoNucleo(err: {
  code: string
  message: string
  cause?: unknown
}): { motivo: MotivoDoEnvio; detalhe: string | null } {
  switch (err.code) {
    case 'evolution_rejected':
    case 'evolution_error':
    case 'meta_error': {
      if (err.cause !== undefined) {
        const { motivo, detalhe } = classificarFalha(err.cause)
        return { motivo, detalhe: detalhe || null }
      }
      return { motivo: err.code === 'evolution_rejected' ? 'recusado' : 'incerto', detalhe: null }
    }
    case 'db_error':
      return { motivo: 'incerto', detalhe: null }
    default:
      return { motivo: 'barrado', detalhe: err.message.slice(0, TETO_DO_DETALHE) || null }
  }
}

/**
 * A linha "não enviada" em `messages` (com o número da tentativa, pelo
 * `gravarComCanal`). Devolve o id, ou `null` quando não gravou. Nunca lança.
 */
async function gravarTentativa(
  db: SupabaseClient,
  rascunho: RascunhoDoEnvio,
  err: unknown,
): Promise<string | null> {
  const { motivo, codigo, detalhe } = classificarFalha(err)
  try {
    const { resultado } = await gravarComCanal(rascunho.canalId, (canal) =>
      db
        .from('messages')
        .insert({
          conversation_id: rascunho.conversationId,
          // A da equipe leva QUEM tentou (a bolha mostra o nome; o "Tentar de
          // novo" é só dele). `agent` + `sender_id` é a forma de "resposta de
          // gente" — por isso o `nao_saiu` abaixo é o que a tira de todo
          // leitor de "alguém respondeu?".
          ...(rascunho.autor
            ? { sender_type: 'agent', sender_id: rascunho.autor }
            : { sender_type: 'bot' }),
          content_type: rascunho.contentType,
          content_text: rascunho.texto,
          ...(rascunho.templateName ? { template_name: rascunho.templateName } : {}),
          ...(rascunho.mediaUrl ? { media_url: rascunho.mediaUrl } : {}),
          ...(rascunho.mediaFilename ? { media_filename: rascunho.mediaFilename } : {}),
          ...(rascunho.interactivePayload ? { interactive_payload: rascunho.interactivePayload } : {}),
          ...(rascunho.aiGenerated ? { ai_generated: true } : {}),
          ...(rascunho.iaAgenteId ? { ia_agente_id: rascunho.iaAgenteId } : {}),
          ...(rascunho.replyToMessageId ? { reply_to_message_id: rascunho.replyToMessageId } : {}),
          // Nada saiu: sem `message_id` e com a marca da 1080, que todo leitor
          // de "alguém falou?" respeita (o "em atraso", a reserva do agente, o
          // "Aguardar sem conversa", o Radar, o painel).
          status: 'failed',
          nao_saiu: true,
          error_title: motivo,
          error_code: codigo,
          error_details: detalhe,
          channel_id: canal,
        })
        .select('id')
        .single(),
    )
    if (resultado.error) {
      console.error('[envio-que-falhou] gravar a bolha falhou:', resultado.error.code, resultado.error.message)
      return null
    }
    return (resultado.data as { id: string } | null)?.id ?? null
  } catch (e) {
    console.error('[envio-que-falhou] gravar a bolha falhou:', e instanceof Error ? e.message : e)
    return null
  }
}

/** A prévia da lista: a conversa sobe como com qualquer mensagem. Nunca lança. */
async function atualizarPrevia(db: SupabaseClient, rascunho: RascunhoDoEnvio): Promise<void> {
  try {
    const agora = new Date().toISOString()
    const { error } = await db
      .from('conversations')
      .update({ last_message_text: rascunho.previa, last_message_at: agora, updated_at: agora })
      .eq('id', rascunho.conversationId)
      .eq('account_id', rascunho.accountId)
    if (error) console.error('[envio-que-falhou] atualizar a prévia falhou:', error.message)
  } catch (e) {
    console.error('[envio-que-falhou] atualizar a conversa falhou:', e instanceof Error ? e.message : e)
  }
}

/**
 * Grava a tentativa do ROBÔ como bolha "não enviada": a linha, o número da
 * conversa SEM número e a prévia. Nunca lança: quem chama propaga o erro do
 * PROVEDOR, cru (a retentativa decide por ele), e uma falha aqui não pode
 * tomar o lugar dele.
 */
export async function registrarEnvioQueFalhou(
  db: SupabaseClient,
  rascunho: RascunhoDoEnvio,
  err: unknown,
): Promise<void> {
  if (!(await gravarTentativa(db, rascunho, err))) return
  try {
    await preencherCanalDaConversa(db, rascunho.accountId, rascunho.conversationId, rascunho.canalId)
  } catch (e) {
    console.error('[envio-que-falhou] preencher o número falhou:', e instanceof Error ? e.message : e)
  }
  await atualizarPrevia(db, rascunho)
}

/**
 * Grava a tentativa da EQUIPE (31/10/2026), na rota do compositor: a linha
 * `agent` de quem tentou e a prévia. Devolve o id da linha — a rota o manda à
 * tela, que troca a bolha otimista por ela — ou `null` (não gravou: a bolha
 * fica só na tela de quem tentou, como antes). Nunca lança.
 *
 * - O número da conversa SEM número o núcleo já preencheu antes de chamar o
 *   provedor, e só fora de GRUPO (`conversations.channel_id` é nulo em grupo):
 *   preencher aqui de novo o poria no grupo.
 * - ⚠️ SEM o arquivo: o anexo que não saiu volta à prévia do compositor, que
 *   continua dono do objeto e o apaga no descarte. Apontar para ele deixaria
 *   a bolha gravada "indisponível" depois; ela mostra o nome e o tipo.
 */
export async function registrarTentativaDaEquipe(
  db: SupabaseClient,
  tentativa: TentativaDoNucleo,
  autor: string,
  err: unknown,
): Promise<string | null> {
  const rascunho: RascunhoDoEnvio = { ...tentativa, mediaUrl: null, autor }
  const id = await gravarTentativa(db, rascunho, err)
  if (id) await atualizarPrevia(db, rascunho)
  return id
}

/**
 * O remetente chama isto quando o PROVEDOR falha: com `aoFalhar` (o motor),
 * entrega o rascunho e deixa a decisão para quem sabe se vai tentar de novo;
 * sem, grava agora. Nunca lança.
 */
export async function falhouAoEnviar(
  db: SupabaseClient,
  rascunho: RascunhoDoEnvio,
  err: unknown,
  aoFalhar?: AoFalhar,
): Promise<void> {
  if (aoFalhar) {
    try {
      aoFalhar(rascunho)
    } catch (e) {
      console.error('[envio-que-falhou] aoFalhar lançou:', e instanceof Error ? e.message : e)
    }
    return
  }
  await registrarEnvioQueFalhou(db, rascunho, err)
}
