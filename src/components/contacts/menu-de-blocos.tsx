"use client";

// ============================================================
// O menu horizontal de blocos de campos personalizados (966).
//
// ⚠️ SÓ UM BLOCO APARECE POR VEZ, e é esse o PONTO da feature. A primeira
// versão empilhava os blocos um sob o outro: organizava e não REDUZIA nada
// — os 15 campos continuavam todos na tela, que é exatamente a poluição que
// os blocos existem para resolver. O operador devolveu com o exemplo do
// outro CRM ("a separação e a visualização são feitas por um menu
// selecionável de forma horizontal"). Quem empilhar de novo desfaz a
// feature inteira.
//
// ⚠️ SOME COM MENOS DE DOIS BLOCOS — mesma regra do seletor de canal: com um
// bloco só ele não decide nada, e o nome dele já está no título logo acima.
// O componente devolve `null` sozinho; quem chama não precisa repetir o
// gate (e não deve, senão a regra volta a morar em dois lugares).
//
// POR QUE COMPONENTE, E NÃO DUAS CÓPIAS. Ele nasceu copiado nas duas fichas
// (a de `/contatos` e o painel da conversa) e as cópias JÁ DIVERGIRAM: uma
// ficou `text-xs` (12px) com as classes num ternário, a outra `text-[11px]`
// com `cn()`. O mesmo widget, dois tamanhos de fonte, sem ninguém decidir
// isso. As duas telas editam o MESMO dado; divergir na aparência é o
// primeiro passo para divergir no comportamento.
// ============================================================

import { chaveDoBloco, type BlocoDeCampos } from "@/lib/contacts/grupos-de-campos";
import { cn } from "@/lib/utils";

export function MenuDeBlocos({
  blocos,
  chaveVisivel,
  onEscolher,
  rotuloDoGeral,
}: {
  blocos: BlocoDeCampos[];
  /** A chave do bloco à vista — resolvida NO RENDER por quem chama. */
  chaveVisivel: string | null;
  onEscolher: (chave: string) => void;
  /**
   * O nome do bloco "Geral" (`Contacts.customFields.groupGeneral`). Vem por
   * prop porque não existe linha para ele no banco: o rótulo sai do
   * dicionário, e o tradutor é de quem chama.
   */
  rotuloDoGeral: string;
}) {
  if (blocos.length < 2) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {blocos.map((bloco) => {
        const chave = chaveDoBloco(bloco.grupo?.id ?? null);
        const ativo = chave === chaveVisivel;
        return (
          <button
            key={chave}
            type="button"
            onClick={() => onEscolher(chave)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              ativo
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {bloco.grupo?.nome ?? rotuloDoGeral}
          </button>
        );
      })}
    </div>
  );
}
