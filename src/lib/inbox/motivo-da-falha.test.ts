import { describe, expect, it } from 'vitest';
import { motivoNaBolha } from './motivo-da-falha';

const falha = {
  status: 'failed' as const,
  sender_type: 'agent' as const,
  error_code: 131026,
  error_title: 'Message undeliverable',
  error_details: 'Unable to deliver message.',
};

describe('o motivo da falha na bolha', () => {
  it('título (código) — detalhes', () => {
    expect(motivoNaBolha(falha)).toBe('Message undeliverable (131026) — Unable to deliver message.');
  });

  it('sem pedaço vazio quando falta um campo', () => {
    expect(motivoNaBolha({ ...falha, error_details: null })).toBe('Message undeliverable (131026)');
    expect(motivoNaBolha({ ...falha, error_code: null })).toBe('Message undeliverable — Unable to deliver message.');
    expect(motivoNaBolha({ ...falha, error_title: '  ', error_code: null })).toBe('Unable to deliver message.');
    expect(motivoNaBolha({ ...falha, error_title: null, error_details: null })).toBe('131026');
  });

  it('falha da Evolution ou anterior à 1039 (os três nulos ou ausentes) não tem motivo', () => {
    expect(motivoNaBolha({ ...falha, error_code: null, error_title: null, error_details: null })).toBeNull();
    expect(motivoNaBolha({ status: 'failed', sender_type: 'bot' })).toBeNull();
  });

  it('só na mensagem que falhou', () => {
    for (const status of ['sending', 'sent', 'delivered', 'read'] as const) {
      expect(motivoNaBolha({ ...falha, status })).toBeNull();
    }
  });

  it('⚠️ mensagem do CLIENTE não tem motivo de entrega (a mesma guarda da bolha)', () => {
    expect(motivoNaBolha({ ...falha, sender_type: 'customer' })).toBeNull();
    expect(motivoNaBolha({ ...falha, sender_type: 'bot' })).not.toBeNull();
  });
});
