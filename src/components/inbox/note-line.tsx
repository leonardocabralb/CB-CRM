'use client';

import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ConversationNote } from '@/types';

/**
 * A anotação interna DENTRO da conversa (migration 918).
 *
 * ⚠️ Amarela e com rótulo explícito de propósito. Ela divide o fio com
 * mensagens que o cliente recebeu, e o único erro caro possível aqui é o
 * operador achar que uma coisa foi enviada quando não foi — por isso a cor
 * destoa das duas bolhas de mensagem e o cabeçalho diz o que é.
 *
 * Diferente da linha de evento do lead (`LeadEventLine`, discreta e
 * centralizada): a anotação é ato de gente, tem autor e precisa ser lida.
 *
 * Fica fora do `MessageActions` — não se responde, não se reage e não se
 * encaminha uma anotação. O mesmo padrão do aviso de sistema de grupo.
 */
export function NoteLine({
  nota,
  podeApagar,
  onApagar,
}: {
  nota: ConversationNote;
  podeApagar: boolean;
  onApagar: (id: string) => void;
}) {
  const t = useTranslations('Inbox.note');
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div className="flex justify-center py-1">
      <div className="w-full max-w-[85%] rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-50">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold">
            {t('wrote', { autor: nota.autor_nome || t('unknownAuthor') })}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="text-[10px] opacity-70">
              {format(new Date(nota.created_at), 'HH:mm')}
            </span>
            {podeApagar &&
              (confirmando ? (
                // Confirmação inline em vez de diálogo: a exclusão é de UMA
                // anotação interna, não sai para o cliente e não tem
                // consequência fora daqui. Um modal para isso seria atrito.
                <span className="flex items-center gap-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => onApagar(nota.id)}
                    className="font-semibold underline underline-offset-2 hover:opacity-80"
                  >
                    {t('confirmDelete')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmando(false)}
                    className="opacity-70 underline underline-offset-2 hover:opacity-100"
                  >
                    {t('cancelDelete')}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  title={t('delete')}
                  onClick={() => setConfirmando(true)}
                  className="opacity-60 transition-opacity hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              ))}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words">{nota.texto}</p>
      </div>
    </div>
  );
}
