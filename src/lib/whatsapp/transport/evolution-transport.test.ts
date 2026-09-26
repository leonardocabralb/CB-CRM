import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EvolutionApiError,
  EvolutionClient,
  assertValidBaseUrl,
} from './evolution-client';
import { getTransport } from './index';
import { toEvolutionNumber } from './evolution-transport';

describe('assertValidBaseUrl', () => {
  it('accepts https origins', () => {
    expect(() => assertValidBaseUrl('https://evo.example.com')).not.toThrow();
  });

  it('accepts http origins (co-located Evolution on the VPS)', () => {
    expect(() => assertValidBaseUrl('http://127.0.0.1:8080')).not.toThrow();
    expect(() => assertValidBaseUrl('http://localhost:8080')).not.toThrow();
  });

  it('rejects a non-http(s) protocol', () => {
    expect(() => assertValidBaseUrl('ftp://evo.example.com')).toThrow(/http/);
  });

  it('rejects a malformed URL', () => {
    expect(() => assertValidBaseUrl('not a url')).toThrow(EvolutionApiError);
  });
});

describe('EvolutionClient construction', () => {
  it('builds over http (internal VPS hop)', () => {
    expect(
      () =>
        new EvolutionClient({
          baseUrl: 'http://127.0.0.1:8080',
          apikey: 'k',
          instance: 'crm',
        })
    ).not.toThrow();
  });

  it('builds over https', () => {
    expect(
      () =>
        new EvolutionClient({
          baseUrl: 'https://evo.example.com/',
          apikey: 'k',
          instance: 'crm',
        })
    ).not.toThrow();
  });

  it('rejects a non-http(s) base URL', () => {
    expect(
      () =>
        new EvolutionClient({
          baseUrl: 'ftp://evo.example.com',
          apikey: 'k',
          instance: 'crm',
        })
    ).toThrow(EvolutionApiError);
  });
});

describe('getTransport', () => {
  it('resolves the evolution provider', () => {
    const t = getTransport({
      provider: 'evolution',
      baseUrl: 'https://evo.example.com',
      instance: 'crm',
      apikey: 'k',
    });
    expect(t.provider).toBe('evolution');
  });

  it('accepts an http evolution origin (co-located VPS)', () => {
    const t = getTransport({
      provider: 'evolution',
      baseUrl: 'http://127.0.0.1:8080',
      instance: 'crm',
      apikey: 'k',
    });
    expect(t.provider).toBe('evolution');
  });

  it('does not wire meta yet', () => {
    expect(() =>
      getTransport({
        provider: 'meta',
        phoneNumberId: '123',
        accessToken: 'tok',
      })
    ).toThrow(/not yet wired/);
  });
});

describe('toEvolutionNumber', () => {
  it('strips E.164 formatting to digits', () => {
    expect(toEvolutionNumber('+55 11 99999-9999')).toBe('5511999999999');
  });

  it('strips the whatsapp JID suffix', () => {
    expect(toEvolutionNumber('5511999999999@s.whatsapp.net')).toBe(
      '5511999999999'
    );
  });

  it('preserves group JIDs unchanged', () => {
    expect(toEvolutionNumber('123456789-987654@g.us')).toBe(
      '123456789-987654@g.us'
    );
  });

  // Segunda trava da Fase 11.3: sem ela, as letras do BSUID sumiriam e a
  // mensagem iria ao número formado pelos dígitos dele — um desconhecido.
  it('LANÇA com o BSUID da Meta (e com o do portfólio)', () => {
    expect(() => toEvolutionNumber('BR.13491208655302741918')).toThrow(/BSUID/);
    expect(() => toEvolutionNumber('US.ENT.11815799212886844830')).toThrow(/BSUID/);
  });
});

// ⚠️ Pino da prévia de link (23/09/2026). Sem `linkPreview: false`, a
// Evolution 2.4 anexa ao texto com link uma prévia no formato de anúncio, e
// a mensagem não chegava a parte dos clientes (Android) — ver o comentário
// em `sendText` e o CLAUDE.md, "Link sai SEM prévia".
describe('EvolutionClient.sendText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function corpoDoEnvio(fetchSpy: ReturnType<typeof vi.fn>) {
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://evo.example.com/message/sendText/crm');
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  function evolutionRespondendo() {
    return vi.fn(async () =>
      new Response(JSON.stringify({ key: { id: '3EB0TESTE' } }), { status: 201 })
    );
  }

  const client = () =>
    new EvolutionClient({ baseUrl: 'https://evo.example.com', apikey: 'k', instance: 'crm' });

  it('sempre desliga a prévia de link', async () => {
    const fetchSpy = evolutionRespondendo();
    vi.stubGlobal('fetch', fetchSpy);

    const id = await client().sendText({
      number: '5511999999999',
      text: 'Link da videochamada: https://meet.google.com/',
    });

    expect(id).toBe('3EB0TESTE');
    expect(corpoDoEnvio(fetchSpy)).toEqual({
      number: '5511999999999',
      text: 'Link da videochamada: https://meet.google.com/',
      linkPreview: false,
    });
  });

  it('desliga a prévia também ao responder citando', async () => {
    const fetchSpy = evolutionRespondendo();
    vi.stubGlobal('fetch', fetchSpy);
    const citada = { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'ABC' };

    await client().sendText({ number: '5511999999999', text: 'https://exemplo.com', quoted: citada });

    expect(corpoDoEnvio(fetchSpy)).toEqual({
      number: '5511999999999',
      text: 'https://exemplo.com',
      quoted: { key: citada },
      linkPreview: false,
    });
  });
});
