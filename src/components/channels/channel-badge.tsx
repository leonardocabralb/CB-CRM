'use client';

// ============================================================
// "Por qual número isto acontece?" — a etiqueta que responde essa pergunta
// nas listas, nos históricos e nas barras laterais.
//
// Duas formas:
//   <ChannelBadge>      um canal concreto (a conversa correu por AQUELE).
//   <ChannelScopeBadge> um ESCOPO (a automação vale em quais números).
//
// A diferença importa: escopo vazio é "todos", e é justamente o que o
// operador precisa enxergar sem abrir o editor. Ver `summarizeScope`.
// ============================================================

import { useTranslations } from 'next-intl';

import {
  CHANNEL_STATUS_DOT,
  findChannel,
  summarizeScope,
} from '@/lib/cb-channels/display';
import type { CbChannel } from '@/lib/cb-channels/repo';
import { cn } from '@/lib/utils';

const BASE =
  'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border ' +
  'bg-muted/50 px-1.5 py-0.5 text-xs font-normal text-muted-foreground';

/** Um canal concreto. Sem status por padrão — nas listas ele é ruído. */
export function ChannelBadge({
  channel,
  showStatus = false,
  className,
}: {
  channel: CbChannel;
  showStatus?: boolean;
  className?: string;
}) {
  const t = useTranslations('Channels');
  return (
    <span
      className={cn(BASE, className)}
      title={`${channel.label} · ${t(`kind_${channel.kind}`)}`}
    >
      {showStatus && (
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
            CHANNEL_STATUS_DOT[channel.status],
          )}
        />
      )}
      <span className="truncate">{channel.label}</span>
    </span>
  );
}

/**
 * Canal de uma linha de histórico (log de automação, run de flow, mensagem),
 * a partir do id. Registros anteriores ao multi-canal têm `channel_id` nulo:
 * mostramos um travessão em vez de inventar o canal padrão, porque naquela
 * época a mensagem pode ter saído por outro número.
 */
export function ChannelCell({
  channels,
  channelId,
  className,
}: {
  channels: CbChannel[];
  channelId: string | null | undefined;
  className?: string;
}) {
  const canal = findChannel(channels, channelId);
  if (!canal) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)} aria-hidden="true">
        —
      </span>
    );
  }
  return <ChannelBadge channel={canal} className={className} />;
}

/**
 * O escopo de canal de uma automação (`channel_ids`) ou de um flow
 * (`channel_id`).
 *
 * `hideWhenAll` existe porque nas listas "Todos os canais" em cada linha
 * vira poluição: quem tem escopo é a exceção, e é ela que precisa saltar.
 * Nas telas de detalhe passamos `hideWhenAll={false}` — lá o silêncio seria
 * ambíguo ("todos" ou "ninguém configurou?").
 */
export function ChannelScopeBadge({
  channels,
  scope,
  hideWhenAll = true,
  className,
}: {
  channels: CbChannel[];
  scope: string[] | string | null | undefined;
  hideWhenAll?: boolean;
  className?: string;
}) {
  const t = useTranslations('Channels');
  const resumo = summarizeScope(channels, scope);

  // Ainda carregando a lista de canais, ou ids órfãos: melhor não mostrar
  // nada do que mostrar "todos os canais" sobre algo restrito.
  if (resumo.kind === 'unresolved') return null;

  if (resumo.kind === 'all') {
    if (hideWhenAll) return null;
    return <span className={cn(BASE, className)}>{t('all')}</span>;
  }

  if (resumo.kind === 'one') {
    return (
      <span className={cn(BASE, className)} title={resumo.label}>
        <span className="truncate">{resumo.label}</span>
      </span>
    );
  }

  return (
    <span className={cn(BASE, className)} title={resumo.labels.join(' · ')}>
      {t('manyCount', { count: resumo.count })}
    </span>
  );
}
