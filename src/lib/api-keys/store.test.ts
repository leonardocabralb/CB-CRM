import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// `findActiveKeyByHash`: "não há chave ativa" (null) × "não consegui ler"
// (lança). Até 01/10/2026 a leitura que falhava devolvia null, e o
// integrador recebia 401 — "revogada" — num soluço do banco.
// ============================================================

const h = vi.hoisted(() => ({
  resultado: { data: null as unknown, error: null as unknown },
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.select = () => c;
    c.eq = () => c;
    c.maybeSingle = async () => h.resultado;
    return c;
  },
}));

import { findActiveKeyByHash } from './store';

const LINHA = {
  id: 'chave-1',
  account_id: 'conta-1',
  created_by: 'dono-1',
  name: 'Integração de exemplo',
  scopes: ['messages:send'],
  expires_at: null,
  revoked_at: null,
};

beforeEach(() => {
  h.resultado = { data: null, error: null };
});

describe('findActiveKeyByHash', () => {
  it('erro de leitura LANÇA — não vira "chave inválida"', async () => {
    h.resultado = { data: null, error: { message: 'canceling statement due to statement timeout' } };
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(findActiveKeyByHash('hash')).rejects.toThrow('API key lookup failed');
    erro.mockRestore();
  });

  it('nenhuma linha: null', async () => {
    await expect(findActiveKeyByHash('hash')).resolves.toBeNull();
  });

  it('revogada ou vencida: null', async () => {
    h.resultado = { data: { ...LINHA, revoked_at: '2026-09-01T00:00:00Z' }, error: null };
    await expect(findActiveKeyByHash('hash')).resolves.toBeNull();
    h.resultado = { data: { ...LINHA, expires_at: '2020-01-01T00:00:00Z' }, error: null };
    await expect(findActiveKeyByHash('hash')).resolves.toBeNull();
  });

  it('ativa: a linha', async () => {
    h.resultado = { data: LINHA, error: null };
    await expect(findActiveKeyByHash('hash')).resolves.toEqual(LINHA);
  });
});
