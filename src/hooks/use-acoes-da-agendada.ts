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
import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';
import { deleteAccountMedia } from '@/lib/storage/upload-media';
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
        // ⚠️ Devolve as colunas que decidem o destino do ARQUIVO, e elas vêm
        // da linha como ela estava no banco no instante do DELETE — nunca do
        // objeto em memória. A lista desta tela é uma foto de segundos atrás:
        // o worker pode ter enviado a mensagem nesse meio-tempo, e decidir
        // pelo `a.status` que a tela guarda apagaria o anexo de uma mensagem
        // que já está no fio do cliente.
        .select('id, message_id, media_path, status, entrega_incerta');
      setOcupada(null);
      // ⚠️ Conferir o RESULTADO, não só o erro. Sem policy que case, a RLS
      // devolve zero linhas SEM erro — e um toast de sucesso mentiria. É a
      // armadilha que o CLAUDE.md descreve.
      //
      // O caso vivo NÃO é o `viewer` (as duas telas escondem o botão dele por
      // `useCan('send-messages')`): é a corrida. Duas pessoas na mesma linha,
      // ou o worker enviando enquanto alguém cancela — a linha some, o DELETE
      // não acha nada, e sem esta checagem a tela diria "cancelada" sobre uma
      // mensagem que acabou de chegar ao cliente.
      if (error) toast.error(t('cancelFailed'));
      else if (!data?.length) toast.error(t('cancelNothing'));
      else {
        toast.success(t('canceled'));
        // ⚠️ O arquivo só sai junto quando NADA MAIS pode estar usando ele —
        // e são três perguntas, não uma (932). Errar aqui não deixa lixo: deixa
        // um anexo quebrado numa conversa que o cliente já teve.
        //
        // ⚠️ E os campos vêm do RETORNO do delete, nunca do objeto em memória:
        // a lista da tela é uma foto de segundos atrás, e entre a carga e o
        // clique o worker pode ter enviado.
        //
        //  · `message_id` preenchido → existe linha em `messages` apontando
        //    para o arquivo. É a bolha que está no fio do escritório.
        //  · `sending` → o worker está esperando a Evolution NESTE instante
        //    (até 90s num envio de mídia), e ela precisa baixar a URL. Apagar
        //    no meio derruba um envio em curso.
        //  · `entrega_incerta` → o processo morreu depois de reivindicar.
        //    Pode existir linha em `messages` gravada antes da queda, sem o
        //    `message_id` ter chegado a ser carimbado de volta.
        //
        // Silencioso e sem `await`: o cancelamento já deu certo, e um erro de
        // limpeza vira lixo no bucket, não um recado que o operador possa
        // resolver. Lixo raro é mais barato que anexo quebrado.
        const apagada = data[0] as {
          message_id?: string | null;
          media_path?: string | null;
          status?: string | null;
          entrega_incerta?: boolean | null;
        };
        const podeApagarArquivo =
          !!apagada?.media_path &&
          !apagada.message_id &&
          !apagada.entrega_incerta &&
          apagada.status !== 'sending';
        if (podeApagarArquivo) {
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, apagada.media_path!).catch(
            () => {},
          );
        }
      }
      aoMudar();
    },
    [t, aoMudar],
  );

  return { ocupada, enviarAgora, cancelar };
}
