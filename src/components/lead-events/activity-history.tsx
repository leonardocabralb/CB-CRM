'use client';

import { History } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useLeadEvents } from '@/hooks/use-lead-events';
import { LeadEventIcon } from './lead-event-icon';
import { useLeadEventText } from './lead-event-text';
import type { LeadEvent } from '@/types';

/**
 * O registro COMPLETO, na ficha do contato.
 *
 * Diferença para a linha na conversa: aqui não se esconde nada. Entram a
 * exclusão de negócio (que fica fora do chat para não despejar uma linha solta
 * em centenas de conversas quando um funil inteiro é apagado) e as linhas
 * retroativas, marcadas como tal. É esta tela que responde a pergunta de
 * auditoria — a da conversa responde a de atendimento.
 */
export function ActivityHistory({
  contactId,
  token = 0,
}: {
  contactId: string | null | undefined;
  token?: number;
}) {
  const t = useTranslations('LeadEvents');
  const { eventos, carregando } = useLeadEvents(contactId, token);

  return (
    <div>
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <History className="h-3 w-3" />
        {t('title')}
      </div>

      <div className="mt-2 space-y-2">
        {carregando && eventos.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t('loading')}</p>
        ) : eventos.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t('empty')}</p>
        ) : (
          // Mais recente primeiro: numa ficha a pergunta é "o que mudou por
          // último?". Na conversa é o contrário, e por isso o hook devolve em
          // ordem cronológica e quem inverte é esta tela.
          [...eventos].reverse().map((evento) => (
            <LinhaDoHistorico key={evento.id} evento={evento} />
          ))
        )}
      </div>
    </div>
  );
}

function LinhaDoHistorico({ evento }: { evento: LeadEvent }) {
  const t = useTranslations('LeadEvents');
  const descrever = useLeadEventText();
  const { texto, autor } = descrever(evento);

  return (
    <div className="rounded-lg bg-muted px-3 py-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          <LeadEventIcon evento={evento} className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground">{texto}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {autor} ·{' '}
            {new Date(evento.occurred_at).toLocaleString(undefined, {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          {/* A trilha precisa dizer o que ela mesma NÃO viu acontecer. */}
          {evento.reconstructed && (
            <span className="mt-1 inline-block rounded-full bg-background px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
              {t('reconstructedBadge')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
