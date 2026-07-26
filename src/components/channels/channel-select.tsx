'use client';

// ============================================================
// Os dois seletores de canal da UI.
//
//   <ChannelSelect>      escolhe UM canal (flow, broadcast, modelo, envio).
//   <ChannelMultiSelect> escolhe VÁRIOS (escopo de automação).
//
// Regra que os dois respeitam, e que vem do motor: lista vazia de canais →
// nada é renderizado, e a tela segue como antes do multi-canal. Não existe
// estado "seletor vazio bloqueando a tela".
//
// A OUTRA regra, a que custa dinheiro se errar: seleção vazia significa
// TODOS. No multi-select isso é literal (`channel_ids = null`); no single
// select só existe quando `allowAll` está ligado (flow curinga). Um seletor
// que deixasse o operador salvar "nenhum canal" produziria uma automação
// que o motor leria como "todos" — exatamente o contrário do que ele viu.
// ============================================================

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CHANNEL_STATUS_DOT, formatChannelPhone, summarizeScope } from '@/lib/cb-channels/display';
import type { CbChannel } from '@/lib/cb-channels/repo';
import { cn } from '@/lib/utils';

/** Sentinela do item "todos" — o Select trabalha com string. */
const ALL = '__all__';

function ChannelRow({ channel }: { channel: CbChannel }) {
  const telefone = formatChannelPhone(channel.display_phone);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-2 w-2 shrink-0 rounded-full',
          CHANNEL_STATUS_DOT[channel.status],
        )}
      />
      {/* O NOME fica com a folga; o telefone é curto e não encolhe. Ao
          contrário, os dois truncavam junto e o nome do canal — a única
          coisa que o operador reconhece — virava "Comercial (…". */}
      <span className="min-w-0 flex-1 truncate">{channel.label}</span>
      {telefone && (
        <span className="text-muted-foreground shrink-0 text-xs">{telefone}</span>
      )}
    </span>
  );
}

export function ChannelSelect({
  channels,
  value,
  onChange,
  allowAll = false,
  allLabel,
  placeholder,
  disabled = false,
  className,
}: {
  channels: CbChannel[];
  /** `null` = nenhum escolhido; com `allowAll`, significa "todos". */
  value: string | null;
  onChange: (channelId: string | null) => void;
  /** Adiciona a opção "todos os canais" (curinga). */
  allowAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('Channels');
  if (channels.length === 0) return null;

  return (
    <Select
      value={value ?? (allowAll ? ALL : null)}
      onValueChange={(v) => onChange(v === ALL || v == null ? null : String(v))}
      disabled={disabled}
    >
      <SelectTrigger className={cn('bg-muted w-full', className)}>
        {/* Função explícita mesmo com o wrapper derivando `items`: o rótulo
            do item é a linha inteira (bolinha + nome + telefone), e no
            gatilho queremos só o nome. */}
        <SelectValue placeholder={placeholder ?? t('selectPlaceholder')}>
          {(v: unknown) => {
            const id = v == null ? null : String(v);
            // Sem `allowAll`, "nada escolhido" é MESMO nada — devolver
            // "Todos os canais" aqui faria um seletor de canal único
            // afirmar algo que ele nem consegue representar.
            if (id === null) {
              return allowAll
                ? (allLabel ?? t('all'))
                : (placeholder ?? t('selectPlaceholder'));
            }
            if (id === ALL) return allLabel ?? t('all');
            return (
              channels.find((c) => c.id === id)?.label ??
              placeholder ??
              t('selectPlaceholder')
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {allowAll && <SelectItem value={ALL}>{allLabel ?? t('all')}</SelectItem>}
        {channels.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <ChannelRow channel={c} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ChannelMultiSelect({
  channels,
  value,
  onChange,
  className,
}: {
  channels: CbChannel[];
  /** Array vazio = TODOS os canais (é o que o motor lê em `channel_ids`). */
  value: string[];
  onChange: (channelIds: string[]) => void;
  className?: string;
}) {
  const t = useTranslations('Channels');
  if (channels.length === 0) return null;

  const resumo = summarizeScope(channels, value.length === 0 ? null : value);
  const rotulo =
    resumo.kind === 'all'
      ? t('all')
      : resumo.kind === 'one'
        ? resumo.label
        : resumo.kind === 'many'
          ? t('manyCount', { count: resumo.count })
          : // `unresolved`: HÁ escopo, mas nenhum id resolve para um canal
            // desta conta. Cair em "Todos os canais" aqui seria mentir sobre
            // uma automação restrita — o pior erro possível nesta tela. O
            // convite a escolher é honesto e leva à correção.
            t('selectPlaceholder');

  function alternar(id: string, marcado: boolean) {
    // Desmarcar o último volta a "todos" — é o mesmo estado que o motor lê
    // como sem restrição, e evita o array vazio que a 903 normaliza para
    // NULL (desativando a automação) sem o operador entender por quê.
    const proximo = marcado ? [...value, id] : value.filter((v) => v !== id);
    onChange(proximo);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'border-input bg-muted flex h-8 w-full items-center justify-between gap-1.5',
          'rounded-lg border px-2.5 text-sm transition-colors outline-none',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
          className,
        )}
      >
        <span className="truncate">{rotulo}</span>
        <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 w-72 overflow-y-auto">
        <DropdownMenuItem
          onClick={() => onChange([])}
          className={cn('text-sm', value.length === 0 && 'text-primary')}
        >
          {t('all')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {channels.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={value.includes(c.id)}
            onCheckedChange={(marcado) => alternar(c.id, !!marcado)}
            // Já é o padrão do base-ui, mas explícito porque dependemos
            // dele: fechar a cada clique tornaria impossível marcar o
            // segundo canal sem reabrir o menu.
            closeOnClick={false}
          >
            <ChannelRow channel={c} />
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
