// ============================================================
// A REDE dos turnos do agente de IA, no laço rápido do agendador
// (`/api/automations/cron`, docs/PLANO-agentes-de-ia.md 5.7).
//
// Duas tarefas:
//  1. RECOLHER o `rodando` órfão (processo morto no deploy). ⚠️⚠️ O
//     recolhedor NÃO re-executa: o turno pode já ter mandado a resposta, e
//     re-executar a mandaria duas vezes. Decide pelo que o turno carimbou:
//       - sem `enviando_desde` → morreu antes de enviar → `falhou`;
//       - `enviando_desde` sem `mensagem_enviada_id` → pode ter saído →
//         `incerto`, e a conversa vai para gente;
//       - com `mensagem_enviada_id` → saiu → `respondeu`, com o erro.
//     ⚠️ O turno lento ainda pode gravar `mensagem_enviada_id` DEPOIS desta
//     leitura (`gravarIdEnviado`, a única escrita dele sem cerca de posse —
//     o eco precisa do id). Isso não muda o desfecho gravado aqui (o id não
//     reescreve `status`) nem reenvia nada: o recolhedor nunca re-executa, e
//     o turno que perdeu a posse não escreve mais o status.
//  2. RODAR os pendentes vencidos que o disparo imediato não rodou (a
//     conversa estava ocupada, ou o processo caiu na espera da rajada).
//
// Nunca lança: roda em `after()` no topo da rota do cron.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from '@/lib/ai/admin-client'

import { RECOLHER_TURNO_MS, TURNOS_POR_TIQUE } from './fila'
import { obterAgente } from './repo'
import { executarTurno, transferirParaGente } from './turno'

interface Orfao {
  id: string
  account_id: string
  conversation_id: string
  ia_agente_id: string | null
  rodando_desde: string
  enviando_desde: string | null
  mensagem_enviada_id: string | null
}

async function recolherOrfaos(db: SupabaseClient): Promise<void> {
  const corte = new Date(Date.now() - RECOLHER_TURNO_MS).toISOString()
  const { data, error } = await db
    .from('cb_ia_turnos')
    .select('id, account_id, conversation_id, ia_agente_id, rodando_desde, enviando_desde, mensagem_enviada_id')
    .eq('status', 'rodando')
    .lt('rodando_desde', corte)
    .order('rodando_desde', { ascending: true })
    .limit(20)
  if (error) {
    console.error('[ia-agentes] ler os turnos órfãos falhou:', error.message)
    return
  }

  for (const o of (data ?? []) as Orfao[]) {
    const status = o.mensagem_enviada_id ? 'respondeu' : o.enviando_desde ? 'incerto' : 'falhou'
    const erro =
      status === 'respondeu'
        ? 'recolhido depois de enviar (o processo parou antes de registrar)'
        : status === 'incerto'
          ? 'recolhido no meio do envio: não dá para saber se saiu'
          : 'recolhido: o processo parou antes de enviar'
    // Cerca de posse: o MESMO `rodando_desde` que foi lido.
    const { data: tomado, error: erroTomar } = await db
      .from('cb_ia_turnos')
      .update({ status, erro, terminado_em: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', o.id)
      .eq('status', 'rodando')
      .eq('rodando_desde', o.rodando_desde)
      .select('id')
    if (erroTomar) {
      console.error('[ia-agentes] recolher o turno falhou:', o.id, erroTomar.message)
      continue
    }
    if (!tomado || tomado.length === 0) continue
    console.warn('[ia-agentes] turno órfão recolhido:', o.id, status)

    // `incerto` vai para gente — menos quando alguém já pausou a conversa
    // (a equipe respondeu, o botão Pausar): `transferirParaGente` não passa
    // por cima da pausa (a de gente é a que a automação retoma) e não
    // escreve nada. O `incerto` fica: ele fala do ENVIO, não da transferência.
    if (status === 'incerto' && o.ia_agente_id) {
      const agente = await obterAgente(o.account_id, o.ia_agente_id).catch(() => null)
      const { data: conv } = await db
        .from('conversations')
        .select('contact_id')
        .eq('id', o.conversation_id)
        .eq('account_id', o.account_id)
        .maybeSingle()
      await transferirParaGente(db, {
        accountId: o.account_id,
        conversationId: o.conversation_id,
        contactId: (conv as { contact_id?: string | null } | null)?.contact_id ?? null,
        iaAgenteId: o.ia_agente_id,
        nomeDoAgente: agente?.nome ?? 'IA',
        transferirPara: agente?.transferirPara ?? null,
        motivo: 'incerto',
      })
    }
  }
}

export async function rodarRedeDosTurnos(): Promise<void> {
  try {
    const db = supabaseAdmin()
    await recolherOrfaos(db)
    const { data, error } = await db
      .from('cb_ia_turnos')
      .select('id')
      .eq('status', 'aguardando')
      .lte('executar_apos', new Date().toISOString())
      .order('executar_apos', { ascending: true })
      .limit(TURNOS_POR_TIQUE)
    if (error) {
      console.error('[ia-agentes] ler os turnos vencidos falhou:', error.message)
      return
    }
    // Em paralelo: são conversas diferentes quase sempre, e dois da mesma
    // conversa se resolvem na reivindicação (o segundo acha a conversa ocupada).
    await Promise.all((data ?? []).map((t) => executarTurno(t.id as string)))
  } catch (err) {
    console.error('[ia-agentes] a rede dos turnos falhou:', err)
  }
}
