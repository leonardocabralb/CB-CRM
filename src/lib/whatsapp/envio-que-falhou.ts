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
// O núcleo de envio de GENTE (`send-message.ts`) fica de fora: quem envia está
// na tela e vê a bolha otimista falhar.
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
}

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
 * Grava a tentativa como bolha "não enviada": a linha em `messages` (com o
 * número da tentativa, pelo `gravarComCanal`), o número da conversa SEM número
 * e a prévia — a conversa sobe na lista como com qualquer mensagem. Nunca
 * lança: quem chama propaga o erro do PROVEDOR, cru (a retentativa decide por
 * ele), e uma falha aqui não pode tomar o lugar dele.
 */
export async function registrarEnvioQueFalhou(
  db: SupabaseClient,
  rascunho: RascunhoDoEnvio,
  err: unknown,
): Promise<void> {
  const { motivo, codigo, detalhe } = classificarFalha(err)
  try {
    const { resultado } = await gravarComCanal(rascunho.canalId, (canal) =>
      db
        .from('messages')
        .insert({
          conversation_id: rascunho.conversationId,
          sender_type: 'bot',
          content_type: rascunho.contentType,
          content_text: rascunho.texto,
          ...(rascunho.templateName ? { template_name: rascunho.templateName } : {}),
          ...(rascunho.mediaUrl ? { media_url: rascunho.mediaUrl } : {}),
          ...(rascunho.mediaFilename ? { media_filename: rascunho.mediaFilename } : {}),
          ...(rascunho.interactivePayload ? { interactive_payload: rascunho.interactivePayload } : {}),
          ...(rascunho.aiGenerated ? { ai_generated: true } : {}),
          ...(rascunho.iaAgenteId ? { ia_agente_id: rascunho.iaAgenteId } : {}),
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
      return
    }
  } catch (e) {
    console.error('[envio-que-falhou] gravar a bolha falhou:', e instanceof Error ? e.message : e)
    return
  }

  try {
    await preencherCanalDaConversa(db, rascunho.accountId, rascunho.conversationId, rascunho.canalId)
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
