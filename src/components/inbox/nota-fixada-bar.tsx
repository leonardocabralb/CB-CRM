'use client';

import { ChevronDown, ChevronUp, Pin, PinOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { ConversationNote } from '@/types';

/**
 * A anotação FIXADA (migration 951) presa no topo da conversa.
 *
 * ⚠️ Irmã `shrink-0` da área de rolagem, não filha dela. Dentro do
 * scrollport (como o cartão sticky da aba Notas do painel) ela flutuaria por
 * cima das bolhas e cobriria justamente o alvo do salto da busca, que
 * centraliza a mensagem no topo visível. Fora, ela só encolhe a lista.
 *
 * ⚠️ Âmbar, igual à `NoteLine`, e não a cor do cartão do painel. A cor aqui
 * carrega significado: no fio ela divide a tela com mensagens que o cliente
 * recebeu, e o único erro caro é o operador achar que a anotação foi enviada.
 *
 * A fixada continua aparecendo no fluxo cronológico, no dia em que foi
 * escrita — esta faixa é atalho, não mudança do histórico.
 *
 * ⚠️ Quem monta passa `key={nota.id}`: "expandido" é estado da leitura DESTA
 * anotação, e sem o remonte a próxima fixada nasceria já aberta na tela.
 */
export function NotaFixadaBar({
  nota,
  onDesafixar,
  desafixando = false,
}: {
  nota: ConversationNote;
  onDesafixar: () => void;
  desafixando?: boolean;
}) {
  const t = useTranslations('Inbox.note');
  const [aberto, setAberto] = useState(false);
  const [truncado, setTruncado] = useState(false);
  const textoRef = useRef<HTMLParagraphElement>(null);

  /**
   * Só oferece "ver mais" quando o texto está CORTADO de verdade.
   *
   * ⚠️ Medido, nunca estimado por número de caracteres: o fio muda de
   * largura sem a janela mudar (abrir e fechar o painel do contato), então
   * um chute ora oferece o botão numa nota que já está inteira na tela, ora
   * o esconde numa que está cortada. Daí o `ResizeObserver`.
   *
   * Mede só FECHADO: aberto, o texto rola dentro do próprio bloco e
   * `scrollHeight > clientHeight` passa a ser o normal, não truncamento.
   */
  useEffect(() => {
    if (aberto) return;
    const el = textoRef.current;
    if (!el) return;
    const medir = () => setTruncado(el.scrollHeight - el.clientHeight > 1);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aberto, nota.texto]);

  const quando = new Date(nota.created_at).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-50">
      <Pin className="mt-1 h-3.5 w-3.5 shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-semibold tracking-wider uppercase opacity-70">
          {t('pinnedBanner')} · {nota.autor_nome || t('unknownAuthor')} ·{' '}
          {quando}
        </p>
        <p
          ref={textoRef}
          className={cn(
            'mt-0.5 text-xs break-words whitespace-pre-wrap',
            // Teto ao expandir: anotação longa não pode empurrar a conversa
            // inteira para fora da tela. Rola dentro do próprio bloco.
            aberto ? 'max-h-32 overflow-y-auto' : 'line-clamp-2'
          )}
        >
          {nota.texto}
        </p>
      </div>
      {(truncado || aberto) && (
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-label={aberto ? t('collapse') : t('expand')}
          title={aberto ? t('collapse') : t('expand')}
          className="-m-1 shrink-0 p-1 opacity-60 transition-opacity hover:opacity-100"
        >
          {aberto ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      <button
        type="button"
        onClick={onDesafixar}
        disabled={desafixando}
        aria-label={t('unpin')}
        title={t('unpin')}
        className="-m-1 shrink-0 p-1 opacity-60 transition-opacity hover:opacity-100 disabled:opacity-30"
      >
        <PinOff className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
