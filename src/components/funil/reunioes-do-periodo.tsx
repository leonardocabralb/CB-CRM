"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  formatarPercentual,
  formatarPp,
  formatarVariacao,
  noMeioDaFrase,
  sinalArredondado,
} from "@/lib/funil/apresentacao";
import {
  agendamentosDe,
  type Comparacao,
  type DeltaDeContagem,
  type DeltaDeTaxa,
  type ResumoDoPeriodo,
  taxaDeNoShow,
} from "@/lib/funil/coorte";

/**
 * A seção "Reuniões" do Desempenho: agendamentos, no-shows e a taxa de
 * no-show do período, contra o anterior. Decisão do operador (09/10/2026):
 * conta pelas TRANSIÇÕES do card, como o resto do funil — sem conta própria
 * de reunião.
 *
 * - Agendamentos = quem alcançou o degrau reunião (o cartão do funil).
 * - No-show = cada ENTRADA numa etapa marcada "Faltou" (`entradasEmFalta`).
 * - Taxa = no-shows ÷ agendamentos (`taxaDeNoShow`); sem agendamento, "—".
 * - A etapa "Reagendar" é fila de trabalho interna e NÃO entra na conta.
 *
 * O custo por no-show é um cartão de custo como os outros (`custosDoResumo`).
 * Só aparece no funil com etapa marcada "Faltou" (`etapasDeFalta`).
 */

type Bom = "subir" | "descer";

interface Delta {
  sinal: number;
  texto: string;
}

/** A linha de baixo do cartão: a variação, ou o que se sabe sem ela. */
type LinhaDaComparacao = { delta: Delta } | { semDelta: string };

export function ReunioesDoPeriodo({
  atual,
  anterior,
  comparacao,
  porPeriodo,
  rotuloDaReuniao,
}: {
  atual: ResumoDoPeriodo;
  /** nulo = sem período anterior (Total). */
  anterior: ResumoDoPeriodo | null;
  comparacao: Comparacao;
  porPeriodo: boolean;
  /** o rótulo do degrau reunião NESTE funil (o livre, se houver). */
  rotuloDaReuniao: string;
}) {
  const t = useTranslations("Pipelines.funil.desempenho");
  const degrau = noMeioDaFrase(rotuloDaReuniao);

  // Sem variação há dois casos, e a frase diz qual: não há período anterior
  // (Total), ou há e a variação não existe (zero lá, taxa sem denominador) —
  // aí o cartão mostra o valor de lá, nunca "sem período anterior". A seta
  // sai do valor ARREDONDADO, o mesmo que o texto escreve.
  const deContagem = (d: DeltaDeContagem): LinhaDaComparacao =>
    d.variacao !== null
      ? {
          delta: {
            sinal: sinalArredondado(d.variacao * 100, 0),
            texto: t("cards.vsAnterior", { delta: formatarVariacao(d.variacao) ?? "" }),
          },
        }
      : { semDelta: d.anterior === null ? t("cards.semAnterior") : t("reunioes.noAnterior", { valor: String(d.anterior) }) };
  const deTaxa = (d: DeltaDeTaxa): LinhaDaComparacao =>
    d.pp !== null
      ? { delta: { sinal: sinalArredondado(d.pp, 1), texto: t("cards.vsAnterior", { delta: formatarPp(d.pp) ?? "" }) } }
      : {
          semDelta:
            anterior === null ? t("cards.semAnterior") : t("reunioes.noAnterior", { valor: formatarPercentual(d.anterior) }),
        };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("reunioes.titulo")}</h3>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        {porPeriodo ? t("reunioes.notaPorPeriodo", { degrau }) : t("reunioes.notaPorEntrada", { degrau })}
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CartaoDeReuniao
          titulo={t("reunioes.agendamentos")}
          valor={String(agendamentosDe(atual))}
          subtitulo={t("reunioes.agendamentosDesc", { degrau })}
          comparacao={deContagem(comparacao.agendamentos)}
          bom="subir"
        />
        <CartaoDeReuniao
          titulo={t("reunioes.noShows")}
          valor={String(atual.noShows)}
          subtitulo={t("reunioes.noShowsDesc")}
          comparacao={deContagem(comparacao.noShows)}
          bom="descer"
        />
        <CartaoDeReuniao
          titulo={t("reunioes.taxa")}
          valor={formatarPercentual(taxaDeNoShow(atual))}
          subtitulo={t("reunioes.taxaDesc")}
          comparacao={deTaxa(comparacao.taxaDeNoShow)}
          bom="descer"
        />
      </div>
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
  comparacao: LinhaDaComparacao;
  /** a direção BOA do número: no-show (e a taxa) que sobe é ruim */
  bom: Bom;
}) {
  if ("semDelta" in comparacao) {
    return (
      <Moldura titulo={titulo} valor={valor} subtitulo={subtitulo}>
        <div className="mt-1 text-xs text-muted-foreground">{comparacao.semDelta}</div>
      </Moldura>
    );
  }
  const { sinal, texto } = comparacao.delta;
  // Classes LITERAIS: classe montada não é gerada pelo Tailwind.
  const tom = sinal === 0 ? "text-muted-foreground" : (bom === "subir" ? sinal > 0 : sinal < 0) ? "text-primary" : "text-red-400";
  return (
    <Moldura titulo={titulo} valor={valor} subtitulo={subtitulo}>
      <div className={`mt-1 flex items-center gap-1 text-xs ${tom}`}>
        {sinal > 0 ? (
          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
        ) : sinal < 0 ? (
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Minus className="h-3.5 w-3.5" aria-hidden />
        )}
        <span className="tabular-nums">{texto}</span>
      </div>
    </Moldura>
  );
}

function Moldura({
  titulo,
  valor,
  subtitulo,
  children,
}: {
  titulo: string;
  valor: string;
  subtitulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/40 p-3">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground" title={titulo}>
        {titulo}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{valor}</div>
      <div className="mt-1 text-xs text-muted-foreground">{subtitulo}</div>
      {children}
    </div>
  );
}
