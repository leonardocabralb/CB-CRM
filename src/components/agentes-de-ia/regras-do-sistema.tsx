'use client';

// As REGRAS DO SISTEMA (27/09/2026), só para LER: valem para todo agente,
// entram no pedido antes das instruções (`src/lib/ia-agentes/regras-do-sistema.ts`)
// e não podem ser desligadas. A tela mostra a tradução de cada regra pelo
// `id` (`IaAgentes.regrasDoSistema.itens.<id>`) — chave MONTADA, cobrada nos
// dois dicionários por `regras-do-sistema.test.ts`. Recolhido por padrão: é
// referência, não campo a preencher.

import { useTranslations } from 'next-intl';
import { ChevronDown, ShieldCheck } from 'lucide-react';

import { REGRAS_DO_SISTEMA } from '@/lib/ia-agentes/regras-do-sistema';

export function RegrasDoSistema() {
  const t = useTranslations('IaAgentes');
  return (
    <details className="group rounded-md border border-border bg-muted/30">
      <summary className="flex cursor-pointer list-none items-start gap-2 p-3 [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {t('regrasDoSistema.titulo', { total: REGRAS_DO_SISTEMA.length })}
          </p>
          <p className="text-xs text-muted-foreground">{t('regrasDoSistema.dica')}</p>
        </div>
        <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ol className="space-y-1.5 pb-3 pl-9 pr-3 text-xs text-foreground">
        {REGRAS_DO_SISTEMA.map((r, i) => (
          <li key={r.id} className="flex gap-2">
            <span className="w-4 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
            <span className="min-w-0">{t(`regrasDoSistema.itens.${r.id}`)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
