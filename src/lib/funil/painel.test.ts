import { describe, expect, it } from "vitest";

import { classificarEtapas, DEGRAUS, type EtapaMinima } from "./degraus";
import {
  CARTOES_DE_CUSTO,
  type CartaoDeCusto,
  cartoesDeCustoNaTela,
  degrauDoCartao,
  degrausNaTela,
  escreverPainel,
  estadoDoDegrau,
  lerPainel,
  normalizarRotulo,
  ROTULO_MAX,
  rotuloDoDegrau,
} from "./painel";

const etapa = (id: string, position: number, degrau: string | null): EtapaMinima => ({ id, name: id, position, degrau });

// Os três funis comerciais de produção (26/09/2026), com a configuração que
// o operador vai fazer depois da 1054.
const BANCARIO = classificarEtapas([
  etapa("avulso", 0, "lead"),
  etapa("mql1", 3, "mql"),
  etapa("reuniao", 4, "reuniao"),
  etapa("proposta", 8, "proposta"),
  etapa("contrato", 9, "contrato"),
  etapa("perdido", 10, "perda"),
]);
const TRABALHISTA = classificarEtapas([
  etapa("entrada", 0, "lead"),
  etapa("qualificado", 5, "mql"),
  etapa("link", 6, "proposta"),
  etapa("assinado", 7, "contrato"),
  etapa("protocolado", 8, "pasta"),
  etapa("perdido", 11, "perda"),
]);
const PREV = classificarEtapas([
  etapa("novo", 0, "lead"),
  etapa("mql", 2, "mql"),
  etapa("assinatura", 3, "proposta"),
  etapa("assinado", 4, "contrato"),
  etapa("pasta", 6, "pasta"),
  etapa("sem-pasta", 12, "perda"),
]);

describe("lerPainel — parse, nunca `as`", () => {
  it("vazio, nulo e lixo viram o padrão (nada escondido, nenhum rótulo)", () => {
    for (const cru of [null, undefined, {}, [], "x", 3, { rotulos: "x", nao_se_aplica: "reuniao" }]) {
      expect(lerPainel(cru)).toEqual({ rotulos: {}, naoSeAplica: [], custosOcultos: [] });
    }
  });

  it("lê as três chaves do banco, aparando e descartando o desconhecido", () => {
    const p = lerPainel({
      rotulos: { proposta: "  Assinatura enviada ", pasta: "Pasta fechada", perda: "Perdido", mql: "   ", lead: 3 },
      nao_se_aplica: ["reuniao", "reuniao", "perda", "inventado", 7],
      custos_ocultos: ["perdidos", "cac", "nao-existe", "perdidos"],
      chave_estranha: true,
    });
    expect(p.rotulos).toEqual({ proposta: "Assinatura enviada", pasta: "Pasta fechada" });
    expect(p.naoSeAplica).toEqual(["reuniao"]);
    // na ordem da tela, sem repetição
    expect(p.custosOcultos).toEqual(["cac", "perdidos"]);
  });

  it("rótulo acima do teto é cortado", () => {
    const longo = "x".repeat(ROTULO_MAX + 10);
    expect(lerPainel({ rotulos: { pasta: longo } }).rotulos.pasta).toHaveLength(ROTULO_MAX);
    expect(normalizarRotulo("  ")).toBeNull();
    expect(normalizarRotulo(null)).toBeNull();
  });

  it("escreverPainel grava na forma do banco e volta igual pelo parse", () => {
    const p = lerPainel({
      rotulos: { pasta: "Processo protocolado" },
      nao_se_aplica: ["reuniao"],
      custos_ocultos: ["perdidos"],
    });
    const gravado = escreverPainel(p);
    expect(gravado).toEqual({
      rotulos: { pasta: "Processo protocolado" },
      nao_se_aplica: ["reuniao"],
      custos_ocultos: ["perdidos"],
    });
    expect(lerPainel(gravado)).toEqual(p);
  });

  it("escreverPainel limpa o rascunho da tela (espaços, rótulo vazio, ordem)", () => {
    const gravado = escreverPainel({
      rotulos: { proposta: "  Link enviado  ", mql: "" },
      naoSeAplica: ["reuniao"],
      custosOcultos: ["perdidos", "investimento"],
    });
    expect(gravado.rotulos).toEqual({ proposta: "Link enviado" });
    expect(gravado.custos_ocultos).toEqual(["investimento", "perdidos"]);
  });
});

