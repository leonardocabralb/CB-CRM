// ============================================================
// O payload do webhook do Instagram → eventos TIPADOS. Puro: nada de I/O.
//
// A forma (referência da Meta + o que a Fase 0 MEDIU, 09/09/2026):
//
//   { object: "instagram",
//     entry: [{ id: "<IG user id da CONTA>", time,
//               messaging: [{ sender: {id}, recipient: {id}, timestamp,
//                             message?:      { mid, text?, attachments?, is_echo?,
//                                              is_deleted?, is_unsupported?,
//                                              reply_to?, quick_reply? },
//                             message_edit?: { mid, text, num_edit },
//                             reaction?:     { mid, action, reaction?, emoji? },
//                             postback?:     { mid, title, payload },
//                             read?:         { mid },
//                             referral?:     { ref, source, type } }] }] }
//
// O que morde quem for consumir isto (tudo medido, nada suposto):
//
// · `entry.id` é a CONTA que recebeu (17 dígitos) — é por ele que a rota
//   acha o canal (`cb_channels.ig_user_id`, único global). `sender.id` é o
//   IGSID do cliente (16 dígitos): nunca vai para `contacts.phone`.
// · Cada DM chega acompanhada de um `message_edit` com `num_edit: 0` —
//   mensagem NÃO editada. Consumido como edição, toda DM viraria duas
//   linhas. Só `num_edit >= 1` é edição de verdade.
// · Nota de voz chega como `attachments[{type: "audio", payload: {url}}]`,
//   SEM mime nem nome, numa URL assinada do CDN que EXPIRA (`cache-control:
//   no-store`). E o CDN entrega `content-type: video/mp4` — classificar
//   pelo content-type faria a voz virar VÍDEO no fio. A classe vem do
//   `type` do webhook; o mime é derivado dele (`midiaDoAnexo`).
// · O eco (`is_echo`) é a mensagem que a PRÓPRIA conta mandou (pelo app do
//   Instagram ou por nós): nele o cliente é o `recipient`, não o `sender`.
//   `clienteDe()` resolve isso para a persistência não inverter a conversa.
// ============================================================

export type TipoDeAnexo =
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'share'
  | 'story_mention'
  | 'reel'
  | 'ig_reel'
  | 'outro';

export interface AnexoDoInstagram {
  tipo: TipoDeAnexo;
  /** A URL assinada do CDN — expira; baixar NA HORA. `null` em anexo sem URL. */
  url: string | null;
  /** O tipo cru, para o log quando cai em `outro`. */
  tipoCru: string;
}

export type RespostaA =
  { mid: string } | { story: { id: string | null; url: string | null } };

interface Base {
  /** `entry.id` — a conta do Instagram que recebeu o evento. */
  igUserId: string;
  remetente: string;
  destinatario: string;
  timestampMs: number | null;
}

export type EventoDoInstagram =
  | (Base & {
      tipo: 'mensagem';
      mid: string;
      texto: string | null;
      anexos: AnexoDoInstagram[];
      /** Mandada pela PRÓPRIA conta (app do Instagram, ou nós). */
      ehEco: boolean;
      apagada: boolean;
      naoSuportada: boolean;
      respostaA: RespostaA | null;
      quickReply: string | null;
    })
  | (Base & {
      tipo: 'edicao';
      mid: string;
      texto: string | null;
      numEdit: number;
    })
  | (Base & {
      tipo: 'reacao';
      mid: string;
      acao: 'react' | 'unreact';
      emoji: string | null;
      reacao: string | null;
    })
  | (Base & {
      tipo: 'postback';
      mid: string | null;
      titulo: string | null;
      payload: string | null;
    })
  | (Base & { tipo: 'lida'; mid: string | null })
  | (Base & {
      tipo: 'referral';
      ref: string | null;
      source: string | null;
      kind: string | null;
    })
  | (Base & { tipo: 'ignorado'; motivo: string });

