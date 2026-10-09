"use client";

import { useCallback, useEffect, useState } from "react";

import { lerResumoDeReunioes, type ReuniaoDoResumo } from "@/lib/reunioes/resumo";

/**
 * As reuniões que o Desempenho do funil conta (Fase 4 de
 * `docs/PLANO-reagendamento.md`), pela rota `/api/cb/reunioes/resumo` (só
 * admin): uma linha por reunião que já começou, sem dado do cliente. A conta
 * por funil e período é de `src/lib/funil/comparecimento.ts`.
 *
 * `janela` nula = não busca nada (o funil não mede comparecimento). `de` e
 * `ate` nulos = sem limite daquele lado ("Total").
 *
 * ⚠️ O resultado é CARIMBADO com a chave do pedido, e `carregando` é DERIVADO
 * do carimbo (nunca `setState` síncrono no efeito — o React Compiler recusa):
 * ao trocar de período, o primeiro render já tem a janela nova e as reuniões
 * da velha — sem o carimbo, os números do período anterior apareceriam sob o
 * período novo até a resposta chegar (a armadilha do efeito passivo). Resposta
 * atrasada de chave velha é descartada.
 *
 * ⚠️ A VERSÃO entra na chave: `recarregar` PISCA o carregando de propósito
 * (diferente da pauta, que recarrega em silêncio). O Desempenho AFIRMA números
 * — comparecimento, no-show —, e afirmar sobre número velho é pior que piscar
 * (`.claude/rules/ao-voltar.md`, "Funil (Lista, Desempenho, Saúde)").
 *
 * `null` em `linhas` é "não sei", nunca "nenhuma reunião".
 */
export interface ReunioesDoDesempenho {
  linhas: ReuniaoDoResumo[] | null;
  carregando: boolean;
  falhou: boolean;
  recarregar: () => void;
}

export function useReunioesDoDesempenho(
  janela: { de: string | null; ate: string | null } | null,
): ReunioesDoDesempenho {
  const [versao, setVersao] = useState(0);
  const [lido, setLido] = useState<{ chave: string; linhas: ReuniaoDoResumo[] | null } | null>(null);

  const ativa = janela !== null;
  const de = janela?.de ?? null;
  const ate = janela?.ate ?? null;
  const chave = `${de ?? ""}|${ate ?? ""}|${versao}`;

  useEffect(() => {
    if (!ativa) return;
    let vivo = true;
    (async () => {
      let linhas: ReuniaoDoResumo[] | null = null;
      try {
        const qs = new URLSearchParams();
        if (de) qs.set("de", de);
        if (ate) qs.set("ate", ate);
        const busca = qs.toString();
        const res = await fetch(`/api/cb/reunioes/resumo${busca ? `?${busca}` : ""}`, { cache: "no-store" });
        if (res.ok) linhas = lerResumoDeReunioes(await res.json());
      } catch {
        linhas = null;
      }
      if (vivo) setLido({ chave, linhas });
    })();
    return () => {
      vivo = false;
    };
  }, [ativa, chave, de, ate]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  if (!ativa) return { linhas: null, carregando: false, falhou: false, recarregar };
  const doPedido = lido?.chave === chave ? lido : null;
  return {
    linhas: doPedido?.linhas ?? null,
    carregando: doPedido === null,
    falhou: doPedido !== null && doPedido.linhas === null,
    recarregar,
  };
}