describe("rotuloDoDegrau — o livre vence; sem ele, o padrão (dicionário)", () => {
  const padrao = (d: string) => `padrão:${d}`;
  it("Pasta fechada no previdenciário; MQL do dicionário", () => {
    const p = lerPainel({ rotulos: { pasta: "Pasta fechada" } });
    expect(rotuloDoDegrau(p, "pasta", padrao)).toBe("Pasta fechada");
    expect(rotuloDoDegrau(p, "mql", padrao)).toBe("padrão:mql");
  });
});

describe("estadoDoDegrau — o cartão 'Reunião' some só de quem marca 'não se aplica'", () => {
  const trabalhista = lerPainel({ nao_se_aplica: ["reuniao"] });
  const semMarca = lerPainel({});

  it("marcado e sem etapa: some (fim do tracejado no Trabalhista e no previdenciário)", () => {
    expect(estadoDoDegrau("reuniao", TRABALHISTA, trabalhista)).toBe("nao_se_aplica");
    expect(estadoDoDegrau("reuniao", PREV, trabalhista)).toBe("nao_se_aplica");
    expect(degrausNaTela(TRABALHISTA, trabalhista)).toEqual(["lead", "mql", "proposta", "contrato", "pasta"]);
  });

  it("⚠️ SEM marca e sem etapa: continua 'faltando' — o esquecimento não se esconde", () => {
    expect(estadoDoDegrau("reuniao", TRABALHISTA, semMarca)).toBe("faltando");
    expect(degrausNaTela(TRABALHISTA, semMarca)).toContain("reuniao");
    const bancarioSemReuniao = classificarEtapas([etapa("avulso", 0, "lead"), etapa("contrato", 1, "contrato")]);
    expect(estadoDoDegrau("reuniao", bancarioSemReuniao, semMarca)).toBe("faltando");
  });

  it("etapa MAPEADA vence a marca: o cartão aparece", () => {
    const marcadoTudo = lerPainel({ nao_se_aplica: [...DEGRAUS] });
    expect(estadoDoDegrau("reuniao", BANCARIO, marcadoTudo)).toBe("mapeado");
    expect(degrausNaTela(BANCARIO, marcadoTudo)).toEqual(["lead", "mql", "reuniao", "proposta", "contrato"]);
  });

  it("a pasta é opcional: sem etapa, some mesmo SEM marca (o Bancário não ganha cartão tracejado)", () => {
    expect(estadoDoDegrau("pasta", BANCARIO, semMarca)).toBe("nao_se_aplica");
    expect(degrausNaTela(BANCARIO, semMarca)).toEqual(["lead", "mql", "reuniao", "proposta", "contrato"]);
    expect(estadoDoDegrau("pasta", PREV, semMarca)).toBe("mapeado");
  });
});

describe("cartoesDeCustoNaTela", () => {
  it("padrão: todos, menos os de degrau sem etapa", () => {
    expect(cartoesDeCustoNaTela(BANCARIO, lerPainel({}))).toEqual([
      "investimento",
      "lead",
      "mql",
      "reuniao",
      "proposta",
      "contrato",
      "cac",
      "perdidos",
    ]);
    // o previdenciário (sem reunião, com pasta): custo por pasta, sem custo por reunião
    expect(cartoesDeCustoNaTela(PREV, lerPainel({}))).toEqual([
      "investimento",
      "lead",
      "mql",
      "proposta",
      "contrato",
      "cac",
      "pasta",
      "perdidos",
    ]);
  });

  it("o que o operador escondeu some; investimento, CAC e perdidos não dependem de degrau", () => {
    const p = lerPainel({ custos_ocultos: ["mql", "perdidos"] });
    expect(cartoesDeCustoNaTela(TRABALHISTA, p)).toEqual(["investimento", "lead", "proposta", "contrato", "cac", "pasta"]);
    const semEtapaNenhuma = classificarEtapas([]);
    expect(cartoesDeCustoNaTela(semEtapaNenhuma, lerPainel({}))).toEqual(["investimento", "cac", "perdidos"]);
  });

  it("todo cartão de degrau aponta para um degrau que existe, e o resto não aponta para nenhum", () => {
    for (const c of CARTOES_DE_CUSTO) {
      const d = degrauDoCartao(c);
      if (d !== null) expect(DEGRAUS).toContain(d);
    }
    expect(DEGRAUS.every((d) => (CARTOES_DE_CUSTO as readonly string[]).includes(d))).toBe(true);
    const semDegrau: CartaoDeCusto[] = ["investimento", "cac", "perdidos"];
    expect(semDegrau.map(degrauDoCartao)).toEqual([null, null, null]);
  });
});
