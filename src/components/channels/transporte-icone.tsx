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
  }
}
