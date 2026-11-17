// ============================================================
// A resposta de `GET /api/invitations/[token]/peek` lida pela página do
// convite (`/join/[token]`). Porte do #682 do original, com o MESMO nome e a
// mesma API (um merge futuro resolve o arquivo inteiro de qualquer lado).
//
// ⚠️ A página fazia `as PeekResult` no corpo, sem olhar o status. O 429 do
// limite por IP (`rateLimitResponse`: `{ error, retry_after_seconds }`) não
// tem `ok` nem `reason`, e `FAIL_COPY[undefined].title` LANÇAVA: a página do
// convite quebrava inteira. Agora o 429 é um estado próprio, e qualquer corpo
// que não seja um dos conhecidos vira `server_error` (com "Tentar novamente").
// ============================================================

export interface PeekOk {
  ok: true;
  account_name: string;
  role: 'admin' | 'agent' | 'viewer';
  expires_at: string;
}

export const PEEK_FAIL_REASONS = [
  'not_found',
  'used',
  'expired',
  'rate_limited',
  'server_error',
] as const;

export type PeekFailReason = (typeof PEEK_FAIL_REASONS)[number];

export interface PeekFail {
  ok: false;
  reason: PeekFailReason;
}

export type PeekResult = PeekOk | PeekFail;

/** As falhas PASSAGEIRAS: a página oferece "Tentar novamente". */
export const RETRYABLE_PEEK_FAIL_REASONS: ReadonlySet<PeekFailReason> = new Set([
  'rate_limited',
  'server_error',
]);

function isPeekFailReason(value: unknown): value is PeekFailReason {
  return (
    typeof value === 'string' &&
    (PEEK_FAIL_REASONS as readonly string[]).includes(value)
  );
}

export function toPeekResult(status: number, body: unknown): PeekResult {
  if (status === 429) return { ok: false, reason: 'rate_limited' };
  if (typeof body === 'object' && body !== null) {
    const payload = body as Record<string, unknown>;
    if (payload.ok === true) return payload as unknown as PeekOk;
    if (payload.ok === false && isPeekFailReason(payload.reason)) {
      return { ok: false, reason: payload.reason };
    }
  }
  return { ok: false, reason: 'server_error' };
}
