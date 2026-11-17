// ============================================================
// Webhook endpoint store helpers — secret generation + the public
// (secret-free) serialization used by the management API.
//
// The signing secret is stored AES-256-GCM-encrypted at rest (see
// migration 028) and returned in plaintext exactly once, at creation.
// ============================================================

import { randomBytes } from 'node:crypto';

/** Secret prefix — self-identifying, like `wacrm_live_` for keys. */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';

/**
 * Columns safe to return over the API — everything except the
 * (encrypted) `secret`, which is only ever surfaced once at creation.
 */
export const WEBHOOK_PUBLIC_COLUMNS =
  'id, url, events, is_active, last_delivery_at, failure_count, created_at';

export interface ApiWebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  last_delivery_at: string | null;
  failure_count: number;
  created_at: string;
}

/** Generate a fresh signing secret (full-entropy, URL/header-safe). */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** Project a `WEBHOOK_PUBLIC_COLUMNS` row into the API shape. */
export function serializeWebhookEndpoint(
  row: Record<string, unknown>
): ApiWebhookEndpoint {
  return {
    id: row.id as string,
    url: row.url as string,
    events: (row.events as string[] | null) ?? [],
    is_active: Boolean(row.is_active),
    last_delivery_at: (row.last_delivery_at as string | null) ?? null,
    failure_count: (row.failure_count as number | null) ?? 0,
    created_at: row.created_at as string,
  };
}

// `motivo` é NOSSO: a rota de sessão (`/api/cb/webhooks-de-saida`) devolve
// esse código, e a tela escolhe a frase por ele; a v1 devolve a `message`
// (inglês, contrato da API). O original só tem `message`.
export type WebhookUrlCheck =
  | { ok: true; url: string }
  | {
      ok: false;
      message: string;
      motivo: 'url_invalida' | 'url_com_credencial';
    };

/**
 * Validate a webhook target URL: must be a well-formed absolute
 * `https://` URL (an unencrypted `http://` sink would leak signed
 * event payloads).
 *
 * ⚠️ Porte do #681: usuário e senha na URL são recusados no CADASTRO. O
 * `fetch` do Node recusa URL com credencial, então toda entrega falhava, o
 * endpoint se desligava sozinho depois das 15 falhas — e a senha aparecia na
 * listagem. Quem prova ao destino que o aviso veio do CRM é o segredo de
 * assinatura.
 */
export function checkWebhookUrl(input: unknown): WebhookUrlCheck {
  const invalid: WebhookUrlCheck = {
    ok: false,
    message: "'url' must be a valid https:// URL",
    motivo: 'url_invalida',
  };
  if (typeof input !== 'string') return invalid;
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return invalid;
  }
  if (u.protocol !== 'https:') return invalid;
  if (u.username || u.password) {
    return {
      ok: false,
      message:
        "'url' must not contain a username or password; authenticate deliveries with the signing secret instead",
      motivo: 'url_com_credencial',
    };
  }
  return { ok: true, url: u.toString() };
}
