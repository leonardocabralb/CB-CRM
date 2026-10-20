'use client';

import type { ReactNode } from 'react';
import { Download, Monitor, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { ARQUIVOS_PADRAO, NOME_PADRAO, type PecaDaMarca } from '@/lib/marca';
import { cn } from '@/lib/utils';

import {
  LADO_MAXIMO_DO_SIMBOLO,
  LADO_MINIMO_DO_SIMBOLO,
} from '@/lib/marca-validacao';

import { fundoDaPeca, nomeDoArquivo, tetoLegivel } from './rascunho';

// ============================================================
// Peças visuais da aba Marca, usadas nos cartões das peças e nos exemplos.
//
// ⚠️ O fundo é FIXO (escuro = o fundo do app no modo escuro; claro =
// branco), nunca o tema de quem olha: a peça "para fundo escuro" tem texto
// branco, e desenhada sobre o tema claro sumiria — a pessoa concluiria que
// o arquivo está errado. O `dark:` está inerte no projeto; aqui nem se
// tenta seguir o tema.
// ============================================================

type Fundo = 'escuro' | 'claro';

const CLASSE_DO_FUNDO: Record<Fundo, string> = {
  escuro: 'border-slate-800 bg-slate-950',
  claro: 'border-slate-200 bg-white',
};

export function CaixaDeFundo({
  fundo,
  className,
  children,
}: {
  fundo: Fundo;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center justify-center overflow-hidden rounded-md border',
        CLASSE_DO_FUNDO[fundo],
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Uma imagem de peça (gravada, escolhida ou de exemplo) no fundo dela: o
 * símbolo nos dois fundos, lado a lado; as outras no seu.
 */
export function ImagemNoFundo({
  peca,
  src,
  alt,
  compacta = false,
}: {
  peca: PecaDaMarca;
  src: string;
  alt: string;
  /** Miniatura (linha de exemplo dentro do cartão). */
  compacta?: boolean;
}) {
  const fundo = fundoDaPeca(peca);
  // `<img>`, não `next/image`: imagem de configuração (Storage,
  // `public/marca/` ou a URL de objeto do arquivo ainda não salvo), que
  // nenhuma allow-list de origem cobre.
  const imagem = (classe: string) => (
    // eslint-disable-next-line @next/next/no-img-element -- ver acima.
    <img
      src={src}
      alt={alt}
      className={cn('max-h-full max-w-full object-contain', classe)}
    />
  );

  if (fundo === 'ambos') {
    const altura = compacta ? 'h-12' : 'h-20';
    const lado = compacta ? 'size-8' : 'size-12';
    return (
      <div className="grid min-w-0 grid-cols-2 gap-1.5">
        <CaixaDeFundo fundo="escuro" className={altura}>
          {imagem(lado)}
        </CaixaDeFundo>
        <CaixaDeFundo fundo="claro" className={altura}>
          {imagem(lado)}
        </CaixaDeFundo>
      </div>
    );
  }

  const horizontal = peca.startsWith('horizontal');
  return (
    <CaixaDeFundo
      fundo={fundo}
      className={cn('px-3', compacta ? 'h-12' : 'h-20')}
    >
      {imagem(
        horizontal
          ? compacta
            ? 'h-6 w-auto'
            : 'h-9 w-auto'
          : compacta
            ? 'h-10 w-auto'
            : 'h-16 w-auto'
      )}
    </CaixaDeFundo>
  );
}

/** Onde a peça aparece, no computador e no celular (a tabela do plano). */
export function OndeAparece({ peca }: { peca: PecaDaMarca }) {
  const t = useTranslations('Settings.marca');
  return (
    <ul className="text-muted-foreground space-y-1 text-xs">
      <li className="flex min-w-0 gap-1.5">
        <Monitor aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">
          <span className="sr-only">{t('noComputador')}: </span>
          {t(`pecas.${peca}.pc`)}
        </span>
      </li>
      <li className="flex min-w-0 gap-1.5">
        <Smartphone aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">
          <span className="sr-only">{t('noCelular')}: </span>
          {t(`pecas.${peca}.celular`)}
        </span>
      </li>
    </ul>
  );
}

/** O formato recomendado da peça. */
export function FormatoDaPeca({ peca }: { peca: PecaDaMarca }) {
  const t = useTranslations('Settings.marca');
  return (
    <p className="text-muted-foreground text-xs">
      <span className="text-foreground font-medium">{t('formatoLabel')}:</span>{' '}
      {t(`pecas.${peca}.formato`, {
        tamanho: tetoLegivel(),
        minimo: LADO_MINIMO_DO_SIMBOLO,
        maximo: LADO_MAXIMO_DO_SIMBOLO,
      })}
    </p>
  );
}

/** "Baixar exemplo": o arquivo do padrão, com `download` (salva, não abre). */
export function BaixarExemplo({ peca }: { peca: PecaDaMarca }) {
  const t = useTranslations('Settings.marca');
  const caminho = ARQUIVOS_PADRAO[peca];
  return (
    <a
      href={caminho}
      download={nomeDoArquivo(caminho)}
      className="text-primary inline-flex items-center gap-1.5 text-xs font-medium underline-offset-4 hover:underline"
    >
      <Download aria-hidden="true" className="size-3.5 shrink-0" />
      {t('baixarExemplo')}
    </a>
  );
}

/** O exemplo do padrão para a peça: a miniatura no fundo certo + baixar. */
export function ExemploDaPeca({ peca }: { peca: PecaDaMarca }) {
  const t = useTranslations('Settings.marca');
  return (
    <div className="border-border grid min-w-0 gap-2 border-t border-dashed pt-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-center">
      <ImagemNoFundo peca={peca} src={ARQUIVOS_PADRAO[peca]} alt="" compacta />
      <div className="min-w-0 space-y-1">
        <p className="text-muted-foreground text-xs">
          {t('exemploDoPadrao', { nomePadrao: NOME_PADRAO })}
        </p>
        <BaixarExemplo peca={peca} />
      </div>
    </div>
  );
}
