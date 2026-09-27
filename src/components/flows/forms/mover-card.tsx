"use client";

/**
 * Formulário do nó "Mover card de etapa" (CB, 26/09/2026, migration 1053).
 * Quem executa é `src/lib/flows/mover-card.ts`; aqui só se escolhe o destino
 * (funil → etapa) e, opcionalmente, as etapas de ORIGEM de onde o card pode
 * sair.
 *
 * Os funis e as etapas vêm do contexto do editor (`catalogoDoFunil`, UMA
 * consulta para o editor inteiro). Enquanto carregam — ou se a leitura
 * falhou — o que já está gravado continua aparecendo como "o funil/a etapa
 * escolhida", nunca como o UUID cru nem como vazio.
 *
 * ⚠️ Destino ou origem que não existe mais no catálogo aparece DITO (aviso
 * âmbar), nunca some calado: a rota de ativação recusa o robô por isso, e o
 * operador precisa ver aqui o que consertar. A etapa de origem apagada não
 * tem caixa para desmarcar (as caixas são do catálogo), então o aviso traz o
 * botão que a tira da lista — sem ele o robô ficaria preso, sem ativar.
 *
 * ⚠️ A origem VAZIA (o padrão do nó novo) traz o card de QUALQUER funil —
 * inclusive o do cliente com caso em andamento em outro funil. O texto fica
 * âmbar e o validador avisa (sem bloquear): é a decisão do operador, dita.
 */

import { useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BuilderNode } from "../shared";
import { useFlowEditor } from "../flow-editor-state";
import { NextNodeRow } from "./fields";

interface MoverCardCfg {
  pipeline_id?: string;
  stage_id?: string;
  origem_stage_ids?: string[];
  next_node_key?: string;
}

