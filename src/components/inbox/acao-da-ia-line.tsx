'use client';

import { format } from 'date-fns';
import { Sparkles } from 'lucide-react';

import type { ConversationNote } from '@/types';

/**
 * A AÇÃO do agente de IA no fio (1141, pedido do operador de 12/11/2026):
 * "Trabalhista · Atendimento preencheu Pendência da IA: …" desenhada como as
 * linhas da trilha (`LeadEventLine`), discreta e centralizada — nunca o
 * cartão amarelo da anotação, que poluía a conversa. Sem responder, fixar,
 * editar nem apagar: é registro do que aconteceu, não conversa da equipe.
 *
 * O texto QUEBRA linha (a pendência pode ser longa), por isso o canto
 * arredondado e não a pílula da trilha. A anotação de ação nunca tem anexo
 * (o escritor do agente só grava texto).
 */
export function AcaoDaIaLine({ nota }: { nota: ConversationNote }) {
  return (
    <div className="flex justify-center py-1">
      <span className="inline-flex max-w-[85%] items-start gap-1.5 rounded-2xl bg-muted/80 px-3 py-1 text-center text-[11px] text-muted-foreground">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 break-words">
          {nota.texto}
          {' · '}
          {format(new Date(nota.created_at), 'HH:mm')}
        </span>
      </span>
    </div>
  );
}
