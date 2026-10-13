import { describe, expect, it } from "vitest";

import {
  intervaloEntreAsFichas,
  lerMotivos,
  montarCandidatas,
  parOrdenado,
  type FichaDaCandidata,
} from "./duplicatas";

const ficha = (id: string, name: string): FichaDaCandidata => ({
  id,
  name,
  phone: "5511900000001",
  created_at: "2026-10-13T14:16:18+00:00",
});

describe("lerMotivos", () => {
  it("lê os três sinais do banco, na ordem em que vieram", () => {
    expect(
      lerMotivos([{ tipo: "mesmo_email" }, { tipo: "telefone_parecido" }, { tipo: "criadas_juntas", segundos: 36 }]),
    ).toEqual([{ tipo: "mesmo_email" }, { tipo: "telefone_parecido" }, { tipo: "criadas_juntas", segundos: 36 }]);
  });

  it("lê o sinal 4 da 1092 (contato de uma ficha unida)", () => {
    expect(lerMotivos([{ tipo: "contato_antigo" }, { tipo: "telefone_parecido" }])).toEqual([
      { tipo: "contato_antigo" },
      { tipo: "telefone_parecido" },
    ]);
  });

  it("ignora o tipo desconhecido (sinal novo no banco antes do app) em vez de mostrá-lo cru", () => {
    expect(lerMotivos([{ tipo: "mesmo_cpf" }, { tipo: "mesmo_email" }])).toEqual([{ tipo: "mesmo_email" }]);
  });

  it("JSON torto não estoura: vira lista vazia ou segundos zerados", () => {
    expect(lerMotivos(null)).toEqual([]);
    expect(lerMotivos("mesmo_email")).toEqual([]);
    expect(lerMotivos([null, 3, "x"])).toEqual([]);
    expect(lerMotivos([{ tipo: "criadas_juntas", segundos: "abc" }])).toEqual([{ tipo: "criadas_juntas", segundos: 0 }]);
    expect(lerMotivos([{ tipo: "criadas_juntas", segundos: -5 }])).toEqual([{ tipo: "criadas_juntas", segundos: 0 }]);
  });
});

describe("montarCandidatas", () => {
  it("junta a ficha por contato, na ordem da RPC", () => {
    const lista = montarCandidatas(
      [
        { outro_id: "b", motivos: [{ tipo: "mesmo_email" }] },
        { outro_id: "a", motivos: [{ tipo: "criadas_juntas", segundos: 24 }] },
      ],
      [ficha("a", "Andre"), ficha("b", "Bia")],
    );
    expect(lista.map((c) => c.contatoId)).toEqual(["b", "a"]);
    expect(lista[0]).toMatchObject({ ficha: { name: "Bia" }, motivos: [{ tipo: "mesmo_email" }] });
    expect(lista[1]).toMatchObject({ ficha: { name: "Andre" }, motivos: [{ tipo: "criadas_juntas", segundos: 24 }] });
  });

  it("ficha que não veio na leitura fica com `ficha` nula — a linha não some", () => {
    const [c] = montarCandidatas([{ outro_id: "x", motivos: [{ tipo: "mesmo_email" }] }], []);
    expect(c).toMatchObject({ contatoId: "x", ficha: null });
  });

  it("linha sem nenhum motivo legível sai da lista", () => {
    expect(montarCandidatas([{ outro_id: "x", motivos: [{ tipo: "outro" }] }], [ficha("x", "X")])).toEqual([]);
  });
});

describe("parOrdenado", () => {
  it("põe o menor primeiro, nos dois sentidos", () => {
    const a = "00000000-0000-0000-0000-000000000001";
    const b = "00000000-0000-0000-0000-000000000002";
    expect(parOrdenado(a, b)).toEqual({ contato_menor: a, contato_maior: b });
    expect(parOrdenado(b, a)).toEqual({ contato_menor: a, contato_maior: b });
  });

  it("compara em minúsculas, como o uuid do banco ordena", () => {
    // Em maiúsculas, "F" < "a" no texto — a ordem do banco é a do hexadecimal minúsculo.
    expect(parOrdenado("FFFFFFFF-0000-0000-0000-000000000000", "aaaaaaaa-0000-0000-0000-000000000000")).toEqual({
      contato_menor: "aaaaaaaa-0000-0000-0000-000000000000",
      contato_maior: "ffffffff-0000-0000-0000-000000000000",
    });
  });
});

describe("intervaloEntreAsFichas", () => {
  it("segundos abaixo de um minuto, minutos acima", () => {
    expect(intervaloEntreAsFichas(36)).toEqual({ unidade: "segundos", valor: 36 });
    expect(intervaloEntreAsFichas(0)).toEqual({ unidade: "segundos", valor: 0 });
    expect(intervaloEntreAsFichas(62)).toEqual({ unidade: "minutos", valor: 1 });
    expect(intervaloEntreAsFichas(120)).toEqual({ unidade: "minutos", valor: 2 });
  });
});
