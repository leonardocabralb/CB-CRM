'use client';

// As REGRAS DO SISTEMA (27/09/2026), só para LER: valem para todo agente,
// entram no pedido antes das instruções (`src/lib/ia-agentes/regras-do-sistema.ts`)
// e não podem ser desligadas. A tela mostra a tradução de cada regra pelo
// `id` (`IaAgentes.regrasDoSistema.itens.<id>`) — chave MONTADA, cobrada nos
// dois dicionários por `regras-do-sistema.test.ts`. Recolhido por padrão: é
// referência, não campo a preencher.
//
// "Conduz o fechamento" (1128): a lista é a do agente COMO ESTÁ NA TELA (o
// rascunho, não o salvo) — com a opção ligada, as duas regras do fechamento
// aparecem no lugar de `sem_preco` e `sem_compromisso`, marcadas.
//
// As frases autorizadas (1131), também as do RASCUNHO: com a lista
// preenchida, as regras que ganham a exceção a mostram embaixo (pelo TIPO da
// exceção, com chave literal), e as frases vêm no fim, como no pedido.

import { useTranslations } from 'next-intl';
import { ChevronDown, ShieldCheck } from 'lucide-react';

import { REGRAS_DO_FECHAMENTO, regrasDoSistema } from '@/lib/ia-agentes/regras-do-sistema';

const DO_FECHAMENTO: ReadonlySet<string> = new Set(REGRAS_DO_FECHAMENTO.map((r) => r.id));

export function RegrasDoSistema({
  conduzFechamento,
  frasesAutorizadas,
}: {
  conduzFechamento: boolean;
  /** As frases do rascunho, uma por item (`frasesDoTexto`). */
  frasesAutorizadas: readonly string[];
}) {
  const t = useTranslations('IaAgentes');
  const regras = regrasDoSistema({ conduzFechamento, frasesAutorizadas });
  const comFrases = frasesAutorizadas.length > 0;
  return (
    <details className="group rounded-md border border-border bg-muted/30">
      <summary className="flex cursor-pointer list-none items-start gap-2 p-3 [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{t('regrasDoSistema.titulo', { total: regras.length })}</p>
          <p className="text-xs text-muted-foreground">{t('regrasDoSistema.dica')}</p>
          {conduzFechamento ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">{t('regrasDoSistema.dicaFechamento')}</p>
          ) : null}
          {comFrases ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">{t('regrasDoSistema.dicaFrases')}</p>
          ) : null}
        </div>
        <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ol className="space-y-1.5 pb-3 pl-9 pr-3 text-xs text-foreground">
        {regras.map((r, i) => (
          <li key={r.id} className="flex gap-2">
            <span className="w-4 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
            <span className="min-w-0">
              {DO_FECHAMENTO.has(r.id) ? (
                <span className="mr-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800">
                  {t('regrasDoSistema.doFechamento')}
                </span>
              ) : null}
              {t(`regrasDoSistema.itens.${r.id}`)}
              {r.excecao === 'custo' ? (
                <span className="mt-0.5 block text-amber-700 dark:text-amber-300">{t('regrasDoSistema.excecaoDoCusto')}</span>
              ) : r.excecao === 'resultado' ? (
                <span className="mt-0.5 block text-amber-700 dark:text-amber-300">
                  {t('regrasDoSistema.excecaoDoResultado')}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {comFrases ? (
        <div className="space-y-1 pb-3 pl-9 pr-3 text-xs">
          <p className="font-medium text-foreground">{t('campo.frasesAutorizadas')}</p>
          <ul className="space-y-1">
            {frasesAutorizadas.map((f, i) => (
              // A frase pode trazer um link sem espaço: ele quebra em vez de alargar o cartão.
              <li key={i} className="min-w-0 break-words text-foreground">
                — {f}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  );
}
