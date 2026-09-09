/**
 * Validação da transcrição colada à mão (origem `manual`) — puro. Espelha
 * os CHECKs da 987 (título 1..200) e põe teto no que o banco não limita:
 * uma reunião de três horas dá ~250 KB de texto; 500 KB é folga, e acima
 * disso é colagem errada (um PDF inteiro), não transcrição.
 */

export const MAX_TITULO = 200;
export const MAX_TEXTO = 500_000;
export const MAX_URL = 2_000;
export const MAX_DURACAO_SEG = 24 * 60 * 60;

export interface TranscricaoManual {
  contact_id: string;
  titulo: string;
  realizada_em: string;
  texto: string;
  duracao_seg: number | null;
  url: string | null;
}

export type ErroDaTranscricaoManual = "contato" | "titulo" | "data" | "texto" | "duracao" | "url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Devolve os dados limpos, ou o PRIMEIRO campo errado. */
export function validarTranscricaoManual(corpo: unknown): { ok: true; dados: TranscricaoManual } | { ok: false; erro: ErroDaTranscricaoManual } {
  const c = (typeof corpo === "object" && corpo !== null ? corpo : {}) as Record<string, unknown>;
  const contactId = typeof c.contact_id === "string" && UUID.test(c.contact_id) ? c.contact_id : null;
  if (!contactId) return { ok: false, erro: "contato" };
  const titulo = typeof c.titulo === "string" ? c.titulo.trim() : "";
  if (titulo.length < 1 || titulo.length > MAX_TITULO) return { ok: false, erro: "titulo" };
  const realizadaEm = typeof c.realizada_em === "string" ? c.realizada_em.trim() : "";
  if (!realizadaEm || Number.isNaN(Date.parse(realizadaEm))) return { ok: false, erro: "data" };
  const texto = typeof c.texto === "string" ? c.texto.replace(/\r\n/g, "\n").trim() : "";
  if (texto.length < 1 || texto.length > MAX_TEXTO) return { ok: false, erro: "texto" };
  let duracao: number | null = null;
  if (c.duracao_seg !== undefined && c.duracao_seg !== null && c.duracao_seg !== "") {
    const n = typeof c.duracao_seg === "number" ? c.duracao_seg : Number(c.duracao_seg);
    if (!Number.isFinite(n) || n < 0 || n > MAX_DURACAO_SEG) return { ok: false, erro: "duracao" };
    duracao = Math.round(n);
  }
  let url: string | null = null;
  if (typeof c.url === "string" && c.url.trim() !== "") {
    const u = c.url.trim();
    if (u.length > MAX_URL || !/^https?:\/\//i.test(u)) return { ok: false, erro: "url" };
    url = u;
  }
  return {
    ok: true,
    dados: { contact_id: contactId, titulo, realizada_em: new Date(realizadaEm).toISOString(), texto, duracao_seg: duracao, url },
  };
}
