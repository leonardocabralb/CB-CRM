"use client";

// ============================================================
// Quais conexões têm computador de ligações e se ele está pronto (4c): o
// botão "Ligar" do cabeçalho da conversa. UMA leitura por aba, guardada no
// módulo e renovada a cada minuto com a aba à vista (o sinal de vida da
// máquina também é por minuto), como a sonda de saúde das conexões.
//
// ⚠️ `null` = "não sei" (carregando, ou a leitura falhou e a última boa
// envelheceu): o botão some, nunca aparece desligado afirmando "fora do ar".
// ============================================================

import { useEffect, useSyncExternalStore } from "react";

import type { SituacaoDoComputador } from "@/lib/ligacoes/ao-vivo";

/** Renovar só depois disto (a rajada de montagem do fio vira uma leitura). */
const VALIDADE_MS = 30_000;
const INTERVALO_MS = 60_000;
/** A leitura boa vale até 3 min depois da última (o "fora" da máquina). */
const VELHA_MS = 3 * 60_000;

const SITUACOES: readonly SituacaoDoComputador[] = ["pronto", "fora", "sem_whatsapp"];

let estado: { porCanal: ReadonlyMap<string, SituacaoDoComputador> | null; em: number } = {
  porCanal: null,
  em: 0,
};
let emVoo: Promise<void> | null = null;
const ouvintes = new Set<() => void>();

function lerResposta(corpo: unknown): Map<string, SituacaoDoComputador> | null {
  const lista = (corpo as { computadores?: unknown } | null)?.computadores;
  if (!Array.isArray(lista)) return null;
  const mapa = new Map<string, SituacaoDoComputador>();
  for (const item of lista) {
    const c = item as { channel_id?: unknown; situacao?: unknown } | null;
    const situacao = SITUACOES.find((s) => s === c?.situacao);
    if (typeof c?.channel_id === "string" && situacao) mapa.set(c.channel_id, situacao);
  }
  return mapa;
}

function buscar(): Promise<void> {
  if (emVoo) return emVoo;
  emVoo = (async () => {
    try {
      const r = await fetch("/api/cb/ligacoes/computadores", { cache: "no-store" });
      const mapa = r.ok ? lerResposta(await r.json()) : null;
      if (!mapa) throw new Error(`computadores: ${r.status}`);
      estado = { porCanal: mapa, em: Date.now() };
    } catch {
      if (Date.now() - estado.em > VELHA_MS) estado = { porCanal: null, em: estado.em };
    } finally {
      emVoo = null;
      ouvintes.forEach((ouvinte) => ouvinte());
    }
  })();
  return emVoo;
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}
const ler = () => estado.porCanal;
const lerNoServidor = () => null;

/** `ativo` falso (quem não liga) não pergunta nada e recebe `null`. */
export function useComputadoresDeLigacao(
  ativo: boolean,
): ReadonlyMap<string, SituacaoDoComputador> | null {
  const porCanal = useSyncExternalStore(assinar, ler, lerNoServidor);
  useEffect(() => {
    if (!ativo) return;
    const talvez = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - estado.em >= VALIDADE_MS) void buscar();
    };
    talvez();
    const laco = window.setInterval(talvez, INTERVALO_MS);
    document.addEventListener("visibilitychange", talvez);
    return () => {
      window.clearInterval(laco);
      document.removeEventListener("visibilitychange", talvez);
    };
  }, [ativo]);
  return ativo ? porCanal : null;
}
