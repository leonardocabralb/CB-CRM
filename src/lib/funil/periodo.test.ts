import { describe, expect, it } from "vitest";

import {
  dentroDoIntervalo,
  diasDoIntervalo,
  duracaoEmDias,
  intervaloDoPreset,
  lerDataLocal,
  mesesAnteriores,
  periodoAnterior,
} from "./periodo";

// quarta-feira, 3 de setembro de 2026, 14h (local)
const AGORA = new Date(2026, 8, 3, 14, 0, 0);

describe("intervaloDoPreset (fuso local, `ate` exclusivo)", () => {
  it("este_mes: do dia 1 até agora (aberto)", () => {
    const i = intervaloDoPreset("este_mes", AGORA);
    expect(i.desde).toEqual(new Date(2026, 8, 1));
    expect(i.ate).toBeNull();
  });

  it("mes_passado: agosto inteiro", () => {
    const i = intervaloDoPreset("mes_passado", AGORA);
    expect(i.desde).toEqual(new Date(2026, 7, 1));
    expect(i.ate).toEqual(new Date(2026, 8, 1));
  });

  it("mes_passado em janeiro vira dezembro do ano anterior", () => {
    const i = intervaloDoPreset("mes_passado", new Date(2027, 0, 10));
    expect(i.desde).toEqual(new Date(2026, 11, 1));
    expect(i.ate).toEqual(new Date(2027, 0, 1));
  });

  it("este_ano e ano_passado", () => {
    expect(intervaloDoPreset("este_ano", AGORA)).toEqual({ desde: new Date(2026, 0, 1), ate: null });
    expect(intervaloDoPreset("ano_passado", AGORA)).toEqual({
      desde: new Date(2025, 0, 1),
      ate: new Date(2026, 0, 1),
    });
  });

  it("total não recorta nada", () => {
    expect(intervaloDoPreset("total", AGORA)).toEqual({ desde: null, ate: null });
  });

  it("personalizado: fim digitado é inclusivo, invertido é trocado, inválido vira total", () => {
    expect(intervaloDoPreset("personalizado", AGORA, { desde: "2026-08-10", ate: "2026-08-20" })).toEqual({
      desde: new Date(2026, 7, 10),
      ate: new Date(2026, 7, 21),
    });
    expect(intervaloDoPreset("personalizado", AGORA, { desde: "2026-08-20", ate: "2026-08-10" })).toEqual({
      desde: new Date(2026, 7, 10),
      ate: new Date(2026, 7, 21),
    });
    expect(intervaloDoPreset("personalizado", AGORA, { desde: "", ate: "abc" })).toEqual({
      desde: null,
      ate: null,
    });
    expect(intervaloDoPreset("personalizado", AGORA, { desde: "2026-08-10", ate: "" })).toEqual({
      desde: new Date(2026, 7, 10),
      ate: null,
    });
  });
});

describe("lerDataLocal", () => {
  it("lê AAAA-MM-DD como meia-noite LOCAL (nunca UTC — a armadilha da coluna DATE)", () => {
    const d = lerDataLocal("2026-05-18");
    expect(d).toEqual(new Date(2026, 4, 18));
    expect(d?.getDate()).toBe(18);
  });

  it("rejeita data que o Date normalizaria (31 de fevereiro) e formatos estranhos", () => {
    expect(lerDataLocal("2026-02-31")).toBeNull();
    expect(lerDataLocal("18/05/2026")).toBeNull();
    expect(lerDataLocal(null)).toBeNull();
  });
});

describe("periodoAnterior — mesma duração, imediatamente antes (D4)", () => {
  it("este_mes no dia 3 compara 3 dias inteiros com os 3 anteriores", () => {
    const anterior = periodoAnterior(intervaloDoPreset("este_mes", AGORA), AGORA);
    expect(anterior).toEqual({ desde: new Date(2026, 7, 29), ate: new Date(2026, 8, 1) });
    expect(duracaoEmDias(intervaloDoPreset("este_mes", AGORA), AGORA)).toBe(3);
  });

  it("mes_passado (agosto, 31 dias) compara com os 31 dias anteriores", () => {
    const anterior = periodoAnterior(intervaloDoPreset("mes_passado", AGORA), AGORA);
    expect(anterior).toEqual({ desde: new Date(2026, 6, 1), ate: new Date(2026, 7, 1) });
  });

  it("total não tem anterior", () => {
    expect(periodoAnterior({ desde: null, ate: null }, AGORA)).toBeNull();
  });

  it("desloca por DIAS DE CALENDÁRIO: março (31 dias) → 29 de janeiro à meia-noite local", () => {
    // Num fuso com horário de verão, março tem 30 dias e 23 horas; subtrair
    // milissegundos cairia em 29/01 à 1h. Rodado também com
    // TZ=America/New_York na revisão do PR #119.
    const abril = new Date(2026, 3, 10, 9);
    const anterior = periodoAnterior(intervaloDoPreset("mes_passado", abril), abril);
    expect(anterior).toEqual({ desde: new Date(2026, 0, 29), ate: new Date(2026, 2, 1) });
    expect(anterior?.desde?.getHours()).toBe(0);
  });

  it("ano inteiro → os 365 dias anteriores, não o ano-calendário (2024 é bissexto)", () => {
    // D4 é "mesma duração", não "mesmo calendário": 2025 tem 365 dias, e 365
    // dias antes de 1/1/2025 é 2/1/2024 — o 1/1/2024 fica de fora, de
    // propósito. O deslocamento por dias de calendário mantém a meia-noite.
    const anterior = periodoAnterior(intervaloDoPreset("ano_passado", AGORA), AGORA);
    expect(anterior).toEqual({ desde: new Date(2024, 0, 2), ate: new Date(2025, 0, 1) });
    expect(anterior?.desde?.getHours()).toBe(0);
  });
});

describe("dentroDoIntervalo e diasDoIntervalo", () => {
  it("[desde, ate) — o fim fica de fora", () => {
    const i = intervaloDoPreset("mes_passado", AGORA);
    expect(dentroDoIntervalo(new Date(2026, 7, 1), i)).toBe(true);
    expect(dentroDoIntervalo(new Date(2026, 7, 31, 23, 59), i)).toBe(true);
    expect(dentroDoIntervalo(new Date(2026, 8, 1), i)).toBe(false);
    expect(dentroDoIntervalo(new Date(2026, 6, 31, 23, 59), i)).toBe(false);
    expect(dentroDoIntervalo(new Date(1999, 0, 1), { desde: null, ate: null })).toBe(true);
  });

  it("dias densos do intervalo aberto vão até hoje, inclusive", () => {
    expect(diasDoIntervalo(intervaloDoPreset("este_mes", AGORA), AGORA)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });

  it("mês fechado tem todos os dias; total não tem dias", () => {
    expect(diasDoIntervalo(intervaloDoPreset("mes_passado", AGORA), AGORA)).toHaveLength(31);
    expect(diasDoIntervalo({ desde: null, ate: null }, AGORA)).toEqual([]);
  });
});

describe("mesesAnteriores", () => {
  it("do mais antigo ao atual, com virada de ano", () => {
    const meses = mesesAnteriores(new Date(2026, 1, 15), 4);
    expect(meses.map((m) => m.chave)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(meses[0].desde).toEqual(new Date(2025, 10, 1));
    expect(meses[0].ate).toEqual(new Date(2025, 11, 1));
    expect(meses[3].ate).toEqual(new Date(2026, 2, 1));
  });
});
