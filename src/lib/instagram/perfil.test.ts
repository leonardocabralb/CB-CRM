import { beforeEach, describe, expect, it, vi } from 'vitest';

const guardarFoto = vi.fn();
vi.mock('@/lib/whatsapp/foto-do-contato', () => ({
  guardarFoto: (...args: unknown[]) => guardarFoto(...args),
}));

import { completarPerfilDoContato } from './perfil';

function fakeDb() {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      },
    }),
  } as never;
  return { db, updates };
}

const base = {
  accountId: 'conta',
  contactId: 'c1',
  igsid: '1663055967608091',
  token: 'token',
  agoraMs: Date.parse('2026-09-10T00:00:00Z'),
};

describe('completarPerfilDoContato', () => {
  beforeEach(() => guardarFoto.mockReset());

  it('sem foto: carimba avatar_checked_at já (senão custaria uma chamada por mensagem)', async () => {
    const { db, updates } = fakeDb();
    const r = await completarPerfilDoContato({
      ...base,
      db,
      nomeAtual: null,
      cliente: {
        me: vi.fn(),
        perfil: async () => ({ nome: 'Ana', username: 'ana', fotoUrl: null }),
      },
    });
    expect(r).toEqual({ name: 'Ana' });
    expect(updates[0]).toMatchObject({
      name: 'Ana',
      instagram_username: 'ana',
      avatar_checked_at: '2026-09-10T00:00:00.000Z',
    });
    expect(guardarFoto).not.toHaveBeenCalled();
  });

  it('com foto: NÃO carimba aqui — quem carimba é o guardarFoto que deu certo', async () => {
    const { db, updates } = fakeDb();
    guardarFoto.mockResolvedValue('atualizada');
    await completarPerfilDoContato({
      ...base,
      db,
      nomeAtual: 'Já tinha',
      cliente: {
        me: vi.fn(),
        perfil: async () => ({
          nome: 'Ana',
          username: 'ana',
          fotoUrl: 'https://cdn/x',
        }),
      },
    });
    expect(updates[0]).not.toHaveProperty('avatar_checked_at');
    // Nome existente não é sobrescrito.
    expect(updates[0]).not.toHaveProperty('name');
    expect(guardarFoto).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'c1', url: 'https://cdn/x' })
    );
  });

  it('download da foto que falha fica sem carimbo — a próxima mensagem tenta de novo', async () => {
    const { db, updates } = fakeDb();
    guardarFoto.mockResolvedValue('falhou');
    const r = await completarPerfilDoContato({
      ...base,
      db,
      nomeAtual: null,
      cliente: {
        me: vi.fn(),
        perfil: async () => ({
          nome: null,
          username: 'ana',
          fotoUrl: 'https://cdn/x',
        }),
      },
    });
    expect(r).toEqual({ name: '@ana' });
    expect(updates.every((u) => !('avatar_checked_at' in u))).toBe(true);
  });

  it('falha da API não grava nada e devolve null', async () => {
    const { db, updates } = fakeDb();
    const r = await completarPerfilDoContato({
      ...base,
      db,
      nomeAtual: null,
      cliente: {
        me: vi.fn(),
        perfil: async () => {
          throw new Error('rede');
        },
      },
    });
    expect(r).toBeNull();
    expect(updates).toHaveLength(0);
  });
});
