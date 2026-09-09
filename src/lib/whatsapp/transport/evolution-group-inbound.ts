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

import { mediaBytesOf as bytesDeclarados } from './anexo-declarado';
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
  /**
   * O `@lid` de quem falou, quando houver — separado de `senderJid` porque
   * aquele PREFERE o telefone. É daqui que `aprenderNossoLid` descobre o
   * nosso próprio LID (916); na Baileys 6 o único campo era `participant`
   * (sempre LID), na 7 o LID pode vir em `participant` OU em
   * `participantAlt`, com o telefone no outro — ver `lidDoRemetente`.
   */
  senderLid: string | null;
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
 *
 * ⚠️ Na Baileys 6.7.19 esses campos nunca vêm, então na prática o remetente
 * gravado é o LID. Na Baileys 7 `participantAlt` traz o telefone e esta
 * preferência passa a valer de fato — mudando a forma de
 * `messages.group_sender_jid` nas linhas novas (hoje 100% LID). Se essa
 * mudança for indesejada, a decisão é a P2 de docs/PLANO-baileys-7.md; o
 * nosso LID já não depende daqui (ver `lidDoRemetente`).
 */
export function remetenteDoGrupo(key: EvolutionMessageKey | undefined): string | null {
  for (const alt of [key?.participantPn, key?.participantAlt]) {
    if (alt && !isLidJid(alt) && /\d/.test(alt)) return alt;
  }
  return key?.participant ?? null;
}

/**
 * O `@lid` de quem falou, se a chave trouxer um.
 *
 * Existe porque `remetenteDoGrupo` prefere o telefone, e o nosso LID (916) é
 * aprendido do `participant` da NOSSA mensagem no grupo: com a Baileys 7, que
 * entrega `participant` = LID e `participantAlt` = telefone (ou o inverso),
 * `remetenteDoGrupo` passaria a devolver o telefone e `aprenderNossoLid` —
 * que só aceita `@lid` — nunca mais aprenderia nada. Menção a nós ficaria
 * apagada em todo canal novo. Ver docs/PLANO-baileys-7.md, ajuste 2.
 */
export function lidDoRemetente(key: EvolutionMessageKey | undefined): string | null {
  for (const candidato of [key?.participant, key?.participantAlt, key?.participantPn]) {
    if (candidato && isLidJid(candidato)) return candidato;
  }
  return null;
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
 * Bytes declarados do anexo.
 *
 * ⚠️ MUDOU DE CASA em 2026-09-09 (`anexo-declarado.ts`): a mesma leitura
 * passou a valer para a conversa 1:1, e o caminho direto não pode importar
 * do módulo de GRUPO — é o vínculo que a bifurcação da 906 existe para
 * evitar. Re-exportado aqui para os call sites e o teste que já existiam.
 */
export { mediaBytesOf } from './anexo-declarado';

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
    senderLid: lidDoRemetente(item.key),
    senderName: item.pushName || null,
    providerMessageId: id,
    timestamp: ts,
    contentType: detectContentType(item.message),
    text: extractText(item.message),
    mentionedJids: extractMentionedJids(item),
    mediaBytes: bytesDeclarados(item),
  };
}
