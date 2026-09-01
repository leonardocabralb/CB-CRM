"use client";

// ============================================================
// O que está RODANDO para o contato: robô ativo + esperas de automação.
//
// Duas fontes com naturezas diferentes, de propósito:
//
//   `flow_runs`   — lido DIRETO sob RLS (a 010 deu SELECT e realtime
//                   exatamente para "o inbox mostrar em qual robô o contato
//                   está"). Mudou no banco → o assinante recarrega.
//   esperas       — via GET /api/cb/execucoes, porque a tabela
//                   `automation_pending_executions` é service-role only
//                   (sem policy de SELECT, sem realtime). Recarrega ao
//                   trocar de contato, após cada ação da aba e quando o
//                   dialog "Executar automação" avisa pelo evento global.
//
// ⚠️ Estado velho de efeito passivo (mordeu 2× em 2026-08-30): em vez de
// "limpar" no efeito, o resultado é CARIMBADO com o contactId de origem e
// comparado contra o prop do render atual — dado de outro contato nunca é
// devolvido, nem na janela entre a troca e o fetch. É a forma que o
// CLAUDE.md registra, e a que o lint do React Compiler aceita (nada de
// setState síncrono em efeito).
// ============================================================

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { EsperaAgrupada } from "@/lib/execucoes/agrupar";
import type { LinhaDoTempo } from "@/lib/execucoes/linha-do-tempo";

/** Grupo de esperas + a linha do tempo que o GET monta para a expansão. */
export type GrupoDeEsperas = EsperaAgrupada & { linha?: LinhaDoTempo };

/**
 * Evento global disparado por quem MUDA o conjunto de execuções de fora da
 * aba (o dialog "Executar automação" vive no fio, em outra árvore). O hook
 * escuta e recarrega — mais barato e mais honesto que fiar um callback
 * através de page → thread → composer.
 */
export const EVENTO_EXECUCOES = "cb:execucoes-mudaram";

/** Avisa todos os `useExecucoesDoContato` montados para recarregarem. */
export function avisarExecucoesMudaram() {
  window.dispatchEvent(new Event(EVENTO_EXECUCOES));
}

export interface RoboAtivo {
  runId: string;
  /** Nome do flow; null se o embed não veio (flow apagado no meio). */
  nome: string | null;
  iniciadoEm: string;
}

interface Resultado {
  robos: RoboAtivo[];
  esperas: GrupoDeEsperas[];
  /** true depois que AS DUAS consultas do contato atual aterrissaram. */
  carregou: boolean;
  /** true quando alguma das duas falhou — a aba avisa em vez de dizer "nada". */
  erro: boolean;
  recarregar: () => void;
}

/** Foto das execuções, carimbada com o contato que a produziu. */
interface Dados {
  contactId: string;
  robos: RoboAtivo[];
  esperas: GrupoDeEsperas[];
  erro: boolean;
}

interface LinhaDeRun {
  id: string;
  started_at: string;
  flows: { name: string | null } | { name: string | null }[] | null;
}

function mapearRun(linha: LinhaDeRun): RoboAtivo {
  const embed = Array.isArray(linha.flows) ? linha.flows[0] : linha.flows;
  return {
    runId: linha.id,
    nome: embed?.name ?? null,
    iniciadoEm: linha.started_at,
  };
}

// Identidades estáveis para o estado "ainda não carregou" — sem elas, cada
// render de contato-sem-dados devolveria arrays novos e re-renderizaria a aba.
const SEM_ROBOS: RoboAtivo[] = [];
const SEM_ESPERAS: GrupoDeEsperas[] = [];

export function useExecucoesDoContato(contactId: string | null): Resultado {
  const [dados, setDados] = useState<Dados | null>(null);
  const [nonce, setNonce] = useState(0);

  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const aoMudar = () => recarregar();
    window.addEventListener(EVENTO_EXECUCOES, aoMudar);
    return () => window.removeEventListener(EVENTO_EXECUCOES, aoMudar);
  }, [recarregar]);

  // ⚠️ A assinatura vive num efeito PRÓPRIO, com deps só de `contactId` —
  // UMA por contato, como o irmão `useQuemVeAConversa` ([accountId]). Com
  // `nonce` nas deps (a forma anterior, achado #27 do plano 31/08), TODO
  // evento de flow_runs derrubava o canal e criava outro: o re-join a cada
  // evento é exatamente a janela de perda que o comentário daqui dizia ter
  // fechado. Declarado ANTES do efeito do snapshot de propósito: os efeitos
  // rodam na ordem de declaração, então na primeira passada o canal arma
  // antes de o fetch sair — evento durante o fetch vira nonce++ e um
  // refetch logo atrás, com o MESMO canal de pé.
  useEffect(() => {
    if (!contactId) return;
    const supabase = createClient();
    const canal = supabase
      .channel(`execucoes:${contactId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "flow_runs",
          filter: `contact_id=eq.${contactId}`,
        },
        () => setNonce((n) => n + 1),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [contactId]);

  useEffect(() => {
    if (!contactId) return;

    const supabase = createClient();
    let cancelado = false;

    void (async () => {
      const [runsRes, esperasRes] = await Promise.all([
        supabase
          .from("flow_runs")
          .select("id, started_at, flows(name)")
          .eq("contact_id", contactId)
          .eq("status", "active")
          .order("started_at", { ascending: false }),
        fetch(`/api/cb/execucoes?contactId=${contactId}`, {
          cache: "no-store",
        }).catch(() => null),
      ]);
      if (cancelado) return;

      let falhou = false;
      let robos: RoboAtivo[] = SEM_ROBOS;
      let esperas: GrupoDeEsperas[] = SEM_ESPERAS;

      if (runsRes.error) {
        console.error("[execucoes] flow_runs:", runsRes.error.message);
        falhou = true;
      } else {
        robos = ((runsRes.data ?? []) as unknown as LinhaDeRun[]).map(mapearRun);
      }

      if (esperasRes?.ok) {
        const json = (await esperasRes.json().catch(() => null)) as {
          grupos?: GrupoDeEsperas[];
        } | null;
        if (cancelado) return;
        // ⚠️ 200 com corpo que não parseia (página de erro de proxy,
        // resposta truncada) NÃO é "nada em execução" — sem o `falhou`, a
        // aba afirmava vazio com cara de resposta certa sobre esperas que
        // podem existir. A rota sempre devolve `{ grupos: [...] }`; qualquer
        // outra forma é anomalia e vira o aviso da aba.
        if (json && Array.isArray(json.grupos)) {
          esperas = json.grupos;
        } else {
          falhou = true;
        }
      } else {
        falhou = true;
      }

      setDados({ contactId, robos, esperas, erro: falhou });
    })();

    return () => {
      cancelado = true;
    };
  }, [contactId, nonce]);

  // O carimbo decide: dado de OUTRO contato (resposta atrasada, troca
  // recém-feita) é tratado como "ainda não carregou", nunca exibido.
  const atual = dados !== null && dados.contactId === contactId ? dados : null;

  return {
    robos: atual?.robos ?? SEM_ROBOS,
    esperas: atual?.esperas ?? SEM_ESPERAS,
    carregou: atual !== null,
    erro: atual?.erro ?? false,
    recarregar,
  };
}
