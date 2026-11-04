// ============================================================
// Histórico de automações de um cliente na API pública (1120) — o formato.
//
// Uma linha de `automation_logs` = uma EXECUÇÃO de automação para o cliente.
// Montado por allowlist de campos (como `serializeMessage`): a linha tem
// colunas internas (`user_id`, `account_id`) que não saem.
//
// ⚠️ `status` da tabela NÃO sai: ele nasce 'failed' no INSERT e termina
// 'success' quando uma condição desvia para ramo vazio — não responde "como
// terminou?" (`.claude/rules/automacoes.md`, "Desfecho da execução"). Quem
// responde é `desfecho` (985) e a marca de interrupção (1005), juntados em
// `outcome` pela régua da aba "Já rodou": o desfecho VENCE a marca (a
// interrompida que já tinha falhado num ramo é falha).
// ⚠️ `outcome` nulo = ainda rodando ou esperando um "Aguardar" — OU uma
// execução anterior à 985, que nunca ganhou desfecho. A doc diz os dois.
// ⚠️ `steps` vai na ordem GRAVADA, que não é a ordem em que rodou quando
// há ramo de condição cheio (o ramo grava antes do passo de fora). A doc
// diz isso.
// ============================================================

import type { AutomationLogStepResult } from '@/types';

export type ApiAutomationRunOutcome = 'completed' | 'blocked' | 'failed' | 'interrupted';

export interface ApiAutomationRunStep {
  step_id: string;
  step_type: string;
  status: 'success' | 'skipped' | 'failed';
  /** Texto do motor (em inglês, como gravado); nulo quando o passo não deixou. */
  detail: string | null;
}

export interface ApiAutomationRun {
  id: string;
  automation_id: string;
  /** Nome da automação hoje; nulo se a leitura do nome não veio. */
  automation_name: string | null;
  /** O que disparou: `deal_stage_changed`, `message_received`, `manual`… */
  trigger_event: string;
  outcome: ApiAutomationRunOutcome | null;
  /**
   * Por que foi interrompida (1005/1097): `resposta` (o cliente respondeu),
   * `etapa` (o card saiu da etapa), `parar` (botão Parar), `passo` (passo
   * "Parar automação"), `desativacao`, `fusao` (fichas unidas), `lixeira`.
   */
  interrupted_by: string | null;
  interrupted_at: string | null;
  error_message: string | null;
  steps: ApiAutomationRunStep[];
  started_at: string;
  finished_at: string | null;
}

const DESFECHOS: Record<string, ApiAutomationRunOutcome> = {
  concluida: 'completed',
  barrada: 'blocked',
  falhou: 'failed',
};

function lerPassos(valor: unknown): ApiAutomationRunStep[] {
  if (!Array.isArray(valor)) return [];
  const out: ApiAutomationRunStep[] = [];
  for (const item of valor as Partial<AutomationLogStepResult>[]) {
    if (!item || typeof item !== 'object') continue;
    const status = item.status;
    if (status !== 'success' && status !== 'skipped' && status !== 'failed') continue;
    out.push({
      step_id: typeof item.step_id === 'string' ? item.step_id : '',
      step_type: typeof item.step_type === 'string' ? item.step_type : '',
      status,
      detail: typeof item.detail === 'string' && item.detail ? item.detail : null,
    });
  }
  return out;
}

export function serializeAutomationRun(row: Record<string, unknown>): ApiAutomationRun {
  const desfecho = typeof row.desfecho === 'string' ? DESFECHOS[row.desfecho] : undefined;
  const interrompidaEm = (row.interrompida_em as string | null) ?? null;
  const automacao = row.automations as { name?: unknown } | null | undefined;
  return {
    id: row.id as string,
    automation_id: row.automation_id as string,
    automation_name: typeof automacao?.name === 'string' ? automacao.name : null,
    trigger_event: (row.trigger_event as string) ?? '',
    outcome: desfecho ?? (interrompidaEm ? 'interrupted' : null),
    interrupted_by: (row.interrompida_por as string | null) ?? null,
    interrupted_at: interrompidaEm,
    error_message: (row.error_message as string | null) ?? null,
    steps: lerPassos(row.steps_executed),
    started_at: row.created_at as string,
    finished_at: (row.finalizado_em as string | null) ?? null,
  };
}
