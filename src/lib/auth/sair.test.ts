import { describe, expect, it } from 'vitest';
import { sairDesteAparelho, type AuthQueSai } from './sair';

function dubleDeAuth(resposta: { error: { message: string } | null } | Error) {
  const chamadas: unknown[] = [];
  const auth: AuthQueSai = {
    async signOut(opcoes) {
      chamadas.push(opcoes);
      if (resposta instanceof Error) throw resposta;
      return resposta;
    },
  };
  return { auth, chamadas };
}

describe('sairDesteAparelho', () => {
  it('sai com escopo LOCAL, e só com ele', async () => {
    const { auth, chamadas } = dubleDeAuth({ error: null });
    await expect(sairDesteAparelho(auth)).resolves.toEqual({ ok: true });
    expect(chamadas).toEqual([{ scope: 'local' }]);
  });

  it('devolve o erro do provedor em vez de engoli-lo', async () => {
    const { auth } = dubleDeAuth({ error: { message: 'fetch failed' } });
    await expect(sairDesteAparelho(auth)).resolves.toEqual({ ok: false, erro: 'fetch failed' });
  });

  it('uma exceção também vira resultado, não estouro', async () => {
    const { auth } = dubleDeAuth(new Error('rede caiu'));
    await expect(sairDesteAparelho(auth)).resolves.toEqual({ ok: false, erro: 'rede caiu' });
  });
});
