/**
 * A transcrição como TEXTO — puro. As frases chegam uma a uma, com orador e
 * tempo; para ler, copiar e (um dia) buscar, o que serve é o texto corrido,
 * com as frases seguidas do mesmo orador juntas num parágrafo.
 */

import type { FraseDaTranscricao } from "./leitura";

export function textoDaTranscricao(frases: readonly FraseDaTranscricao[]): string {
  const paragrafos: string[] = [];
  let orador: string | null = null;
  let trecho: string[] = [];
  const fechar = () => {
    if (trecho.length === 0) return;
    const texto = trecho.join(" ");
    paragrafos.push(orador ? `${orador}: ${texto}` : texto);
    trecho = [];
  };
  for (const f of frases) {
    if (f.orador !== orador) {
      fechar();
      orador = f.orador;
    }
    trecho.push(f.texto);
  }
  fechar();
  return paragrafos.join("\n\n");
}

/** `1:02:03` ou `12:03` — para a coluna de tempo do visualizador. */
export function tempoMmSs(seg: number): string {
  const s = Math.max(0, Math.floor(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

/** `1h 12min`, `45min`, `< 1min`; `null` vira travessão. */
export function formatarDuracao(seg: number | null | undefined): string {
  if (seg === null || seg === undefined || !Number.isFinite(seg)) return "—";
  const min = Math.round(seg / 60);
  if (min < 1) return "< 1min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}
