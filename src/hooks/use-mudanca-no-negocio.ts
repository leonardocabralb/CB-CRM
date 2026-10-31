'use client';

import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { LeadEvent, LeadEventType } from '@/types';

/**
 * Os tipos da trilha (912) que dizem "um negócio DESTE contato mudou": nasceu,
 * trocou de etapa ou de funil, ganhou/perdeu/reabriu, foi apagado. Etiqueta,
 * situação da conversa, união de fichas e Lixeira têm `deal_id` nulo e ficam
 * de fora (`funil.md`: leitor de funil filtra o tipo).
 */
export const TIPOS_QUE_MUDAM_O_NEGOCIO: ReadonlySet<LeadEventType> = new Set<LeadEventType>([
  'deal_created',
  'stage_changed',
  'pipeline_changed',
  'status_changed',
  'deal_deleted',
]);

export function mudaONegocio(evento: Pick<LeadEvent, 'event_type'> | null | undefined): boolean {
  return !!evento && TIPOS_QUE_MUDAM_O_NEGOCIO.has(evento.event_type);
}

/** Um tópico por ASSINATURA — o porquê está em `use-lead-events.ts`. */
let canaisAbertos = 0;

/**
 * Avisa quando um negócio do contato muda por OUTRO caminho — o agente de IA
 * no servidor, uma automação, o robô, um colega arrastando o card no quadro —
 * com a conversa aberta. O painel da conversa só relia os negócios ao trocar
 * de contato, e a etapa ficava a antiga até recarregar a página.
 *
 * ⚠️ Escuta a TRILHA (`cb_lead_events`, na publicação realtime desde a 1059,
 * sem lista de colunas), não `deals`: `deals` não está na publicação, e quem
 * escreve a trilha é o GATILHO da 912 — todo escritor de etapa, funil e status
 * passa por ele, inclusive a service role do servidor. Só INSERT, filtrado por
 * `contact_id`, como o `useLeadEvents`.
 *
 * O evento só AVISA; quem ouve relê do banco (`aoMudar`). Não dá para montar
 * o negócio a partir do evento: ele não traz valor, título nem o embed da
 * etapa.
 *
 * - Sem assinatura para contato nulo (grupo).
 * - O `aoMudar` mais recente é lido por ref: quem chama pode passar função
 *   nova a cada render sem re-assinar o canal.
 * - Evento que chegue DEPOIS da troca de contato (a remoção do canal é
 *   assíncrona) não avisa ninguém (`ativo`).
 * - O que o canal perde enquanto está fora (aba em segundo plano, reconexão)
 *   NÃO chega por aqui: quem ouve relê também no `resyncToken`.
 */
export function useMudancaNoNegocio(
  contactId: string | null | undefined,
  aoMudar: (evento: LeadEvent) => void,
) {
  const aoMudarRef = useRef(aoMudar);
  useEffect(() => {
    aoMudarRef.current = aoMudar;
  });

  useEffect(() => {
    if (!contactId) return;
    let ativo = true;
    const supabase = createClient();
    const canal = supabase
      .channel(`negocios:${contactId}:${++canaisAbertos}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'cb_lead_events',
          filter: `contact_id=eq.${contactId}`,
        },
        (payload) => {
          if (!ativo) return;
          const evento = payload.new as LeadEvent;
          // A régua do filtro é do servidor; a do contato confere de novo aqui
          // (barato, e o painel nunca relê pelo evento de outro cliente).
          if (evento.contact_id !== contactId || !mudaONegocio(evento)) return;
          aoMudarRef.current(evento);
        },
      )
      .subscribe();

    return () => {
      ativo = false;
      void supabase.removeChannel(canal);
    };
  }, [contactId]);
}
