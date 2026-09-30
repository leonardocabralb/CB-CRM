"use client";

// ============================================================
// A faixa CLIENTE RESCINDIDO / FINALIZADO / SUSPENSO / INATIVO, a primeira
// da pilha acima do compositor (Fases 1 e 2 de docs/PLANO-integracao-atlas.md).
// Pedido do operador (29/09/2026): bem visível, para quem atende saber que o
// contrato daquele cliente acabou (ou parou) e DECIDIR se segue a conversa —
// ela só informa, nunca bloqueia, e não tem botão (D7).
//
// Duas fontes, cada linha dizendo de onde veio (`juntarSituacoes`,
// `src/lib/atlas/situacao-na-faixa.ts`): a MARCA da etapa do funil ("no
// funil Bancário - Jurídico, etapa “Cliente Rescindido”" — o mesmo cliente
// pode ter caso encerrado numa área e ativo noutra) e a situação lida no
// Atlas ("no Atlas desde 12/08/2026"; com a leitura velha, "situação lida no
// Atlas em …"). Suspenso e inativo só vêm do Atlas (decisão do operador,
// 30/09/2026). Cala com `situacoes` nula — que também é "não sei": nada aqui
// afirma "cliente ativo".
//
// ⚠️ Cores: o `dark:` está INERTE (`.claude/rules/ui.md`) e nenhum tom único
// de vermelho, azul, âmbar ou cinza passa de 4:1 como TEXTO nos dois modos
// (medido na revisão do PR #355: red-700 no escuro dá ~3:1). Então o texto é
// `text-foreground` e a cor fica na borda, no fundo, no ícone e na PASTILHA
// da palavra-chave — branco sobre red-600, sky-700, amber-700 e slate-600,
// opacas, legíveis nos dois modos. Classes LITERAIS (o Tailwind não gera
// classe montada). Finalizado não é "mau": azul.
// ============================================================

import { CirclePause, FileCheck, FileMinus, FileX, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import type { SituacaoDaFaixa, SituacaoNaFaixa } from "@/lib/atlas/situacao-na-faixa";

type T = ReturnType<typeof useTranslations<"Inbox.situacaoDoCliente">>;

const ESTILO: Record<SituacaoDaFaixa, { caixa: string; icone: string; pastilha: string; Icone: LucideIcon }> = {
  rescindido: {
    caixa: "mx-3 mt-2 flex max-w-full items-start gap-2.5 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-foreground",
    icone: "mt-0.5 h-4 w-4 shrink-0 text-red-600",
    pastilha: "rounded bg-red-600 px-1.5 py-px text-xs font-bold uppercase tracking-wide text-white",
    Icone: FileX,
  },
  suspenso: {
    caixa: "mx-3 mt-2 flex max-w-full items-start gap-2.5 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-foreground",
    icone: "mt-0.5 h-4 w-4 shrink-0 text-amber-600",
    pastilha: "rounded bg-amber-700 px-1.5 py-px text-xs font-bold uppercase tracking-wide text-white",
    Icone: CirclePause,
  },
  inativo: {
    caixa: "mx-3 mt-2 flex max-w-full items-start gap-2.5 rounded-lg border border-slate-500/50 bg-slate-500/10 px-3 py-2 text-xs text-foreground",
    icone: "mt-0.5 h-4 w-4 shrink-0 text-slate-600",
    pastilha: "rounded bg-slate-600 px-1.5 py-px text-xs font-bold uppercase tracking-wide text-white",
    Icone: FileMinus,
  },
  finalizado: {
    caixa: "mx-3 mt-2 flex max-w-full items-start gap-2.5 rounded-lg border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-xs text-foreground",
    icone: "mt-0.5 h-4 w-4 shrink-0 text-sky-600",
    pastilha: "rounded bg-sky-700 px-1.5 py-px text-xs font-bold uppercase tracking-wide text-white",
    Icone: FileCheck,
  },
};

function rotulo(t: T, s: SituacaoDaFaixa): string {
  switch (s) {
    case "rescindido":
      return t("rotuloRescindido");
    case "finalizado":
      return t("rotuloFinalizado");
    case "suspenso":
      return t("rotuloSuspenso");
    case "inativo":
      return t("rotuloInativo");
  }
}

/** `dd/mm/aaaa` no fuso de quem lê. */
function diaDe(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** `dd/mm hh:mm` no fuso de quem lê. */
function quandoFoi(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** A frase da linha, com a fonte. Chaves LITERAIS (nada montado para o portão de i18n contar). */
function linha(t: T, s: SituacaoNaFaixa): string {
  if (s.fonte === "funil") {
    return s.situacao === "rescindido"
      ? t("ondeRescindido", { funil: s.funil, etapa: s.etapa })
      : t("ondeFinalizado", { funil: s.funil, etapa: s.etapa });
  }
  const desde = diaDe(s.desde);
  switch (s.situacao) {
    case "rescindido":
      return desde ? t("noAtlasRescindido", { desde }) : t("noAtlasRescindidoSemData");
    case "finalizado":
      return desde ? t("noAtlasFinalizado", { desde }) : t("noAtlasFinalizadoSemData");
    case "suspenso":
      return desde ? t("noAtlasSuspenso", { desde }) : t("noAtlasSuspensoSemData");
    case "inativo":
      return desde ? t("noAtlasInativo", { desde }) : t("noAtlasInativoSemData");
  }
}

export function FaixaDeSituacaoDoCliente({ situacoes }: { situacoes: SituacaoNaFaixa[] | null }) {
  const t = useTranslations("Inbox.situacaoDoCliente");
  if (!situacoes || situacoes.length === 0) return null;

  // A mais grave vem primeiro (`juntarSituacoes` ordena): é ela que dá a cor e o título.
  const primeira = situacoes[0];
  const estilo = ESTILO[primeira.situacao];
  const Icone = estilo.Icone;

  return (
    <div role="status" data-situacao={primeira.situacao} data-fonte={primeira.fonte} className={estilo.caixa}>
      <Icone className={estilo.icone} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {t("cliente")} <span className={estilo.pastilha}>{rotulo(t, primeira.situacao)}</span>
        </p>
        {situacoes.map((s) => {
          const lida = s.fonte === "atlas" && s.velha ? quandoFoi(s.lidaEm) : null;
          return (
            <div key={s.fonte === "funil" ? `funil:${s.situacao}:${s.funil}` : `atlas:${s.situacao}`}>
              <p className="mt-0.5 break-words">{linha(t, s)}</p>
              {lida && <p className="text-muted-foreground">{t("lidoNoAtlasEm", { quando: lida })}</p>}
            </div>
          );
        })}
        <p className="text-muted-foreground">{t("dica")}</p>
      </div>
    </div>
  );
}
