'use client';

// ============================================================
// "Como funciona" — a legenda do Radar. O operador decide COM o Radar, e
// para confiar nele precisa saber o que entra na análise, de onde vem a
// nota e por que um sinal aparece na tela.
//
// Os números (janela, teto de mensagens, cadência, espera) são
// IMPORTADOS das constantes reais que o worker usa — texto com número
// digitado à mão mentiria na primeira mudança de configuração.
// ============================================================

import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { JANELA_DIAS, THROTTLE_MS } from '@/lib/cb-radar/ordenacao';
import { TETO_MENSAGENS } from '@/lib/cb-radar/rubrica';
import { CICLO_MINUTOS } from '@/lib/scheduled/display';

export function ComoFunciona() {
  const t = useTranslations('Radar.legenda');
  return (
    <Dialog>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted">
        <HelpCircle className="h-3.5 w-3.5" />
        {t('botao')}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('titulo')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Secao titulo={t('escopoTitulo')}>
            <p>{t('escopo', { dias: JANELA_DIAS })}</p>
            <p>{t('limites', { mensagens: TETO_MENSAGENS })}</p>
          </Secao>
          <Secao titulo={t('notaTitulo')}>
            <p>{t('nota')}</p>
          </Secao>
          <Secao titulo={t('sinaisTitulo')}>
            <p>{t('sinais')}</p>
          </Secao>
          <Secao titulo={t('cicloTitulo')}>
            <p>
              {t('ciclo', {
                ciclo: CICLO_MINUTOS,
                espera: Math.round(THROTTLE_MS / 60_000),
              })}
            </p>
          </Secao>
          <Secao titulo={t('estadosTitulo')}>
            <p>{t('estados')}</p>
          </Secao>
          <p className="text-xs text-muted-foreground">{t('custo')}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </p>
      <div className="space-y-1.5 text-sm text-foreground">{children}</div>
    </div>
  );
}
