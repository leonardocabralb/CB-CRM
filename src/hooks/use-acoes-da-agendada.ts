'use client';

// ============================================================
// "Executar agora" e "Cancelar" — as duas ações de uma agendada, num lugar só.
//
// ⚠️ EXTRAÍDO DA FAIXA DA CONVERSA, não reescrito. As duas ações mandam
// mensagem para cliente e apagam registro; duas cópias divergindo é o jeito
// mais silencioso possível de errar isto — a tela nova ganharia, por exemplo,
// um "tentar de novo" onde a faixa já sabia não oferecer (`podeDispararAgora`),
// e o cliente receberia a mesma mensagem duas vezes.
//
// ⚠️ Fica com o namespace `Inbox.scheduled` mesmo sendo usado fora do inbox.
// São os mesmos avisos, palavra por palavra; duplicá-los num namespace novo
// criaria dois textos para a mesma frase, que envelhecem separados.
// ============================================================

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import type { ScheduledMessage } from '@/types';

export interface AcoesDaAgendada {
  /** Id da agendada com ação em curso, ou `null`. Desabilita os botões dela. */
  ocupada: string | null;
  enviarAgora: (a: ScheduledMessage) => Promise<void>;
  cancelar: (a: ScheduledMessage) => Promise<void>;
}

/**
 * @param aoMudar Chamado depois de cada ação, com sucesso ou não — é o que
 *   refaz a lista de quem chamou. Sempre chamado: uma falha também muda o que
 *   está no banco (a linha pode ter virado `failed` com motivo novo).
 */
export function useAcoesDaAgendada(aoMudar: () => void): AcoesDaAgendada {
  const t = useTranslations('Inbox.scheduled');
  const [ocupada, setOcupada] = useState<string | null>(null);

  const enviarAgora = useCallback(
    async (a: ScheduledMessage) => {
      setOcupada(a.id);
      try {
        const res = await fetch(`/api/cb/scheduled/${a.id}/run`, {
          method: 'POST',
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) toast.error(json.error ?? t('sendNowFailed'));
        else toast.success(t('sentNow'));
      } catch {
        toast.error(t('sendNowFailed'));
      } finally {
        setOcupada(null);
        aoMudar();
      }
    },
    [t, aoMudar],
  );

  const cancelar = useCallback(
    async (a: ScheduledMessage) => {
      // ⚠️ O texto fala em "cancelar o envio agendado", nunca em "apagar
      // mensagem": na bolha do chat "Apagar" quer dizer revogar no WhatsApp do
      // cliente, e confundir os dois faz alguém achar que está desfazendo algo
      // que o cliente já viu.
      //
      // ⚠️ E o texto MUDA em `sending`/entrega incerta. Ali a promessa "a
      // mensagem não vai sair" seria falsa: o worker já reivindicou a linha, ou
      // o WhatsApp já aceitou. Cancelar continua permitido — é a única saída
      // para uma linha travada —, mas quem aperta precisa saber o que está e o
      // que não está desfazendo.
      const incerta = a.status === 'sending' || a.entrega_incerta;
      if (
        !window.confirm(t(incerta ? 'cancelConfirmUncertain' : 'cancelConfirm'))
      ) {
        return;
      }
      setOcupada(a.id);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('cb_scheduled_messages')
        .delete()
        .eq('id', a.id)
        .select('id');
      setOcupada(null);
      // ⚠️ Conferir o RESULTADO, não só o erro. Sem policy que case, a RLS
      // devolve zero linhas SEM erro — e um toast de sucesso mentiria. É a
      // armadilha que o CLAUDE.md descreve. Vale mais aqui do que na faixa:
      // `viewer` não tem a policy de DELETE, e é justamente quem mais vai
      // abrir uma tela de consulta.
      if (error) toast.error(t('cancelFailed'));
      else if (!data?.length) toast.error(t('cancelNothing'));
      else toast.success(t('canceled'));
      aoMudar();
    },
    [t, aoMudar],
  );

  return { ocupada, enviarAgora, cancelar };
}
