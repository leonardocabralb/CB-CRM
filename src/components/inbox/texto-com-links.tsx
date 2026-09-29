'use client';

// ============================================================
// Link clicável dentro de texto — a bolha do fio (via `FormattedText`) e as
// anotações internas (pedido do operador, 29/09/2026). A detecção mora em
// `src/lib/inbox/links-no-texto.ts`.
// ============================================================

import { Fragment } from 'react';

import { partirEmLinks } from '@/lib/inbox/links-no-texto';

/**
 * Um endereço como link. Abre em aba nova: a conversa não pode sumir da tela
 * no clique. `noreferrer` porque o endereço da página carrega o id da
 * conversa, e o site de fora não tem por que saber dele.
 *
 * Cor HERDADA com sublinhado, nunca uma cor própria: a mesma peça vai na bolha
 * violeta da equipe (texto claro), na bolha do cliente e no cartão da nota.
 *
 * ⚠️ `onContextMenu` para aqui: a linha da mensagem (`message-actions.tsx`)
 * troca o menu do botão direito — e o toque longo do celular — pela barra de
 * ações. Sobre um link, o menu tem de ser o do navegador ("copiar endereço").
 */
export function LinkDoTexto({ href, texto }: { href: string; texto: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      onContextMenu={(e) => e.stopPropagation()}
      className="underline underline-offset-2 hover:opacity-80"
    >
      {texto}
    </a>
  );
}

/**
 * Texto puro com os endereços clicáveis — para a ANOTAÇÃO, que não passa pela
 * formatação do WhatsApp (asterisco na nota continua asterisco). Vai dentro
 * do `<p>` de quem chama, que já cuida de quebra de linha e de palavra longa.
 */
export function TextoComLinks({ texto }: { texto: string | null | undefined }) {
  return (
    <>
      {partirEmLinks(texto).map((trecho, i) =>
        trecho.tipo === 'link' ? (
          <LinkDoTexto key={i} href={trecho.href} texto={trecho.texto} />
        ) : (
          <Fragment key={i}>{trecho.texto}</Fragment>
        )
      )}
    </>
  );
}
