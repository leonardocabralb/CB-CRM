// ============================================================
// O ECO da resposta do agente de IA na ingestão da Evolution
// (docs/PLANO-agentes-de-ia.md, 5.4 e E5).
//
// Tudo que sai desta conta de WhatsApp volta pelo webhook com `fromMe`, e a
// rota separa "o CRM enviou" (a linha já existe — `jaGravada`) de "digitado no
// celular pareado" (não existe — `persistDeviceMessage`). A resposta do agente
// cai no vão entre os dois: o turno grava o id do provedor em
// `cb_ia_turnos.mensagem_enviada_id` ANTES do INSERT da mensagem (`aoSair`, em
// `engineSendText`), e se o INSERT atrasar mais que a espera de 2 s do
// `jaGravada` — ou nunca acontecer (o processo morreu entre os dois) —, o eco
// virava mensagem do CELULAR: `sender_type = 'agent'` com `from_device`, e a
// conversa passava a "ter tido gente" (D16) para sempre.
//
// Aqui o eco é reconhecido pelo id e gravado COMO A RESPOSTA DO AGENTE — a
// mesma linha que o envio gravaria. ⚠️ Reconhecer NÃO é descartar (Codex,
// #292): sem a linha, a bolha se perderia e o alerta de atraso ficaria aceso
// sobre cliente respondido.
//
// ⚠️⚠️ É o INSERT do envio feito por outra mão: faz o que o envio faz, e NADA
// do que a ingestão faz. Nenhum motor (robô, automações, IA), nada de funil,
// reabertura, `cancelarEsperasPorResposta`, `followConversationChannel` nem
// `registrarEntrega` — o envio do robô também não faz nenhum deles. Pino
// lendo este fonte em `eco.test.ts` (importações em lista fechada).
//
// ⚠️ A invariante da rota: se algo aqui falhar, vale o caminho de SEMPRE (a
// mensagem do celular). A pausa não acontece nem assim — o gatilho da 1044
// ignora a mensagem cujo id é o de um turno (a defesa dobrada do E5); sobra só
// a D16 contaminada, que é o que valia antes desta peça.
//
// Limite conhecido: a RELIGAÇÃO das retidas sem telefone (`religar.ts`)
// pergunta "já gravada?" sem esperar e sem o item, então não passa por aqui.
// Uma resposta do agente só chega lá se o eco ficou RETIDO, o que exige três
// coisas juntas: o eco em `@lid` sem telefone, NÃO reconhecido na chegada (o
// turno ainda sem o id depois dos 2 s, ou uma leitura que falhou), e o INSERT
// do envio que nunca aconteceu. Nesse caso ela entra como mensagem do celular
// — sem pausar o agente, pela mesma defesa.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { gravarComCanal } from '@/lib/cb-channels/stamp'
import {
  detectContentType,
  extractText,
  lidJidFromKey,
  phoneJidFromKey,
  type EvolutionUpsert,
} from '@/lib/whatsapp/transport/evolution-inbound'

/** O que a rota sabe do eco quando pergunta: a conta da instância e o item cru. */
export interface EcoPossivel {
  accountId: string
  item: EvolutionUpsert
}

interface TurnoDoEco {
  account_id: string
  conversation_id: string
  canal_id: string | null
  ia_agente_id: string | null
}

/**
 * O turno cuja resposta tem este id do provedor, NESTA conta. `null` = não é,
 * ou a leitura falhou (o caminho de sempre). Nunca lança.
 */
async function turnoDaResposta(
  db: SupabaseClient,
  accountId: string,
  providerMessageId: string,
): Promise<TurnoDoEco | null> {
  try {
    const { data, error } = await db
      .from('cb_ia_turnos')
      .select('account_id, conversation_id, canal_id, ia_agente_id')
      .eq('mensagem_enviada_id', providerMessageId)
      .eq('account_id', accountId)
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('[ia-agentes/eco] ler o turno do eco falhou:', error.message)
      return null
    }
    const turno = (data as TurnoDoEco | null) ?? null
    // ⚠️ A conta conferida TAMBÉM aqui. O recorte de verdade é o `.eq` acima,
    // mas é daqui que sai a conversa onde a mensagem vai ser gravada: um id
    // que colida com o turno de outra conta não pode escrever no fio dela.
    return turno && turno.account_id === accountId ? turno : null
  } catch (err) {
    console.error('[ia-agentes/eco] ler o turno do eco falhou:', err instanceof Error ? err.message : err)
    return null
  }
}

