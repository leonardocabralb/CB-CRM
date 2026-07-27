// ============================================================
// Administração de instâncias Evolution para MÚLTIPLOS canais.
//
// Reaproveita a base do Gabriel: um servidor Evolution só para todo o
// CRM (EVOLUTION_BASE_URL + EVOLUTION_GLOBAL_API_KEY, do ambiente), e
// `provisionEvolutionInstance` que já aceita um nome de instância
// customizado. Um canal Evolution ADICIONAL é só uma instância nova no
// mesmo servidor — o operador não digita URL nem chave, só um rótulo.
//
// O webhook é o mesmo endpoint global do Gabriel
// (`/api/whatsapp/evolution/webhook`, autenticado por
// EVOLUTION_WEBHOOK_SECRET); todas as instâncias apontam para ele e a
// ingestão roteia por `instance_name`. Por isso não há segredo de
// webhook por canal.
// ============================================================

import crypto from 'crypto';

import {
  EvolutionClient,
} from '@/lib/whatsapp/transport/evolution-client';
import {
  evolutionGlobalConfig,
  provisionEvolutionInstance,
  WEBHOOK_EVENTS,
  type ProvisionResult,
  type WebhookConfig,
} from '@/lib/whatsapp/transport/evolution-provision';
import {
  motivoParaRecusar,
  segredoDoHeader,
  type WebhookRegistrado,
} from './webhook-url';

/**
 * Nome de instância para um canal ADICIONAL. O sufixo aleatório evita
 * colidir com o canal padrão da conta (`cbcrm-<accountId>`, criado pelo
 * fluxo single-channel do Gabriel) e com outros canais da mesma conta.
 */
export function buildChannelInstanceName(accountId: string): string {
  const suffix = crypto.randomBytes(3).toString('hex');
  return `cbcrm-${accountId}-${suffix}`;
}

/**
 * Monta a config do webhook global. `requestOrigin` é o fallback de dev
 * quando NEXT_PUBLIC_SITE_URL não está setado.
 */
export function evolutionWebhookConfig(requestOrigin?: string): WebhookConfig {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('EVOLUTION_WEBHOOK_SECRET não está configurado no servidor.');
  }
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || requestOrigin;
  if (!origin) {
    throw new Error('NEXT_PUBLIC_SITE_URL não está configurado no servidor.');
  }
  return { url: `${origin}/api/whatsapp/evolution/webhook`, secret };
}

/** Cria (ou adota) a instância de um canal e devolve estado + QR. */
export function provisionChannelInstance(args: {
  accountId: string;
  instanceName: string;
  webhook: WebhookConfig;
}): Promise<ProvisionResult> {
  return provisionEvolutionInstance(args);
}

function normalizeState(raw?: string): 'open' | 'connecting' | 'close' {
  return raw === 'open' || raw === 'connecting' ? raw : 'close';
}

/** `5511999999999@s.whatsapp.net` → `5511999999999`. */
function phoneFromJid(jid: unknown): string | undefined {
  if (typeof jid !== 'string') return undefined;
  const digits = jid.split('@')[0]?.split(':')[0];
  return digits && /^\d+$/.test(digits) ? digits : undefined;
}

interface RawInstance {
  name?: string;
  instanceName?: string;
  ownerJid?: string;
  instance?: { instanceName?: string };
}

/**
 * Estado da conexão de uma instância + (quando conectada) o número
 * pareado, para gravar em `cb_channels.display_phone`. Quando ainda não
 * conectou, devolve o QR atual.
 */
export async function channelConnectionState(instanceName: string): Promise<{
  state: 'open' | 'connecting' | 'close';
  qrBase64?: string;
  ownerPhone?: string;
}> {
  const { baseUrl, apikey } = evolutionGlobalConfig();
  const client = new EvolutionClient({ baseUrl, apikey, instance: instanceName });

  const stateRes = await client.connectionState();
  const state = normalizeState(stateRes.instance?.state ?? stateRes.state);

  if (state === 'open') {
    let ownerPhone: string | undefined;
    try {
      const list = (await client.fetchInstances()) as RawInstance[];
      const row = Array.isArray(list)
        ? list.find(
            (it) =>
              (it?.name ?? it?.instanceName ?? it?.instance?.instanceName) ===
              instanceName,
          )
        : undefined;
      ownerPhone = phoneFromJid(row?.ownerJid);
    } catch {
      // Melhor-esforço: o número também chega pelo CONNECTION_UPDATE do
      // webhook (Fase 3); não bloquear a conexão por causa dele.
    }
    return { state, ownerPhone };
  }

  // Ainda pareando — devolve o QR vigente.
  const conn = await client.connect();
  return { state, qrBase64: conn.base64 };
}

