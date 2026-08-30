"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A faixa de volta da jornada funil → conversa. Aparece quando a URL carrega
 * `de=funil` (quem navega do quadro passa o param, e a página do inbox o
 * preserva nos replaces via `urlDoInbox`). Renderizada como irmã da faixa
 * amarela do WhatsApp: `shrink-0` na coluna, empurra os painéis em vez de
 * cobri-los, e fica visível na lista E no fio — inclusive no celular, onde
 * convive com a seta que volta para a lista (por isso tem TEXTO, não só
 * ícone). É `<Link>`, não `router.push`: Ctrl+clique e clique do meio de
 * graça. A rolagem do quadro é restaurada pelo próprio funil, que consome o
 * registro gravado na ida (sessionStorage).
 */
export function VoltarAoFunil({ inert }: { inert?: boolean }) {
  const t = useTranslations("Inbox.page");
  return (
    <div
      inert={inert}
      className="flex shrink-0 items-center border-b border-border bg-card px-3 py-1.5"
    >
      <Link
        href="/pipelines"
        className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("backToPipeline")}
      </Link>
    </div>
  );
}
