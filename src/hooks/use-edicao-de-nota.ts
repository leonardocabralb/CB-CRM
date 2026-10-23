'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { destinoDaEdicao, idDoAvisoDeApagada, type EdicaoEmCurso } from '@/lib/notes/edicao';
import type { ConversationNote } from '@/types';

/**
 * Qual anotação está sendo EDITADA no lugar (Fase 3 da anotação com anexos),
 * para quem monta a lista: o fio, a aba Notas do painel e a do grupo. Quem
 * monta troca o cartão da nota pela caixa (`InternalNoteBox` com `editando`)
 * quando `editandoId` é o dela.
 *
 * - ⚠️ Carimbada com a CONVERSA e conferida no render (efeito passivo, raiz
 *   8c): o fio não remonta na troca, e a edição de uma nota de A não pode
 *   aparecer em B. E SOLTA no render — sem `setState` síncrono em efeito, a
 *   regra do React Compiler — quando a conversa muda OU a nota sai da lista.
 *   Sem soltar, a volta (A → B → A) e a recarga boa depois de uma que falhou
 *   (a falha esvazia a lista, e a caixa some com o rascunho) REABRIAM a caixa
 *   sozinhas.
 * - Uma de cada vez: editar outra fecha a primeira (a caixa desmonta e
 *   descarta o rascunho, como o Cancelar).
 * - ⚠️ A nota que sai da lista RESPONDIDA (`pronta`) foi apagada por alguém
 *   (o tempo real ou a recarga a tirou): a caixa desmonta com ela, e um aviso
 *   diz por quê — senão o texto escrito sumiria sem explicação. Lista vazia
 *   por busca que FALHOU também solta a edição, mas sem o aviso: falha não é
 *   "apagada".
 */
export function useEdicaoDeNota(
  conversationId: string | null | undefined,
  notas: readonly ConversationNote[],
  pronta: boolean
) {
  const t = useTranslations('Inbox.composer');
  const [edicao, setEdicao] = useState<EdicaoEmCurso | null>(null);
  // A nota em edição que saiu da lista RESPONDIDA — o aviso de apagada.
  const [apagada, setApagada] = useState<string | null>(null);

  // No render, nunca em efeito (ver o cabeçalho e `destinoDaEdicao`).
  const destino = destinoDaEdicao(edicao, conversationId, notas, pronta);
  if (destino.soltar) {
    if (destino.apagada) setApagada(destino.apagada);
    setEdicao(null);
  }

  // Só o AVISO mora no efeito (não é estado). Uma vez por nota: `apagada` só
  // muda quando a edição de OUTRA (ou uma nova) começa.
  useEffect(() => {
    if (apagada) toast.error(t('noteEditGone'), { id: idDoAvisoDeApagada(apagada) });
  }, [apagada, t]);

  const editar = useCallback(
    (nota: ConversationNote) => {
      if (!conversationId) return;
      // Edição NOVA: se esta nota sumir, avisa (de novo, se já avisou antes).
      setApagada(null);
      setEdicao({ de: conversationId, id: nota.id });
    },
    [conversationId]
  );
  const pararDeEditar = useCallback(() => setEdicao(null), []);

  return {
    /** A nota em edição NESTA conversa e ainda na lista; `null` = nenhuma. */
    editandoId: destino.editandoId,
    editar,
    pararDeEditar,
  };
}
