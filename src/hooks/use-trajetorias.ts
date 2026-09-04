"use client";

import { useCallback, useEffect, useState } from "react";

import { carregarTrajetorias } from "@/lib/funil/carregar";
import type { Intervalo } from "@/lib/funil/periodo";
import type { LinhaDeTrajetoria } from "@/lib/funil/trajetoria";
import { createClient } from "@/lib/supabase/client";

/**
 * As trajetórias de um funil num intervalo — a RPC `cb_funil_trajetorias`
 * (975), paginada por `carregarTrajetorias`.
 *
 * `carregando` é DERIVADO (a chave do pedido vigente ≠ a chave do resultado
 * que está no estado), nunca um `setState` síncrono dentro do efeito — a
 * regra do React Compiler que já derrubou PR no CI. Resposta atrasada de um
 * pedido antigo é descartada pela chave; `falhou` é "a RPC respondeu e não
 * dá para confiar" (`null` do laço paginado), distinto de "ainda carregando".
 *
 * `atualizarLinha` é o estado OTIMISTA de quem move uma etapa na lista; quem
 * chama re-deriva os fatos com `fatosDoNegocio`.
 */

interface Resultado {
  chave: string;
  linhas: LinhaDeTrajetoria[] | null;
}

function chaveDoPedido(pipelineId: string | null, desdeMs: number | null, ateMs: number | null, versao: number) {
  return `${pipelineId ?? ""}|${desdeMs ?? ""}|${ateMs ?? ""}|${versao}`;
}

export interface UseTrajetoriasResult {
  linhas: LinhaDeTrajetoria[] | null;
  carregando: boolean;
  falhou: boolean;
  recarregar: () => void;
  atualizarLinha: (dealId: string, mudar: (linha: LinhaDeTrajetoria) => LinhaDeTrajetoria) => void;
}

export function useTrajetorias(pipelineId: string | null, intervalo: Intervalo): UseTrajetoriasResult {
  const supabase = createClient();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [versao, setVersao] = useState(0);

  const desdeMs = intervalo.desde ? intervalo.desde.getTime() : null;
  const ateMs = intervalo.ate ? intervalo.ate.getTime() : null;
  const chave = chaveDoPedido(pipelineId, desdeMs, ateMs, versao);

  useEffect(() => {
    if (!pipelineId) return;
    let ativo = true;
    void carregarTrajetorias(supabase, {
      pipelineId,
      desde: desdeMs === null ? null : new Date(desdeMs),
      ate: ateMs === null ? null : new Date(ateMs),
    }).then((linhas) => {
      if (ativo) setResultado({ chave: chaveDoPedido(pipelineId, desdeMs, ateMs, versao), linhas });
    });
    return () => {
      ativo = false;
    };
  }, [supabase, pipelineId, desdeMs, ateMs, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  const atualizarLinha = useCallback(
    (dealId: string, mudar: (linha: LinhaDeTrajetoria) => LinhaDeTrajetoria) => {
      setResultado((atual) =>
        atual && atual.linhas
          ? { ...atual, linhas: atual.linhas.map((l) => (l.deal_id === dealId ? mudar(l) : l)) }
          : atual,
      );
    },
    [],
  );

  const vigente = resultado !== null && resultado.chave === chave;
  return {
    linhas: vigente ? resultado.linhas : null,
    carregando: pipelineId !== null && !vigente,
    falhou: vigente && resultado.linhas === null,
    recarregar,
    atualizarLinha,
  };
}
