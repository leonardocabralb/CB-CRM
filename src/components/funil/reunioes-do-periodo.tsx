"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Loader2, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  formatarPercentual,
  formatarPp,
  formatarVariacao,
  sinalArredondado,
} from "@/lib/funil/apresentacao";
import { compararReunioes, contarReunioes, reunioesForaDeFunil } from "@/lib/funil/comparecimento";
import type { DeltaDeContagem, DeltaDeTaxa } from "@/lib/funil/coorte";
import type { Intervalo } from "@/lib/funil/periodo";
import type { ReuniaoDoResumo } from "@/lib/reunioes/resumo";

/**
 * A seção "Reuniões" do Desempenho (Fase 4 de `docs/PLANO-reagendamento.md`):
 * compareceram, no-show, reagendaram e a taxa de comparecimento do período,
 * contra o anterior. Toda a conta mora em `src/lib/funil/comparecimento.ts`
 * (regra em `.claude/rules/funil-metricas.md`); aqui só apresentação.
 *
 * - Conta pela DATA DA REUNIÃO nos dois modos (reunião é evento, não coorte),
 *   no funil em que o card estava NO DIA dela — a nota da seção diz isso.
 * - Taxa sem denominador é "—" (`formatarPercentual(null)`), nunca 0%.
 * - Sem as linhas (carga ou falha) não há número nenhum: "não sei" nunca vira
 *   zero.
 */

type Bom = "subir" | "descer" | "neutro";

interface Delta {
  sinal: number;
  texto: string;
}

/** A linha de baixo do cartão: a variação, ou o que se sabe sem ela. */
type Comparacao = { delta: Delta } | { semDelta: string };

export function ReunioesDoPeriodo({
  funilId,
  linhas,
  carregando,
  falhou,
  onTentarDeNovo,
  intervalo,
  anterior,
}: {
  funilId: string;
  linhas: ReuniaoDoResumo[] | null;
  carregando: boolean;
  falhou: boolean;
  onTentarDeNovo: () => void;
  intervalo: Intervalo;
  anterior: Intervalo | null;
}) {
  const t = useTranslations("Pipelines.funil.desempenho");

  // Só há número com as linhas DESTE pedido na mão.
  const prontas = carregando || falhou ? null : linhas;
  const atual = prontas ? contarReunioes(prontas, funilId, intervalo) : null;

  // A seta sai do valor ARREDONDADO, o mesmo que o texto escreve (como os
  // outros cartões do Desempenho).
  // Sem variação há dois casos, e a frase diz qual: não há período anterior
  // (Total), ou há e a variação não existe (zero lá, taxa sem denominador) —
  // aí o cartão mostra o valor de lá, nunca "sem período anterior".
  const deContagem = (d: DeltaDeContagem): Comparacao =>
    d.variacao !== null
      ? {
          delta: {
            sinal: sinalArredondado(d.variacao * 100, 0),
            texto: t("cards.vsAnterior", { delta: formatarVariacao(d.variacao) ?? "" }),
          },
        }
      : { semDelta: d.anterior === null ? t("cards.semAnterior") : t("reunioes.noAnterior", { valor: String(d.anterior) }) };
  const deTaxa = (d: DeltaDeTaxa, temAnterior: boolean): Comparacao =>
    d.pp !== null
      ? { delta: { sinal: sinalArredondado(d.pp, 1), texto: t("cards.vsAnterior", { delta: formatarPp(d.pp) ?? "" }) } }
      : { semDelta: temAnterior ? t("reunioes.noAnterior", { valor: formatarPercentual(d.anterior) }) : t("cards.semAnterior") };

  let corpo: ReactNode;
  if (falhou && !carregando) {
    corpo = (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        {t("reunioes.falhou")}
        <button type="button" onClick={onTentarDeNovo} className="underline hover:text-foreground">
          {t("tentarDeNovo")}
        </button>
      </div>
    );
  } else if (!prontas || !atual) {
    // Carregando — ou linhas nulas sem falha, que também é "não sei".
    corpo = (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("reunioes.carregando")}
      </div>
    );
  } else {
    const ant = anterior ? contarReunioes(prontas, funilId, anterior) : null;
    const cmp = compararReunioes(atual, ant);
    const foraDeFunil = reunioesForaDeFunil(prontas, intervalo);
    corpo = (
      <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <CartaoDeReuniao
            titulo={t("reunioes.compareceram")}
            valor={String(atual.compareceram)}
            subtitulo={t("reunioes.comProposta", { n: atual.comProposta })}
            comparacao={deContagem(cmp.compareceram)}
            bom="subir"
          />
          <CartaoDeReuniao
            titulo={t("reunioes.noShow")}
            valor={String(atual.noShow)}
            subtitulo={t("reunioes.noShowDesc")}
            comparacao={deContagem(cmp.noShow)}
            bom="descer"
          />
          <CartaoDeReuniao
            titulo={t("reunioes.reagendaram")}
            valor={String(atual.reagendaram)}
            subtitulo={t("reunioes.reagendaramDesc")}
            comparacao={deContagem(cmp.reagendaram)}
            bom="neutro"
          />
          <CartaoDeReuniao
            titulo={t("reunioes.comparecimento")}
            valor={formatarPercentual(atual.comparecimento)}
            subtitulo={t("reunioes.comparecimentoDesc")}
            comparacao={deTaxa(cmp.comparecimento, ant !== null)}
            bom="subir"
          />
        </div>
        {foraDeFunil > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">{t("reunioes.foraDeFunil", { n: foraDeFunil })}</p>
        )}
      </>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("reunioes.titulo")}</h3>
        {atual && (
          <span className="text-xs text-muted-foreground">
            {t("reunioes.noPeriodo", { n: atual.reunioes })}
            {atual.semResultado > 0 && ` · ${t("reunioes.semResultado", { n: atual.semResultado })}`}
          </span>
        )}
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">{t("reunioes.nota")}</p>
      {corpo}
    </section>
  );
}

function CartaoDeReuniao({
  titulo,
  valor,
  subtitulo,
  comparacao,
  bom,
}: {
  titulo: string;
  valor: string;
  subtitulo: string;
  comparacao: Comparacao;
  /** a direção BOA do número: no-show que sobe é ruim; reagendar não é bom nem ruim */
  bom: Bom;
}) {
  const delta = "delta" in comparacao ? comparacao.delta : null;
  // Classes LITERAIS: classe montada não é gerada pelo Tailwind.
  const tom =
    delta === null || delta.sinal === 0 || bom === "neutro"
      ? "text-muted-foreground"
      : (bom === "subir" ? delta.sinal > 0 : delta.sinal < 0)
        ? "text-primary"
        : "text-red-400";
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground" title={titulo}>
        {titulo}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{valor}</div>
      <div className="mt-1 text-xs text-muted-foreground">{subtitulo}</div>
      {"semDelta" in comparacao ? (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">{comparacao.semDelta}</div>
      ) : delta === null ? null : (
        <div className={`mt-1 flex items-center gap-1 text-xs ${tom}`}>
          {delta.sinal > 0 ? (
            <ArrowUp className="h-3.5 w-3.5" aria-hidden />
          ) : delta.sinal < 0 ? (
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Minus className="h-3.5 w-3.5" aria-hidden />
          )}
          <span className="tabular-nums">{delta.texto}</span>
        </div>
      )}
    </div>
  );
}
