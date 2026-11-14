import { describe, expect, it } from 'vitest';

import {
  OPCOES_DE_VALIDADE_DIAS,
  acoesDaChave,
  VALIDADE_MAXIMA_DIAS,
  ehChaveSoDeLeitura,
  escritaProibida,
  lerFunis,
  lerMembro,
  lerValidade,
  validadeSugerida,
} from './configuracao';
import { API_SCOPES, ehEscopoDeLeitura } from './scopes';

const AGORA = Date.parse('2026-11-04T12:00:00Z');
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('acoesDaChave (o que a lista oferece ao admin)', () => {
  it('a ATIVA se edita e se revoga', () => {
    expect(acoesDaChave('active')).toEqual({ editar: true, revogar: true });
  });
  it('⚠️ a VENCIDA se edita (é como se renova a validade sem trocar o segredo) e não se revoga — achado do Codex', () => {
    expect(acoesDaChave('expired')).toEqual({ editar: true, revogar: false });
  });
  it('a REVOGADA não volta: nem editar, nem revogar de novo', () => {
    expect(acoesDaChave('revoked')).toEqual({ editar: false, revogar: false });
  });
});

describe('lerValidade', () => {
  it('ausente = não mexer; null = sem validade', () => {
    expect(lerValidade(undefined, AGORA)).toEqual({ ok: true, valor: undefined });
    expect(lerValidade(null, AGORA)).toEqual({ ok: true, valor: null });
  });

  it('N dias a partir de AGORA, com teto de 1 ano', () => {
    expect(lerValidade(90, AGORA)).toEqual({ ok: true, valor: '2027-02-02T12:00:00.000Z' });
    const teto = lerValidade(10_000, AGORA);
    expect(teto.ok && teto.valor).toBe(
      new Date(AGORA + VALIDADE_MAXIMA_DIAS * 86_400_000).toISOString()
    );
  });

  it('recusa número inválido em vez de criar chave sem prazo em silêncio', () => {
    for (const ruim of [0, -5, '90', Number.NaN, Infinity]) {
      expect(lerValidade(ruim, AGORA).ok).toBe(false);
    }
  });

  it('sugere 90 dias com funcionário e "sem validade" na chave de integração', () => {
    // Decisão do operador: a do n8n não pode parar sozinha em 90 dias.
    expect(validadeSugerida(true)).toBe('90');
    expect(validadeSugerida(false)).toBe('sem');
    expect(OPCOES_DE_VALIDADE_DIAS).toContain(90);
  });
});

describe('lerMembro', () => {
  it('UUID, null ou ausente', () => {
    expect(lerMembro(UUID_A)).toEqual({ ok: true, valor: UUID_A });
    expect(lerMembro(null)).toEqual({ ok: true, valor: null });
    expect(lerMembro(undefined)).toEqual({ ok: true, valor: undefined });
    expect(lerMembro('ana').ok).toBe(false);
  });
});

describe('lerFunis', () => {
  it('lista de UUIDs sem repetição; null = todos', () => {
    expect(lerFunis([UUID_A, UUID_B, UUID_A.toUpperCase()])).toEqual({
      ok: true,
      valor: [UUID_A, UUID_B],
    });
    expect(lerFunis(null)).toEqual({ ok: true, valor: null });
  });

  it('⚠️ lista VAZIA é recusada: nunca vira "todos" por um clique errado', () => {
    expect(lerFunis([]).ok).toBe(false);
  });

  it('recusa item que não é UUID e o que não é lista', () => {
    expect(lerFunis([UUID_A, 'Trabalhista']).ok).toBe(false);
    expect(lerFunis(UUID_A).ok).toBe(false);
  });
});

describe('escritaProibida (decisão do operador: chave de funcionário e recortada só leem)', () => {
  it('recortada por funil: aponta o primeiro escopo de escrita', () => {
    const recortada = { funis: [UUID_A], membroUserId: null };
    expect(escritaProibida(recortada, ['contacts:read', 'messages:send'])).toBe('messages:send');
    expect(escritaProibida(recortada, ['contacts:read', 'messages:read'])).toBeNull();
  });

  it('de funcionário SEM funil também só lê (a escrita sairia como o dono)', () => {
    const doFuncionario = { funis: null, membroUserId: UUID_B };
    expect(ehChaveSoDeLeitura(doFuncionario)).toBe(true);
    expect(escritaProibida(doFuncionario, ['contacts:write'])).toBe('contacts:write');
  });

  it('chave da conta (sem funcionário, sem recorte): escrita permitida, como sempre', () => {
    const daConta = { funis: null, membroUserId: null };
    expect(ehChaveSoDeLeitura(daConta)).toBe(false);
    expect(escritaProibida(daConta, ['messages:send', 'contacts:write'])).toBeNull();
  });

  it('a chave só de leitura leva EXATAMENTE estes escopos (escopo novo decide aqui)', () => {
    // A régua é o sufixo `:read`; o que a chave de funcionário e a recortada
    // carregam é esta lista. Um escopo novo de escrita com nome que termine
    // em `:read`, ou um de leitura com outro nome, reprova até alguém decidir.
    expect([...API_SCOPES].filter(ehEscopoDeLeitura).sort()).toEqual([
      'automations:read',
      'channels:read',
      'contacts:read',
      'conversations:read',
      'custom_fields:read',
      'deals:read',
      'meetings:read',
      'messages:read',
      'notes:read',
      'scheduled:read',
      'tasks:read',
    ]);
  });
});
