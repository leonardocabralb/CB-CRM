"use client";

import Link from "next/link";
import { Loader2, Settings } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useGastosDeAnuncios } from "@/hooks/use-gastos-de-anuncios";
import { useModoDeContagem } from "@/hooks/use-modo-de-contagem";
import { useTrajetorias } from "@/hooks/use-trajetorias";
import { useAoVoltarParaOApp } from "@/hooks/use-ao-voltar-para-o-app";
import { formatCurrency, formatCurrencyShort } from "@/lib/currency";
import { formatarPercentual, paraPontosPercentuais } from "@/lib/funil/apresentacao";
import { corDaTransicao } from "@/lib/funil/cores";
import { custosMensais } from "@/lib/funil/custos";
import { classificarEtapas, type Degrau } from "@/lib/funil/degraus";
import { cartoesDeCustoNaTela, lerPainel, rotuloDoDegrau as rotuloNoPainel } from "@/lib/funil/painel";
import { inicioDoMesLocal } from "@/lib/funil/periodo";
import { periodoSemAtividade } from "@/lib/funil/por-periodo";
import { COORTE_PEQUENA, coortesMensais, linhasDoMapa, type TransicaoDoHistorico } from "@/lib/funil/saude";
import { fatosDoNegocio } from "@/lib/funil/trajetoria";
import type { Pipeline, PipelineStage } from "@/types";

import { useRotuloDoCartaoDeCusto } from "./cartoes-de-custo";
import { GraficoDeConversao, type SerieDeConversao } from "./grafico-de-conversao";
import { MapaDeCalor, type LinhaDoMapaDeCalor } from "./mapa-de-calor";
import { SeletorDeModo } from "./seletor-de-modo";

/**
 * A vista de SAÚDE (Fase 3 do plano): doze meses, a conversão por transição
 * ao longo do tempo e o mapa de calor com cor relativa à linha. Conta em
 * `src/lib/funil/saude.ts`.
 *
 * DOIS modos (18/09/2026, o mesmo seletor do Desempenho): "por período" — o
 * padrão, cada mês mostra o que ACONTECEU nele, e mês passado é número final
 * — e "por mês de entrada", em que cada mês é a COORTE de quem entrou nele.
 *
 * UMA carga da RPC para `[1º dia de 11 meses atrás, hoje)`, que serve aos
 * dois. O que segue vale para a COORTE: o que a coorte
 * de cada mês fez depois conta até hoje. Coorte com lead ainda SEM DESFECHO
 * é "em andamento" e traz a contagem sob o mês — não é o mês corrente: a
 * coorte de agosto com três leads abertos segue mudando em setembro, e o
 * mês corrente com tudo resolvido já é final (Codex, PR #122). Célula
 * pequena (< 5 na base da taxa) fica apagada e fora da escala de cor — por
 * período a base é o degrau de partida do mês, não as entradas (revisão do
 * PR #224); os textos do `title` e da legenda mudam com o modo por isso.
 *
 * CUSTOS (6.4 do plano do previdenciário): o gasto em anúncios de cada mês
 * sobre as contagens do mês, com a MESMA conta do Desempenho
 * (`custosMensais` → `custosDoResumo`) e os mesmos cartões que o painel do
 * funil mostra. As cores das linhas estão em `src/lib/funil/cores.ts`.
 */

const MESES = 12;

