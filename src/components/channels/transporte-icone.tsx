// ============================================================
// O ícone de cada transporte, num lugar só.
//
// Antes, cada tela desenhava `kind === 'meta' ? <BadgeCheck/> : <QrCode/>`
// — um ternário de dois braços que daria o QR Code a um canal Instagram.
// Aqui o `switch` é sobre o tipo `Transporte` inteiro: transporte novo sem
// ícone não compila.
// ============================================================

import { BadgeCheck, QrCode } from 'lucide-react';

import type { Transporte } from '@/lib/cb-channels/transporte';

import { InstagramGlyph } from './instagram-glyph';

export function IconeDoTransporte({
  kind,
  className,
}: {
  kind: Transporte;
  className?: string;
}) {
  switch (kind) {
    case 'meta':
      return <BadgeCheck className={className} />;
    case 'evolution':
      return <QrCode className={className} />;
    case 'instagram':
      return <InstagramGlyph className={className} />;
    default: {
      // `tsconfig` não tem `noImplicitReturns`: sem isto, um 4º transporte
      // compilaria e o ícone sumiria em silêncio (Codex, PR #170).
      const nunca: never = kind;
      throw new Error(`transporte sem ícone: ${String(nunca)}`);
    }
  }
}
