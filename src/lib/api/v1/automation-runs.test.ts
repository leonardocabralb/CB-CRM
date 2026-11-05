import { describe, expect, it } from 'vitest';

import { serializeAutomationRun } from './automation-runs';

const base = {
  id: 'log-1',
  automation_id: 'auto-1',
  trigger_event: 'deal_stage_changed',
  desfecho: null,
  error_message: null,
  steps_executed: [],
  created_at: '2026-11-04T12:00:00Z',
  finalizado_em: null,
  interrompida_em: null,
  interrompida_por: null,
  automations: { name: 'No-show' },
};

describe('serializeAutomationRun', () => {
  it('traduz o desfecho e NÃO expõe o `status` cru nem colunas internas', () => {
    const out = serializeAutomationRun({
      ...base,
      desfecho: 'concluida',
      finalizado_em: '2026-11-04T12:01:00Z',
      status: 'failed',
      user_id: 'quem-criou',
      account_id: 'acct-1',
    });
    expect(out.outcome).toBe('completed');
    expect(out.automation_name).toBe('No-show');
    expect(out.finished_at).toBe('2026-11-04T12:01:00Z');
    for (const interno of ['status', 'user_id', 'account_id', 'desfecho']) {
      expect(out).not.toHaveProperty(interno);
    }
  });

  it('interrompida sem desfecho = interrupted, com o motivo', () => {
    const out = serializeAutomationRun({
      ...base,
      interrompida_em: '2026-11-04T13:00:00Z',
      interrompida_por: 'resposta',
    });
    expect(out.outcome).toBe('interrupted');
    expect(out.interrupted_by).toBe('resposta');
  });

  it('⚠️ o desfecho VENCE a marca: a interrompida que já falhou é falha', () => {
    const out = serializeAutomationRun({
      ...base,
      desfecho: 'falhou',
      interrompida_em: '2026-11-04T13:00:00Z',
      interrompida_por: 'etapa',
    });
    expect(out.outcome).toBe('failed');
  });

  it('sem desfecho nem marca = null (rodando, esperando ou anterior à 985)', () => {
    expect(serializeAutomationRun(base).outcome).toBeNull();
  });

  it('passos lidos campo a campo; o que não tem forma de passo sai', () => {
    const out = serializeAutomationRun({
      ...base,
      steps_executed: [
        { step_id: 's1', step_type: 'send_message', status: 'success' },
        { step_id: 's2', step_type: 'wait', status: 'skipped', detail: 'interrompida' },
        { lixo: true },
        null,
      ],
    });
    expect(out.steps).toEqual([
      { step_id: 's1', step_type: 'send_message', status: 'success', detail: null },
      { step_id: 's2', step_type: 'wait', status: 'skipped', detail: 'interrompida' },
    ]);
  });
});
