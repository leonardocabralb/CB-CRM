'use client';

import { useEffect, useState } from 'react';

import { JANELA_DO_AUTOMATICO_DIAS, type Movimento } from '@/lib/pipelines/etapas-recomendadas';
import { createClient } from '@/lib/supabase/client';

// ============================================================
// Os movimentos de etapa de um funil nos últimos 30 dias — a base do
// automático do botão "avançar" (`cb_movimentos_entre_etapas`, 1061).
//
// Em memória por funil, válidos por 10 minutos: o painel troca de conversa o
// tempo todo, e o número não muda em minutos. `null` = nenhuma leitura boa
// ainda (carregando, ou a primeira falhou) — o automático não afirma nada sem
// ela (a escolha à mão não precisa). Depois de uma leitura boa, a releitura
// que FALHA mantém a anterior, de propósito: o histórico de 30 dias muda
// devagar, e esconder o botão por um soluço do banco seria pior que uma
// sugestão de minutos atrás (Codex, PR #340, decidido não trocar).
//
// ⚠️ A validade é cumprida com o painel MONTADO: ele passa o expediente
// inteiro aberto no mesmo funil, e sem o relógio que relê na validade a
// recomendação ficaria na foto da primeira conversa (Codex, PR #340).
// ============================================================

const VALIDADE_MS = 10 * 60 * 1000;
const NOVA_LEITURA_APOS_FALHA_MS = 60 * 1000;

interface Guardado {
  em: number;
  movimentos: Movimento[];
}

const guardados = new Map<string, Guardado>();
const emVoo = new Map<string, Promise<Guardado | null>>();

function lerDoBanco(pipelineId: string): Promise<Guardado | null> {
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
    const guardado = { em: Date.now(), movimentos };
    guardados.set(pipelineId, guardado);
    return guardado;
  })().finally(() => emVoo.delete(pipelineId));
  emVoo.set(pipelineId, pedido);
  return pedido;
}

/** Os movimentos do funil, ou `null` enquanto não há (carregando ou falhou). */
export function useMovimentosDoFunil(pipelineId: string | null | undefined): Movimento[] | null {
  const [lidos, setLidos] = useState<(Guardado & { de: string }) | null>(null);

  useEffect(() => {
    if (!pipelineId) return;
    let vivo = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const buscar = () => {
      void lerDoBanco(pipelineId).then((guardado) => {
        if (!vivo) return;
        if (guardado) setLidos({ de: pipelineId, ...guardado });
        relogio = setTimeout(buscar, guardado ? VALIDADE_MS : NOVA_LEITURA_APOS_FALHA_MS);
      });
    };
    const guardado = guardados.get(pipelineId);
    const idade = guardado ? Date.now() - guardado.em : Number.POSITIVE_INFINITY;
    if (idade < VALIDADE_MS) relogio = setTimeout(buscar, VALIDADE_MS - idade);
    else buscar();
    return () => {
      vivo = false;
      if (relogio) clearTimeout(relogio);
    };
  }, [pipelineId]);

  if (!pipelineId) return null;
  // A leitura mais nova vence — a desta tela ou a de outra (o Gerenciar
  // funil relê a cada abertura). Carimbada com o funil: trocar para um
  // negócio de outro funil não mostra, por um quadro, os movimentos do anterior.
  const guardado = guardados.get(pipelineId);
  if (lidos?.de === pipelineId && (!guardado || lidos.em >= guardado.em)) return lidos.movimentos;
  return guardado?.movimentos ?? null;
}

/** Para a tela de funis, que precisa ler de novo a cada abertura. */
export async function lerMovimentosDoFunil(pipelineId: string): Promise<Movimento[] | null> {
  return (await lerDoBanco(pipelineId))?.movimentos ?? null;
}