export function Saude({
  pipeline,
  stages,
  etapasCarregadas,
  onConfigurar,
}: {
  pipeline: Pipeline;
  stages: PipelineStage[];
  /** se `stages` já é DESTE funil — ver o mesmo campo em `Desempenho`. */
  etapasCarregadas: boolean;
  onConfigurar: () => void;
}) {
  const t = useTranslations("Pipelines.funil.saude");
  const tDesempenho = useTranslations("Pipelines.funil.desempenho");
  const tDegraus = useTranslations("Pipelines.funil.degraus");
  const [modo, setModo] = useModoDeContagem();
  const porPeriodo = modo === "periodo";

  const agora = new Date();
  const desde = inicioDoMesLocal(agora.getFullYear(), agora.getMonth() - (MESES - 1));
  const { linhas, carregando, falhou, recarregar } = useTrajetorias(pipeline.id, { desde, ate: null });
  // Os custos por mês (6.4): o gasto dos doze meses, sob RLS, como no
  // Desempenho.
  const anuncios = useGastosDeAnuncios({ desde, ate: null });
  // O app instalado no celular não tem botão de recarregar: voltar para ele
  // depois de um tempo fora refaz as coortes E o gasto, com o `recarregar`
  // comum, que pisca o carregando — é relatório, afirma números (a escolha
  // do Meu dia). ⚠️ Os DOIS juntos, como no Desempenho: só as trajetórias
  // misturariam as contagens novas com o gasto de antes.
  useAoVoltarParaOApp(() => {
    recarregar();
    anuncios.recarregar();
  });

  const classificacao = classificarEtapas(stages);
  const painel = lerPainel(pipeline.painel);
  const rotuloDoDegrau = (d: Degrau) =>
    // O rótulo livre do funil (não passa pelo dicionário), senão o padrão:
    // chave montada `degraus.<d>` — cobrada em degraus.test.ts.
    rotuloNoPainel(painel, d, (x) => tDegraus(x as Parameters<typeof tDegraus>[0]));
  const rotuloDaTransicao = (tr: TransicaoDoHistorico) =>
    tr.global
      ? tDesempenho("taxas.global", { de: rotuloDoDegrau("lead"), para: rotuloDoDegrau("contrato") })
      : `${rotuloDoDegrau(tr.de)} → ${rotuloDoDegrau(tr.para)}`;
  const rotuloDoCartao = useRotuloDoCartaoDeCusto(rotuloDoDegrau);

  // Etapas ainda não chegaram ≠ funil sem etapa (ver `Desempenho`).
  if (!etapasCarregadas) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {tDesempenho("carregando")}
      </div>
    );
  }
  if (!classificacao.configurado) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <Settings className="h-8 w-8 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">{tDesempenho("configure")}</p>
        <Button variant="outline" onClick={onConfigurar} className="border-border bg-card text-foreground hover:bg-muted">
          {tDesempenho("configurar")}
        </Button>
      </div>
    );
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {tDesempenho("carregando")}
      </div>
    );
  }
  if (falhou) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted-foreground">
        {tDesempenho("falhou")}
        <button type="button" onClick={recarregar} className="underline hover:text-foreground">
          {tDesempenho("tentarDeNovo")}
        </button>
      </div>
    );
  }

  const fatos = (linhas ?? []).map((l) => fatosDoNegocio(l, pipeline.id, classificacao));
  const coortes = coortesMensais(fatos, classificacao, MESES, agora, modo);
  const mapa = linhasDoMapa(coortes, classificacao, modo);
  // "jul/26", não "jul. de 26": são doze colunas lado a lado.
  const rotuloDoMes = (d: Date) =>
    `${d.toLocaleDateString(undefined, { month: "short" }).replace(".", "")}/${String(d.getFullYear()).slice(-2)}`;
  const meses = coortes.map((c) => ({
    chave: c.chave,
    rotulo: rotuloDoMes(c.desde),
    // "em andamento" é ter lead SEM DESFECHO, não ser o mês corrente (ver
    // o cabeçalho): a contagem vai para debaixo do rótulo do mês.
    emAberto: c.emAberto,
  }));
  const totalDeEntradas = coortes.reduce((s, c) => s + c.resumo.entradas, 0);
  // Por período, "nenhum lead entrou" não é tela vazia: o contrato do lead
  // de treze meses atrás está no mapa. A faixa só aparece quando NADA
  // aconteceu em mês nenhum — a mesma régua do Desempenho.
  const semNada = porPeriodo ? coortes.every((c) => periodoSemAtividade(c.resumo)) : totalDeEntradas === 0;

  const series: SerieDeConversao[] = mapa.map((linha) => ({
    chave: `${linha.transicao.de}-${linha.transicao.para}${linha.transicao.global ? "-global" : ""}`,
    rotulo: rotuloDaTransicao(linha.transicao),
    cor: corDaTransicao(linha.transicao),
    valores: linha.taxas.map(paraPontosPercentuais),
  }));

  const cartoesDeCusto = cartoesDeCustoNaTela(classificacao, painel);
  const custosDosMeses = anuncios.conectado
    ? custosMensais(coortes, anuncios.gastos, anuncios.campanhas, pipeline.id, agora)
    : [];

  const linhasDoCalor: LinhaDoMapaDeCalor[] = mapa.map((linha) => ({
    chave: `${linha.transicao.de}-${linha.transicao.para}${linha.transicao.global ? "-global" : ""}`,
    rotulo: rotuloDaTransicao(linha.transicao),
    celulas: linha.taxas.map((taxa, i) => ({
      taxa,
      posicao: linha.pequenas[i] ? null : linha.escala(taxa),
      base: linha.bases[i],
      pequena: linha.pequenas[i],
    })),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SeletorDeModo modo={modo} onChange={setModo} />
        <p className="text-xs text-muted-foreground">
          {porPeriodo ? t("periodoPorAtividade", { meses: MESES }) : t("periodo", { meses: MESES })} ·{" "}
          {t("entradas", { n: totalDeEntradas })}
        </p>
      </div>
      {semNada && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {porPeriodo ? t("semAtividade") : t("semCoortes")}
        </p>
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("conversao.titulo")} <span className="font-normal normal-case">· {t("conversao.subtitulo", { meses: MESES })}</span>
        </h3>
        {series.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{tDesempenho("funil.semEtapa")}</p>
        ) : (
          <GraficoDeConversao
            meses={meses.map((m) => m.rotulo)}
            series={series}
            formatarValor={(v) => (v === null ? "—" : formatarPercentual(v / 100))}
          />
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("mapa.titulo")} <span className="font-normal normal-case">· {t("mapa.subtitulo")}</span>
          </h3>
          <span className="text-[11px] text-muted-foreground">
            {porPeriodo
              ? t("mapa.legendaPorPeriodo", { minimo: COORTE_PEQUENA })
              : t("mapa.legenda", { minimo: COORTE_PEQUENA })}
          </span>
        </div>
        {linhasDoCalor.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{tDesempenho("funil.semEtapa")}</p>
        ) : (
          <MapaDeCalor
            meses={meses}
            linhas={linhasDoCalor}
            formatarTaxa={formatarPercentual}
            tituloDaCelula={(mes, taxa, base) =>
              porPeriodo ? t("mapa.celulaPorPeriodo", { mes, taxa, n: base }) : t("mapa.celula", { mes, taxa, n: base })
            }
            rotuloEmAndamento={(n) => t("mapa.emAndamento", { n })}
            rotuloEmAberto={(n) => t("mapa.emAberto", { n })}
            rotuloPequena={
              porPeriodo ? t("mapa.pequenaPorPeriodo", { minimo: COORTE_PEQUENA }) : t("mapa.pequena", { minimo: COORTE_PEQUENA })
            }
          />
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          {porPeriodo ? t("fontePorPeriodo", { funil: pipeline.name }) : t("fonte", { funil: pipeline.name })}
        </p>
      </section>

      {/* Custos por mês (6.4). Gasto que falhou ou não coube NÃO vira número
          (a regra do `useGastosDeAnuncios`); sem integração, a linha que
          aponta para Integrações — nunca uma tabela de "—" com cara de
          medição. */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("custos.titulo")} <span className="font-normal normal-case">· {t("custos.subtitulo")}</span>
        </h3>
        {anuncios.carregando ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("custos.carregando")}
          </p>
        ) : anuncios.falhou ? (
          <p className="text-xs text-muted-foreground">{tDesempenho("investimento.falhou")}</p>
        ) : !anuncios.conectado ? (
          <p className="text-xs text-muted-foreground">
            {tDesempenho("investimento.naoConectado")}{" "}
            <Link href="/settings?tab=integracoes" className="underline hover:text-foreground">
              {tDesempenho("investimento.abrirIntegracoes")}
            </Link>
          </p>
        ) : cartoesDeCusto.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("custos.semCartoes")}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-1 text-xs">
                <thead>
                  <tr>
                    <th className="w-44 text-left font-medium text-muted-foreground" />
                    {meses.map((m) => (
                      <th key={m.chave} className="px-1 py-1 text-center font-medium text-muted-foreground">
                        {m.rotulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cartoesDeCusto.map((c) => (
                    <tr key={c}>
                      <th className="whitespace-nowrap pr-2 text-left font-medium text-foreground">{rotuloDoCartao(c)}</th>
                      {custosDosMeses.map((mes) => {
                        const valor = mes.custos[c];
                        return (
                          <td
                            key={mes.chave}
                            className="rounded-md bg-muted/40 px-1 py-2 text-center tabular-nums text-foreground"
                            title={valor === null ? undefined : formatCurrency(valor)}
                          >
                            {valor === null ? "—" : formatCurrencyShort(valor)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">{t("custos.nota")}</p>
          </>
        )}
      </section>
    </div>
  );
}
