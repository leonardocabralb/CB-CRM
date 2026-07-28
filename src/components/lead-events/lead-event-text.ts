'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { chaveDoAutor, chaveDoTexto } from '@/lib/lead-events/describe';
import type { LeadEvent } from '@/types';

/**
 * Transforma um evento da trilha em texto legível.
 *
 * Separado dos componentes porque as três telas que mostram a trilha (linha na
 * conversa, ficha do inbox, ficha de contato) precisam da MESMA frase — e
 * porque manter `useTranslations` num só lugar evita três conjuntos de chaves
 * divergindo.
 */
export function useLeadEventText() {
  const t = useTranslations('LeadEvents');

  return useCallback(
    (evento: LeadEvent): { texto: string; autor: string } => {
      // Rótulo ausente só acontece em linha retroativa cujo funil/etapa já
      // tinha sido apagado. Um travessão é honesto; "undefined" na tela não.
      const ou = (valor: string | null) => valor ?? '—';

      const chave = chaveDoTexto(evento);
      let texto: string;

      switch (chave) {
        case 'deal_created':
          texto = t('dealCreated', {
            pipeline: ou(evento.to_pipeline_label),
            stage: ou(evento.to_stage_label),
          });
          break;
        case 'deal_deleted':
          texto = t('dealDeleted', { pipeline: ou(evento.from_pipeline_label) });
          break;
        case 'pipeline_changed':
          texto = t('pipelineChanged', {
            fromPipeline: ou(evento.from_pipeline_label),
            fromStage: ou(evento.from_stage_label),
            toPipeline: ou(evento.to_pipeline_label),
            toStage: ou(evento.to_stage_label),
          });
          break;
        case 'stageAdvanced':
        case 'stageReturned':
        case 'stageChanged':
          texto = t(chave, {
            from: ou(evento.from_stage_label),
            to: ou(evento.to_stage_label),
          });
          break;
        case 'statusWon':
        case 'statusLost':
        case 'statusReopened':
          texto = t(chave);
          break;
        case 'tag_added':
          texto = t('tagAdded', { tag: ou(evento.tag_label) });
          break;
        case 'tag_removed':
          texto = t('tagRemoved', { tag: ou(evento.tag_label) });
          break;
        default:
          texto = chave;
      }

      const { chave: chaveAutor, nome } = chaveDoAutor(evento);
      const autor =
        chaveAutor === 'actorPerson' || chaveAutor === 'actorChannel'
          ? t(chaveAutor, { name: ou(nome) })
          : t(chaveAutor);

      return { texto, autor };
    },
    [t],
  );
}
