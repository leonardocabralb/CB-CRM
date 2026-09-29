import { describe, expect, it } from 'vitest';

import {
  RECUSA_DE_SUSPENSO,
  ehRecusaDeSuspenso,
  membrosAtivos,
  opcoesDeResponsavel,
} from './suspensao';

type Membro = { user_id: string; suspenso_em?: string | null };

const ana: Membro = { user_id: 'u-ana', suspenso_em: null };
const bia: Membro = { user_id: 'u-bia', suspenso_em: '2026-09-29T12:00:00Z' };
const caio: Membro = { user_id: 'u-caio' }; // dado de antes da 1064: sem o campo

describe('membrosAtivos', () => {
  it('tira quem está suspenso e mantém quem não tem o campo (antes da 1064)', () => {
    expect(membrosAtivos([ana, bia, caio]).map((m) => m.user_id)).toEqual(['u-ana', 'u-caio']);
  });
});

describe('opcoesDeResponsavel', () => {
  it('oferece só os ativos quando ninguém está escolhido', () => {
    expect(opcoesDeResponsavel([ana, bia, caio], () => false).map((m) => m.user_id)).toEqual([
      'u-ana',
      'u-caio',
    ]);
  });

  it('mantém o responsável ATUAL mesmo suspenso — sem ele, salvar apagaria a atribuição', () => {
    expect(
      opcoesDeResponsavel([ana, bia, caio], (m) => m.user_id === 'u-bia').map((m) => m.user_id),
    ).toEqual(['u-ana', 'u-bia', 'u-caio']);
  });
});

describe('ehRecusaDeSuspenso', () => {
  it('reconhece só a mensagem do contrato com a 1064', () => {
    expect(RECUSA_DE_SUSPENSO).toBe('membro_suspenso');
    expect(ehRecusaDeSuspenso({ message: 'membro_suspenso' })).toBe(true);
    expect(ehRecusaDeSuspenso({ message: 'No account for caller' })).toBe(false);
    expect(ehRecusaDeSuspenso(null)).toBe(false);
    expect(ehRecusaDeSuspenso(undefined)).toBe(false);
  });
});
