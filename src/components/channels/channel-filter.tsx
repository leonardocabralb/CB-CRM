'use client';

// ============================================================
// Filtro "mostre só o que é deste número", para as listas.
//
// Some com menos de dois canais: numa conta de um número o filtro não
// separa nada e só ocupa a barra. Mesma regra do filtro que já existe na
// lista de conversas.
// ============================================================

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CHANNEL_STATUS_DOT, channelLabel } from '@/lib/cb-channels/display';
import type { CbChannel } from '@/lib/cb-channels/repo';
import { cn } from '@/lib/utils';

export function ChannelFilter({
  channels,
  value,
  onChange,
  className,
}: {
  channels: CbChannel[];
  /** `null` = sem filtro. */
  value: string | null;
  onChange: (channelId: string | null) => void;
  className?: string;
}) {
  const t = useTranslations('Channels');
  if (channels.length < 2) return null;

  const rotulo = channelLabel(channels, value) ?? t('filterAll');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'border-border inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm',
          'hover:bg-muted transition-colors',
          value ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          className,
        )}
      >
        <span className="max-w-[10rem] truncate">{rotulo}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 w-56 overflow-y-auto">
        <DropdownMenuItem
          onClick={() => onChange(null)}
          className={cn('text-sm', value === null && 'text-primary')}
        >
          {t('filterAll')}
        </DropdownMenuItem>
        {channels.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => onChange(c.id)}
            className={cn('text-sm', value === c.id && 'text-primary')}
          >
            <span
              aria-hidden="true"
              className={cn(
                'mr-2 inline-block h-2 w-2 shrink-0 rounded-full',
                CHANNEL_STATUS_DOT[c.status],
              )}
            />
            <span className="truncate">{c.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