export interface ResultadoDoWebhook {
  /** `false` quando o corpo não é um webhook do Instagram (ou não é JSON válido). */
  ehInstagram: boolean;
  eventos: EventoDoInstagram[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null;

const TIPOS_DE_ANEXO: readonly TipoDeAnexo[] = [
  'image',
  'video',
  'audio',
  'file',
  'share',
  'story_mention',
  'reel',
  'ig_reel',
];

function anexo(v: unknown): AnexoDoInstagram | null {
  const a = obj(v);
  if (!a) return null;
  const tipoCru = str(a.type) ?? '';
  const tipo = (TIPOS_DE_ANEXO as readonly string[]).includes(tipoCru)
    ? (tipoCru as TipoDeAnexo)
    : 'outro';
  return { tipo, url: str(obj(a.payload)?.url), tipoCru };
}

function respostaA(v: unknown): RespostaA | null {
  const r = obj(v);
  if (!r) return null;
  const mid = str(r.mid);
  if (mid) return { mid };
  const story = obj(r.story);
  if (story) return { story: { id: str(story.id), url: str(story.url) } };
  return null;
}

function eventoDe(igUserId: string, ev: Obj): EventoDoInstagram | null {
  const remetente = str(obj(ev.sender)?.id);
  const destinatario = str(obj(ev.recipient)?.id);
  if (!remetente || !destinatario) return null;
  const ts = ev.timestamp;
  const base: Base = {
    igUserId,
    remetente,
    destinatario,
    timestampMs: typeof ts === 'number' && Number.isFinite(ts) ? ts : null,
  };

  const msg = obj(ev.message);
  if (msg) {
    const mid = str(msg.mid);
    if (!mid) return { ...base, tipo: 'ignorado', motivo: 'mensagem sem mid' };
    return {
      ...base,
      tipo: 'mensagem',
      mid,
      texto: typeof msg.text === 'string' ? msg.text : null,
      anexos: arr(msg.attachments)
        .map(anexo)
        .filter((a): a is AnexoDoInstagram => a !== null),
      ehEco: msg.is_echo === true,
      apagada: msg.is_deleted === true,
      naoSuportada: msg.is_unsupported === true,
      respostaA: respostaA(msg.reply_to),
      quickReply: str(obj(msg.quick_reply)?.payload),
    };
  }

  const edicao = obj(ev.message_edit);
  if (edicao) {
    const mid = str(edicao.mid);
    const numEdit = typeof edicao.num_edit === 'number' ? edicao.num_edit : 0;
    if (!mid) return { ...base, tipo: 'ignorado', motivo: 'edição sem mid' };
    // MEDIDO: toda DM vem com um message_edit de num_edit 0. Não é edição.
    if (numEdit < 1) {
      return {
        ...base,
        tipo: 'ignorado',
        motivo: 'message_edit com num_edit 0',
      };
    }
    return {
      ...base,
      tipo: 'edicao',
      mid,
      texto: typeof edicao.text === 'string' ? edicao.text : null,
      numEdit,
    };
  }

  const reacao = obj(ev.reaction);
  if (reacao) {
    const mid = str(reacao.mid);
    const acao = reacao.action === 'unreact' ? 'unreact' : 'react';
    if (!mid) return { ...base, tipo: 'ignorado', motivo: 'reação sem mid' };
    return {
      ...base,
      tipo: 'reacao',
      mid,
      acao,
      emoji: str(reacao.emoji),
      reacao: str(reacao.reaction),
    };
  }

  const postback = obj(ev.postback);
  if (postback) {
    return {
      ...base,
      tipo: 'postback',
      mid: str(postback.mid),
      titulo: str(postback.title),
      payload: str(postback.payload),
    };
  }

  const lida = obj(ev.read);
  if (lida) return { ...base, tipo: 'lida', mid: str(lida.mid) };

  const referral = obj(ev.referral);
  if (referral) {
    return {
      ...base,
      tipo: 'referral',
      ref: str(referral.ref),
      source: str(referral.source),
      kind: str(referral.type),
    };
  }

  return {
    ...base,
    tipo: 'ignorado',
    motivo: `evento sem forma conhecida (chaves: ${Object.keys(ev).join(', ')})`,
  };
}

/**
 * Interpreta o corpo já parseado. Nunca lança: forma desconhecida vira
 * evento `ignorado` com o motivo, para a rota registrar e responder 200 —
 * 4xx repetido faz a Meta desativar a assinatura (a lição do Calendly).
 */
export function interpretarWebhook(payload: unknown): ResultadoDoWebhook {
  const p = obj(payload);
  if (!p || p.object !== 'instagram')
    return { ehInstagram: false, eventos: [] };

  const eventos: EventoDoInstagram[] = [];
  for (const e of arr(p.entry)) {
    const entry = obj(e);
    const igUserId = entry ? str(entry.id) : null;
    if (!entry || !igUserId) continue;
    for (const m of arr(entry.messaging)) {
      const ev = obj(m);
      if (!ev) continue;
      const evento = eventoDe(igUserId, ev);
      if (evento) eventos.push(evento);
    }
  }
  return { ehInstagram: true, eventos };
}

/** O IGSID do CLIENTE num evento: no eco, é o destinatário. */
export function clienteDe(ev: Base & { ehEco?: boolean }): string {
  return ev.ehEco ? ev.destinatario : ev.remetente;
}

export type ClasseDeMidia = 'image' | 'video' | 'audio' | 'document';

/**
 * Classe e mime de um anexo, decididos pelo `type` do WEBHOOK — nunca pelo
 * content-type do CDN, que entrega a nota de voz como `video/mp4`
 * (medido). `null` para o que não é arquivo (share, story_mention, reel) e
 * para anexo sem URL.
 */
export function midiaDoAnexo(
  a: AnexoDoInstagram
): { classe: ClasseDeMidia; mime: string } | null {
  if (!a.url) return null;
  switch (a.tipo) {
    case 'image':
      return { classe: 'image', mime: 'image/jpeg' };
    case 'video':
      return { classe: 'video', mime: 'video/mp4' };
    case 'audio':
      // Container MP4 com AAC (`audioclip-<epoch>.mp4` no content-disposition).
      return { classe: 'audio', mime: 'audio/mp4' };
    case 'file':
      return { classe: 'document', mime: 'application/pdf' };
    default:
      return null;
  }
}
