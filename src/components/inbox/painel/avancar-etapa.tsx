'use client';

// ============================================================
// O botão "avançar" do cartão de negócio no painel da conversa — o visual 2
// do preview de 28/09/2026, escolhido pelo operador: um botão principal com
// a próxima etapa, e as outras opções como links logo abaixo.
//
// A regra do que aparece mora em `src/lib/pipelines/etapas-recomendadas.ts`
// (automático só para a frente, ou a escolha à mão do Gerenciar funil). O
// movimento, com os 4 s de desfazer e a garantia de acontecer mesmo se a
// pessoa sair da página, em `src/lib/pipelines/mover-com-desfazer.ts`.
//
// ⚠️ Com um movimento na janela de desfazer, as recomendações SOMEM (e o
// seletor de etapa do cartão fica travado): elas seriam as da etapa de
// destino, que ainda não está no banco, e um segundo clique encadearia um
// movimento a partir de uma etapa que o card ainda não tem. Um por vez.
// ============================================================

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useMovimentoDeEtapa } from '@/hooks/use-movimento-de-etapa';
import { recomendarEtapas, type Movimento } from '@/lib/pipelines/etapas-recomendadas';
import {
  agendarMovimento,
  desfazerMovimento,
  ESPERA_PARA_DESFAZER_MS,
} from '@/lib/pipelines/mover-com-desfazer';
import type { Deal, PipelineStage } from '@/types';

export function AvancarEtapa({
  deal,
  etapas,
  movimentos,
  contato,
  userId,
  disabled,
}: {
  deal: Pick<Deal, 'id' | 'stage_id' | 'pipeline_id'>;
  /** As etapas da conta (a regra recorta as do funil do negócio). */
  etapas: PipelineStage[];
  /** Os movimentos do funil em 30 dias; `null` enquanto não há. */
  movimentos: Movimento[] | null;
  /** O nome do cliente, para os avisos que saem fora do cartão. */
  contato: string;
  userId: string;
  disabled?: boolean;
}) {
  const t = useTranslations('Inbox.sidebar.avancar');
  const movimento = useMovimentoDeEtapa(deal.id);
  const porId = useMemo(() => new Map(etapas.map((e) => [e.id, e])), [etapas]);
  const atual = porId.get(deal.stage_id);
  const recomendacao = useMemo(
    () => (atual ? recomendarEtapas(atual, etapas, movimentos) : null),
    [atual, etapas, movimentos],
  );

  if (movimento?.fase === 'aguardando' || movimento?.fase === 'enviando') {
    const destino = porId.get(movimento.para);
    return (
      <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2 text-sm">
        {movimento.fase === 'enviando' && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {t.rich('movendo', {
            nome: destino?.name ?? '—',
            etapa: (nome) => <NomeDaEtapa cor={destino?.color}>{nome}</NomeDaEtapa>,
          })}
        </span>
        {movimento.fase === 'aguardando' && (
          <BotaoDesfazer
            // Relógio novo a cada movimento: nasce nos 4 s, sem herdar o
            // "0" do anterior por um quadro.
            key={movimento.prazo}
            prazo={movimento.prazo}
            aoDesfazer={() => desfazerMovimento(deal.id)}
            rotulo={(segundos) => t('desfazer', { segundos })}
          />
        )}
      </div>
    );
  }

  if (movimento?.fase === 'movido') {
    return (
      <p className="flex h-8 items-center gap-1.5 px-1 text-sm text-muted-foreground">
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="min-w-0 truncate">
          {t.rich('movido', {
            nome: porId.get(movimento.para)?.name ?? '—',
            etapa: (nome) => (
              <NomeDaEtapa cor={porId.get(movimento.para)?.color}>{nome}</NomeDaEtapa>
            ),
          })}
        </span>
      </p>
    );
  }

  const aviso =
    movimento?.fase === 'desfeito' ? (
      <p className="px-1 text-xs text-muted-foreground">{t('desfeito')}</p>
    ) : null;

  if (!recomendacao || !atual) return aviso;

  const mover = (para: string) => {
    const destino = porId.get(para);
    if (!destino) return;
    const nomes = { contato, etapa: destino.name };
    agendarMovimento(
      {
        dealId: deal.id,
        de: deal.stage_id,
        para,
        textos: {
          movido: t('toastMovido', nomes),
          mudou: t('toastMudou', nomes),
          falhou: t('toastFalhou', nomes),
          tentandoDeNovo: t('toastTentandoDeNovo', nomes),
        },
      },
      userId,
    );
  };

  const principal = recomendacao.principal ? porId.get(recomendacao.principal) : undefined;
  const outras = recomendacao.outras
    .map((id) => porId.get(id))
    .filter((e): e is PipelineStage => e !== undefined);

  return (
    <div className="space-y-1.5">
      {principal && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => mover(principal.id)}
          aria-label={t('avancarPara', { etapa: principal.name })}
          className="flex h-8 w-full items-center justify-center gap-1.5 overflow-hidden rounded-md bg-primary px-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowRight className="h-4 w-4 shrink-0" />
          <span className="truncate">{principal.name}</span>
        </button>
      )}
      {outras.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
          <span>{principal ? t('ou') : t('moverPara')}</span>
          {outras.map((etapa) => (
            <button
              key={etapa.id}
              type="button"
              disabled={disabled}
              onClick={() => mover(etapa.id)}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-foreground underline decoration-border underline-offset-[3px] transition-colors hover:decoration-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: etapa.color }}
              />
              <span className="truncate">{etapa.name}</span>
            </button>
          ))}
        </div>
      )}
      {aviso}
    </div>
  );
}

function NomeDaEtapa({ cor, children }: { cor: string | undefined; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-foreground">
      {cor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cor }} />}
      {children}
    </span>
  );
}

function BotaoDesfazer({
  prazo,
  aoDesfazer,
  rotulo,
}: {
  prazo: number;
  aoDesfazer: () => void;
  rotulo: (segundos: number) => string;
}) {
  // Contagem regressiva, no molde da barra de desfazer do compositor.
  const [restam, setRestam] = useState(Math.ceil(ESPERA_PARA_DESFAZER_MS / 1000));
  useEffect(() => {
    const tick = () => setRestam(Math.max(0, Math.ceil((prazo - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [prazo]);
  return (
    <button
      type="button"
      onClick={aoDesfazer}
      className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-muted"
    >
      {rotulo(restam)}
    </button>
  );
}
