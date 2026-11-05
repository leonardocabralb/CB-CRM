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
//  · COM ALARME, SE ALARGA (E1, Fase 3 dos alarmes de conexão; decisão do
//    operador, 05/11/2026, no lugar de uma faixa fixa no topo): o fundo pega a
//    cor do alarme e, do `md` para cima, o botão diz QUAL conexão e o quê, sem
//    abrir o popover. No popover, cada alarme mora na ficha da PRÓPRIA
//    conexão, como os outros avisos dela (decisão do operador: os cartões no
//    topo ficaram grosseiros). A
//    régua (o que conta como alarme, para quem) é `alarmes-do-cabecalho.ts`:
//    o amarelo dos estados de passagem (reconectando, sem confirmação há
//    pouco) e o atraso curto do reinício da Evolution NÃO alargam — só o
//    glifo muda de cor, como sempre. No celular o texto não cabe ao lado do
//    título: fica só o fundo colorido.
// ============================================================

import { useTranslations } from 'next-intl';

import { ABRE_PARA_BAIXO } from '@/components/layout/popup-do-cabecalho';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/hooks/use-auth';
import { useChannelHealth, type ChannelHealth, type HealthTone } from '@/hooks/use-channel-health';
import {
  alarmesDoCabecalho,
  alarmesPorConexao,
  type AlarmeDoCabecalho,
} from '@/lib/cb-channels/alarmes-do-cabecalho';
import { formatChannelPhone } from '@/lib/cb-channels/display';
import { cn } from '@/lib/utils';

