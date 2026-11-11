import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ordem, alarmes, gerar, vencer, vencerNotas, podar, gravacoes, drenar, transcricoes } = vi.hoisted(() => ({
  ordem: [] as string[],
  alarmes: vi.fn(),
  gerar: vi.fn(),
  vencer: vi.fn(),
  vencerNotas: vi.fn(),
  podar: vi.fn(),
  gravacoes: vi.fn(),
  drenar: vi.fn(),
  transcricoes: vi.fn(),
}));

vi.mock('@/lib/cb-channels/avisar-alarmes', () => ({
  avisarAlarmesDeConexao: (...a: unknown[]) => {
    ordem.push('alarmes');
    return alarmes(...a);
  },
}));
vi.mock('@/lib/tasks/gerar-recorrentes', () => ({
  gerarTarefasRecorrentes: (...a: unknown[]) => {
    ordem.push('tarefas');
    return gerar(...a);
  },
}));
vi.mock('@/lib/notes/vencer-lixeira-de-anotacoes', () => ({
  vencerLixeiraDeAnotacoes: (...a: unknown[]) => {
    ordem.push('notas');
    return vencerNotas(...a);
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
vi.mock('@/lib/whatsapp/ligacoes/poda', () => ({
  podarGravacoesDeLigacao: (...a: unknown[]) => {
    ordem.push('gravacoes');
    return gravacoes(...a);
  },
}));
vi.mock('@/lib/whatsapp/ligacoes/transcricao', () => ({
  retomarTranscricoes: (...a: unknown[]) => {
    ordem.push('transcricoes');
    return transcricoes(...a);
  },
}));

import {
  PRAZO_DA_MANUTENCAO_MS,
  rodarManutencaoDoCiclo,
} from './manutencao-do-ciclo';

const admin = {} as SupabaseClient;
const ORDEM = ['alarmes', 'tarefas', 'vencer', 'notas', 'podar', 'gravacoes', 'drenar', 'transcricoes'];

beforeEach(() => {
  ordem.length = 0;
  alarmes.mockResolvedValue(undefined);
  gerar.mockResolvedValue({ geradas: 0, semAviso: 0, erro: null });
  vencer.mockResolvedValue({ excluidas: 0, arquivos: 0, erro: null });
  vencerNotas.mockResolvedValue({ excluidas: 0, erro: null });
  podar.mockResolvedValue({ limpos: 0, erro: null });
  gravacoes.mockResolvedValue(undefined);
  drenar.mockResolvedValue({
    apagados: 0,
    foraDaGuarda: 0,
    falhas: 0,
    erro: null,
  });
  transcricoes.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a manutenção do ciclo das agendadas', () => {
  it('roda os oito passos EM SEQUÊNCIA: alarmes → tarefas → vencimento da Lixeira → vencimento das anotações → poda dos turnos da IA → poda das gravações → fila → transcrições (o aviso de conexão primeiro; os vencimentos enchem a fila que a drenagem leva; a transcrição, que chama o provedor, por último)', async () => {
    await rodarManutencaoDoCiclo(admin, 1_000);
    expect(ordem).toEqual(ORDEM);
    expect(alarmes).toHaveBeenCalledWith(admin, 1_000);
    expect(gerar).toHaveBeenCalledWith(admin);
    // O vencimento das anotações mede os 90 dias a partir do INÍCIO.
    expect(vencerNotas).toHaveBeenCalledWith(admin, 1_000);
  });

  it('UM prazo comum, contado do início', async () => {
    await rodarManutencaoDoCiclo(admin, 1_000);
    expect(vencer).toHaveBeenCalledWith(admin, 1_000 + PRAZO_DA_MANUTENCAO_MS);
    expect(podar).toHaveBeenCalledWith(admin, 1_000 + PRAZO_DA_MANUTENCAO_MS);
    expect(gravacoes).toHaveBeenCalledWith(admin, 1_000 + PRAZO_DA_MANUTENCAO_MS);
    expect(drenar).toHaveBeenCalledWith(admin, 1_000 + PRAZO_DA_MANUTENCAO_MS);
    expect(transcricoes).toHaveBeenCalledWith(admin, 1_000 + PRAZO_DA_MANUTENCAO_MS);
  });

  it('o prazo fica abaixo do recolhimento da fila (10 min) e do laço (15 min)', () => {
    expect(PRAZO_DA_MANUTENCAO_MS).toBeGreaterThan(0);
    expect(PRAZO_DA_MANUTENCAO_MS).toBeLessThan(10 * 60_000);
  });

  it('cada passo é ISOLADO: o que lança (ou rejeita) não impede o seguinte, e nada sai para fora', async () => {
    alarmes.mockRejectedValue(new Error('alarmes quebrou'));
    gerar.mockRejectedValue(new Error('tarefas quebrou'));
    vencer.mockImplementation(() => {
      throw new Error('vencimento quebrou');
    });
    vencerNotas.mockRejectedValue(new Error('anotações quebrou'));
    podar.mockRejectedValue(new Error('poda quebrou'));
    gravacoes.mockRejectedValue(new Error('poda das gravações quebrou'));
    drenar.mockRejectedValue(new Error('drenagem quebrou'));
    await expect(rodarManutencaoDoCiclo(admin, 1_000)).resolves.toBeUndefined();
    expect(ordem).toEqual(ORDEM);
    expect(podar).toHaveBeenCalledTimes(1);
    expect(drenar).toHaveBeenCalledTimes(1);
    expect(transcricoes).toHaveBeenCalledTimes(1);
  });
});
