"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { useAoVoltarParaOApp } from "@/hooks/use-ao-voltar-para-o-app";
import { useMotivosDoFunil } from "@/hooks/use-motivos-do-funil";
import { formatarPercentual } from "@/lib/funil/apresentacao";
import { agruparMotivos, type MotivosDaEtapa, type QuemMoveu } from "@/lib/funil/motivos";
import type { Intervalo } from "@/lib/funil/periodo";
import type { PipelineStage } from "@/types";

/**
 * A seção "Motivos" do Desempenho (Fase 4 de `docs/PLANO-motivos-de-perda.md`):
 * por etapa com campo de motivo (1112), os cards que ENTRARAM nela no período,
 * pelo motivo que a ficha tem hoje — opções da lista, "Outro" com os textos e
 * "Sem motivo" por quem levou o card até lá. A soma é do banco (1113); a
 * conta, de `agruparMotivos`.
 *
 * - Conta pelo PERÍODO nos dois modos do Desempenho (o motivo é do momento da
 *   saída), e a nota diz isso.
 * - Carrega sozinha, com a própria recarga ao voltar para o app: a das
 *   trajetórias (`desempenho.tsx`) não a alcança.
 * - Só aparece no funil com alguma etapa que pede motivo (quem decide é
 *   `desempenho.tsx`).
 */
export function MotivosDoPeriodo({
  pipelineId,
  intervalo,
  stages,
}: {
  pipelineId: string;
  intervalo: Intervalo;
  /** as etapas DESTE funil, já carregadas (`etapasCarregadas` no Desempenho) */
  stages: PipelineStage[];
}) {
  const t = useTranslations("Pipelines.funil.desempenho.motivos");
  const campoIds = stages.flatMap((s) => (s.campo_do_motivo_id ? [s.campo_do_motivo_id] : []));
  const { dados, carregando, falhou, recarregar } = useMotivosDoFunil(pipelineId, intervalo, campoIds);
  useAoVoltarParaOApp(recarregar);

  const porEtapa = dados ? agruparMotivos(dados.linhas, stages, dados.campos) : [];
  const nomeDoCampo = (etapaId: string) => {
    const id = stages.find((s) => s.id === etapaId)?.campo_do_motivo_id;
    return dados?.campos.find((c) => c.id === id)?.field_name ?? null;
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("titulo")}</h3>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">{t("nota")}</p>
      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("carregando")}
        </div>
      ) : falhou ? (
        // Falha nunca vira "nenhum card": a seção diz que não sabe.
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          {t("falhou")}
          <button type="button" onClick={recarregar} className="underline hover:text-foreground">
            {t("tentarDeNovo")}
          </button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {porEtapa.map((etapa) => (
            <BlocoDaEtapa key={etapa.etapaId} etapa={etapa} campo={nomeDoCampo(etapa.etapaId)} />
          ))}
        </div>
      )}
    </section>
  );
}

function BlocoDaEtapa({ etapa, campo }: { etapa: MotivosDaEtapa; campo: string | null }) {
  const t = useTranslations("Pipelines.funil.desempenho.motivos");
  const pct = (n: number) => formatarPercentual(etapa.total > 0 ? n / etapa.total : null);
  const rotuloDeQuem = (quem: QuemMoveu) =>
    quem.tipo === "pessoa" ? (quem.nome ?? t("pessoaSemNome")) : quem.tipo === "sem_pessoa" ? t("semPessoa") : t("historico");

  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-medium text-foreground" title={etapa.nome}>
          {etapa.nome}
        </div>
        <div className="shrink-0 text-xs tabular-nums text-muted-foreground">{t("cards", { n: etapa.total })}</div>
      </div>
      {campo && (
        <div className="truncate text-[11px] text-muted-foreground" title={campo}>
          {t("campo", { nome: campo })}
        </div>
      )}
      {etapa.total === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{t("nenhum")}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {/* o recuo alinha com as linhas que abrem ("Outro", "Sem motivo") */}
          {etapa.motivos.map((m) => (
            <div key={m.rotulo} className="pl-4">
              <Linha rotulo={m.rotulo} n={m.cards} pct={pct(m.cards)} fracao={m.cards / etapa.total} tom="motivo" />
            </div>
          ))}
          {etapa.outro.cards > 0 && (
            <Detalhe
              rotulo={t("outro")}
              n={etapa.outro.cards}
              pct={pct(etapa.outro.cards)}
              fracao={etapa.outro.cards / etapa.total}
              tom="outro"
              itens={etapa.outro.textos.map((x) => ({ chave: x.rotulo, rotulo: x.rotulo, n: x.cards }))}
            />
          )}
          {etapa.semMotivo.cards > 0 && (
            <Detalhe
              rotulo={t("semMotivo")}
              n={etapa.semMotivo.cards}
              pct={pct(etapa.semMotivo.cards)}
              fracao={etapa.semMotivo.cards / etapa.total}
              tom="sem"
              itens={etapa.semMotivo.porQuem.map((q, i) => ({ chave: String(i), rotulo: rotuloDeQuem(q.quem), n: q.cards }))}
            />
          )}
        </div>
      )}
    </div>
  );
}

type Tom = "motivo" | "outro" | "sem";

// Classes LITERAIS (classe montada não é gerada) e uma cor só para os dois
// modos: o `dark:` está inerte no projeto.
const BARRA: Record<Tom, string> = {
  motivo: "bg-primary/70",
  outro: "bg-primary/35",
  sem: "bg-amber-500/60",
};

function Linha({ rotulo, n, pct, fracao, tom }: { rotulo: string; n: number; pct: string; fracao: number; tom: Tom }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-foreground" title={rotulo}>
          {rotulo}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{n}</span> · {pct}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-muted">
        <div className={`h-1.5 rounded-full ${BARRA[tom]}`} style={{ width: `${Math.round(fracao * 100)}%` }} />
      </div>
    </div>
  );
}

function Detalhe({
  rotulo,
  n,
  pct,
  fracao,
  tom,
  itens,
}: {
  rotulo: string;
  n: number;
  pct: string;
  fracao: number;
  tom: Tom;
  itens: { chave: string; rotulo: string; n: number }[];
}) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-1 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <div className="min-w-0 flex-1">
          <Linha rotulo={rotulo} n={n} pct={pct} fracao={fracao} tom={tom} />
        </div>
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5 pl-4">
        {itens.map((item) => (
          <li key={item.chave} className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate" title={item.rotulo}>
              {item.rotulo}
            </span>
            <span className="shrink-0 tabular-nums">{item.n}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
