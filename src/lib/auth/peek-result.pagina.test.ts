import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { RETRYABLE_PEEK_FAIL_REASONS } from './peek-result';

// ============================================================
// Os casos NOSSOS do convite no 429 (porte do #682 do original). O
// `peek-result.ts` e o `peek-result.test.ts` são os do original, byte a byte
// (`docs/MERGE-UPSTREAM.md`, §3.4: caso nosso dentro do teste deles viraria
// conflito add/add no próximo merge); o que é nosso mora aqui.
//
// ⚠️ A página `/join/[token]` fazia `as PeekResult` no corpo, sem olhar o
// status. O 429 do limite por IP (`rateLimitResponse`: `{ error,
// retry_after_seconds }`) não tem `ok` nem `reason`, e
// `FAIL_COPY[undefined].title` LANÇAVA: a página do convite quebrava inteira.
// ============================================================

describe('as falhas TERMINAIS do convite não oferecem "Tentar novamente"', () => {
  it.each(['not_found', 'used', 'expired'] as const)('%s', (reason) => {
    expect(RETRYABLE_PEEK_FAIL_REASONS.has(reason)).toBe(false);
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

  it('todo motivo tem texto (as NOSSAS chaves fail*), e o "Tentar novamente" segue as passageiras', () => {
    expect(pagina).toContain("t('failRateLimitedTitle')");
    expect(pagina).toContain("t('failRateLimitedBody')");
    expect(pagina).toContain('RETRYABLE_PEEK_FAIL_REASONS.has(peek.reason)');
  });
});
