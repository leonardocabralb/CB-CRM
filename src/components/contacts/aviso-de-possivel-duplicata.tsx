"use client";

// ============================================================
// O AVISO de possível duplicata (1088) inteiro: a faixa, o "Comparar" e qual
// candidata está aberta. Mora no fio da conversa e no formulário do card
// aberto pelo quadro — os dois montam só isto.
//
// ⚠️ Remonta a cada ficha (`key` com o contato, aqui dentro): o diálogo
// aberto é estado DESTA ficha. Carimbar o estado com o contato não bastava —
// trocar de conversa com o "Comparar" aberto (o aviso do navegador, o
// voltar) o escondia, e voltar à primeira o reabria sem clique (revisão do
// PR #403). Remontar zera, sem efeito de limpeza.
// ============================================================

import { useState } from "react";

import { useCan } from "@/hooks/use-can";
import { usePossiveisDuplicatas } from "@/hooks/use-possiveis-duplicatas";
import type { Candidata } from "@/lib/contacts/duplicatas";

import { CompararFichasDialog } from "./comparar-fichas-dialog";
import { FaixaDePossivelDuplicata } from "./faixa-de-possivel-duplicata";

interface Props {
  /** A ficha de quem abriu (a conversa ou o card). */
  contatoId: string;
  /** O token de resync da página (voltar à aba, reconexão). */
  resyncToken?: number;
  /** Abrir a conversa da OUTRA ficha. Sem ele, o botão não existe no "Comparar". */
  aoAbrirConversa?: (conversaId: string) => void;
  /** As margens de quem monta. */
  className?: string;
}

function AvisoDaFicha({ contatoId, resyncToken = 0, aoAbrirConversa, className }: Props) {
  const duplicatas = usePossiveisDuplicatas(contatoId, resyncToken);
  // Todos veem e comparam; decidir é de admin (D1).
  const podeDecidir = useCan("decide-duplicates");
  const [comparando, setComparando] = useState<Candidata | null>(null);

  return (
    <>
      <FaixaDePossivelDuplicata
        candidatas={duplicatas.candidatas}
        podeDecidir={podeDecidir}
        aoComparar={setComparando}
        className={className}
      />
      {/* `key` pela candidata: o formulário de "ligar" é rascunho e não
          sobrevive à troca. Dentro do Sheet do card, o diálogo fica na árvore
          dele de propósito: o base-ui reconhece o ANINHADO e não briga pelo
          foco. */}
      <CompararFichasDialog
        key={comparando?.contatoId ?? "nenhuma"}
        contatoId={contatoId}
        candidata={comparando}
        aoFechar={() => setComparando(null)}
        podeDecidir={podeDecidir}
        acoes={duplicatas}
        aoAbrirConversa={aoAbrirConversa}
      />
    </>
  );
}

export function AvisoDePossivelDuplicata(props: Props) {
  return <AvisoDaFicha key={props.contatoId} {...props} />;
}
