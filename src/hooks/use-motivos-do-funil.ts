"use client";

import { useCallback, useEffect, useState } from "react";

import { carregarMotivos } from "@/lib/funil/carregar";
import type { LinhaDeMotivo } from "@/lib/funil/motivos";
import type { Intervalo } from "@/lib/funil/periodo";
import { createClient } from "@/lib/supabase/client";
import type { CustomField } from "@/types";

/**
 * O relatório de motivos de um funil num intervalo: a soma da
 * `cb_motivos_do_funil` (1113) e os campos de motivo das etapas (para saber
 * o que é opção da lista e o que é "Outro").
 *
 * Mesmo desenho de `useTrajetorias`: `carregando` é DERIVADO da chave do
 * pedido (nunca `setState` síncrono no efeito), resposta de pedido antigo é
 * descartada pela chave, e `falhou` é "respondeu e não dá para confiar" —
 * distinto de "ainda carregando". Os dois pedidos valem juntos: um que falha
 * derruba o resultado inteiro (sem a lista, todo motivo cairia em "Outro").
 */

interface Dados {
  linhas: LinhaDeMotivo[];
  campos: CustomField[];
}

interface Resultado {
  chave: string;
  dados: Dados | null;
}

export interface UseMotivosDoFunilResult {
  dados: Dados | null;
  carregando: boolean;
  falhou: boolean;
  recarregar: () => void;
}

export function useMotivosDoFunil(
  pipelineId: string,
  intervalo: Intervalo,
  campoIds: readonly string[],
): UseMotivosDoFunilResult {
  const supabase = createClient();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [versao, setVersao] = useState(0);

  const desdeMs = intervalo.desde ? intervalo.desde.getTime() : null;
  const ateMs = intervalo.ate ? intervalo.ate.getTime() : null;
  const campos = [...new Set(campoIds)].sort().join(",");
  const chave = `${pipelineId}|${desdeMs ?? ""}|${ateMs ?? ""}|${campos}|${versao}`;

  useEffect(() => {
    let ativo = true;
    const ids = campos ? campos.split(",") : [];
    const doPedido = `${pipelineId}|${desdeMs ?? ""}|${ateMs ?? ""}|${campos}|${versao}`;
    void Promise.all([
      carregarMotivos(supabase, {
        pipelineId,
        desde: desdeMs === null ? null : new Date(desdeMs),
        ate: ateMs === null ? null : new Date(ateMs),
      }),
      ids.length === 0
        ? Promise.resolve({ data: [] as CustomField[], error: null })
        : supabase.from("custom_fields").select("id, field_name, field_type, field_options").in("id", ids),
    ])
      .then(([linhas, lidos]) => {
        if (!ativo) return;
        const dados = linhas && !lidos.error && lidos.data ? { linhas, campos: lidos.data as CustomField[] } : null;
        setResultado({ chave: doPedido, dados });
      })
      // Um pedido que LANÇA (rede caiu no meio) deixaria a seção girando para
      // sempre: vira "falhou", com o "Tentar de novo".
      .catch(() => {
        if (ativo) setResultado({ chave: doPedido, dados: null });
      });
    return () => {
      ativo = false;
    };
  }, [supabase, pipelineId, desdeMs, ateMs, campos, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  const vigente = resultado !== null && resultado.chave === chave;
  return {
    dados: vigente ? resultado.dados : null,
    carregando: !vigente,
    falhou: vigente && resultado.dados === null,
    recarregar,
  };
}
