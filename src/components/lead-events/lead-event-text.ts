'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import {
  chaveDoAutor,
  chaveDoTexto,
  complementoDoResponsavel,
  responsaveisDoEvento,
} from '@/lib/lead-events/describe';
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
      const { de, para } = responsaveisDoEvento(evento);
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
        // A conversa (1083).
        case 'conversationStarted':
          texto = t('conversationStarted');
          break;
        case 'conversationCreatedClosed':
          texto = t('conversationCreatedClosed');
          break;
        case 'conversationCreatedPending':
          texto = t('conversationCreatedPending');
          break;
        case 'conversationClosed':
          texto = t('conversationClosed');
          break;
        case 'conversationReopened':
          texto = t('conversationReopened');
          break;
        case 'conversationReopenedPending':
          texto = t('conversationReopenedPending');
          break;
        case 'conversationPending':
          texto = t('conversationPending');
          break;
        case 'conversationOpened':
          texto = t('conversationOpened');
          break;
        case 'conversationAssigned':
          texto = t('conversationAssigned', { to: ou(para) });
          break;
        case 'conversationReassigned':
          texto = t('conversationReassigned', { from: ou(de), to: ou(para) });
          break;
        case 'conversationUnassigned':
          texto = t('conversationUnassigned', { from: ou(de) });
          break;
        default:
          texto = chave;
      }

      const complemento = complementoDoResponsavel(evento);
      if (complemento) {
        texto = `${texto} ${
          complemento.chave === 'suffixWasWith'
            ? t('suffixWasWith', { name: ou(complemento.nome) })
            : t('suffixAssignedTo', { name: ou(complemento.nome) })
        }`;
      }

      function textoDoAutor(): string {
        const quem = chaveDoAutor(evento);
        switch (quem.chave) {
          case 'actorPerson':
            return t('actorPerson', { name: ou(quem.nome) });
          case 'actorChannel':
            return t('actorChannel', { name: ou(quem.nome) });
          case 'actorAutomation':
            return t('actorAutomation');
          case 'actorSystem':
            return t('actorSystem');
          case 'actorReconstructed':
            return t('actorReconstructed');
          case 'actorCustomer':
            return t('actorCustomer');
          case 'actorPhone':
            return t('actorPhone');
          case 'actorCall':
            return t('actorCall');
          case 'actorApi':
            return t('actorApi');
          case 'actorAutomationNamed':
            return t('actorAutomationNamed', { name: ou(quem.nome) });
          case 'actorBilling':
            return t('actorBilling');
          case 'actorFlow':
            return t('actorFlow');
          case 'actorFlowNamed':
            return t('actorFlowNamed', { name: ou(quem.nome) });
          case 'actorAgent':
            return t('actorAgent');
          case 'actorAgentNamed':
            return t('actorAgentNamed', { name: ou(quem.nome) });
          case 'actorScheduling':
            return t('actorScheduling');
          case 'actorIntegration':
            return t('actorIntegration');
          default: {
            const nunca: never = quem.chave;
            return nunca;
          }
        }
      }

      return { texto, autor: textoDoAutor() };
    },
    [t],
  );
}
