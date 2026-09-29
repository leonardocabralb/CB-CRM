"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A faixa "← Voltar para <nome>" (1069): aparece depois de pular de uma
 * conversa para a de um contato RELACIONADO pela aba do painel, e devolve à
 * conversa de onde se saiu. Irmã de `VoltarAoFunil`, com a mesma casca
 * (`shrink-0` na coluna da página, empurra os painéis em vez de cobri-los,
 * visível na lista e no fio, inclusive no celular). É botão, não `<Link>`: a
 * volta passa pela seleção da página, que já tem a conversa carregada.
 */
export function VoltarParaConversa({
  nome,
  onVoltar,
  inert,
}: {
  /** Nome de quem ficou para trás. NULO (ficha sem nome nem identidade): texto genérico. */
  nome: string | null;
  onVoltar: () => void;
  inert?: boolean;
}) {
  const t = useTranslations("Inbox.page");
  const rotulo = nome ? t("backToContact", { nome }) : t("backToConversation");
  return (
    <div
      inert={inert}
      className="flex shrink-0 items-center border-b border-border bg-card px-3 py-1.5"
    >
      <button
        type="button"
        onClick={onVoltar}
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
      >
        <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{rotulo}</span>
      </button>
    </div>
  );
}
