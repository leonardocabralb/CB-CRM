import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  gerarTarefasRecorrentes,
  LOTE_DE_RECORRENTES,
  TITULO_DO_AVISO_RECORRENTE,
} from './gerar-recorrentes';

function tarefa(id: string) {
  return {
    id,
    account_id: 'conta',
    contact_id: 'cliente',
    criador_user_id: 'u-chefe',
    responsavel_user_id: 'u-colega',
    titulo: `Ligar ${id}`,
  };
}

/** Dublê do cliente: `rpc` devolve os lotes em ordem; `insert` registra. */
function dubleDoAdmin(
  lotes: Array<{ data: unknown[] | null; error: { message: string } | null }>,
  erroDoAviso: { message: string } | null = null,
) {
  const rpc = vi.fn(async () => lotes.shift() ?? { data: [], error: null });
  const insert = vi.fn<(linhas: unknown[]) => Promise<{ error: { message: string } | null }>>(
    async () => ({ error: erroDoAviso }),
  );
  const from = vi.fn(() => ({ insert }));
  return { admin: { rpc, from } as unknown as SupabaseClient, rpc, insert, from };
}

describe('gerarTarefasRecorrentes', () => {
  it('manda o "hoje" do ESCRITÓRIO: 22h de Brasília ainda é o mesmo dia (UTC já virou)', async () => {
    const { admin, rpc } = dubleDoAdmin([{ data: [], error: null }]);
    await gerarTarefasRecorrentes(admin, new Date('2026-03-02T01:00:00Z'));
    expect(rpc).toHaveBeenCalledWith('cb_tarefas_recorrentes_gerar', {
      p_hoje: '2026-03-01',
      p_limite: LOTE_DE_RECORRENTES,
    });
  });

  it('avisa no sino o responsável de cada tarefa gerada, roteando pela tarefa', async () => {
    const { admin, insert, from } = dubleDoAdmin([
      { data: [tarefa('a'), tarefa('b')], error: null },
    ]);
    const r = await gerarTarefasRecorrentes(admin, new Date('2026-03-02T12:00:00Z'));
    expect(r).toEqual({ geradas: 2, semAviso: 0, erro: null });
    expect(from).toHaveBeenCalledWith('notifications');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toEqual([
      {
        account_id: 'conta',
        user_id: 'u-colega',
        type: 'task_assigned',
        contact_id: 'cliente',
        task_id: 'a',
        actor_user_id: 'u-chefe',
        title: TITULO_DO_AVISO_RECORRENTE,
        body: 'Ligar a',
      },
      expect.objectContaining({ task_id: 'b', body: 'Ligar b' }),
    ]);
  });

  it('dia sem série vencida não grava aviso nenhum', async () => {
    const { admin, insert } = dubleDoAdmin([{ data: [], error: null }]);
    const r = await gerarTarefasRecorrentes(admin);
    expect(r).toEqual({ geradas: 0, semAviso: 0, erro: null });
    expect(insert).not.toHaveBeenCalled();
  });

  it('lote cheio chama de novo; lote incompleto encerra o ciclo', async () => {
    const cheio = Array.from({ length: LOTE_DE_RECORRENTES }, (_, i) => tarefa(`c${i}`));
    const { admin, rpc } = dubleDoAdmin([
      { data: cheio, error: null },
      { data: [tarefa('ultima')], error: null },
      { data: [tarefa('nunca')], error: null },
    ]);
    const r = await gerarTarefasRecorrentes(admin);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(r.geradas).toBe(LOTE_DE_RECORRENTES + 1);
  });

  it('aviso que falha não desfaz a tarefa: conta como "sem aviso"', async () => {
    const { admin } = dubleDoAdmin(
      [{ data: [tarefa('a')], error: null }],
      { message: 'check violation' },
    );
    const r = await gerarTarefasRecorrentes(admin);
    expect(r).toEqual({ geradas: 1, semAviso: 1, erro: null });
  });

  it('NUNCA lança: erro da função vira motivo no resultado', async () => {
    const { admin } = dubleDoAdmin([{ data: null, error: { message: 'function does not exist' } }]);
    await expect(gerarTarefasRecorrentes(admin)).resolves.toEqual({
      geradas: 0,
      semAviso: 0,
      erro: 'function does not exist',
    });
  });
});
