import type { Automation, DateFieldTriggerConfig } from '@/types'
import { supabaseAdmin } from './admin-client'
import { runAutomationsForTrigger } from './engine'
import { janelaDeBusca, motivoDeConfigInvalida } from './lembretes'

// ------------------------------------------------------------
// Varredura do gatilho de lembrete por data (migration 935).
//
// Roda a cada ciclo do cron. Para cada automação ativa deste tipo, pergunta ao
// banco quem tem o campo de data caindo na janela e dispara — uma vez só por
// (automação, contato, valor).
//
// ⚠️ ISTO NÃO PASSA PELA FILA `cb_automation_events`. Aquela existe porque o
// gatilho de funil nasce de uma ESCRITA feita no navegador, sem ponto único no
// servidor. Aqui não há escrita nenhuma: o disparo nasce da passagem do tempo,
// e o cron já é o lugar onde o tempo passa. Enfileirar seria dar uma volta
// para chegar no mesmo ponto.
// ------------------------------------------------------------

export interface ResultadoDaVarredura {
  /** Automações de lembrete examinadas neste ciclo. */
  examinadas: number
  /** Disparos feitos (uma por contato). */
  disparados: number
  /** Já disparados antes para o mesmo (automação, contato, valor). */
  repetidos: number
  falhas: number
}

/** Nunca lança: o cron não pode cair por causa de uma automação torta. */
export async function varrerLembretes(): Promise<ResultadoDaVarredura> {
  const saida: ResultadoDaVarredura = {
    examinadas: 0,
    disparados: 0,
    repetidos: 0,
    falhas: 0,
  }
  try {
    const db = supabaseAdmin()

    const { data: automacoes, error } = await db
      .from('automations')
      .select('*')
      .eq('trigger_type', 'date_field_offset')
      .eq('is_active', true)

    if (error) {
      console.error('[automations] varredura de lembretes: leitura falhou', error)
      return saida
    }
    if (!automacoes || automacoes.length === 0) return saida

    const agora = Date.now()

    for (const bruta of automacoes as Automation[]) {
      saida.examinadas += 1
      const cfg = bruta.trigger_config as DateFieldTriggerConfig

      const invalida = motivoDeConfigInvalida(cfg)
      if (invalida) {
        // Não é falha de execução: é regra mal montada. A ativação já recusa
        // isto, então só chega aqui automação gravada antes da validação.
        console.warn('[automations] lembrete ignorado:', bruta.id, invalida)
        continue
      }

      const { de, ate } = janelaDeBusca(cfg, agora)

      const { data: alvos, error: erroAlvos } = await db.rpc('cb_alvos_de_lembrete', {
        p_account_id: bruta.account_id,
        p_custom_field_id: cfg.custom_field_id,
        p_de: de,
        p_ate: ate,
      })

      if (erroAlvos) {
        console.error('[automations] varredura: busca de alvos falhou', bruta.id, erroAlvos)
        saida.falhas += 1
        continue
      }

      for (const alvo of (alvos ?? []) as { contact_id: string; valor: string }[]) {
        // ⚠️ A TRAVA VEM ANTES DO DISPARO, e o INSERT é a própria
        // reivindicação. Ler-depois-escrever abriria janela para dois ciclos
        // sobrepostos mandarem o mesmo lembrete duas vezes ao cliente.
        const { error: erroTrava } = await db.from('cb_automation_reminders').insert({
          account_id: bruta.account_id,
          automation_id: bruta.id,
          contact_id: alvo.contact_id,
          valor: alvo.valor,
        })

        if (erroTrava) {
          // 23505 = já disparou para este (automação, contato, valor).
          // É o caso NORMAL de todo ciclo depois do primeiro.
          if (erroTrava.code === '23505') {
            saida.repetidos += 1
            continue
          }
          console.error('[automations] varredura: trava falhou', bruta.id, erroTrava)
          saida.falhas += 1
          continue
        }

        await runAutomationsForTrigger({
          accountId: bruta.account_id,
          triggerType: 'date_field_offset',
          contactId: alvo.contact_id,
          // Sem canal: o lembrete nasce do relógio, não de uma mensagem. O
          // escopo de canal deixa passar (falha aberta, como todo disparo sem
          // canal) e o envio cai no canal da conversa do contato — que é o
          // número por onde ele fala, e é o certo aqui.
          context: { vars: { _lembrete_valor: alvo.valor } },
        })
        saida.disparados += 1
      }
    }
  } catch (err) {
    console.error('[automations] varredura de lembretes falhou', err)
  }
  return saida
}

/**
 * Poda travas antigas. 90 dias: tempo de sobra para investigar "por que este
 * cliente não recebeu?", e curto o bastante para a tabela não virar arquivo.
 *
 * ⚠️ Podar cedo demais FAZ O LEMBRETE REPETIR: sem a trava, um valor de data
 * ainda dentro da janela dispararia de novo.
 */
export async function podarLembretesAntigos(): Promise<number> {
  try {
    const corte = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const { data, error } = await supabaseAdmin()
      .from('cb_automation_reminders')
      .delete()
      .lt('disparado_em', corte)
      .select('id')
    if (error) {
      console.error('[automations] poda de lembretes falhou', error)
      return 0
    }
    return data?.length ?? 0
  } catch {
    return 0
  }
}
