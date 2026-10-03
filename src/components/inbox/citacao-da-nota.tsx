'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { ConversationNote } from '@/types';

/**
 * A anotação RESPONDIDA, citada em cima da resposta (1075) — como a citação
 * da resposta do WhatsApp (decisão do operador, 01/10/2026). A mesma peça vai
 * no fio (`NoteLine`), nas abas (`CartaoDeNota`), na ficha de `/contatos` e na
 * caixa de escrever (`InternalNoteBox`, com o X que desiste de responder).
 *
 * ⚠️ `original` nulo = a respondida não está na lista desta tela (apagada há
 * um instante, antes de o `SET NULL` da FK chegar pelo tempo real). Diz
 * "indisponível", nunca "apagada": a tela não sabe qual dos dois.
 *
 * Cor HERDADA (`currentColor` na borda): a mesma peça vai na nota amarela do
 * fio e no cartão do painel.
 */
export function CitacaoDaNota({
  original,
  onIr,
  onCancelar,
  className,
}: {
  original: ConversationNote | null;
  /** Leva até a respondida (no fio). Ausente = a citação não é botão. */
  onIr?: () => void;
  /** O X da caixa de escrever: desiste de responder, o texto fica. */
  onCancelar?: () => void;
  className?: string;
}) {
  const t = useTranslations('Inbox.note');
  const autor = original
    ? original.autor_nome || t('unknownAuthor')
    : null;

  const conteudo = (
    <>
      <span className="block truncate text-xs font-semibold">
        {autor ?? t('originalUnavailable')}
      </span>
      {original && (
        // `break-words` + `line-clamp-2`: link colado na anotação não pode
        // alargar a bolha (a armadilha de `min-width: auto` da raiz).
        <span className="line-clamp-2 text-xs break-words whitespace-pre-wrap opacity-80">
          {original.texto}
        </span>
      )}
    </>
  );

  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-md border-l-2 border-current/40 bg-black/[0.04] px-2 py-1',
        className
      )}
    >
      {onIr && original ? (
        <button
          type="button"
          onClick={onIr}
          title={t('goToOriginal')}
          aria-label={t('goToOriginal')}
          className="min-w-0 flex-1 text-left hover:opacity-80"
        >
          {conteudo}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{conteudo}</div>
      )}
      {onCancelar && (
        <button
          type="button"
          onClick={onCancelar}
          title={t('cancelReply')}
          aria-label={t('cancelReply')}
          className="-m-1 shrink-0 p-1 opacity-60 hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