import { WhatsAppGlyph } from './whatsapp-glyph';
import { InstagramGlyph } from './instagram-glyph';
import { ehInstagram } from '@/lib/cb-channels/transporte';
import type { CbChannelKind } from '@/lib/cb-channels/repo';

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
  kind,
  className,
}: {
  tone: HealthTone;
  pulsar: boolean;
  /** Sem `kind` (o glifo AGREGADO, acima do teto) desenha o WhatsApp. */
  kind?: CbChannelKind;
  className?: string;
}) {
  const Marca = ehInstagram(kind) ? InstagramGlyph : WhatsAppGlyph;
  return (
    <span className={cn('relative inline-flex', className)}>
      <Marca
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

/** Dia e hora (o começo da sequência sem recibo), no idioma do navegador. */
function quandoFoi(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Uma duração em segundos, no mesmo vocabulário curto do `hums`. */
function duracao(seg: number): string {
  const min = Math.floor(seg / 60);
  if (min < 1) return `${seg} s`;
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

type Tradutor = ReturnType<typeof useTranslations<'ChannelHealth'>>;

/** A linha curta do alarme: o que o botão alargado mostra. */
function textoCurto(t: Tradutor, a: AlarmeDoCabecalho): string {
  switch (a.tipo) {
    case 'fora_do_ar':
      return t('alarme.foraDoAr', { canal: a.rotulo });
    case 'sem_recibo':
      return t('alarme.semRecibo', { canal: a.rotulo, quando: quandoFoi(a.desdeIso) });
    case 'nao_recebe':
      return t('alarme.naoRecebe', { canal: a.rotulo });
    case 'atrasada':
      return t('alarme.atrasada', { canal: a.rotulo, quando: quandoFoi(a.desdeIso) });
    // Os da sentinela da VPS (1123, Fase 4).
    case 'sem_entrada':
      return t('alarme.semEntrada', { canal: a.rotulo, quando: quandoFoi(a.desdeIso) });
    case 'nao_gravadas':
      return t('alarme.naoGravadas', { canal: a.rotulo, quando: quandoFoi(a.desdeIso) });
    case 'falhas':
      return t('alarme.falhas', { canal: a.rotulo, quando: quandoFoi(a.desdeIso) });
    case 'quedas':
      return t('alarme.quedas', { canal: a.rotulo, quando: quandoFoi(a.desdeIso) });
  }
}

/**
 * O alarme na ficha da PRÓPRIA conexão (o nome dela já está acima), como os
 * outros avisos da ficha. Fora do ar e não recebe não ganham linha: o status
 * da ficha já diz. O sem recibo manda NÃO reenviar (raiz, 8e).
 */
function textoNaFicha(t: Tradutor, a: AlarmeDoCabecalho): string | null {
  switch (a.tipo) {
    case 'fora_do_ar':
    case 'nao_recebe':
      return null;
    case 'sem_recibo':
      return t('alarme.naFicha.semRecibo', { quando: quandoFoi(a.desdeIso) });
    case 'atrasada':
      return t('alarme.naFicha.atrasada', { quando: quandoFoi(a.desdeIso) });
    case 'sem_entrada':
      return t('alarme.naFicha.semEntrada', { quando: quandoFoi(a.desdeIso) });
    case 'nao_gravadas':
      return t('alarme.naFicha.naoGravadas', { quando: quandoFoi(a.desdeIso) });
    case 'falhas':
      return t('alarme.naFicha.falhas', { quando: quandoFoi(a.desdeIso) });
    case 'quedas':
      return t('alarme.naFicha.quedas', { quando: quandoFoi(a.desdeIso) });
  }
}

/**
 * ⚠️ Cores que valem nos DOIS modos (o `dark:` está inerte, ver a `Ficha`): o
 * `amber-700` da faixa da conversa e o `red-600` (contraste medido no papel:
 * 4,8 no claro, 4,1 no escuro), sobre o fundo a 10%.
 */
const COR_DO_ALARME = {
  vermelho: 'bg-red-500/10 text-red-600 ring-red-500/40 hover:bg-red-500/15',
  ambar: 'bg-amber-500/10 text-amber-700 ring-amber-500/40 hover:bg-amber-500/15',
} as const;

function Ficha({ c, alarmes }: { c: ChannelHealth; alarmes: readonly AlarmeDoCabecalho[] }) {
  const t = useTranslations('ChannelHealth');
  const telefone = formatChannelPhone(c.phone);
  const verificado = hums(c.checkedAt);
  const conectado = hums(c.connectedAt);
  // Só quando ESTÁ atrasada. O número em operação normal é de segundos e
  // não informa nada — mostrá-lo sempre é como o rótulo de canal que
  // aparecia em 98% das conversas: presente demais vira invisível.
  //
  // ⚠️⚠️ Lê o `detail` que o SERVIDOR decidiu, nunca reavalia a régua aqui.
  // Duas razões: (1) recalcular com `Date.now()` no render é chamada impura
  // — o React Compiler reprova, e com motivo, porque o resultado mudaria a
  // cada re-render; (2) uma segunda cópia da régua pode discordar do glifo
  // ao lado, e linha e cor discordando sobre a mesma conexão é pior que as
  // duas caladas. `alarmeDeAtraso` já pesou o frescor lá (Codex, 3ª rodada):
  // medição velha não vira `lagging`, então não chega aqui.
  const atrasada = c.detail === 'lagging';
  const medido = hums(c.atrasoMedidoEm);

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Glifo tone={c.tone} pulsar={c.tone === 'warn'} kind={c.kind} className="mt-0.5 shrink-0" />
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
        {/* Nível 3 (1002). Leva QUANDO foi medido junto: sem isso, uma
            conexão que ficou quieta depois de um episódio mostraria o
            atraso velho como se fosse de agora.

            ⚠️ O par claro/escuro é a convenção do projeto, mas MEDIDO em
            16/09/2026 o `dark:` está INERTE em toda a aplicação: o variant
            é `@custom-variant dark (&:is(.dark *))` (globals.css) e o modo
            é marcado por `html[data-mode="dark"]` — não existe UM elemento
            com a classe `.dark` na página. Ou seja, vale sempre o
            `amber-700`. Ele é o melhor compromisso possível numa cor só
            (contraste medido: 4,90 no claro, 4,17 no escuro), e a segunda
            metade fica escrita para o dia em que o variant for consertado
            — são 111 usos de `dark:text-*` no repo na mesma situação, e
            arrumar o variant muda a cor de todos eles de uma vez, o que é
            decisão própria e não carona deste PR. */}
        {atrasada && c.atrasoSeg !== null && (
          <p className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            {t('deliveryLag', { tempo: duracao(c.atrasoSeg) })}
            {medido ? ` · ${t('lagMeasured', { tempo: medido })}` : ''}
          </p>
        )}
        {/* E1: os alarmes DESTA conexão que o status acima não diz, do pior
            para o mais leve (o sem recibo, que era a linha "Sem confirmação
            de entrega desde…", vem por aqui, também atrás de outro motivo). */}
        {alarmes.map((a) => {
          const texto = textoNaFicha(t, a);
          return (
            texto && (
              <p key={a.tipo} className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                {texto}
              </p>
            )
          );
        })}
      </div>
    </div>
  );
}

export function ChannelHealthIndicator({ className }: { className?: string }) {
  const t = useTranslations('ChannelHealth');
  const { channels, loading, falhou } = useChannelHealth();
  const { acesso } = useAuth();

  // Conta sem conexão: nada a dizer.
  if (channels.length === 0) return null;

  const tons = channels.map((c) => c.tone);
  const pior = piorTom(tons);
  const colapsado = channels.length > TETO_DE_GLIFOS;
  const resumo = t('summary', {
    total: channels.length,
    ruins: tons.filter((x) => x !== 'ok').length,
  });

  // E1: o alarme de quem recebe o aviso (D2), o pior primeiro; a ficha de
  // cada conexão mostra todos os dela.
  const entrada = { saude: channels, carregando: loading, falhou, acesso };
  const alarmes = alarmesDoCabecalho(entrada);
  const porConexao = alarmesPorConexao(entrada);
  const principal = alarmes[0] ?? null;
  const curto = principal ? textoCurto(t, principal) : null;
  const outros = alarmes.length - 1;
  const rotulo = principal
    ? [curto, outros > 0 ? t('alarme.maisAlertas', { n: outros }) : null, resumo]
        .filter(Boolean)
        .join(' · ')
    : resumo;

  return (
    <Popover>
      <PopoverTrigger
        aria-label={rotulo}
        title={rotulo}
        className={cn(
          'flex h-10 min-w-0 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-muted',
          principal &&
            cn(
              'gap-2 ring-1 ring-inset md:px-2.5',
              principal.tipo === 'fora_do_ar' ? COR_DO_ALARME.vermelho : COR_DO_ALARME.ambar,
            ),
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
            <Glifo key={c.id} tone={c.tone} pulsar={c.tone === 'warn'} kind={c.kind} />
          ))
        )}
        {/* O texto cabe do `md` para cima. Com o menu lateral (`lg`) o
            cabeçalho estreita, e o teto desce para o título da página caber
            ("Caixa de entrada", medido de 800 a 1440 px); volta no `xl`. */}
        {curto && (
          <span className="hidden min-w-0 max-w-48 truncate text-xs font-medium md:inline lg:max-w-40 xl:max-w-96">
            {curto}
          </span>
        )}
        {outros > 0 && (
          <span aria-hidden="true" className="hidden shrink-0 text-xs font-semibold md:inline">
            +{outros}
          </span>
        )}
      </PopoverTrigger>
      {/* Sempre para baixo, com piso na altura: no app do iPhone abria
          para cima, cortado (`popup-do-cabecalho.ts`). */}
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionAvoidance={ABRE_PARA_BAIXO}
        className="max-h-[max(var(--available-height),16rem)] w-80 overflow-y-auto"
      >
        <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('title')}
        </p>
        <div className="divide-y divide-border">
          {channels.map((c) => (
            <Ficha key={c.id} c={c} alarmes={porConexao.get(c.id) ?? []} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
