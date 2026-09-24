import { afterEach, describe, expect, it, vi } from 'vitest';
import { listWabaPhoneNumbers } from './meta-api';

// NOSSO (Fase 7 do plano do merge do upstream). `paging.next` é uma URL que
// vem da RESPOSTA, e o token viaja no cabeçalho: seguir um cursor de outro
// host entregaria o token a ele. E a lista é o que decide "o número mora
// nesta WABA?" — lista pela metade diria "não mora" sobre número que mora.

function resposta(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listWabaPhoneNumbers', () => {
  it('segue o cursor do Graph e junta as páginas, com o token no cabeçalho', async () => {
    const urls: string[] = [];
    const cabecalhos: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(url);
        cabecalhos.push(init?.headers);
        return urls.length === 1
          ? resposta({
              data: [{ id: '1' }],
              paging: { next: 'https://graph.facebook.com/v21.0/W/phone_numbers?after=X' },
            })
          : resposta({ data: [{ id: '2' }] });
      }),
    );
    const numeros = await listWabaPhoneNumbers({ wabaId: 'W', accessToken: 'tok' });
    expect(numeros.map((n) => n.id)).toEqual(['1', '2']);
    expect(urls).toHaveLength(2);
    expect(urls.join(' ')).not.toContain('access_token');
    expect(cabecalhos[1]).toEqual({ Authorization: 'Bearer tok' });
  });

  it('cursor fora de graph.facebook.com NÃO é seguido — lança sem mandar o token', async () => {
    const f = vi.fn(async () =>
      resposta({
        data: [{ id: '1' }],
        paging: { next: 'https://graph.facebook.com.evil.example/v21.0/W/phone_numbers' },
      }),
    );
    vi.stubGlobal('fetch', f);
    await expect(listWabaPhoneNumbers({ wabaId: 'W', accessToken: 'tok' })).rejects.toThrow(
      /outside graph\.facebook\.com/,
    );
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('bater no teto de páginas com página sobrando LANÇA, nunca devolve meia lista', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n += 1;
        return resposta({
          data: [{ id: String(n) }],
          paging: { next: `https://graph.facebook.com/v21.0/W/phone_numbers?after=${n}` },
        });
      }),
    );
    await expect(listWabaPhoneNumbers({ wabaId: 'W', accessToken: 'tok' })).rejects.toThrow(
      /more phone numbers/,
    );
    expect(n).toBe(5);
  });
});