/** O carimbo do WhatsApp, como a ingestão grava (`created_at`); `null` = o do banco. */
function carimboDoItem(item: EvolutionUpsert): string | null {
  const bruto = item.messageTimestamp
  const seg = typeof bruto === 'number' ? bruto : typeof bruto === 'string' ? parseInt(bruto, 10) : NaN
  return Number.isFinite(seg) && seg > 0 ? new Date(seg * 1000).toISOString() : null
}

/**
 * Chamada pela rota DEPOIS da espera do `jaGravada`, com a linha ainda
 * ausente: o id é a resposta de um turno DESTA conta? Se for, grava o eco como
 * a resposta do agente, na conversa do TURNO, e atualiza a prévia como o envio
 * faria.
 *
 * `true` = a resposta está no fio (gravada agora, ou o INSERT do envio chegou
 * no meio — o 23505): quem chama NÃO grava de novo. `false` = não é de turno,
 * ou algo falhou — o caminho de sempre. Nunca lança.
 */
export async function assumirEcoDoTurno(
  db: SupabaseClient,
  args: EcoPossivel & { providerMessageId: string },
): Promise<boolean> {
  const turno = await turnoDaResposta(db, args.accountId, args.providerMessageId)
  if (!turno) return false

  const { item } = args
  const texto = extractText(item.message)
  const tipo = detectContentType(item.message)
  const carimbo = carimboDoItem(item)

  try {
    // O canal do TURNO, que é o que o envio grava (`exigirCanal`: saiu por
    // ele). É o mesmo da instância que devolveu o eco.
    const { resultado } = await gravarComCanal(turno.canal_id, (canal) =>
      db
        .from('messages')
        .insert({
          conversation_id: turno.conversation_id,
          sender_type: 'bot',
          content_type: tipo,
          // O texto que o cliente recebeu (já assinado): é o que o eco traz.
          content_text: texto,
          message_id: args.providerMessageId,
          remote_jid: phoneJidFromKey(item.key),
          // O endereço para revogar/editar em conversa migrada para LID (917),
          // como a ingestão grava.
          remote_jid_lid: lidJidFromKey(item.key),
          from_me: true,
          status: 'sent',
          ai_generated: true,
          channel_id: canal,
          ia_agente_id: turno.ia_agente_id,
          // O carimbo do WhatsApp (o envio foi há segundos): a mensagem do
          // cliente que chegou no vão fica DEPOIS dela no fio, como foi.
          ...(carimbo ? { created_at: carimbo } : {}),
        })
        .select('id')
        .single(),
    )
    if (resultado.error) {
      // 23505 = o INSERT do envio chegou entre a espera e aqui: a linha é a
      // dele, e a prévia também (`engineSendText` a atualiza).
      if (resultado.error.code === '23505') return true
      // Só código e mensagem: o `details` do PostgREST traz a linha recusada.
      console.error('[ia-agentes/eco] gravar o eco como resposta do agente falhou:', resultado.error.code, resultado.error.message)
      return false
    }
  } catch (err) {
    console.error('[ia-agentes/eco] gravar o eco falhou:', err instanceof Error ? err.message : err)
    return false
  }

  console.info(
    '[ia-agentes/eco] a resposta do agente chegou pelo eco antes do registro do envio; gravada como do agente.',
    JSON.stringify({ messageId: args.providerMessageId, conversationId: turno.conversation_id }),
  )

  // A prévia, como o envio faria. Melhor esforço: a mensagem já está no fio.
  try {
    const agora = new Date().toISOString()
    const { error } = await db
      .from('conversations')
      .update({ last_message_text: texto || `[${tipo}]`, last_message_at: agora, updated_at: agora })
      .eq('id', turno.conversation_id)
      .eq('account_id', args.accountId)
    if (error) console.error('[ia-agentes/eco] atualizar a prévia falhou:', error.message)
  } catch (err) {
    console.error('[ia-agentes/eco] atualizar a prévia falhou:', err instanceof Error ? err.message : err)
  }
  return true
}
