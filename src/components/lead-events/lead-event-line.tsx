'use client';

import { format } from 'date-fns';

import { LeadEventIcon } from './lead-event-icon';
import { useLeadEventText } from './lead-event-text';
import type { LeadEvent } from '@/types';

/**
 * A linha do evento DENTRO da conversa — o que o operador pediu: ver a
 * mudança de funil no meio do papo, sem trocar de tela.
 *
 * Deliberadamente discreta e centralizada, no formato de aviso de sistema do
 * próprio WhatsApp: ela divide espaço com as mensagens do cliente e não pode
 * competir com elas. Quem quiser o registro completo (com exclusões e linhas
 * retroativas) abre o painel de histórico na ficha.
 */
export function LeadEventLine({ evento }: { evento: LeadEvent }) {
  const descrever = useLeadEventText();
  const { texto, autor } = descrever(evento);

  return (
    <div className="flex justify-center py-1">
      <span className="inline-flex max-w-[85%] items-center gap-1.5 rounded-full bg-muted/80 px-3 py-1 text-center text-[11px] text-muted-foreground">
        <LeadEventIcon evento={evento} className="h-3 w-3 shrink-0" />
        <span className="min-w-0">
          {texto}
          {' · '}
          {autor}
          {' · '}
          {format(new Date(evento.occurred_at), 'HH:mm')}
        </span>
      </span>
    </div>
  );
}
