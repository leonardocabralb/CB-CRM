// ============================================================
// Evolution instance provisioning.
//
// One Evolution server backs the whole CRM (EVOLUTION_BASE_URL +
// EVOLUTION_GLOBAL_API_KEY). Each account gets its own Baileys instance
// named `cbcrm-<accountId>`, so inbound webhooks route cleanly by the
// payload's `instance` field and one WhatsApp number maps to one account.
//
// Provisioning is idempotent: it adopts an existing instance or creates a
// fresh one, (re)applies the webhook, and reports the connection state
// plus a QR to pair when the number isn't linked yet. The global key is
// used for all management calls; the per-instance key it returns is what
// the outbound transport uses later (stored encrypted on whatsapp_config).
// ============================================================

import { EvolutionClient } from './evolution-client';

/** Events the CRM needs: inbound messages, delivery/read acks, connection + QR. */
const WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
  // Apagar e editar. ⚠️ Acrescentar aqui só vale para instância NOVA — a
  // Evolution guarda a lista no momento em que o webhook é registrado.
  // Instância já existente continua sem receber estes eventos até o webhook
  // ser reaplicado (o que `provisionEvolutionInstance` faz sempre que roda,
  // inclusive na reconexão). Sem essa reaplicação, a mensagem que o cliente
  // apagar continua aparecendo intacta no CRM, como se nada tivesse
  // acontecido — foi exatamente o sintoma relatado.
  'MESSAGES_DELETE',
  'MESSAGES_EDITED',
];

export function evolutionGlobalConfig(): { baseUrl: string; apikey: string } {
  const baseUrl = process.env.EVOLUTION_BASE_URL;
  const apikey = process.env.EVOLUTION_GLOBAL_API_KEY;
  if (!baseUrl || !apikey) {
    throw new Error(
      'Evolution is not configured — set EVOLUTION_BASE_URL and EVOLUTION_GLOBAL_API_KEY.'
    );
  }
  return { baseUrl, apikey };
}

/** Deterministic per-account instance name (also the inbound-routing key). */
export function instanceNameForAccount(accountId: string): string {
  return `cbcrm-${accountId}`;
}

export interface WebhookConfig {
  url: string;
  secret: string;
}

export interface ProvisionResult {
  baseUrl: string;
  instanceName: string;
  /** Per-instance apikey (the `hash`/`token`) — store encrypted. */
  instanceApiKey: string;
  state: 'open' | 'connecting' | 'close';
  /** data-URI PNG QR to render for pairing, when not yet connected. */
  qrBase64?: string;
  pairingCode?: string;
}

/** A raw instance row from GET /instance/fetchInstances. */
interface RawInstance {
  name?: string;
  instanceName?: string;
  token?: string;
  hash?: string;
  connectionStatus?: string;
  instance?: { instanceName?: string; state?: string };
}

function normalizeState(raw?: string): 'open' | 'connecting' | 'close' {
  return raw === 'open' || raw === 'connecting' ? raw : 'close';
}

/**
 * Create-or-adopt the account's instance, wire its webhook, and return the
 * current connection state (+ QR if pairing is still needed).
 */
export async function provisionEvolutionInstance(args: {
  accountId: string;
  webhook: WebhookConfig;
  /**
   * Adopt this exact instance instead of deriving `cbcrm-<accountId>`.
   * Used when a connection already exists (e.g. an instance paired
   * directly in the Evolution manager) so re-provisioning doesn't spawn
   * a duplicate.
   */
  instanceName?: string;
}): Promise<ProvisionResult> {
  const { baseUrl, apikey: globalKey } = evolutionGlobalConfig();
  const instanceName = args.instanceName ?? instanceNameForAccount(args.accountId);

  // The global key can drive any instance's endpoints, so one client
  // (global key + this instance's path) handles every management call.
  const client = new EvolutionClient({
    baseUrl,
    apikey: globalKey,
    instance: instanceName,
  });

  const webhook = {
    url: args.webhook.url,
    events: WEBHOOK_EVENTS,
    headers: { Authorization: `Bearer ${args.webhook.secret}` },
  };

  // 1. Adopt if it already exists, else create.
  const list = (await client.fetchInstances()) as RawInstance[];
  const found = Array.isArray(list)
    ? list.find(
        (it) => (it?.name ?? it?.instanceName ?? it?.instance?.instanceName) === instanceName
      )
    : undefined;

  let instanceApiKey: string;
  let qrBase64: string | undefined;
  let pairingCode: string | undefined;

  if (found) {
    instanceApiKey = found.token ?? found.hash ?? globalKey;
  } else {
    const created = await client.createInstance({
      instanceName,
      qrcode: true,
      webhook,
    });
    instanceApiKey = created.hash ?? globalKey;
    qrBase64 = created.qrcode?.base64;
    pairingCode = created.qrcode?.pairingCode;
  }

  // 2. (Re)apply the webhook — idempotent, and repairs an existing
  //    instance whose webhook was never set or points elsewhere.
  await client.setWebhook(webhook);

  // 3. Connection state, fetching a fresh QR when still unpaired.
  const stateRes = await client.connectionState();
  const state = normalizeState(stateRes.instance?.state ?? stateRes.state);

  if (state !== 'open' && !qrBase64) {
    const conn = await client.connect();
    qrBase64 = conn.base64;
    pairingCode = conn.pairingCode;
  }

  return { baseUrl, instanceName, instanceApiKey, state, qrBase64, pairingCode };
}

/** Poll just the connection state (+ a QR if still pairing). */
export async function evolutionConnectionState(
  instanceName: string
): Promise<{ state: 'open' | 'connecting' | 'close'; qrBase64?: string }> {
  const { baseUrl, apikey } = evolutionGlobalConfig();
  const client = new EvolutionClient({ baseUrl, apikey, instance: instanceName });

  const stateRes = await client.connectionState();
  const state = normalizeState(stateRes.instance?.state ?? stateRes.state);
  if (state === 'open') return { state };

  const conn = await client.connect();
  return { state, qrBase64: conn.base64 };
}
