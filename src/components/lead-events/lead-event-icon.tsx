'use client';

import {
  ArchiveRestore,
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  CircleCheck,
  CircleDot,
  Clock,
  Eraser,
  GitMerge,
  MessageCircle,
  MessageCirclePlus,
  Plus,
  RotateCcw,
  Tag as TagIcon,
  Trash2,
  Trophy,
  Undo2,
  UserCheck,
  UserX,
  XCircle,
} from 'lucide-react';

import { chaveDoTexto, direcaoDoMovimento } from '@/lib/lead-events/describe';
import type { LeadEvent } from '@/types';

/**
 * Ícone da linha. Mesma escolha nas três telas — o operador aprende o símbolo
 * uma vez e ele significa a mesma coisa em qualquer lugar.
 */
export function LeadEventIcon({
  evento,
  className = 'h-3 w-3',
}: {
  evento: LeadEvent;
  className?: string;
}) {
  switch (evento.event_type) {
    case 'deal_created':
      return <Plus className={className} />;
    case 'deal_deleted':
      return <Trash2 className={className} />;
    case 'pipeline_changed':
      return <ArrowLeftRight className={className} />;
    case 'stage_changed': {
      const direcao = direcaoDoMovimento(evento);
      if (direcao === 'avanco') return <ArrowUpRight className={className} />;
      if (direcao === 'retorno') return <ArrowDownRight className={className} />;
      return <ArrowLeftRight className={className} />;
    }
    case 'status_changed':
      if (evento.to_status === 'won') return <Trophy className={className} />;
      if (evento.to_status === 'lost') return <XCircle className={className} />;
      return <Undo2 className={className} />;
    case 'tag_added':
      return <TagIcon className={className} />;
    case 'tag_removed':
      return <TagIcon className={className} />;
    // A conversa (1083): a mesma régua do texto decide o símbolo.
    case 'conversation_status_changed':
      switch (chaveDoTexto(evento)) {
        case 'conversationStarted':
        case 'conversationCreatedClosed':
        case 'conversationCreatedPending':
          return <MessageCirclePlus className={className} />;
        case 'conversationClosed':
          return <CircleCheck className={className} />;
        case 'conversationReopened':
        case 'conversationReopenedPending':
          return <RotateCcw className={className} />;
        case 'conversationPending':
          return <Clock className={className} />;
        default:
          return <MessageCircle className={className} />;
      }
    case 'contacts_merged':
      return <GitMerge className={className} />;
    case 'conversation_assigned':
      return chaveDoTexto(evento) === 'conversationUnassigned' ? (
        <UserX className={className} />
      ) : (
        <UserCheck className={className} />
      );
    // A Lixeira (1097): o cesto ao mover, a caixa que devolve ao restaurar, a
    // borracha ao sair de vez (esta não chega a ficha nenhuma, mas tem
    // símbolo, como todo tipo da trilha).
    case 'contact_trashed':
      return <Trash2 className={className} />;
    case 'contact_restored':
      return <ArchiveRestore className={className} />;
    case 'contact_purged':
      return <Eraser className={className} />;
    default: {
      // Tipo novo da trilha (CHECK da migration + `LeadEventType`) escolhe o
      // símbolo aqui: o `never` reprova o typecheck. O círculo segue como
      // reserva para a linha que o banco gravou antes do app saber dela.
      const tipoNovo: never = evento.event_type;
      void tipoNovo;
      return <CircleDot className={className} />;
    }
  }
}
