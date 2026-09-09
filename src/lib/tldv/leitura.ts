/**
 * Leitura dos payloads do tl;dv — puro. Cada função aceita `unknown` e
 * devolve a nossa forma ou `null`: o que vem da API (e do webhook, que
 * "usa o mesmo formato da API") nunca é confiado sem conferir.
 *
 * Formas, pela doc (`https://doc.tldv.io`, `v1alpha1`):
 * - reunião: `{ id, name, happenedAt, url, duration (s), organizer {name,
 *   email}, invitees [{name, email}], template, extraProperties }`
 * - transcrição: `{ id, meetingId, data: [{ speaker, text, startTime,
 *   endTime }] }` (tempos em segundos)
 * - notas: `{ structuredNotes[], markdownContent, topics: [{ id, order,
 *   title, summary }] }`
 * - webhook: `{ id, event: 'MeetingReady' | 'TranscriptReady', data,
 *   executedAt }`, onde `data` é a reunião (MeetingReady) ou a transcrição
 *   (TranscriptReady, com `meetingId`).
 */

export interface PessoaDoTldv {
  nome: string;
  email: string;
}

export interface ReuniaoDoTldv {
  id: string;
  nome: string;
  /** ISO 8601, como veio. */
  realizadaEm: string;
  url: string | null;
  duracaoSeg: number | null;
  organizador: PessoaDoTldv | null;
  convidados: PessoaDoTldv[];
}

export interface FraseDaTranscricao {
  orador: string;
  texto: string;
  inicioSeg: number;
  fimSeg: number;
}

export interface NotasDoTldv {
  markdown: string | null;
  topicos: { titulo: string; resumo: string }[];
}

/** O id de reunião do tl;dv: 24 hexadecimais (o padrão que a própria doc declara). */
export const ID_DE_REUNIAO = /^[0-9a-f]{24}$/i;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function pessoa(v: unknown): PessoaDoTldv | null {
  if (!ehObjeto(v)) return null;
  const email = texto(v.email);
  const nome = texto(v.name);
  if (!email && !nome) return null;
  return { nome: nome ?? "", email: (email ?? "").toLowerCase() };
}

export function lerReuniao(v: unknown): ReuniaoDoTldv | null {
  if (!ehObjeto(v)) return null;
  const id = texto(v.id);
  const nome = texto(v.name);
  const realizadaEm = texto(v.happenedAt);
  if (!id || !realizadaEm || Number.isNaN(Date.parse(realizadaEm))) return null;
  const convidados: PessoaDoTldv[] = [];
  if (Array.isArray(v.invitees)) {
    for (const c of v.invitees) {
      const p = pessoa(c);
      if (p) convidados.push(p);
    }
  }
  return {
    id,
    nome: nome ?? "(sem nome)",
    realizadaEm: new Date(realizadaEm).toISOString(),
    url: texto(v.url),
    duracaoSeg: typeof v.duration === "number" && Number.isFinite(v.duration) && v.duration >= 0 ? Math.round(v.duration) : null,
    organizador: pessoa(v.organizer),
    convidados,
  };
}

/** `null` = a resposta não tem a forma esperada (não confunda com "vazia"). */
export function lerTranscricao(v: unknown): FraseDaTranscricao[] | null {
  if (!ehObjeto(v) || !Array.isArray(v.data)) return null;
  const frases: FraseDaTranscricao[] = [];
  for (const f of v.data) {
    if (!ehObjeto(f)) continue;
    const t = typeof f.text === "string" ? f.text.trim() : "";
    if (!t) continue;
    frases.push({
      orador: texto(f.speaker) ?? "",
      texto: t,
      inicioSeg: typeof f.startTime === "number" && Number.isFinite(f.startTime) ? f.startTime : 0,
      fimSeg: typeof f.endTime === "number" && Number.isFinite(f.endTime) ? f.endTime : 0,
    });
  }
  return frases;
}

export function lerNotas(v: unknown): NotasDoTldv | null {
  if (!ehObjeto(v)) return null;
  const markdown = texto(v.markdownContent);
  const topicos: { titulo: string; resumo: string }[] = [];
  if (Array.isArray(v.topics)) {
    for (const t of v.topics) {
      if (!ehObjeto(t)) continue;
      const titulo = texto(t.title);
      if (!titulo) continue;
      topicos.push({ titulo, resumo: texto(t.summary) ?? "" });
    }
  }
  if (!markdown && topicos.length === 0) return null;
  return { markdown, topicos };
}

/**
 * O id de reunião num link colado pelo operador — `https://tldv.io/app/
 * meetings/<id>`, `https://app.tldv.io/meetings/<id>?…` — ou o id cru.
 * Qualquer outra coisa é `null`: a rota nunca manda ao tl;dv o que não tem
 * a forma de um id.
 */
export function idDaReuniaoDoLink(entrada: string): string | null {
  const limpo = entrada.trim();
  if (ID_DE_REUNIAO.test(limpo)) return limpo.toLowerCase();
  const m = /\/meetings\/([0-9a-f]{24})(?:[/?#]|$)/i.exec(limpo);
  return m ? m[1].toLowerCase() : null;
}

export type EventoDoWebhook = "MeetingReady" | "TranscriptReady";

/**
 * O que o webhook do tl;dv trouxe: o evento e o id da reunião. Só isso é
 * usado — a reunião é buscada na API com a nossa chave (ver a 987: o tl;dv
 * não assina a entrega, então o corpo é aviso, não fonte).
 */
export function lerAvisoDoWebhook(v: unknown): { evento: EventoDoWebhook; meetingId: string } | null {
  if (!ehObjeto(v) || !ehObjeto(v.data)) return null;
  const evento = v.event;
  if (evento !== "MeetingReady" && evento !== "TranscriptReady") return null;
  const bruto = evento === "TranscriptReady" ? (texto(v.data.meetingId) ?? texto(v.data.id)) : texto(v.data.id);
  if (!bruto || !ID_DE_REUNIAO.test(bruto)) return null;
  return { evento, meetingId: bruto.toLowerCase() };
}
