// ============================================================
// Transport factory — the single place the rest of the app asks for a
// WhatsApp sender. Keyed on the `provider` discriminator that will be
// added to whatsapp_config (migration 037), so Meta and Evolution
// accounts can coexist during rollout and the eventual production Meta
// cutover is a config change, not a code change.
//
// Only the Evolution path is wired today. The Meta path stays in
// meta-api.ts and will be adapted into a `MetaTransport` implementing
// this same interface when the production Meta secret arrives — at which
// point `getTransport` gains its `case 'meta'`.
// ============================================================

import { EvolutionClient } from './evolution-client';
import { EvolutionTransport } from './evolution-transport';
import type { WhatsAppTransport } from './types';

/** Connection parameters for the Evolution backend (from whatsapp_config). */
export interface EvolutionConnection {
  provider: 'evolution';
  /** Evolution server origin, e.g. `https://evo.example.com`. */
  baseUrl: string;
  /** Instance name (the `{instance}` path segment). */
  instance: string;
  /** DECRYPTED instance apikey (callers decrypt whatsapp_config.api_key first). */
  apikey: string;
}

/** Placeholder for the Meta backend, wired when the Meta cutover lands. */
export interface MetaConnection {
  provider: 'meta';
  phoneNumberId: string;
  /** DECRYPTED access token. */
  accessToken: string;
}

export type TransportConnection = EvolutionConnection | MetaConnection;

/**
 * Resolve a `WhatsAppTransport` for the given connection. Throws for a
 * provider that isn't wired yet rather than silently doing nothing.
 */
export function getTransport(conn: TransportConnection): WhatsAppTransport {
  switch (conn.provider) {
    case 'evolution':
      return new EvolutionTransport(
        new EvolutionClient({
          baseUrl: conn.baseUrl,
          apikey: conn.apikey,
          instance: conn.instance,
        })
      );
    case 'meta':
      throw new Error(
        'Meta transport not yet wired — arriving with the production Meta cutover. Use provider="evolution" for now.'
      );
    default: {
      const _exhaustive: never = conn;
      throw new Error(
        `Unknown transport provider: ${JSON.stringify(_exhaustive)}`
      );
    }
  }
}

export { EvolutionClient } from './evolution-client';
export { EvolutionTransport, toEvolutionNumber } from './evolution-transport';
export type {
  ConnectionState,
  InboundMedia,
  MediaKind,
  ProviderMessageRef,
  SendResult,
  WhatsAppTransport,
} from './types';
