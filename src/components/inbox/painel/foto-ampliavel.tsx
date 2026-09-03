'use client';

// ============================================================
// A foto do cabeçalho do painel (contato ou grupo) como BOTÃO: clicar abre o
// visualizador de mídia do inbox — o mesmo das imagens do fio, com zoom e
// giro (pedido do operador, 2026-09-03, junto com a foto de perfil da 973).
//
// Sem foto, devolve o `fallback` (inicial ou ícone) sem botão nenhum: um
// botão que não abre nada seria mira de dardo para leitor de tela.
//
// ⚠️ O visualizador sai por PORTAL para o `body` (achado do Codex no PR
// #112): no tablet o painel lateral é uma gaveta com `translate-x` e
// `overflow-hidden` (inbox/page), e um elemento com `transform` vira o
// containing block de qualquer `position: fixed` dentro dele — o
// `inset-0` do visualizador passava a ser "os 400px da gaveta", com a foto
// ampliada cortada. No fio isso nunca apareceu porque o fio não tem
// transform. O portal é só daqui: a bolha continua montando o visualizador
// inline, e mudar o próprio `MediaViewer` mexeria num arquivo que é nosso
// inteiro e já carrega o giro/zoom.
// ============================================================

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';

import { MediaViewer } from '@/components/inbox/media-viewer';

export function FotoAmpliavel({
  src,
  alt,
  fallback,
}: {
  src: string | null | undefined;
  alt: string;
  fallback: React.ReactNode;
}) {
  const t = useTranslations('Inbox.sidebar');
  const [ampliada, setAmpliada] = useState(false);

  if (!src) return <>{fallback}</>;

  return (
    <>
      <button
        type="button"
        onClick={() => setAmpliada(true)}
        aria-label={t('enlargePhoto')}
        title={t('enlargePhoto')}
        className="h-10 w-10 shrink-0 cursor-zoom-in overflow-hidden rounded-full transition-opacity hover:opacity-80"
      >
        <img src={src} alt={alt} className="h-10 w-10 rounded-full object-cover" />
      </button>
      {ampliada &&
        createPortal(
          <MediaViewer src={src} alt={alt} onClose={() => setAmpliada(false)} />,
          document.body,
        )}
    </>
  );
}