export function MoverCardForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: MoverCardCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations("Flows.builder.form");
  const { catalogoDoFunil, recarregarCatalogoDoFunil } = useFlowEditor();

  const funilId = typeof cfg.pipeline_id === "string" ? cfg.pipeline_id : "";
  const etapaId = typeof cfg.stage_id === "string" ? cfg.stage_id : "";
  const origens = Array.isArray(cfg.origem_stage_ids)
    ? cfg.origem_stage_ids.filter((v): v is string => typeof v === "string" && v !== "")
    : [];

  const pronto = catalogoDoFunil.status === "pronto";
  const funis = pronto ? catalogoDoFunil.funis : [];
  const funil = funis.find((f) => f.id === funilId) ?? null;
  const etapasDoFunil = funil?.etapas ?? [];
  const etapaExiste = etapasDoFunil.some((e) => e.id === etapaId);

  const todasAsEtapas = new Set(funis.flatMap((f) => f.etapas.map((e) => e.id)));
  const origensApagadas = pronto ? origens.filter((id) => !todasAsEtapas.has(id)).length : 0;

  const funilOrfao = pronto && funilId !== "" && !funil;
  const etapaOrfa = pronto && etapaId !== "" && !!funil && !etapaExiste;

  // Só com o catálogo PRONTO: carregando ou falhou, `todasAsEtapas` é vazio e
  // o filtro limparia a lista inteira (o botão nem aparece nesses estados).
  const tirarOrigensApagadas = () => {
    if (!pronto) return;
    onUpdateConfig({ origem_stage_ids: origens.filter((id) => todasAsEtapas.has(id)) });
  };
  const sobraAlgumaOrigem = origens.length > origensApagadas;

  const alternarOrigem = (id: string, marcada: boolean) => {
    const proximas = marcada
      ? [...new Set([...origens, id])]
      : origens.filter((x) => x !== id);
    onUpdateConfig({ origem_stage_ids: proximas });
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <label className="mb-1 block text-xs text-muted-foreground">{t("movePipelineLabel")}</label>
          <Select
            value={funilId}
            onValueChange={(v) => {
              const novo = typeof v === "string" ? v : "";
              if (novo === funilId) return;
              // A etapa é DO funil: trocar o funil solta a etapa escolhida,
              // senão o nó apontaria para uma etapa de outro funil.
              onUpdateConfig({ pipeline_id: novo, stage_id: "" });
            }}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue placeholder={t("movePickPipeline")} />
            </SelectTrigger>
            <SelectContent>
              {funis.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
              {/* O que está gravado precisa de um item enquanto o catálogo
                  não chega (ou se o funil foi apagado) — sem ele o gatilho
                  mostraria o UUID cru. */}
              {funilId !== "" && !funil && (
                <SelectItem value={funilId}>
                  {funilOrfao ? t("movePipelineMissing") : t("movePipelineChosen")}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0">
          <label className="mb-1 block text-xs text-muted-foreground">{t("moveStageLabel")}</label>
          <Select
            value={etapaId}
            onValueChange={(v) => onUpdateConfig({ stage_id: typeof v === "string" ? v : "" })}
            disabled={!funil}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue placeholder={t("movePickStage")} />
            </SelectTrigger>
            <SelectContent>
              {etapasDoFunil.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
              {etapaId !== "" && !etapaExiste && (
                <SelectItem value={etapaId}>
                  {etapaOrfa ? t("moveStageMissing") : t("moveStageChosen")}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {catalogoDoFunil.status === "carregando" && (
        <p className="text-[10px] text-muted-foreground">{t("moveLoading")}</p>
      )}
      {catalogoDoFunil.status === "falhou" && (
        <p className="text-[10px] text-red-700 dark:text-red-300">
          {t("moveLoadError")}{" "}
          <button
            type="button"
            onClick={recarregarCatalogoDoFunil}
            className="font-medium underline underline-offset-2 hover:opacity-80"
          >
            {t("moveLoadRetry")}
          </button>
        </p>
      )}
      {pronto && funil && etapasDoFunil.length === 0 && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300">{t("moveNoStages")}</p>
      )}
      {(funilOrfao || etapaOrfa) && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300">{t("moveDestinationMissing")}</p>
      )}

      <div className="min-w-0">
        <label className="mb-1 block text-xs text-muted-foreground">{t("moveOriginLabel")}</label>
        {pronto && (
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-border bg-muted/40 p-2">
            {funis.map((f) =>
              f.etapas.length === 0 ? null : (
                <div key={f.id} className="min-w-0">
                  <p className="mb-1 truncate text-[11px] font-medium text-muted-foreground">{f.name}</p>
                  <div className="space-y-1">
                    {f.etapas.map((e) => (
                      <label
                        key={e.id}
                        className="flex min-w-0 cursor-pointer items-center gap-2 text-xs text-foreground"
                      >
                        <Checkbox
                          checked={origens.includes(e.id)}
                          onCheckedChange={(marcada) => alternarOrigem(e.id, marcada === true)}
                        />
                        <span className="truncate">{e.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
        {origens.length === 0 ? (
          <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">{t("moveOriginAny")}</p>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {t("moveOriginCount", { count: origens.length })}
          </p>
        )}
        {origensApagadas > 0 && (
          <div className="mt-1 space-y-1 text-[10px] text-amber-700 dark:text-amber-300">
            <p>
              {t("moveOriginMissing", { count: origensApagadas })}{" "}
              <button
                type="button"
                onClick={tirarOrigensApagadas}
                className="font-medium underline underline-offset-2 hover:opacity-80"
              >
                {t("moveOriginRemoveMissing", { count: origensApagadas })}
              </button>
            </p>
            {/* Tirar TODAS as marcadas vira "de qualquer etapa" — dizer antes. */}
            {!sobraAlgumaOrigem && <p>{t("moveOriginMissingAll")}</p>}
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">{t("moveHelp")}</p>
      <p className="text-[10px] text-muted-foreground">{t("moveHelpOrder")}</p>

      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label={t("thenAdvanceTo")}
      />
    </>
  );
}
