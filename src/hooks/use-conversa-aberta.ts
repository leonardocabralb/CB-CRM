"use client";

// ============================================================
// Presença por conversa (956) — as duas metades.
//
//   useMarcarConversaAberta  — ESCRITOR. Mora na página do inbox (dona da
//     conversa selecionada): marca a troca na hora e rebate a cada
//     HEARTBEAT_MS. As RPCs saem por uma FILA serializada — troca rápida de
//     conversa dispararia rpc(null)/rpc(novo) em paralelo, e a ordem de
//     chegada decidiria o estado final; com a fila, quem decide é a ordem
//     dos cliques. "Saí do inbox" é best-effort no desmonte + staleness de
//     75s no leitor (aba fechada não escreve nada — filosofia da 024).
//
//   useQuemVeAConversa       — LEITOR. Snapshot da conta + realtime
//     (espelho do use-presence: assina PRIMEIRO, snapshot funde depois,
//     ticker local re-deriva staleness). Devolve os user_ids dos OUTROS
//     membros com a MESMA conversa aberta agora.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { HEARTBEAT_MS } from "@/lib/presence";
import {
  quemVeAConversa,
  type ConversaAbertaRow,
} from "@/lib/presenca-na-conversa";

// Mesmo tique do usePresence: a saída (staleness) não gera evento de banco,
// só o relógio local a percebe.
const RE_DERIVE_MS = 15_000;

/**
 * Mantém `cb_conversa_aberta` espelhando a conversa selecionada. Passe
 * `null` quando nenhuma estiver aberta. Idempotente e barato — duplo mount
 * do StrictMode só re-executa o mesmo upsert.
 */
export function useMarcarConversaAberta(conversationId: string | null): void {
  // Fila de RPCs: garante que a ÚLTIMA intenção do operador é a última a
  // escrever, mesmo com respostas fora de ordem na rede.
  const filaRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const supabase = createClient();
    const marcar = (id: string | null) => {
      filaRef.current = filaRef.current
        .then(() =>
          supabase.rpc("cb_marcar_conversa_aberta", {
            p_conversation_id: id,
          }),
        )
        .then(({ error }) => {
          if (error) {
            console.error("[conversa-aberta] marcar falhou:", error.message);
          }
        })
        // Nunca deixa a fila rejeitada — a batida seguinte reencadeia.
        .catch(() => undefined);
    };

    marcar(conversationId);
    const batida = setInterval(() => marcar(conversationId), HEARTBEAT_MS);

    return () => {
      clearInterval(batida);
      // Best-effort: navegar para fora do inbox limpa a marcação na hora.
      // Na troca de conversa o efeito seguinte re-marca logo atrás (a fila
      // preserva a ordem); se a aba fechar sem rodar isto, o staleness de
      // 75s do leitor resolve.
      marcar(null);
    };
  }, [conversationId]);
}

/**
 * Quem MAIS está com esta conversa aberta agora (user_ids, ordem estável).
 * O chamador resolve nome/foto — o fio já carrega os profiles da conta.
 */
export function useQuemVeAConversa(conversationId: string | null): string[] {
  const { accountId, user } = useAuth();
  const [rows, setRows] = useState<Map<string, ConversaAbertaRow>>(
    () => new Map(),
  );
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (!accountId) return;

    const supabase = createClient();
    let cancelado = false;

    const aplicar = (row: ConversaAbertaRow) => {
      setRows((prev) => {
        const next = new Map(prev);
        next.set(row.user_id, row);
        return next;
      });
    };

    // Assina PRIMEIRO, snapshot depois — evento que chega durante o fetch
    // não pode ser atropelado por uma linha mais velha do snapshot.
    const canal: RealtimeChannel = supabase
      .channel(`conversa-aberta:${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cb_conversa_aberta",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { user_id?: string };
            if (!old.user_id) return;
            setRows((prev) => {
              if (!prev.has(old.user_id!)) return prev;
              const next = new Map(prev);
              next.delete(old.user_id!);
              return next;
            });
            return;
          }
          aplicar(payload.new as ConversaAbertaRow);
        },
      )
      .subscribe();

    supabase
      .from("cb_conversa_aberta")
      .select("user_id, conversation_id, visto_em")
      .eq("account_id", accountId)
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) {
          console.error("[conversa-aberta] snapshot falhou:", error.message);
          return;
        }
        setRows((prev) => {
          const next = new Map(prev);
          for (const r of (data ?? []) as ConversaAbertaRow[]) {
            const existente = next.get(r.user_id);
            // Evento vivo que chegou primeiro vence snapshot mais velho.
            if (
              !existente ||
              new Date(r.visto_em) >= new Date(existente.visto_em)
            ) {
              next.set(r.user_id, r);
            }
          }
          return next;
        });
      });

    const tique = setInterval(() => setAgora(Date.now()), RE_DERIVE_MS);

    return () => {
      cancelado = true;
      clearInterval(tique);
      supabase.removeChannel(canal);
    };
  }, [accountId]);

  return useMemo(
    () =>
      quemVeAConversa([...rows.values()], conversationId, user?.id, agora),
    [rows, conversationId, user?.id, agora],
  );
}
