'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { ConversationNote } from '@/types';

/**
 * O id do aviso "a anotação foi apagada", o MESMO aqui e na caixa: a nota
 * apagada no meio do Salvar acende os dois (a lista a perde e o `PUT` responde
 * `NOTE_GONE`), e o sonner junta avisos de mesmo id num só.
 */
export function idDoAvisoDeApagada(notaId: string): string {
  return `nota-apagada-na-edicao:${notaId}`;
}

/**
 * Qual anotação está sendo EDITADA no lugar (Fase 3 da anotação com anexos),
 * para quem monta a lista: o fio, a aba Notas do painel e a do grupo. Quem
 * monta troca o cartão da nota pela caixa (`InternalNoteBox` com `editando`)
 * quando `editandoId` é o dela.
 *
 * - ⚠️ Carimbada com a CONVERSA e comparada no render (efeito passivo, raiz
 *   8c): o fio não remonta na troca, e a edição de uma nota de A não pode
 *   aparecer em B. E zerada ao sair da conversa, no render — na volta
 *   (A → B → A) a caixa de edição reapareceria sem ninguém pedir.
 * - Uma de cada vez: editar outra fecha a primeira (a caixa desmonta e
 *   descarta o rascunho, como o Cancelar).
 * - ⚠️ A nota SUMIU durante a edição (alguém a apagou e o tempo real a tirou
 *   da lista): a caixa desmonta com ela, e um aviso diz por quê — senão o
 *   texto escrito sumiria sem explicação. Só com a lista RESPONDIDA
 *   (`pronta`): uma busca que falhou esvazia a lista e não quer dizer
 *   "apagada".
 */
export function useEdicaoDeNota(
  conversationId: string | null | undefined,
  notas: readonly ConversationNote[],
  pronta: boolean
) {
  const t = useTranslations('Inbox.composer');
  const [edicao, setEdicao] = useState<{ de: string; id: string } | null>(null);
  if (edicao && edicao.de !== conversationId) setEdicao(null);
  const daConversa = edicao && edicao.de === conversationId ? edicao.id : null;
  const sumiu = daConversa !== null && pronta && !notas.some((n) => n.id === daConversa);

  // Só o AVISO mora no efeito (não é estado): ele dispara uma vez por nota,
  // quando ela deixa a lista — uma recarga que falha e depois volta faria
  // `sumiu` piscar e repetir o aviso.
  const avisadaRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sumiu || !daConversa || avisadaRef.current === daConversa) return;
    avisadaRef.current = daConversa;
    toast.error(t('noteEditGone'), { id: idDoAvisoDeApagada(daConversa) });
  }, [sumiu, daConversa, t]);

  const editar = useCallback(
    (nota: ConversationNote) => {
      if (!conversationId) return;
      // Edição NOVA: se esta nota sumir de novo, avisa de novo.
      avisadaRef.current = null;
      setEdicao({ de: conversationId, id: nota.id });
    },
    [conversationId]
  );
  const pararDeEditar = useCallback(() => setEdicao(null), []);

  return {
    /** A nota em edição NESTA conversa e ainda na lista; `null` = nenhuma. */
    editandoId: sumiu ? null : daConversa,
    editar,
    pararDeEditar,
  };
}
