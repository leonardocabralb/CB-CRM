import { describe, expect, it } from "vitest";

import type { PipelineStage } from "@/types";
import { etapasParaSalvar } from "./etapas-para-salvar";

const etapa = (id: string, extra: Partial<PipelineStage> = {}): PipelineStage =>
  ({
    id,
    pipeline_id: "funil-1",
    name: `Etapa ${id}`,
    color: "#3b82f6",
    position: 9,
    ...extra,
  }) as PipelineStage;

describe("etapasParaSalvar (porte #679)", () => {
  it("⚠️ a etapa que outro admin apagou NÃO volta: só as que ainda existem", () => {
    const linhas = etapasParaSalvar([etapa("a"), etapa("b"), etapa("c")], new Set(["a", "c"]));
    expect(linhas.map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("as posições saem contíguas, na ordem da janela, só entre as que ficaram", () => {
    const linhas = etapasParaSalvar([etapa("c"), etapa("b"), etapa("a")], new Set(["a", "c"]));
    expect(linhas.map((l) => [l.id, l.position])).toEqual([
      ["c", 0],
      ["a", 1],
    ]);
  });

  it("nenhuma etapa existe mais: nada a gravar", () => {
    expect(etapasParaSalvar([etapa("a")], new Set())).toEqual([]);
  });

  it("leva as NOSSAS colunas (resultado, degrau, reunião, próximas, situação, desqualificação, motivo)", () => {
    const [linha] = etapasParaSalvar(
      [
        etapa("a", {
          resultado: "perdido",
          degrau: "perda",
          desqualificacao: true,
          proximas_etapas: ["b"],
          situacao_do_cliente: "rescindido",
          campo_do_motivo_id: "campo-1",
        } as Partial<PipelineStage>),
      ],
      new Set(["a"]),
    );
    expect(linha).toMatchObject({
      resultado: "perdido",
      degrau: "perda",
      desqualificacao: true,
      proximas_etapas: ["b"],
      situacao_do_cliente: "rescindido",
      campo_do_motivo_id: "campo-1",
    });
    expect(Object.keys(linha).sort()).toEqual(
      [
        "campo_do_motivo_id",
        "color",
        "degrau",
        "desfecho_da_reuniao",
        "desqualificacao",
        "id",
        "name",
        "pipeline_id",
        "position",
        "proximas_etapas",
        "resultado",
        "situacao_do_cliente",
      ].sort(),
    );
  });

  it("a marca que não vale é limpa como antes (desqualificação fora da perda)", () => {
    const [linha] = etapasParaSalvar(
      [etapa("a", { degrau: "lead", desqualificacao: true } as Partial<PipelineStage>)],
      new Set(["a"]),
    );
    expect(linha.desqualificacao).toBe(false);
  });
});
