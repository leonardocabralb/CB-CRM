'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { toast } from 'sonner';

import type { ConversationNote } from '@/types';

/**
 * Apagar uma anotação interna (918), de qualquer tela — e, desde a 1132,
 * restaurá-la da lixeira.
 *
 * ⚠️ Apagar = mandar para a LIXEIRA (1132, decisão do operador de
 * 10/11/2026): a rota `DELETE /api/cb/notes/[id]` MARCA a anotação, e ela
 * fica 90 dias na lixeira da aba Notas. Até a 1132 isto ia DIRETO do
 * navegador (DELETE sob a RLS "autor OU admin"); a régua agora mora na rota
 * (`mudarNaLixeira`), e a volta (`POST …/restaurar`) é a mesma mecânica.
 *
 * ⚠️ Mora aqui, e não dentro de cada tela, pela MESMA razão do
 * `useFixarNota`: são três call sites (o fio, a aba Notas do painel e a do
 * grupo), e o que os une é a guarda abaixo — a parte que é fácil esquecer
 * numa segunda cópia e cujo sintoma é silencioso.
 *
 * ⚠️⚠️ Resposta que não é 2xx (ou a rede que caiu) RECARREGA a lista: a
 * anotação saiu da tela antes da resposta, e sem a recarga ela sumiria e
 * voltaria na próxima abertura, sem nada explicando. Na rede caída a marca
 * PODE ter entrado — por isso recarregar (o banco diz), nunca "não apagou".
 *
 * @param removerLocal  tira a nota da lista antes da resposta (quem apaga vê
 *                      sumir na hora)
 * @param recarregar    desfaz o otimismo relendo a lista quando a rota recusa
 * @param colocar       põe na lista a linha que a rota devolveu (a apagada
 *                      entra na lixeira; a restaurada volta às vivas) sem
 *                      esperar o tempo real
 */
export function useApagarNota(
  removerLocal: (id: string) => void,
  recarregar: () => void | Promise<void>,
  colocar?: (nota: ConversationNote) => void
) {
  const t = useTranslations('Inbox.note');

  /** Devolve `true` quando a anotação voltou (quem chama decide o que mostrar). */
  const restaurarNota = useCallback(
    async (id: string): Promise<boolean> => {
      const { ok, nota } = await pedir(`/api/cb/notes/${id}/restaurar`, 'POST');
      if (ok) {
        if (nota) colocar?.(nota);
        else void recarregar();
        return true;
      }
      toast.error(t('restoreFailed'));
      void recarregar();
      return false;
    },
    [recarregar, colocar, t]
  );

  const apagarNota = useCallback(
    async (id: string) => {
      removerLocal(id);
      const { ok, nota } = await pedir(`/api/cb/notes/${id}`, 'DELETE');
      if (ok) {
        // Sem a linha na resposta (corpo ilegível), o banco diz pela recarga.
        if (nota) colocar?.(nota);
        else void recarregar();
        // A proteção contra o clique sem querer (o pedido da 1132): diz onde
        // ela ficou e oferece desfazer ali mesmo.
        toast.success(t('movedToTrash'), {
          action: { label: t('undoDelete'), onClick: () => void restaurarNota(id) },
        });
        return;
      }
      toast.error(t('deleteFailed'));
      void recarregar();
    },
    [removerLocal, recarregar, colocar, restaurarNota, t]
  );

  return { apagarNota, restaurarNota };
}

/**
 * `ok` = a rota aceitou (2xx); `nota` = a linha que ela devolveu, quando o
 * corpo se lê. Recusa e rede caída = `ok: false`.
 */
async function pedir(
  url: string,
  method: 'DELETE' | 'POST'
): Promise<{ ok: boolean; nota: ConversationNote | null }> {
  try {
    const res = await fetch(url, { method });
    if (!res.ok) return { ok: false, nota: null };
    const corpo = (await res.json().catch(() => null)) as { note?: ConversationNote } | null;
    return { ok: true, nota: corpo?.note ?? null };
  } catch {
    return { ok: false, nota: null };
  }
}
