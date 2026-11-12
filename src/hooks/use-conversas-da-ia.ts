"use client";

// ============================================================
// As conversas da IA para o filtro "IA" da caixa de entrada
// (`GET /api/cb/ia/conversas`): quem a IA atende agora e o que ela passou
// para a equipe.
//
// Lê SÓ com o filtro ligado (a régua roda no servidor sobre a conta inteira:
// ninguém paga por ela sem pedir) e relê a cada minuto com a aba visível — a
// IA entra e sai das conversas sem evento na tela. A pausa da linha, que
// chega pelo tempo real, decide na hora o que dá (`casaComAIa`).
//
// ⚠️ `conjuntos` nulo = "não sei" (primeira leitura no ar, ou falhou): o
// recorte é NEUTRALIZADO, nunca "nenhuma conversa". A releitura que falha
// MANTÉM a anterior. `respondeu` diz se a primeira leitura desta conta já
// voltou (boa ou não): a lista segura o spinner até lá.
// ============================================================

import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import type { ConversasDaIaNaTela } from "@/lib/inbox/filtros";

/** De quanto em quanto tempo a lista relê, com o filtro ligado e a aba visível. */
export const RECARGA_DAS_CONVERSAS_DA_IA_MS = 60_000;

/** O corpo da rota → os dois conjuntos; `null` se a forma não é a esperada. */
export function lerRespostaDasConversasDaIa(corpo: unknown): ConversasDaIaNaTela | null {
  if (!corpo || typeof corpo !== "object") return null;
  const { atendimento, pendencias } = corpo as { atendimento?: unknown; pendencias?: unknown };
  if (!Array.isArray(atendimento) || !Array.isArray(pendencias)) return null;
  const ids = (l: unknown[]) => new Set(l.filter((x): x is string => typeof x === "string"));
  return { atendimento: ids(atendimento), pendencias: ids(pendencias) };
}

export function useConversasDaIa(
  ativa: boolean,
  resyncToken: number = 0,
): { conjuntos: ConversasDaIaNaTela | null; respondeu: boolean } {
  const { accountId } = useAuth();
  const [versao, setVersao] = useState(0);
  // Carimbada com a CONTA: a leitura de outra conta não vale aqui.
  const [leitura, setLeitura] = useState<{ de: string; conjuntos: ConversasDaIaNaTela | null } | null>(null);

  // Desligar o filtro DESCARTA a leitura: religado horas depois, os conjuntos
  // velhos recortariam a lista com cara de atuais (sem spinner) até a nova
  // voltar. Na limpeza (o filtro saiu), nunca no corpo do efeito.
  useEffect(() => {
    if (!ativa) return;
    return () => setLeitura(null);
  }, [ativa]);

  useEffect(() => {
    if (!ativa) return;
    const tique = setInterval(() => {
      if (document.visibilityState === "visible") setVersao((v) => v + 1);
    }, RECARGA_DAS_CONVERSAS_DA_IA_MS);
    return () => clearInterval(tique);
  }, [ativa]);

  useEffect(() => {
    if (!ativa || !accountId) return;
    let cancelado = false;
    void (async () => {
      let lido: ConversasDaIaNaTela | null = null;
      try {
        const resposta = await fetch("/api/cb/ia/conversas", { cache: "no-store" });
        if (resposta.ok) lido = lerRespostaDasConversasDaIa(await resposta.json());
      } catch {
        lido = null;
      }
      if (cancelado) return;
      setLeitura((anterior) => {
        // A releitura que falha mantém a anterior DESTA conta.
        if (!lido && anterior?.de === accountId) return anterior;
        return { de: accountId, conjuntos: lido };
      });
    })();
    return () => {
      cancelado = true;
    };
  }, [ativa, accountId, versao, resyncToken]);

  const valida = leitura && leitura.de === accountId ? leitura : null;
  return { conjuntos: valida?.conjuntos ?? null, respondeu: valida !== null };
}
