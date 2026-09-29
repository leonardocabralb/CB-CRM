'use client';

// ============================================================
// "Botão de avançar" no Gerenciar funil (1065): a escolha, por etapa, do que
// o botão do painel da conversa recomenda — decisão do operador, 29/09/2026:
// automático só para a frente por padrão, "com possibilidade de escolher as
// etapas de cada um no gerenciador".
//
// Cada linha mostra o que vale hoje: o automático (calculado aqui com o
// MESMO `recomendarEtapas` do painel, sobre a ordem do rascunho) ou a
// escolha à mão. Mexer numa caixa transforma o que está marcado em escolha
// à mão — partindo do que o automático sugeria —, e "Voltar ao automático"
// grava NULL de novo. Tudo fica no rascunho do diálogo e vai no "Salvar".
//
// ⚠️ Edição EMBAIXO da linha, e não num popover: o diálogo já prende o foco,
// e um popover dentro dele é mais um portal para brigar com isso.
// ============================================================

import { useState } from 'react';
import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  emLista,
  JANELA_DO_AUTOMATICO_DIAS,
  MAXIMO_DE_OPCOES,
  MINIMO_DE_MOVIMENTOS,
  type Movimento,
  recomendarEtapas,
} from '@/lib/pipelines/etapas-recomendadas';
import { cn } from '@/lib/utils';
import type { PipelineStage } from '@/types';

export function EtapasRecomendadasConfig({
  etapas,
  movimentos,
  historico,
  onChange,
}: {
  /** O rascunho do diálogo, na ordem da tela (é ela que vira `position`). */
  etapas: PipelineStage[];
  movimentos: Movimento[] | null;
  historico: 'carregando' | 'pronto' | 'falhou';
  onChange: (stageId: string, proximas: string[] | null) => void;
}) {
  const t = useTranslations('Pipelines.settings.recomendadas');
  const [aberta, setAberta] = useState<string | null>(null);

  // A ordem do rascunho É a posição que o "Salvar" vai gravar: arrastar uma
  // etapa muda o que é "para a frente" antes mesmo de salvar.
  const naOrdem = etapas.map((e, i) => ({ ...e, position: i }));
  const porId = new Map(naOrdem.map((e) => [e.id, e]));

  const automaticoDe = (etapa: PipelineStage) =>
    emLista(recomendarEtapas({ ...etapa, proximas_etapas: null }, naOrdem, movimentos));

  const resumo = (etapa: PipelineStage) => {
    if (Array.isArray(etapa.proximas_etapas)) {
      const nomes = etapa.proximas_etapas
        .map((id) => porId.get(id)?.name)
        .filter((n): n is string => Boolean(n));
      return nomes.length ? nomes.join(' · ') : t('nenhuma');
    }
    if (historico === 'carregando') return `${t('automatico')} · ${t('carregando')}`;
    const nomes = automaticoDe(etapa).map((id) => porId.get(id)?.name ?? '');
    return `${t('automatico')} · ${nomes.length ? nomes.join(' · ') : t('semSugestao')}`;
  };

  return (
    <details className="rounded-lg border border-border p-2">
      <summary className="cursor-pointer text-sm text-muted-foreground">{t('titulo')}</summary>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('dica', { dias: JANELA_DO_AUTOMATICO_DIAS, minimo: MINIMO_DE_MOVIMENTOS })}
      </p>
      {historico === 'falhou' && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{t('falhou')}</p>
      )}
      <div className="mt-3 grid gap-1">
        {naOrdem.map((etapa) => {
          const manual = Array.isArray(etapa.proximas_etapas);
          const efetiva = manual ? (etapa.proximas_etapas ?? []).filter((id) => porId.has(id)) : automaticoDe(etapa);
          const estaAberta = aberta === etapa.id;
          const gravar = (lista: string[]) => onChange(etapa.id, lista);
          return (
            <div key={etapa.id} className="rounded-md bg-muted/60">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: etapa.color }} />
                <span className="w-40 shrink-0 truncate text-sm text-foreground">{etapa.name}</span>
                <span
                  className={cn('min-w-0 flex-1 truncate text-xs', manual ? 'text-foreground' : 'text-muted-foreground')}
                  title={resumo(etapa)}
                >
                  {resumo(etapa)}
                </span>
                {/* ⚠️ Travado enquanto o histórico carrega: a primeira caixa
                    mexida parte do que o automático sugere, e sem o
                    histórico (ou com o do funil aberto antes) essa sugestão
                    sairia vazia — a escolha à mão nasceria sem as etapas
                    que a tela promete aproveitar (Codex, PR #340). */}
                <button
                  type="button"
                  disabled={historico === 'carregando'}
                  onClick={() => setAberta(estaAberta ? null : etapa.id)}
                  aria-expanded={estaAberta}
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {estaAberta ? t('fechar') : t('escolher')}
                </button>
              </div>

              {estaAberta && (
                <div className="border-t border-border px-2 pb-2 pt-1.5">
                  <p className="mb-1 text-[11px] text-muted-foreground">
                    {manual
                      ? efetiva.length
                        ? t('modoManual')
                        : t('modoNenhuma')
                      : t('modoAutomatico', { dias: JANELA_DO_AUTOMATICO_DIAS })}
                    {' · '}
                    {t('maximo', { maximo: MAXIMO_DE_OPCOES })}
                  </p>
                  <div className="grid gap-0.5">
                    {naOrdem
                      .filter((outra) => outra.id !== etapa.id)
                      .map((outra) => {
                        const indice = efetiva.indexOf(outra.id);
                        const marcada = indice >= 0;
                        const cheia = efetiva.length >= MAXIMO_DE_OPCOES;
                        return (
                          <div key={outra.id} className="flex items-center gap-2 text-sm">
                            <label className="flex min-w-0 flex-1 items-center gap-2 py-0.5">
                              <input
                                type="checkbox"
                                checked={marcada}
                                disabled={!marcada && cheia}
                                onChange={() =>
                                  gravar(
                                    marcada
                                      ? efetiva.filter((id) => id !== outra.id)
                                      : [...efetiva, outra.id],
                                  )
                                }
                              />
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: outra.color }}
                              />
                              <span className="truncate text-foreground">{outra.name}</span>
                            </label>
                            {marcada &&
                              (indice === 0 ? (
                                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary">
                                  <Star className="h-3 w-3 fill-current" />
                                  {t('principal')}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    gravar([outra.id, ...efetiva.filter((id) => id !== outra.id)])
                                  }
                                  title={t('tornarPrincipal')}
                                  aria-label={t('tornarPrincipal')}
                                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-primary"
                                >
                                  <Star className="h-3 w-3" />
                                </button>
                              ))}
                          </div>
                        );
                      })}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!manual}
                      onClick={() => onChange(etapa.id, null)}
                      className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('voltarAoAutomatico')}
                    </button>
                    <button
                      type="button"
                      disabled={manual && efetiva.length === 0}
                      onClick={() => gravar([])}
                      className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t('nenhumaBotao')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
