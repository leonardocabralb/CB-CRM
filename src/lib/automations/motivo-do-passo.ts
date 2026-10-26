// ============================================================
// O motivo que o passo "Mover card de etapa" grava (Fase 3 do
// docs/PLANO-motivos-de-perda.md).
//
// Decisão do operador (26/10/2026): a automação que leva o card a uma etapa
// que pede motivo (`pipeline_stages.campo_do_motivo_id`, 1112) grava o
// motivo NO PRÓPRIO PASSO — automação não abre janela, não há quem
// responda. O motivo é um texto LITERAL escolhido no construtor entre as
// opções do campo (`step_config.motivo`).
//
// ⚠️ Grava DEPOIS de o card se mover: o movimento recusado (o card mudou de
// status no meio) não deixa motivo solto na ficha. E a falha ao gravar NÃO
// falha o passo: o card já se moveu, e parar a execução calaria as
// mensagens seguintes ao cliente por causa de um dado de relatório. A nota
// vai para o registro ("motivo não gravado (…)"), e o relatório mostra o
// card em "Sem motivo — automação".
//
// ⚠️ A etapa é lida PELA CONTA (service role ignora a RLS); o campo é da
// mesma conta do funil pelo gatilho da 1112.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** O motivo configurado no passo, aparado; `null` = o passo não grava motivo. */
export function motivoDoPasso(cfg: { motivo?: unknown }): string | null {
  return typeof cfg.motivo === 'string' && cfg.motivo.trim() !== '' ? cfg.motivo.trim() : null;
}

/** O sufixo do registro do passo (vazio quando o passo não tem motivo). */
export function notaDoMotivo(
  resultado:
    | { tipo: 'sem_motivo' }
    | { tipo: 'gravado'; motivo: string }
    | { tipo: 'nao_gravado'; causa: string },
): string {
  if (resultado.tipo === 'sem_motivo') return '';
  if (resultado.tipo === 'gravado') return ` — motivo: ${resultado.motivo}`;
  return ` — motivo não gravado (${resultado.causa})`;
}

/**
 * Grava o motivo do passo no campo da etapa de destino e devolve a nota do
 * registro. Nunca lança.
 */
export async function gravarMotivoDoPasso(
  db: SupabaseClient,
  entrada: { accountId: string; contactId: string | null; stageId: string; motivo: string | null },
): Promise<string> {
  const { accountId, contactId, stageId, motivo } = entrada;
  if (!motivo) return notaDoMotivo({ tipo: 'sem_motivo' });
  if (!contactId) return notaDoMotivo({ tipo: 'nao_gravado', causa: 'sem contato' });

  const { data: etapa, error: erroDaEtapa } = await db
    .from('pipeline_stages')
    .select('campo_do_motivo_id, pipelines!inner(account_id)')
    .eq('id', stageId)
    .eq('pipelines.account_id', accountId)
    .maybeSingle();
  if (erroDaEtapa) {
    return notaDoMotivo({ tipo: 'nao_gravado', causa: 'etapa não conferida' });
  }
  const campoId = (etapa as { campo_do_motivo_id: string | null } | null)?.campo_do_motivo_id ?? null;
  if (!campoId) {
    return notaDoMotivo({ tipo: 'nao_gravado', causa: 'a etapa não pede motivo' });
  }

  const { error } = await db
    .from('contact_custom_values')
    .upsert(
      { contact_id: contactId, custom_field_id: campoId, value: motivo },
      { onConflict: 'contact_id,custom_field_id' },
    );
  if (error) {
    return notaDoMotivo({ tipo: 'nao_gravado', causa: `falha ao gravar: ${error.message}` });
  }
  return notaDoMotivo({ tipo: 'gravado', motivo });
}
