// ============================================================
// Evolution `messages.upsert` → NormalizedInbound.
//
// Baileys delivers a flat `{ key, pushName, message, messageTimestamp }`
// shape (very different from Meta's entry[].changes[].value envelope).
// Text arrives as `message.conversation` or
// `message.extendedTextMessage.text`; media as a typed sub-object whose
// `caption` (when present) is the text. Group chats (`@g.us`) and our own
// echoes (`key.fromMe`) are dropped — a 1:1 CRM inbox doesn't want them.
// ============================================================

import type { NormalizedInbound } from '@/lib/whatsapp/inbound-store';

export interface EvolutionMessageKey {
  remoteJid?: string;
  fromMe?: boolean;
  id?: string;
  participant?: string;
  /**
   * Contrapartida em TELEFONE do `remoteJid` quando ele vem como `@lid`.
   * O WhatsApp está migrando o endereçamento para LID e a Baileys expõe o
   * número real num destes campos — os nomes variam entre versões, por isso
   * todos são aceitos.
   */
  remoteJidAlt?: string;
  senderPn?: string;
  participantPn?: string;
  participantAlt?: string;
  /**
   * O endereço que `remoteJid` tinha ANTES de a Evolution reescrevê-lo de
   * `@lid` para telefone. Serve para AGIR sobre a mensagem (revogar, editar):
   * do lado do WhatsApp a conversa continua endereçada por LID, e a
   * revogação mandada para o telefone não acha nada. Ver migration 917.
   */
  previousRemoteJid?: string;
}

export interface EvolutionUpsert {
  key?: EvolutionMessageKey;
  pushName?: string;
  message?: Record<string, unknown> | null;
  messageType?: string;
  messageTimestamp?: number | string;
}

/**
 * Sufixos de JID que NÃO são conversa 1:1. Antes só `@g.us` era barrado, e
 * como `phoneFromJid` devolve os dígitos de qualquer JID, um canal do
 * WhatsApp (`@newsletter`) ou uma atualização de status (`@broadcast`)
 * entrava no inbox como se fosse um cliente novo, com telefone inventado.
 *
 * ⚠️ `@lid` NÃO está aqui de propósito. Desde a v2 o WhatsApp usa esse
 * formato no lugar do telefone em conversas legítimas — barrá-lo perderia
 * mensagem de cliente de verdade. O efeito colateral conhecido é que o
 * contato nasce com o LID no campo `phone`, que não é discável. O canal em
 * produção hoje recebe `@s.whatsapp.net` com telefone real, então isso é
 * risco latente, não ativo; resolver exige mapear LID → telefone, que a
 * Evolution só expõe em alguns payloads.
 */
const SUFIXOS_NAO_CONVERSA = ['@g.us', '@newsletter', '@broadcast'];

export function isNonChatJid(jid: string): boolean {
  return SUFIXOS_NAO_CONVERSA.some((sufixo) => jid.endsWith(sufixo));
}

/** Reduce a chat JID to digits-only phone (drops @suffix and device part). */
export function phoneFromJid(jid: string): string {
  return jid
    .replace(/@s\.whatsapp\.net$|@lid$|@g\.us$/, '')
    .replace(/:.*/, '')
    .replace(/\D/g, '');
}

export function isLidJid(jid: string): boolean {
  return jid.endsWith('@lid');
}

/**
 * JID de TELEFONE da conversa. Devolve `null` quando só existe o LID.
 *
 * ⚠️ Esta função existe por causa de um bug que chegou a produção: o
 * WhatsApp está migrando o endereçamento para LID (`71176265142382@lid`),
 * um identificador interno que NÃO é telefone. Em produção o eco das
 * mensagens que o operador mandava do celular chegava com LID enquanto as
 * mensagens recebidas do MESMO cliente chegavam com o telefone — e como o
 * contato é procurado por telefone, o LID virava um contato novo. Resultado:
 * a conversa se partia em duas, uma com o que o cliente escreveu e outra,
 * com nome de número sem sentido, com o que o advogado respondeu.
 *
 * A regra: sem telefone de verdade, NÃO se inventa contato. Descartar é
 * ruim (a mensagem do celular não aparece), mas partir a conversa de um
 * cliente ao meio e criar um contato falso na base é pior — e some no
 * meio dos contatos reais.
 */
