'use client';

import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  CircleDot,
  Plus,
  Tag as TagIcon,
  Trash2,
  Trophy,
  Undo2,
  XCircle,
} from 'lucide-react';

import { direcaoDoMovimento } from '@/lib/lead-events/describe';
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
    default:
      return <CircleDot className={className} />;
  }
}
