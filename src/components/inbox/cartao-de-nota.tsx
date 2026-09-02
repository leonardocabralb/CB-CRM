'use client';

import { Pin, PinOff, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import type { ConversationNote } from '@/types';

/**
 * A anotação interna nas ABAS (painel da conversa e barra do grupo).
 *
 * Irmã da `NoteLine`, que é a mesma anotação DENTRO do fio — separadas de
 * propósito: no fio a nota divide espaço com mensagens que o cliente recebeu
 * e precisa destoar (amarela, 85% de largura, centralizada); aqui ela é o
 * conteúdo da coluna e usa a cor do painel.
 *
 * ⚠️ O que as duas PRECISAM ter igual é o que este componente centraliza: o
 * AUTOR e o botão de apagar. Até 2026-09-02 a aba não tinha nenhum dos dois —
 * a mesma anotação mostrava "Fulano anotou:" e uma lixeira no fio, e no painel
 * aparecia sem dono e sem saída. Quem lia pelo painel não sabia de quem era, e
 * quem quisesse apagar tinha de caçar a nota no meio da conversa.
 *
 * ⚠️ Confirmação INLINE, não diálogo (mesma decisão da `NoteLine`): é UMA
 * anotação interna, não sai para o cliente e não tem consequência fora daqui.
 * Um modal para isso seria atrito.
 *
 * ⚠️ Os botões NÃO dependem de hover. No toque do celular não existe hover, e
 * um botão revelado por ele simplesmente não existe — é o que já estava
 * escrito no alfinete do painel, e vale igual para a lixeira.
 */
export function CartaoDeNota({
  nota,
  podeApagar,
  onApagar,
  destaque = false,
  fixada = false,
  fixando = false,
  onFixar,
}: {
  nota: ConversationNote;
  /** Autor ou admin — quem decide de verdade é a RLS; isto só esconde o botão. */
  podeApagar: boolean;
  onApagar: (id: string) => void;
  /** O cartão da nota FIXADA no topo da aba: outra moldura, mesmo conteúdo. */
  destaque?: boolean;
  fixada?: boolean;
  /** Fixação em trânsito: desabilita o botão para não mandar duas vezes. */
  fixando?: boolean;
  /** Ausente = a fixação não é oferecida (nota de grupo não fixa — 951). */
  onFixar?: (fixar: boolean) => void;
}) {
  const t = useTranslations('Inbox.note');
  const tSidebar = useTranslations('Inbox.sidebar');
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2',
        // Sem `sticky` aqui: grudar no topo é decisão de LAYOUT de quem
        // monta a aba (o painel prende o cartão fixado; a barra do grupo nem
        // tem nota fixada — 951 exige contato). O cartão só diz como é.
        destaque ? 'border-primary/40 bg-card border shadow-sm' : 'bg-muted'
      )}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        {destaque ? (
          <span className="text-primary flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase">
            <Pin className="h-3 w-3" />
            {tSidebar('pinnedNote')}
          </span>
        ) : (
          // Mesma frase do fio (`Inbox.note.wrote`), para a anotação ter o
          // mesmo dono nos dois lugares — inclusive a queda para "Alguém da
          // equipe" quando o autor saiu da conta.
          <span className="text-foreground text-[11px] font-semibold">
            {t('wrote', { autor: nota.autor_nome || t('unknownAuthor') })}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-1.5">
          {onFixar && (
            <button
              type="button"
              onClick={() => onFixar(!fixada)}
              disabled={fixando}
              aria-label={fixada ? tSidebar('unpinNote') : tSidebar('pinNote')}
              title={fixada ? tSidebar('unpinNote') : tSidebar('pinNote')}
              className="text-muted-foreground hover:text-foreground -m-1 p-1 transition-colors disabled:opacity-50"
            >
              {fixada ? (
                <PinOff className="h-3.5 w-3.5" />
              ) : (
                <Pin className="h-3 w-3" />
              )}
            </button>
          )}
          {podeApagar &&
            (confirmando ? (
              <span className="flex items-center gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => onApagar(nota.id)}
                  className="text-destructive font-semibold underline underline-offset-2 hover:opacity-80"
                >
                  {t('confirmDelete')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmando(false)}
                  className="text-muted-foreground underline underline-offset-2 hover:opacity-80"
                >
                  {t('cancelDelete')}
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label={t('delete')}
                title={t('delete')}
                onClick={() => setConfirmando(true)}
                className="text-muted-foreground hover:text-destructive -m-1 p-1 transition-colors"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            ))}
        </span>
      </div>
      {/* No cartão de destaque o autor não cabe no cabeçalho (ele é do rótulo
          "Fixada"), então vem aqui — a informação não pode sumir só porque a
          nota foi fixada. */}
      {destaque && (
        <p className="text-muted-foreground mb-1 text-[11px] font-semibold">
          {t('wrote', { autor: nota.autor_nome || t('unknownAuthor') })}
        </p>
      )}
      <p
        className={cn(
          'text-xs whitespace-pre-wrap',
          // ⚠️ `break-words`: a anotação recebe texto de fora (link de
          // processo colado, número sem espaços) e a coluna do painel é
          // estreita — sem isto ela empurra a largura e acende barra
          // horizontal, a armadilha que o CLAUDE.md registra sobre a bolha
          // do fio.
          'break-words',
          destaque ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {nota.texto}
      </p>
      <p className="text-muted-foreground mt-1 text-[10px]">
        {/* Locale do NAVEGADOR (undefined), nunca fixo — o formato antigo do
            date-fns imprimia "Aug 29" num app pt-BR. */}
        {new Date(nota.created_at).toLocaleString(undefined, {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
    </div>
  );
}
