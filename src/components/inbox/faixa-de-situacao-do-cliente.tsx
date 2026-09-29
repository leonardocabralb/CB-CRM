"use client";

// ============================================================
// A faixa CLIENTE RESCINDIDO / FINALIZADO, a primeira da pilha acima do
// compositor (Fase 1 de docs/PLANO-integracao-atlas.md). Pedido do operador
// (29/09/2026): bem visível, para quem atende saber que o contrato daquele
// cliente acabou e DECIDIR se segue a conversa — ela só informa, nunca
// bloqueia (o mesmo padrão da faixa de número divergente).
//
// A situação vem da MARCA da etapa em que está o card mais recente de cada
// funil (`situacao-do-cliente.ts`); a faixa diz ONDE ("no Bancário -
// Jurídico, etapa Cliente Rescindido"), porque o mesmo cliente pode ter caso
// encerrado numa área e ativo noutra. Cala com `situacoes` nula — que também
// é "não sei": nada aqui afirma "cliente ativo".
//
// ⚠️ Cores: o `dark:` está INERTE (`.claude/rules/ui.md`), então a PRIMEIRA
// cor vale nos dois modos: `red-700` (a da inadimplência) e `sky-600` (a da
// bolha), legíveis nos dois. Finalizado não é "mau": azul, não vermelho.
// ============================================================

import { FileCheck, FileX } from "lucide-react";
import { useTranslations } from "next-intl";

import type { SituacaoNoFunil } from "@/lib/pipelines/situacao-do-cliente";

export function FaixaDeSituacaoDoCliente({ situacoes }: { situacoes: SituacaoNoFunil[] | null }) {
  const t = useTranslations("Inbox.situacaoDoCliente");
  if (!situacoes || situacoes.length === 0) return null;

  // A mais grave vem primeiro (a regra ordena): é ela que dá a cor e o título.
  const rescindido = situacoes[0].situacao === "rescindido";
  const Icone = rescindido ? FileX : FileCheck;

  return (
    <div
      role="status"
      data-situacao={situacoes[0].situacao}
      className={
        rescindido
          ? "mx-3 mt-2 flex max-w-full items-start gap-2.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
          : "mx-3 mt-2 flex max-w-full items-start gap-2.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-600 dark:text-sky-400"
      }
    >
      <Icone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{rescindido ? t("tituloRescindido") : t("tituloFinalizado")}</p>
        {situacoes.map((s) => (
          <p key={`${s.situacao}:${s.funil}`} className="break-words">
            {s.situacao === "rescindido"
              ? t("ondeRescindido", { funil: s.funil, etapa: s.etapa })
              : t("ondeFinalizado", { funil: s.funil, etapa: s.etapa })}
          </p>
        ))}
        <p className="opacity-80">{t("dica")}</p>
      </div>
    </div>
  );
}
