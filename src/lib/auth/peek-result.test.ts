import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { RETRYABLE_PEEK_FAIL_REASONS, toPeekResult } from './peek-result';

// A página do convite quebrava no 429 do limite por IP (porte do #682 do
// original): o corpo do `rateLimitResponse` não tem `ok` nem `reason`.

describe('toPeekResult', () => {
  it('o 429 do limite (sem ok nem reason) vira rate_limited', () => {
    expect(
      toPeekResult(429, { error: 'Rate limit exceeded', retry_after_seconds: 42 }),
    ).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('o convite válido passa como veio', () => {
    const body = {
      ok: true,
      account_name: 'Escritório Exemplo',
      role: 'agent',
      expires_at: '2026-12-01T00:00:00Z',
    };
    expect(toPeekResult(200, body)).toEqual(body);
  });

  it.each(['not_found', 'used', 'expired', 'server_error'])(
    'a falha %s passa como veio',
    (reason) => {
      expect(toPeekResult(200, { ok: false, reason })).toEqual({ ok: false, reason });
    },
  );

  it('motivo desconhecido vira server_error (antes também quebrava a página)', () => {
    expect(toPeekResult(200, { ok: false, reason: 'misterio' })).toEqual({
      ok: false,
      reason: 'server_error',
    });
  });

  it('corpo ilegível vira server_error', () => {
    expect(toPeekResult(502, null)).toEqual({ ok: false, reason: 'server_error' });
    expect(toPeekResult(500, { error: 'boom' })).toEqual({
      ok: false,
      reason: 'server_error',
    });
  });

  it('só as falhas passageiras oferecem "Tentar novamente"', () => {
    expect(RETRYABLE_PEEK_FAIL_REASONS.has('rate_limited')).toBe(true);
    expect(RETRYABLE_PEEK_FAIL_REASONS.has('server_error')).toBe(true);
    expect(RETRYABLE_PEEK_FAIL_REASONS.has('expired')).toBe(false);
    expect(RETRYABLE_PEEK_FAIL_REASONS.has('used')).toBe(false);
    expect(RETRYABLE_PEEK_FAIL_REASONS.has('not_found')).toBe(false);
  });
});

describe('/join/[token] lê o peek por toPeekResult', () => {
  const pagina = readFileSync(
    join(__dirname, '../../app/join/[token]/page.tsx'),
    'utf8',
  );

  it('nenhum cast cru do corpo (o 429 quebrava a página)', () => {
    expect(pagina).not.toMatch(/as PeekResult/);
    expect(pagina.match(/toPeekResult\(\s*peekRes\.status/g)).toHaveLength(2);
  });

  it('todo motivo tem texto, e o "Tentar novamente" segue as passageiras', () => {
    expect(pagina).toContain("t('failRateLimitedTitle')");
    expect(pagina).toContain("t('failRateLimitedBody')");
    expect(pagina).toContain('RETRYABLE_PEEK_FAIL_REASONS.has(peek.reason)');
  });
});
