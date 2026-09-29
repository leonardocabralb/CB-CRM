"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import { lerRetornoDaPauta } from "@/lib/reunioes/retorno";

/**
 * O registro da volta não muda enquanto a faixa está na tela (só o clique de
 * "Abrir conversa" da pauta o grava, e a pauta não está montada aqui): não há
 * o que assinar.
 */
function nadaAAssinar() {
  return () => {};
}

/**
 * A faixa de volta da jornada pauta de reuniões → conversa. Irmã de
 * `voltar-ao-funil.tsx`, com o mesmo desenho: aparece com `de=reunioes` na
 * URL (preservado nos replaces por `urlDoInbox`), `shrink-0` na coluna, TEXTO
 * e não só ícone, `<Link>` para Ctrl+clique de graça.
 *
 * O destino é a pauta de onde a conversa foi aberta (o dia escolhido), lida
 * da aba por `lerRetornoDaPauta`. ⚠️ Por `useSyncExternalStore` com
 * instantâneo de servidor na pauta de hoje: ler `sessionStorage` no render
 * faria o HTML do servidor e o do navegador divergirem (erro de hidratação),
 * e ler num efeito com `setState` o React Compiler reprova.
 */
export function VoltarAsReunioes({ inert }: { inert?: boolean }) {
  const t = useTranslations("Inbox.page");
  const href = useSyncExternalStore(
    nadaAAssinar,
    lerRetornoDaPauta,
    () => "/reunioes",
  );
  return (
    <div
      inert={inert}
      className="flex shrink-0 items-center border-b border-border bg-card px-3 py-1.5"
    >
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("backToReunioes")}
      </Link>
    </div>
  );
}
