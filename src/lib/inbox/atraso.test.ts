import { describe, it, expect } from "vitest";
import { ATRASO_CRITICO_MS, ATRASO_DE_RESPOSTA_MS, atrasoDeResposta } from "./atraso";

const AGORA = Date.parse("2026-09-02T15:00:00Z");
const min = (n: number) => new Date(AGORA - n * 60_000).toISOString();

const aberta = (aguardando_desde: string | null | undefined) => ({
  status: "open" as const,
  group_id: null,
  aguardando_desde,
});

describe("atrasoDeResposta — a régua dos 10 minutos", () => {
  it("é 10 minutos, o número que o operador pediu", () => {
    expect(ATRASO_DE_RESPOSTA_MS).toBe(600_000);
  });

  it("sem ninguém esperando não há alerta", () => {
    expect(atrasoDeResposta(aberta(null), AGORA)).toBeNull();
    expect(atrasoDeResposta(aberta(undefined), AGORA)).toBeNull();
  });

  it("abaixo de 10 minutos ainda não alerta; em 10 alerta", () => {
    expect(atrasoDeResposta(aberta(min(9)), AGORA)).toBeNull();
    expect(atrasoDeResposta(aberta(min(10)), AGORA)).toEqual({ n: 10, unidade: "min", critico: false });
  });

  it("é vermelho a partir de 30 minutos, o que o operador escolheu", () => {
    expect(ATRASO_CRITICO_MS).toBe(1_800_000);
    expect(atrasoDeResposta(aberta(min(29)), AGORA)).toEqual({ n: 29, unidade: "min", critico: false });
    expect(atrasoDeResposta(aberta(min(30)), AGORA)).toEqual({ n: 30, unidade: "min", critico: true });
  });

  it("escolhe a unidade mais legível", () => {
    expect(atrasoDeResposta(aberta(min(59)), AGORA)).toEqual({ n: 59, unidade: "min", critico: true });
    expect(atrasoDeResposta(aberta(min(60)), AGORA)).toEqual({ n: 1, unidade: "h", critico: true });
    expect(atrasoDeResposta(aberta(min(23 * 60 + 59)), AGORA)).toEqual({ n: 23, unidade: "h", critico: true });
    expect(atrasoDeResposta(aberta(min(48 * 60)), AGORA)).toEqual({ n: 2, unidade: "d", critico: true });
  });

  it("encerrada nunca alerta, mesmo com a coluna preenchida na linha velha", () => {
    expect(
      atrasoDeResposta({ ...aberta(min(30)), status: "closed" }, AGORA),
    ).toBeNull();
  });

  it("pendente ainda é atendimento em curso: alerta", () => {
    expect(
      atrasoDeResposta({ ...aberta(min(30)), status: "pending" }, AGORA),
    ).toEqual({ n: 30, unidade: "min", critico: true });
  });

  it("grupo fica de fora", () => {
    expect(
      atrasoDeResposta({ ...aberta(min(30)), group_id: "g1" }, AGORA),
    ).toBeNull();
  });

  it("coluna com lixo não derruba a lista", () => {
    expect(atrasoDeResposta(aberta("ontem"), AGORA)).toBeNull();
  });
});
