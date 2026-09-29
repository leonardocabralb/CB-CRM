"use client";

// ============================================================
// A faixa CLIENTE RESCINDIDO / FINALIZADO, a primeira da pilha acima do
// compositor (Fase 1 de docs/PLANO-integracao-atlas.md). Pedido do operador
// (29/09/2026): bem visível, para quem atende saber que o contrato daquele
// cliente acabou e DECIDIR se segue a conversa — ela só informa, nunca
// bloqueia (o mesmo padrão da faixa de número divergente).
//
// A situação vem da MARCA da etapa (`situacao-do-cliente.ts`: a etapa atual
// em cada funil, ou a de onde o card saiu); a faixa diz ONDE ("Bancário -
// Jurídico, etapa Cliente Rescindido"), porque o mesmo cliente pode ter caso
// encerrado numa área e ativo noutra. Cala com `situacoes` nula — que também
// é "não sei": nada aqui afirma "cliente ativo".
//
// ⚠️ Cores: o `dark:` está INERTE (`.claude/rules/ui.md`) e nenhum tom único
// de vermelho ou azul passa de 4:1 como TEXTO nos dois modos (medido na
// revisão do PR #355: red-700 no escuro dá ~3:1). Então o texto é
// `text-foreground` e a cor fica na borda, no fundo, no ícone e na PASTILHA
// da palavra-chave — branco sobre red-600 (~4,8:1) e sobre sky-700 (~5,9:1),
// opacas, legíveis nos dois modos. Finalizado não é "mau": azul.
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
          ? "mx-3 mt-2 flex max-w-full items-start gap-2.5 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-foreground"
          : "mx-3 mt-2 flex max-w-full items-start gap-2.5 rounded-lg border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-xs text-foreground"
      }
    >
      <Icone
        className={rescindido ? "mt-0.5 h-4 w-4 shrink-0 text-red-600" : "mt-0.5 h-4 w-4 shrink-0 text-sky-600"}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {t("cliente")}{" "}
          <span
            className={
              rescindido
                ? "rounded bg-red-600 px-1.5 py-px text-xs font-bold uppercase tracking-wide text-white"
                : "rounded bg-sky-700 px-1.5 py-px text-xs font-bold uppercase tracking-wide text-white"
            }
          >
            {rescindido ? t("rotuloRescindido") : t("rotuloFinalizado")}
          </span>
        </p>
        {situacoes.map((s) => (
          <p key={`${s.situacao}:${s.funil}`} className="mt-0.5 break-words">
            {s.situacao === "rescindido"
              ? t("ondeRescindido", { funil: s.funil, etapa: s.etapa })
              : t("ondeFinalizado", { funil: s.funil, etapa: s.etapa })}
          </p>
        ))}
        <p className="text-muted-foreground">{t("dica")}</p>
      </div>
    </div>
  );
}
