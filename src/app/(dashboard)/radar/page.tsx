'use client';

// ============================================================
// O Radar de Atendimento — a resposta a "qual conversa eu olho primeiro?".
//
// Lê o que o worker gravou (cb_conversation_insights) e ordena por
// severidade + recência. Não substitui o inbox: daqui o operador SALTA
// para a conversa (`/inbox?c=`); aqui ele decide para onde olhar.
//
// Princípios que a tela sustenta:
//   - todo sinal exibe a EVIDÊNCIA (trecho da mensagem) — sinal sem
//     evidência nem chega aqui, o parser da rubrica descarta;
//   - "tratado/descartado" tira da frente sem apagar (anti fadiga de
//     alarme; o descarte é o dado de calibração);
//   - a pendência ("aguardando há X") é calculada AO VIVO em horas
//     úteis — o valor gravado no banco envelhece entre análises.
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  ExternalLink,
  Frown,
  Loader2,
  RefreshCw,
  Scale,
  Star,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { ChannelCell } from '@/components/channels/channel-badge';
import { ChannelFilter } from '@/components/channels/channel-filter';
import type { CbChannel } from '@/lib/cb-channels/repo';
import { useCan } from '@/hooks/use-can';
import { useChannels } from '@/hooks/use-channels';
import {
  useAcoesDoRadar,
  useRadar,
  type InsightDaConta,
} from '@/hooks/use-radar';
import {
  formatarDuracaoUtil,
  segundosUteisEntre,
} from '@/lib/cb-radar/horario-comercial';
import {
  LIMIAR_PENDENCIA_SEG,
  ordenarPorSeveridade,
  resumirCartoes,
  type InsightParaOrdenacao,
} from '@/lib/cb-radar/ordenacao';
import type { Evidencia } from '@/lib/cb-radar/rubrica';
import { cn } from '@/lib/utils';

type Aba = 'abertos' | 'todos';

/** Segundos úteis aguardando AGORA (null = ninguém aguardando). */
function aguardandoSegUteis(i: InsightDaConta, agora: Date): number | null {
  if (!i.aguardando_desde) return null;
  return segundosUteisEntre(new Date(i.aguardando_desde), agora);
}

function paraOrdenacao(i: InsightDaConta, agora: Date): InsightParaOrdenacao {
  return {
    urgencia: i.urgencia,
    insatisfacao: i.insatisfacao,
    pedidosAbertos: i.pedidos_abertos,
    aguardandoSegUteis: aguardandoSegUteis(i, agora),
    nota: i.nota,
    estado: i.estado,
    ultimaAtividade: i.conversation?.last_message_at
      ? new Date(i.conversation.last_message_at)
      : null,
  };
}

