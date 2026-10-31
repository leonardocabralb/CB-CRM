import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ordem, gerar, vencer, podar, drenar } = vi.hoisted(() => ({
  ordem: [] as string[],
  gerar: vi.fn(),
  vencer: vi.fn(),
  podar: vi.fn(),
  drenar: vi.fn(),
}));

vi.mock('@/lib/tasks/gerar-recorrentes', () => ({
  gerarTarefasRecorrentes: (...a: unknown[]) => {
    ordem.push('tarefas');
    return gerar(...a);
  },
}));
vi.mock('@/lib/ia-agentes/conteudo-dos-turnos', () => ({
  podarConteudoDosTurnos: (...a: unknown[]) => {
    ordem.push('podar');
    return podar(...a);
  },
}));
vi.mock('@/lib/storage/arquivos-a-apagar', () => ({
  vencerLixeira: (...a: unknown[]) => {
    ordem.push('vencer');
    return vencer(...a);
  },
  drenarArquivosAApagar: (...a: unknown[]) => {
    ordem.push('drenar');
    return drenar(...a);
  },
}));

import {
  PRAZO_DA_MANUTENCAO_MS,
  rodarManutencaoDoCiclo,
} from './manutencao-do-ciclo';

const admin = {} as SupabaseClient;

beforeEach(() => {
  ordem.length = 0;
  gerar.mockResolvedValue({ geradas: 0, semAviso: 0, erro: null });
  vencer.mockResolvedValue({ excluidas: 0, arquivos: 0, erro: null });
  podar.mockResolvedValue({ limpos: 0, erro: null });
  drenar.mockResolvedValue({
    apagados: 0,
    foraDaGuarda: 0,
    falhas: 0,
    erro: null,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a manutenção do ciclo das agendadas', () => {
  it('roda os quatro passos EM SEQUÊNCIA: tarefas → vencimento → poda dos turnos da IA → fila (o vencimento enche a fila que a drenagem leva; a poda vem depois da exclusão definitiva)', async () => {
    await rodarManutencaoDoCiclo(admin, 1_000);
    expect(ordem).toEqual(['tarefas', 'vencer', 'podar', 'drenar']);
    expect(gerar).toHaveBeenCalledWith(admin);
  });

  it('UM prazo comum, contado do início', async () => {
    await rodarManutencaoDoCiclo(admin, 1_000);
    expect(vencer).toHaveBeenCalledWith(admin, 1_000 + PRAZO_DA_MANUTENCAO_MS);
    expect(podar).toHaveBeenCalledWith(admin, 1_000 + PRAZO_DA_MANUTENCAO_MS);
    expect(drenar).toHaveBeenCalledWith(admin, 1_000 + PRAZO_DA_MANUTENCAO_MS);
  });

  it('o prazo fica abaixo do recolhimento da fila (10 min) e do laço (15 min)', () => {
    expect(PRAZO_DA_MANUTENCAO_MS).toBeGreaterThan(0);
    expect(PRAZO_DA_MANUTENCAO_MS).toBeLessThan(10 * 60_000);
  });

  it('cada passo é ISOLADO: o que lança (ou rejeita) não impede o seguinte, e nada sai para fora', async () => {
    gerar.mockRejectedValue(new Error('tarefas quebrou'));
    vencer.mockImplementation(() => {
      throw new Error('vencimento quebrou');
    });
    podar.mockRejectedValue(new Error('poda quebrou'));
    await expect(rodarManutencaoDoCiclo(admin, 1_000)).resolves.toBeUndefined();
    expect(ordem).toEqual(['tarefas', 'vencer', 'podar', 'drenar']);
    expect(podar).toHaveBeenCalledTimes(1);
    expect(drenar).toHaveBeenCalledTimes(1);
  });
});
