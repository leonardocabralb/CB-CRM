'use client';

// ============================================================
// "Meus números estão de pé?" — a resposta no cabeçalho, ao lado do sol.
//
// Um glifo do WhatsApp por conexão, colorido pela saúde. Clique abre a ficha
// de todas: estado, número, tipo, desde quando está conectada e há quanto
// tempo foi verificada.
//
// DECISÕES QUE NÃO SÃO ÓBVIAS:
//
//  · COR NÃO BASTA. Verde/amarelo/vermelho exclui ~8% dos homens. Cada glifo
//    leva um símbolo (✓ ! ×) além da cor, e o `title` diz em texto.
//  · COLAPSA A PARTIR DE 4. O cabeçalho tem 56px e divide espaço com o
//    título e o avatar; oito glifos ali viram poluição. Acima do teto vira um
//    glifo só, pintado com o PIOR estado, com contador.
//  · APARECE COM UM CANAL SÓ. Diferente da convenção "seletor some com menos
//    de dois canais" — ali o widget não decide nada, aqui a saúde de um
//    número único é a informação mais crítica da tela.
//  · SOME COM ZERO. Conta sem conexão nenhuma não tem o que mostrar.
// ============================================================

import { useTranslations } from 'next-intl';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useChannelHealth, type ChannelHealth, type HealthTone } from '@/hooks/use-channel-health';
import { formatChannelPhone } from '@/lib/cb-channels/display';
import { cn } from '@/lib/utils';

import { WhatsAppGlyph } from './whatsapp-glyph';

/** Acima disto os glifos viram um só, com contador. */
const TETO_DE_GLIFOS = 3;

const COR: Record<HealthTone, string> = {
  ok: 'text-emerald-500',
  warn: 'text-amber-500',
  down: 'text-red-500',
  unknown: 'text-muted-foreground',
};

/** O segundo canal de informação, para quem não distingue as cores. */
const MARCA: Record<HealthTone, string> = {
  ok: '✓',
  warn: '!',
  down: '×',
  unknown: '?',
};

function piorTom(tons: HealthTone[]): HealthTone {
  const ordem: HealthTone[] = ['down', 'warn', 'unknown', 'ok'];
  for (const t of ordem) if (tons.includes(t)) return t;
  return 'ok';
}

function Glifo({
  tone,
  pulsar,
  className,
}: {
  tone: HealthTone;
  pulsar: boolean;
  className?: string;
}) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <WhatsAppGlyph
        className={cn(
          'h-5 w-5 transition-colors',
          COR[tone],
          // Pulso só no amarelo: é o estado transitório, e é o que o operador
          // precisa notar. `motion-reduce` desliga para quem pediu.
          pulsar && 'animate-pulse motion-reduce:animate-none',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -bottom-0.5 -right-1 text-[9px] font-bold leading-none',
          COR[tone],
        )}
      >
        {MARCA[tone]}
      </span>
    </span>
  );
}

/** "há 12 minutos" sem trazer biblioteca de datas para o cabeçalho. */
function hums(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

function Ficha({ c }: { c: ChannelHealth }) {
  const t = useTranslations('ChannelHealth');
  const telefone = formatChannelPhone(c.phone);
  const verificado = hums(c.checkedAt);
  const conectado = hums(c.connectedAt);

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Glifo tone={c.tone} pulsar={c.tone === 'warn'} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{c.label}</p>
        <p className="text-xs text-muted-foreground">
          {t(`tone_${c.tone}`)}
          {c.detail ? ` · ${t(`detail_${c.detail}`)}` : ''}
        </p>
        {telefone && <p className="mt-0.5 text-xs text-muted-foreground">{telefone}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t(`kind_${c.kind}`)}
          {conectado ? ` · ${t('connectedFor', { tempo: conectado })}` : ''}
        </p>
        {/* As DUAS datas: "desde quando está assim" e "há quanto tempo
            sabemos disso" respondem perguntas diferentes, e é a segunda que
            revela o verde mentiroso. */}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {verificado ? t('checkedAgo', { tempo: verificado }) : t('neverChecked')}
        </p>
      </div>
    </div>
  );
}

export function ChannelHealthIndicator({ className }: { className?: string }) {
  const t = useTranslations('ChannelHealth');
  const { channels } = useChannelHealth();

  // Conta sem conexão: nada a dizer.
  if (channels.length === 0) return null;

  const tons = channels.map((c) => c.tone);
  const pior = piorTom(tons);
  const colapsado = channels.length > TETO_DE_GLIFOS;
  const resumo = t('summary', {
    total: channels.length,
    ruins: tons.filter((x) => x !== 'ok').length,
  });

  return (
    <Popover>
      <PopoverTrigger
        aria-label={resumo}
        title={resumo}
        className={cn(
          'flex h-10 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-muted',
          className,
        )}
      >
        {colapsado ? (
          <>
            <Glifo tone={pior} pulsar={pior === 'warn'} />
            <span className="text-xs font-medium text-muted-foreground">
              {channels.length}
            </span>
          </>
        ) : (
          channels.map((c) => (
            <Glifo key={c.id} tone={c.tone} pulsar={c.tone === 'warn'} />
          ))
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80">
        <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('title')}
        </p>
        <div className="divide-y divide-border">
          {channels.map((c) => (
            <Ficha key={c.id} c={c} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
