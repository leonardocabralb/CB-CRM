'use client';

import { useEffect, useState } from 'react';

import { JANELA_DO_AUTOMATICO_DIAS, type Movimento } from '@/lib/pipelines/etapas-recomendadas';
import { createClient } from '@/lib/supabase/client';

// ============================================================
// Os movimentos de etapa de um funil nos últimos 30 dias — a base do
// automático do botão "avançar" (`cb_movimentos_entre_etapas`, 1061).
//
// Em memória por funil, por 10 minutos: o painel troca de conversa o tempo
// todo, e o número não muda em minutos. `null` = carregando ou falhou — o
// automático não afirma nada sem ele (a escolha à mão não precisa dele).
// ============================================================

const VALIDADE_MS = 10 * 60 * 1000;
const guardados = new Map<string, { em: number; movimentos: Movimento[] }>();
const emVoo = new Map<string, Promise<Movimento[] | null>>();

function lerDoBanco(pipelineId: string): Promise<Movimento[] | null> {
  const noAr = emVoo.get(pipelineId);
  if (noAr) return noAr;
  const desde = new Date(Date.now() - JANELA_DO_AUTOMATICO_DIAS * 24 * 60 * 60 * 1000);
  const pedido = (async () => {
    const { data, error } = await createClient().rpc('cb_movimentos_entre_etapas', {
      p_pipeline_id: pipelineId,
      p_desde: desde.toISOString(),
    });
    if (error || !Array.isArray(data)) return null;
    const movimentos = data.flatMap((l: Record<string, unknown>): Movimento[] =>
      typeof l.de === 'string' && typeof l.para === 'string' && typeof l.vezes === 'number'
        ? [{ de: l.de, para: l.para, vezes: l.vezes }]
        : [],
    );
    guardados.set(pipelineId, { em: Date.now(), movimentos });
    return movimentos;
  })().finally(() => emVoo.delete(pipelineId));
  emVoo.set(pipelineId, pedido);
  return pedido;
}

/** Os movimentos do funil, ou `null` enquanto não há (carregando ou falhou). */
export function useMovimentosDoFunil(pipelineId: string | null | undefined): Movimento[] | null {
  const [lidos, setLidos] = useState<{ de: string; movimentos: Movimento[] } | null>(null);

  useEffect(() => {
    if (!pipelineId) return;
    const guardado = guardados.get(pipelineId);
    if (guardado && Date.now() - guardado.em < VALIDADE_MS) return;
    let vivo = true;
    void lerDoBanco(pipelineId).then((movimentos) => {
      if (vivo && movimentos) setLidos({ de: pipelineId, movimentos });
    });
    return () => {
      vivo = false;
    };
  }, [pipelineId]);

  if (!pipelineId) return null;
  // A resposta é carimbada com o funil: trocar de negócio para um de outro
  // funil não pode mostrar, por um quadro, os movimentos do anterior.
  if (lidos?.de === pipelineId) return lidos.movimentos;
  return guardados.get(pipelineId)?.movimentos ?? null;
}

/** Para a tela de funis, que precisa ler de novo a cada abertura. */
export function lerMovimentosDoFunil(pipelineId: string): Promise<Movimento[] | null> {
  return lerDoBanco(pipelineId);
}