export function phoneJidFromKey(key: EvolutionMessageKey | undefined): string | null {
  const principal = key?.remoteJid;
  if (principal && !isLidJid(principal)) return principal;

  // A Baileys mudou o nome deste campo entre versões; aceitar todos evita
  // que um upgrade do servidor Evolution volte a partir as conversas.
  for (const alt of [key?.remoteJidAlt, key?.senderPn, key?.participantPn, key?.participantAlt]) {
    if (alt && !isLidJid(alt) && /\d/.test(alt)) return alt;
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

/**
 * Invólucros que escondem a mensagem real uma camada mais fundo. Foto "ver
 * uma vez" chega como `viewOnceMessageV2.message.imageMessage`, e mensagem
 * de conversa com autodestruição, como `ephemeralMessage.message.…`. Sem
 * descer por eles, `detectContentType` via `text` e o anexo era ignorado —
 * o cliente mandava a foto do documento e no inbox não aparecia nada.
 */
const INVOLUCROS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
] as const;

/**
 * Desce pelos invólucros até a mensagem de verdade. O limite de profundidade
 * existe porque o payload vem de fora: sem ele, um `ephemeralMessage` que
 * aponte para si mesmo (acidente ou má-fé) prenderia o laço para sempre.
 */
export function unwrapMessage(
  message?: Record<string, unknown> | null
): Record<string, unknown> | null {
  let atual = message ?? null;
  for (let i = 0; i < 5 && atual; i++) {
    const involucro = INVOLUCROS.find((k) => asRecord(atual![k]));
    if (!involucro) return atual;
    const dentro = asRecord(asRecord(atual[involucro])!.message);
    if (!dentro) return atual;
    atual = dentro;
  }
  return atual;
}

export function extractText(message?: Record<string, unknown> | null): string | null {
  const m0 = unwrapMessage(message);
  if (!m0) return null;
  if (typeof m0.conversation === 'string') return m0.conversation;
  const ext = asRecord(m0.extendedTextMessage);
  if (ext && typeof ext.text === 'string') return ext.text;
  for (const key of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const m = asRecord(m0[key]);
    if (m && typeof m.caption === 'string' && m.caption) return m.caption;
  }
  return null;
}

export function detectContentType(
  message?: Record<string, unknown> | null
): NormalizedInbound['contentType'] {
  const m = unwrapMessage(message);
  if (!m) return 'text';
  if (m.imageMessage || m.stickerMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return 'audio';
  if (m.documentMessage) return 'document';
  if (m.locationMessage) return 'location';
  return 'text';
}

/**
 * Reação (`👍` numa mensagem) não é mensagem. Hoje ela cairia como texto de
 * conteúdo nulo: bolha vazia no histórico, e — pior — disparando automações,
 * flows e resposta de IA como se o cliente tivesse escrito algo.
 *
 * Descartar é o comportamento correto até a reação ser modelada de verdade
 * (guardada e exibida na bolha da mensagem reagida, como no WhatsApp).
 */
export function isReaction(message?: Record<string, unknown> | null): boolean {
  return !!asRecord(unwrapMessage(message)?.reactionMessage);
}

/**
 * Normalize one upsert item. Returns null for messages the inbox should
 * ignore (group chats, our own echoes, or missing key/id). `channelId` é o
 * `cb_channels.id` por onde a mensagem entrou (Fase 3), propagado para o
 * carimbo — NULL no fallback de transição.
 */
export function normalizeUpsert(
  item: EvolutionUpsert,
  accountId: string,
  configOwnerUserId: string,
  channelId: string | null = null
): NormalizedInbound | null {
  const bruto = item.key?.remoteJid;
  const id = item.key?.id;
  if (!bruto || !id) return null;
  if (isNonChatJid(bruto)) return null; // grupo, canal, status: não é 1:1
  if (isReaction(item.message)) return null; // reação não é mensagem (ver isReaction)

  // Endereço de TELEFONE da conversa. Um `@lid` sem contrapartida devolve
  // null e a mensagem é descartada — ver `phoneJidFromKey` para o porquê:
  // gravá-la criaria um contato falso e partiria a conversa do cliente.
  const jid = phoneJidFromKey(item.key);
  if (!jid) return null;

  const phone = phoneFromJid(jid);
  if (!phone) return null;

  const ts =
    typeof item.messageTimestamp === 'number'
      ? item.messageTimestamp
      : typeof item.messageTimestamp === 'string'
        ? parseInt(item.messageTimestamp, 10) || Math.floor(Date.now() / 1000)
        : Math.floor(Date.now() / 1000);

  return {
    accountId,
    configOwnerUserId,
    channelId,
    // `fromMe` significa "saiu desta conta de WhatsApp" — o que engloba
    // DUAS origens que o chamador precisa separar: o eco do que o próprio
    // CRM enviou (já gravado, descartar) e o que o operador digitou no
    // celular pareado (tem de aparecer). Só o `message_id` distingue,
    // e isso exige ir ao banco — por isso a decisão não é tomada aqui.
    fromMe: item.key?.fromMe === true,
    phone,
    name: item.pushName || phone,
    providerMessageId: id,
    remoteJid: jid,
    // O endereço ORIGINAL, antes de a Evolution reescrever `@lid` → telefone.
    // Sem ele não dá para revogar nem editar mensagem de conversa migrada: a
    // revogação sairia para a conversa "telefone" e a mensagem vive na
    // "@lid". Só grava quando é de fato um LID — em conversa não migrada o
    // campo nem vem. Ver migration 917.
    remoteJidLid: isLidJid(item.key?.previousRemoteJid ?? '')
      ? (item.key?.previousRemoteJid ?? null)
      : null,
    timestamp: ts,
    contentType: detectContentType(item.message),
    text: extractText(item.message),
    // Preenchido pelo webhook, que tem as credenciais para chamar
    // chat/getBase64FromMediaMessage — ver evolution-media.ts.
    mediaUrl: null,
  };
}

/** Uma exclusão anunciada pelo webhook `messages.delete`. */
export interface ExclusaoRecebida {
  /** Id da mensagem NO WHATSAPP — o que casa com `messages.message_id`. */
  providerMessageId: string;
  /** A mensagem apagada era nossa (`true`) ou do contato (`false`). */
  fromMe: boolean;
}

/**
 * Lê o `data` de um `messages.delete` da Evolution.
 *
 * ⚠️ A Evolution emite este evento em DUAS formas, e ler só uma delas é o
 * defeito que deixou a exclusão passar em branco:
 *
 *   1. Exclusão feita no CELULAR (ou em outro cliente do WhatsApp) — a chave
 *      vem achatada: `{ id, remoteJid, fromMe }`. Aqui `id` É o id do
 *      WhatsApp.
 *   2. Exclusão feita pela API DELA — isto é, pelo nosso botão de apagar — a
 *      chave vem aninhada em `key`, e o `id` de fora é o identificador
 *      INTERNO do banco da Evolution, que não casa com nada nosso. Usar o
 *      `id` de fora nessa forma faz o UPDATE acertar zero linhas em silêncio.
 *
 * Por isso `key.id` tem precedência sobre qualquer id de primeiro nível.
 *
 * Devolve lista porque o campo `data` também chega como array em lote; um
 * `data` que não contenha id nenhum vira lista vazia, nunca exceção.
 */
export function parseDeleteEvent(data: unknown): ExclusaoRecebida[] {
  const itens = Array.isArray(data) ? data : [data];
  const saida: ExclusaoRecebida[] = [];
  for (const bruto of itens) {
    if (!bruto || typeof bruto !== 'object') continue;
    const d = bruto as {
      id?: unknown;
      keyId?: unknown;
      fromMe?: unknown;
      key?: { id?: unknown; fromMe?: unknown } | null;
    };
    const candidato = d.key?.id ?? d.keyId ?? d.id;
    if (typeof candidato !== 'string' || !candidato) continue;
    const fromMe = d.key?.fromMe ?? d.fromMe;
    saida.push({ providerMessageId: candidato, fromMe: fromMe === true });
  }
  return saida;
}