/**
 * Remove a instância no servidor (logout + delete). Erros são engolidos:
 * o chamador usa isto ao apagar o canal do banco, e uma instância órfã
 * no servidor é bem menos ruim que um canal impossível de excluir.
 */
export async function deleteChannelInstance(instanceName: string): Promise<void> {
  const { baseUrl, apikey } = evolutionGlobalConfig();
  const client = new EvolutionClient({ baseUrl, apikey, instance: instanceName });
  try {
    await client.logout();
  } catch {
    /* já desconectada */
  }
  try {
    await client.deleteInstance();
  } catch (err) {
    console.warn(
      '[cb-channels] falha ao remover instância no servidor (canal removido localmente):',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Reaplica o webhook (URL + eventos + segredo) numa instância que já existe.
 *
 * A Evolution guarda a lista de eventos no momento do registro, então
 * assinar um evento novo no código não alcança quem já está conectado. Sem
 * esta reparação, `MESSAGES_DELETE` e `MESSAGES_EDITED` nunca chegariam ao
 * canal em produção — a exclusão feita pelo cliente ficaria invisível para
 * sempre, que foi exatamente o sintoma relatado.
 */
export async function reaplicarWebhook(
  instanceName: string,
  requestOrigin?: string,
): Promise<void> {
  const webhook = evolutionWebhookConfig(requestOrigin);
  const { baseUrl, apikey } = evolutionGlobalConfig();
  const client = new EvolutionClient({ baseUrl, apikey, instance: instanceName });

  // GUARDA: não quebrar um webhook que funciona. Rodamos o CRM local contra
  // a MESMA conta de produção — de propósito, para desenvolver com o número
  // e as conversas reais —, e nesse arranjo uma reaplicação disparada do
  // localhost apontaria o webhook do número do escritório para a máquina do
  // desenvolvedor, ou trocaria o segredo que a produção espera. Nos dois
  // casos a Evolution aceita, responde 200, e o número para de receber
  // mensagem sem erro em lugar nenhum. Ver `webhook-url.ts`.
  //
  // Falha de leitura aqui NÃO bloqueia: instância nova não tem webhook, e a
  // reaplicação é o caminho de conserto — travá-la por um GET que não
  // respondeu seria pior que o risco que ela evita.
  let atual: WebhookRegistrado | null = null;
  let leituraFalhou = false;
  try {
    const bruto = (await client.findWebhook()) as Record<string, unknown> | null;
    const w = ((bruto?.webhook as Record<string, unknown>) ?? bruto ?? {}) as {
      url?: string;
      headers?: Record<string, string>;
    };
    atual = {
      url: w.url ?? null,
      secret: segredoDoHeader(w.headers?.Authorization ?? w.headers?.authorization),
    };
  } catch (err) {
    // "Não consegui saber" ≠ "não há webhook". A distinção existe porque o
    // GET tem teto de 15s e o laço do QR consulta a cada 5s: engolir o erro
    // como "instância limpa" desarmava a guarda justamente no clique que ela
    // deveria cobrir. O aviso é distinto de propósito — se um upgrade da
    // Evolution mover este endpoint, a guarda ficaria desarmada para sempre
    // e sem nenhum sinal.
    leituraFalhou = true;
    console.warn(
      '[cb-channels] não foi possível ler o webhook atual; guarda em modo cauteloso:',
      err instanceof Error ? err.message : err,
    );
  }
  const recusa = motivoParaRecusar(
    atual,
    { url: webhook.url, secret: webhook.secret },
    { origemDoPedido: requestOrigin, leituraFalhou },
  );
  if (recusa) throw new Error(recusa);

  await client.setWebhook({
    url: webhook.url,
    events: WEBHOOK_EVENTS,
    headers: { Authorization: `Bearer ${webhook.secret}` },
  });
}
