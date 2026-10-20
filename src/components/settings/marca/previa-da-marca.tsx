'use client';

import type { ReactNode } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { LogoDaMarca, SimboloDaMarca } from '@/components/marca/logo-da-marca';
import type { Marca } from '@/lib/marca';
import { cn } from '@/lib/utils';

import { CaixaDeFundo } from './peca-visual';

// ============================================================
// A PRÉVIA da marca: os lugares onde ela aparece, desenhados com os mesmos
// componentes da barra lateral e do login (`LogoDaMarca`/`SimboloDaMarca`),
// com `marca=` (o rascunho, ainda não gravado) e `fundo=` (os dois modos ao
// mesmo tempo, cada um no seu fundo).
//
// Os tamanhos imitam os de verdade (as mesmas classes do logo na
// `sidebar.tsx` e no cartão do login, `max-w-md`): o nome comprido que a
// barra lateral corta aparece cortado aqui também. O ícone do app é um
// quadrado de cantos de iOS com o símbolo a 50% sobre a cor de fundo.
// ============================================================

export function PreviaDaMarca({ marca }: { marca: Marca }) {
  const t = useTranslations('Settings.marca');

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <Bloco
        titulo={t('previaBarraLateral')}
        onde={<Onde pc celular />}
        className="md:col-span-2"
      >
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {(['escuro', 'claro'] as const).map((fundo) => (
            <figure key={fundo} className="min-w-0 space-y-1">
              <CaixaDeFundo
                fundo={fundo}
                className="h-14 max-w-60 justify-start px-4"
              >
                <LogoDaMarca
                  forma="horizontal"
                  fundo={fundo}
                  marca={marca}
                  className="h-7 w-auto max-w-44"
                />
              </CaixaDeFundo>
              <figcaption className="text-muted-foreground text-xs">
                {fundo === 'escuro'
                  ? t('previaModoEscuro')
                  : t('previaModoClaro')}
              </figcaption>
            </figure>
          ))}
        </div>
      </Bloco>

      <Bloco
        titulo={t('previaLogin')}
        onde={<Onde pc celular />}
        className="md:col-span-2"
      >
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {(['escuro', 'claro'] as const).map((fundo) => (
            <figure key={fundo} className="min-w-0 space-y-1">
              <CaixaDeFundo fundo={fundo} className="h-36 max-w-md px-6">
                <LogoDaMarca
                  forma="vertical"
                  fundo={fundo}
                  marca={marca}
                  className="h-20 w-auto max-w-full sm:h-24"
                />
              </CaixaDeFundo>
              <figcaption className="text-muted-foreground text-xs">
                {fundo === 'escuro'
                  ? t('previaModoEscuro')
                  : t('previaModoClaro')}
              </figcaption>
            </figure>
          ))}
        </div>
      </Bloco>

      <Bloco titulo={t('previaIconeDoApp')} onde={<Onde celular />}>
        <div className="bg-muted flex min-w-0 justify-center rounded-md px-4 py-5">
          <figure className="flex w-20 min-w-0 flex-col items-center gap-1.5">
            <span
              className="flex size-16 items-center justify-center rounded-[22%] shadow-sm"
              style={{ backgroundColor: marca.corDoIcone }}
            >
              <SimboloDaMarca marca={marca} className="size-8" />
            </span>
            <figcaption className="text-foreground w-full truncate text-center text-xs">
              {marca.nomeCurto}
            </figcaption>
          </figure>
        </div>
      </Bloco>

      <Bloco titulo={t('previaAbaDoNavegador')} onde={<Onde pc />}>
        <div className="bg-muted min-w-0 rounded-md px-3 pt-4">
          <div className="bg-background flex w-full max-w-56 min-w-0 items-center gap-2 rounded-t-lg px-3 py-2 shadow-sm">
            <SimboloDaMarca marca={marca} className="size-4" />
            <span className="text-foreground min-w-0 truncate text-xs">
              {marca.nome}
            </span>
          </div>
        </div>
      </Bloco>
    </div>
  );
}

function Bloco({
  titulo,
  onde,
  className,
  children,
}: {
  titulo: string;
  onde: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('min-w-0 space-y-2', className)}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 className="text-foreground text-sm font-medium">{titulo}</h4>
        {onde}
      </div>
      {children}
    </section>
  );
}

/** Os selos "PC" / "Celular" de cada lugar da prévia. */
function Onde({
  pc = false,
  celular = false,
}: {
  pc?: boolean;
  celular?: boolean;
}) {
  const t = useTranslations('Settings.marca');
  return (
    <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-xs">
      {pc ? (
        <span className="inline-flex items-center gap-1">
          <Monitor aria-hidden="true" className="size-3.5" />
          {t('previaPc')}
        </span>
      ) : null}
      {celular ? (
        <span className="inline-flex items-center gap-1">
          <Smartphone aria-hidden="true" className="size-3.5" />
          {t('previaCelular')}
        </span>
      ) : null}
    </span>
  );
}
