import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyPhoneNumber } from './meta-api';

// NOSSO (PR #386): a sonda de saúde CANCELA o verify no prazo dela pelo
// `signal`. Um merge que traga o `verifyPhoneNumber` cru do upstream
// descartaria o campo sem erro de tipo nenhum no fetch — e, numa Graph API
// travada, cada sonda deixaria uma requisição pendurada viva.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyPhoneNumber', () => {
  it('repassa o `signal` ao fetch', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: '123' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controle = new AbortController();

    await verifyPhoneNumber({ phoneNumberId: '123', accessToken: 'tok', signal: controle.signal });

    expect(fetchMock.mock.calls[0]![1]?.signal).toBe(controle.signal);
  });

  it('o prazo vencido chega como TimeoutError (o que a sonda lê como "não sei")', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_, rejeitar) => {
            init?.signal?.addEventListener('abort', () => rejeitar(init.signal!.reason));
          }),
      ),
    );

    await expect(
      verifyPhoneNumber({ phoneNumberId: '123', accessToken: 'tok', signal: AbortSignal.timeout(5) }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