export default function RadarPage() {
  const t = useTranslations('Radar');
  const { insights, carregando, falhou, estourouOTeto, recarregar } = useRadar();
  const { channels } = useChannels();
  const podeAgir = useCan('send-messages');
  const { ocupada, mudarEstado, reanalisar } = useAcoesDoRadar(recarregar);
  const [canalFiltro, setCanalFiltro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>('abertos');
  const [expandida, setExpandida] = useState<string | null>(null);

  const mostrarCanal = channels.length > 1;
  // O "agora" da pendência ao vivo e do bônus de 72h. Por render, sem
  // memo: a lista tem ≤200 linhas e recomputar é mais barato que manter
  // um relógio consistente entre memos.
  const agora = new Date();

  const doCanal = useMemo(
    () =>
      canalFiltro
        ? insights.filter((i) => i.channel_id === canalFiltro)
        : insights,
    [insights, canalFiltro],
  );

  const cartoes = useMemo(() => {
    const ag = new Date();
    return resumirCartoes(doCanal.map((i) => paraOrdenacao(i, ag)));
  }, [doCanal]);

  const ordenados = useMemo(() => {
    const ag = new Date();
    return ordenarPorSeveridade(doCanal, (i) => paraOrdenacao(i, ag), ag);
  }, [doCanal]);
  const visiveis = useMemo(
    () => (aba === 'abertos' ? ordenados.filter((i) => i.estado === 'aberto') : ordenados),
    [ordenados, aba],
  );
  const nAbertos = useMemo(
    () => doCanal.filter((i) => i.estado === 'aberto').length,
    [doCanal],
  );

  const agir = useCallback(
    async (acao: Promise<{ ok: boolean; erro?: string }>) => {
      const r = await acao;
      if (!r.ok) toast.error(t('acaoFalhou', { erro: r.erro ?? '?' }));
    },
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Scale className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
        <ChannelFilter
          channels={channels}
          value={canalFiltro}
          onChange={setCanalFiltro}
        />
      </div>

      {/* Cartões-resumo: a visão de 5 segundos. Contam só o ABERTO — o
          tratado saiu da frente de propósito. A nota média é da janela
          inteira (tratar um sinal não melhora a semana). */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao
          icone={AlertTriangle}
          rotulo={t('cardUrgencias')}
          valor={String(cartoes.urgencias)}
          alerta={cartoes.urgencias > 0}
        />
        <Cartao
          icone={Frown}
          rotulo={t('cardInsatisfacoes')}
          valor={String(cartoes.insatisfacoes)}
          alerta={cartoes.insatisfacoes > 0}
        />
        <Cartao
          icone={Clock}
          rotulo={t('cardPendencias')}
          valor={String(cartoes.pendencias)}
          alerta={cartoes.pendencias > 0}
        />
        <Cartao
          icone={Star}
          rotulo={t('cardNotaMedia')}
          valor={cartoes.notaMedia === null ? '—' : String(cartoes.notaMedia)}
          alerta={false}
        />
      </div>

      {falhou && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t('loadFailed')}
          <button
            type="button"
            onClick={recarregar}
            className="ml-auto underline underline-offset-2"
          >
            {t('tentarDeNovo')}
          </button>
        </div>
      )}

      {estourouOTeto && (
        <p className="text-xs text-muted-foreground">{t('estourouOTeto')}</p>
      )}

      <div className="flex items-center gap-1 border-b border-border">
        {(['abertos', 'todos'] as const).map((opcao) => (
          <button
            key={opcao}
            type="button"
            onClick={() => setAba(opcao)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              aba === opcao
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {opcao === 'abertos'
              ? t('tab_abertos', { n: nAbertos })
              : t('tab_todos', { n: doCanal.length })}
          </button>
        ))}
      </div>

      {carregando ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visiveis.length === 0 && !falhou ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {insights.length === 0 ? (
            <>
              <p className="font-medium text-foreground">{t('vazioTitulo')}</p>
              <p className="mx-auto mt-2 max-w-md">{t('vazioNuncaAnalisado')}</p>
            </>
          ) : (
            <p>{t('vazioSemAbertos')}</p>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {visiveis.map((i) => (
            <LinhaDoRadar
              key={i.id}
              insight={i}
              agora={agora}
              mostrarCanal={mostrarCanal}
              canais={channels}
              podeAgir={podeAgir}
              ocupada={ocupada === i.conversation_id}
              expandida={expandida === i.id}
              aoExpandir={() => setExpandida((atual) => (atual === i.id ? null : i.id))}
              aoMudarEstado={(estado) => agir(mudarEstado(i.conversation_id, estado))}
              aoReanalisar={() => agir(reanalisar(i.conversation_id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Cartao({
  icone: Icone,
  rotulo,
  valor,
  alerta,
}: {
  icone: typeof AlertTriangle;
  rotulo: string;
  valor: string;
  alerta: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icone className={cn('h-3.5 w-3.5', alerta && 'text-amber-500')} />
        {rotulo}
      </div>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          alerta ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
        )}
      >
        {valor}
      </p>
    </div>
  );
}

const COR_URGENCIA: Record<string, string> = {
  alta: 'border-destructive/40 bg-destructive/10 text-destructive',
  media: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  baixa: 'border-border bg-muted text-muted-foreground',
};

function Etiqueta({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        className ?? 'border-border bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function CorDaNota(nota: number): string {
  if (nota >= 8) return 'text-emerald-600 dark:text-emerald-400';
  if (nota >= 5) return 'text-amber-600 dark:text-amber-400';
  return 'text-destructive';
}

function LinhaDoRadar({
  insight: i,
  agora,
  mostrarCanal,
  canais,
  podeAgir,
  ocupada,
  expandida,
  aoExpandir,
  aoMudarEstado,
  aoReanalisar,
}: {
  insight: InsightDaConta;
  agora: Date;
  mostrarCanal: boolean;
  canais: CbChannel[];
  podeAgir: boolean;
  ocupada: boolean;
  expandida: boolean;
  aoExpandir: () => void;
  aoMudarEstado: (estado: 'aberto' | 'tratado' | 'descartado') => void;
  aoReanalisar: () => void;
}) {
  const t = useTranslations('Radar');
  const contato = i.conversation?.contact;
  const nome = contato?.name || contato?.phone || t('contatoSemNome');
  const aguardandoSeg = aguardandoSegUteis(i, agora);
  const detalhes = i.detalhes;
  const analise = detalhes?.analise ?? null;
  const processos = detalhes?.processos ?? [];

  return (
    <li
      className={cn(
        'rounded-lg border border-border bg-card px-4 py-3',
        i.estado !== 'aberto' && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={aoExpandir}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expandida}
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              expandida && 'rotate-180',
            )}
          />
          <span className="truncate text-sm font-medium text-foreground">{nome}</span>
          {mostrarCanal && (
            <ChannelCell channelId={i.channel_id} channels={canais} />
          )}
        </button>
        {i.nota !== null && (
          <span
            className={cn('text-sm font-semibold tabular-nums', CorDaNota(i.nota))}
            title={t('notaTitulo')}
          >
            {t('nota', { nota: i.nota })}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {i.urgencia !== 'nenhuma' && (
          <Etiqueta className={COR_URGENCIA[i.urgencia]}>
            <AlertTriangle className="h-3 w-3" />
            {t(`urgencia_${i.urgencia}`)}
          </Etiqueta>
        )}
        {i.insatisfacao && (
          <Etiqueta className={COR_URGENCIA.media}>
            <Frown className="h-3 w-3" />
            {t('insatisfacao')}
          </Etiqueta>
        )}
        {aguardandoSeg !== null && aguardandoSeg >= LIMIAR_PENDENCIA_SEG && (
          <Etiqueta className={COR_URGENCIA.media}>
            <Clock className="h-3 w-3" />
            {t('aguardando', { tempo: formatarDuracaoUtil(aguardandoSeg) })}
          </Etiqueta>
        )}
        {i.pedidos_abertos > 0 && (
          <Etiqueta>{t('pedidos', { count: i.pedidos_abertos })}</Etiqueta>
        )}
        {i.mencao_processo && (
          <Etiqueta>
            <Scale className="h-3 w-3" />
            {t('mencaoProcesso')}
          </Etiqueta>
        )}
        {detalhes?.sem_ia && <Etiqueta>{t('semIa')}</Etiqueta>}
        {i.status === 'failed' && (
          <Etiqueta className={COR_URGENCIA.alta}>{t('analiseFalhou')}</Etiqueta>
        )}
        {i.estado !== 'aberto' && (
          <Etiqueta>{t(`estado_${i.estado}`)}</Etiqueta>
        )}
      </div>

      {i.resumo && (
        <p className="mt-2 text-sm text-muted-foreground">{i.resumo}</p>
      )}

      {expandida && (
        <div className="mt-3 space-y-3 border-t border-border pt-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {t('metricasLinha', {
              primeira:
                i.primeira_resposta_seg === null
                  ? '—'
                  : formatarDuracaoUtil(i.primeira_resposta_seg),
              mediana:
                i.resposta_mediana_seg === null
                  ? '—'
                  : formatarDuracaoUtil(i.resposta_mediana_seg),
              mensagens: i.mensagens_analisadas,
            })}
            {i.mensagens_sem_texto > 0 && (
              <> · {t('audioAviso', { count: i.mensagens_sem_texto })}</>
            )}
            {i.analisado_em && (
              <>
                {' · '}
                {t('analisadoEm', {
                  quando: new Date(i.analisado_em).toLocaleString(undefined, {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </>
            )}
          </p>

          {analise?.urgenciaMotivo && (
            <Sinal titulo={t('urgenciaTitulo')} detalhe={analise.urgenciaMotivo} evidencias={analise.urgenciaEvidencias ?? []} />
          )}
          {analise?.insatisfacaoMotivo && (
            <Sinal titulo={t('insatisfacao')} detalhe={analise.insatisfacaoMotivo} evidencias={analise.insatisfacaoEvidencias ?? []} />
          )}
          {(analise?.pedidosNaoAtendidos ?? []).map((p, idx) => (
            <Sinal key={idx} titulo={t('pedidoTitulo')} detalhe={p.pedido} evidencias={p.evidencias} />
          ))}
          {(analise?.pontosDeAtencao ?? []).map((p, idx) => (
            <Sinal key={idx} titulo={p.titulo} detalhe={p.detalhe} evidencias={p.evidencias} />
          ))}
          {processos.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('processosTitulo')}{' '}
              <span className="font-mono text-foreground">{processos.join(' · ')}</span>
            </p>
          )}
          {i.status === 'failed' && i.erro && (
            <p className="text-xs text-destructive">{i.erro}</p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/inbox?c=${i.conversation_id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('verNoChat')}
        </Link>
        {podeAgir && i.estado === 'aberto' && (
          <>
            <button
              type="button"
              disabled={ocupada}
              onClick={() => aoMudarEstado('tratado')}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {t('tratar')}
            </button>
            <button
              type="button"
              disabled={ocupada}
              onClick={() => aoMudarEstado('descartado')}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              title={t('descartarTitulo')}
            >
              {t('descartar')}
            </button>
          </>
        )}
        {podeAgir && i.estado !== 'aberto' && (
          <button
            type="button"
            disabled={ocupada}
            onClick={() => aoMudarEstado('aberto')}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {t('reabrir')}
          </button>
        )}
        {podeAgir && (
          <button
            type="button"
            disabled={ocupada}
            onClick={aoReanalisar}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {ocupada ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t('reanalisar')}
          </button>
        )}
      </div>
    </li>
  );
}

/** Um sinal com sua evidência — o trecho REAL da mensagem que o justifica.
 *  Sem trecho, o sinal nem chegou aqui (o parser da rubrica descartou). */
function Sinal({
  titulo,
  detalhe,
  evidencias,
}: {
  titulo: string;
  detalhe: string;
  evidencias: Evidencia[];
}) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <p className="text-xs font-semibold text-foreground">{titulo}</p>
      <p className="text-sm text-muted-foreground">{detalhe}</p>
      {evidencias.map((e) => (
        <p key={e.indice} className="mt-1 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
          “{e.trecho}”
        </p>
      ))}
    </div>
  );
}
