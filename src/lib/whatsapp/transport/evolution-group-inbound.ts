// ============================================================
// Evolution `messages.upsert` de GRUPO → NormalizedGroupInbound.
//
// Módulo separado do `evolution-inbound.ts` de propósito. O `normalizeUpsert`
// de lá continua BARRANDO `@g.us` (via `isNonChatJid`) e isso está certo: ele
// produz uma conversa de contato, e grupo não é contato. Quem decide o caminho
// é o webhook, antes de chamar qualquer um dos dois.
//
// A diferença que mais importa está no tratamento do `@lid` — ver
// `remetenteDoGrupo` abaixo. A regra do 1:1 ("sem telefone de verdade, não se
// grava") NÃO vale aqui, e aplicá-la por hábito jogaria fora mensagem real.
// ============================================================

import {
  detectContentType,
  extractText,
  isLidJid,
  unwrapMessage,
  type EvolutionMessageKey,
  type EvolutionUpsert,
} from './evolution-inbound';
import type { NormalizedInbound } from '@/lib/whatsapp/inbound-store';

/** O JID é de um grupo de WhatsApp? */
export function isGroupJid(jid: string | undefined | null): boolean {
  return !!jid && jid.endsWith('@g.us');
}

export interface NormalizedGroupInbound {
  accountId: string;
  configOwnerUserId: string;
  channelId: string | null;
  /** Saiu DESTA conta de WhatsApp (eco do CRM ou digitada no celular). */
  fromMe: boolean;
  /** `120363…@g.us` — a identidade da conversa. */
  groupJid: string;
  /**
   * Quem falou. Pode ser `@lid` (identificador interno) ou `@s.whatsapp.net`
   * (telefone). Guardado como veio, sem tentar converter — ver
   * `remetenteDoGrupo`.
   */
  senderJid: string | null;
  /** `pushName` do participante. É o que a bolha mostra. */
  senderName: string | null;
  providerMessageId: string;
  timestamp: number;
  contentType: NormalizedInbound['contentType'];
  text: string | null;
  /** JIDs marcados na mensagem, como vieram (normalmente `@lid`). */
  mentionedJids: string[];
  /**
   * Tamanho do anexo em bytes, quando o payload declara. `null` quando não
   * há anexo ou o campo não veio — e aí o chamador TENTA baixar, porque
   * perder anexo é pior que gastar banda (ver a regra dos 5 MB no webhook).
   */
  mediaBytes: number | null;
}

/**
 * Quem falou, e por que aqui a gente NÃO descarta o `@lid`.
 *
 * No 1:1, `phoneJidFromKey` devolve `null` quando só existe LID e a mensagem
 * é jogada fora. Aquela regra protege uma coisa específica: o contato é
 * procurado por telefone, então um LID viraria um CONTATO NOVO e partiria a
 * conversa do cliente em duas.
 *
 * Em grupo nada disso acontece — o remetente é gravado desnormalizado em
 * `messages.group_sender_*`, sem FK, sem criar contato, sem nada para partir.
 * Aplicar a regra do 1:1 aqui descartaria mensagem de gente real em troca de
 * proteção nenhuma. Em produção os participantes chegam TODOS como `@lid`
 * (conferido na sondagem), então a regra do 1:1 esvaziaria o grupo inteiro.
 *
 * Preferimos o telefone quando a Baileys o oferece (`participantPn` /
 * `participantAlt`), porque um dia ele permite ligar o participante a um
 * contato existente. Sem ele, o LID serve como identidade opaca e estável.
 */
export function remetenteDoGrupo(key: EvolutionMessageKey | undefined): string | null {
  for (const alt of [key?.participantPn, key?.participantAlt]) {
    if (alt && !isLidJid(alt) && /\d/.test(alt)) return alt;
  }
  return key?.participant ?? null;
}

/**
 * JIDs marcados na mensagem.
 *
 * ⚠️ O `contextInfo` aparece em DOIS lugares e a sondagem em produção
 * encontrou o caso real na RAIZ da mensagem, não dentro do
 * `extendedTextMessage` que a documentação sugere. Ler só um dos dois faz o
 * destaque de menção simplesmente nunca acender.
 */
export function extractMentionedJids(item: EvolutionUpsert): string[] {
  const corpo = unwrapMessage(item.message) ?? {};
  const candidatos = [
    (corpo as Record<string, { contextInfo?: { mentionedJid?: unknown } }>)
      .extendedTextMessage?.contextInfo,
    (item as { contextInfo?: { mentionedJid?: unknown } }).contextInfo,
  ];
  for (const ctx of candidatos) {
    const men = ctx?.mentionedJid;
    if (Array.isArray(men)) {
      return men.filter((x): x is string => typeof x === 'string' && x.length > 0);
    }
  }
  return [];
}

/**
 * Bytes declarados do anexo. Vem como STRING no payload da Evolution
 * (conferido na sondagem), então `Number()` é obrigatório — comparar a string
 * com o teto daria resultado errado sem erro nenhum.
 */
export function mediaBytesOf(item: EvolutionUpsert): number | null {
  const corpo = unwrapMessage(item.message);
  if (!corpo) return null;
  for (const chave of ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage']) {
    const m = corpo[chave] as { fileLength?: unknown } | undefined;
    if (!m) continue;
    const n = Number(m.fileLength);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/**
 * Normaliza um item de `messages.upsert` que veio de um GRUPO.
 *
 * Devolve `null` só para o que não dá para gravar: sem JID de grupo, sem id,
 * ou reação (que é estado, não mensagem — mesma decisão do 1:1).
 */
export function normalizeGroupUpsert(
  item: EvolutionUpsert,
  accountId: string,
  configOwnerUserId: string,
  channelId: string | null = null,
): NormalizedGroupInbound | null {
  const groupJid = item.key?.remoteJid;
  const id = item.key?.id;
  if (!groupJid || !id || !isGroupJid(groupJid)) return null;
  if (unwrapMessage(item.message)?.reactionMessage) return null;

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
    fromMe: item.key?.fromMe === true,
    groupJid,
    senderJid: remetenteDoGrupo(item.key),
    senderName: item.pushName || null,
    providerMessageId: id,
    timestamp: ts,
    contentType: detectContentType(item.message),
    text: extractText(item.message),
    mentionedJids: extractMentionedJids(item),
    mediaBytes: mediaBytesOf(item),
  };
}
