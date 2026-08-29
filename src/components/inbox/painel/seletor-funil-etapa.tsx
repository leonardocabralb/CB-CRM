"use client";

// ============================================================
// Seletor de funil + etapa em DOIS NÍVEIS (Fase 5, referência Kommo).
//
// Um controle só: a lista mostra os FUNIS; clicar num funil expande as
// etapas coloridas dele; escolher uma etapa de OUTRO funil transfere o
// lead — quem escolhe decide funil e etapa num gesto, e a escrita sai
// num UPDATE só (regra da trilha 912). Com um funil só, os cabeçalhos
// somem e a lista abre direto nas etapas.
// ============================================================

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "@/types";

export function SeletorFunilEtapa({
  pipelines,
  stages,
  pipelineId,
  stageId,
  onEscolher,
  disabled,
  ariaLabel,
}: {
  pipelines: { id: string; name: string }[];
  stages: PipelineStage[];
  pipelineId: string;
  stageId: string;
  /** Funil e etapa ESCOLHIDOS — o chamador grava os dois num update só. */
  onEscolher: (pipelineId: string, stageId: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [aberto, setAberto] = useState(false);
  /**
   * Qual funil está expandido DENTRO do popover. Começa no funil atual do
   * negócio a cada abertura — é nele que a próxima etapa quase sempre está.
   */
  const [expandido, setExpandido] = useState<string | null>(null);

  const porFunil = useMemo(() => {
    const mapa = new Map<string, PipelineStage[]>();
    for (const p of pipelines) mapa.set(p.id, []);
    for (const s of [...stages].sort((a, b) => a.position - b.position)) {
      mapa.get(s.pipeline_id)?.push(s);
    }
    return mapa;
  }, [pipelines, stages]);

  const atual = stages.find((s) => s.id === stageId);
  const funilAtual = pipelines.find((p) => p.id === pipelineId);
  const umFunilSo = pipelines.length <= 1;

  const escolher = (pId: string, sId: string) => {
    setAberto(false);
    if (sId !== stageId) onEscolher(pId, sId);
  };

  const listaDeEtapas = (pId: string) => (
    <div className="py-0.5">
      {(porFunil.get(pId) ?? []).map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => escolher(pId, s.id)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
            !umFunilSo && "pl-7",
          )}
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: s.color }}
          />
          <span className="min-w-0 flex-1 truncate">{s.name}</span>
          {s.id === stageId && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
        </button>
      ))}
    </div>
  );

  return (
    <Popover
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (v) setExpandido(pipelineId);
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        aria-label={ariaLabel}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-card px-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: atual?.color ?? "var(--muted-foreground)" }}
        />
        <span className="min-w-0 flex-1 truncate text-left">
          {atual?.name ?? "—"}
          {!umFunilSo && funilAtual && (
            <span className="text-muted-foreground"> · {funilAtual.name}</span>
          )}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="max-h-80 w-64 overflow-y-auto p-1" sideOffset={6}>
        {umFunilSo ? (
          listaDeEtapas(pipelineId)
        ) : (
          pipelines.map((p) => {
            const estaAberto = expandido === p.id;
            return (
              <div key={p.id}>
                {/* Clicar no FUNIL só expande/recolhe — mover exige escolher
                    a etapa de destino, nunca um palpite nosso. */}
                <button
                  type="button"
                  onClick={() => setExpandido(estaAberto ? null : p.id)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm font-medium transition-colors hover:bg-muted",
                    p.id === pipelineId ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {estaAberto ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </button>
                {estaAberto && listaDeEtapas(p.id)}
              </div>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
