'use client';

import { AlertTriangle, CalendarClock, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useAgendadorSaude } from '@/hooks/use-agendador-saude';
import { deveAparecer } from '@/lib/scheduled/saude';
import { CICLO_MINUTOS } from '@/lib/scheduled/display';
import { cn } from '@/lib/utils';

/**
 * O aviso de que as mensagens agendadas pararam de sair — no cabeçalho, em
 * toda tela do CRM.
 *
 * ⚠️ É a peça que fecha o buraco mais caro desta feature. O agendador é um
 * processo EXTERNO ao CRM; se ele morrer, nada no sistema estoura. As linhas
 * ficam eternamente "Agendada", prometendo um envio que não vem, e o
 * escritório descobre pelo cliente reclamando. Foi exatamente assim que o cron
 * das automações passou semanas parado neste projeto sem ninguém notar.
 *
 * ⚠️ Só aparece quando há o que fazer. Indicador permanente vira papel de
 * parede: o operador para de enxergar, e aí ele não serve para nada no dia em
 * que importa.
 */
export function SchedulerHealthIndicator() {
  const t = useTranslations('Inbox.scheduled.saude');
  const { saude } = useAgendadorSaude();

  if (!saude || !deveAparecer(saude)) return null;

  const grave = saude.tom === 'down';
  // ⚠️ O título segue o RECADO, não o componente. Com "Mensagens agendadas"
  // fixo, o aviso do laço das automações se contradizia na própria caixa: o
  // título dizia "mensagens agendadas" e o corpo, "as agendadas não são
  // afetadas". Vale para o rótulo acessível também — quem usa leitor de tela
  // ouviria o assunto errado antes de abrir.
  const daAutomacao = saude.recado === 'automacoesParadas';
  const titulo = daAutomacao ? t('rotuloAutomacoes') : t('rotulo');

  return (
    <Popover>
      <PopoverTrigger
        aria-label={titulo}
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors',
          grave
            ? 'text-destructive hover:bg-destructive/10'
            : 'text-amber-600 hover:bg-amber-500/10 dark:text-amber-400',
        )}
      >
        <AlertTriangle className={cn('h-4 w-4', grave && 'animate-pulse')} />
        {saude.recado === 'falhas' && (
          <span className="text-xs font-medium">{saude.falhas}</span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" sideOffset={8} className="w-80">
        <p className="flex items-center gap-1.5 px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {daAutomacao ? (
            <Zap className="h-3.5 w-3.5" />
          ) : (
            <CalendarClock className="h-3.5 w-3.5" />
          )}
          {titulo}
        </p>

        <p
          className={cn(
            'text-sm',
            grave ? 'font-medium text-destructive' : 'text-foreground',
          )}
        >
          {saude.recado === 'paradoComFila' &&
            t('paradoComFila', { fila: saude.pendentes })}
          {saude.recado === 'paradoSemFila' && t('paradoSemFila')}
          {saude.recado === 'nuncaRodou' && t('nuncaRodou')}
          {saude.recado === 'automacoesParadas' && t('automacoesParadas')}
          {saude.recado === 'falhas' && t('falhas', { n: saude.falhas })}
        </p>

        {/* O número cru importa: "parado há 4 horas" e "parado há 40 minutos"
            pedem reações diferentes.

            ⚠️ No recado do laço rápido mostra o minuto DELE, não o do lento —
            que ali está fresco, e exibi-lo diria "último ciclo há 0 min"
            logo abaixo de "as automações pararam". */}
        {saude.recado === 'automacoesParadas' ? (
          <p className="text-xs text-muted-foreground">
            {saude.minutosSemAutomacoes === null
              ? t('automacoesNuncaRodaram')
              : t('ultimoCiclo', { min: saude.minutosSemAutomacoes })}
          </p>
        ) : (
          saude.minutosSemCiclo !== null &&
          saude.recado !== 'falhas' && (
            <p className="text-xs text-muted-foreground">
              {t('ultimoCiclo', { min: saude.minutosSemCiclo })}
            </p>
          )
        )}

        <p className="text-xs text-muted-foreground">
          {saude.recado === 'falhas'
            ? t('comoResolverFalhas')
            : saude.recado === 'automacoesParadas'
              ? t('comoResolverAutomacoes')
              : t('comoResolverParado', { ciclo: CICLO_MINUTOS })}
        </p>
      </PopoverContent>
    </Popover>
  );
}
