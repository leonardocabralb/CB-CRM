import { describe, expect, it } from 'vitest';

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
});
