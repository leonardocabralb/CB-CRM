import { describe, expect, it } from "vitest";

import { TIPO_DATA } from "@/lib/contacts/campo-data";
import {
  criarFilaDeGravacao,
  gravaAoEscolher,
  gravaAoSair,
  valorMudou,
} from "./salvamento-de-campo";

describe("gravaAoSair", () => {
  it("texto, número e data confirmam ao SAIR do campo", () => {
    for (const tipo of ["text", "number", TIPO_DATA, "qualquer-coisa-nova"]) {
      expect(gravaAoSair(tipo), tipo).toBe(true);
      expect(gravaAoEscolher(tipo), tipo).toBe(false);
    }
  });

  it("CRÍTICO: `select` confirma na ESCOLHA — não há blur útil", () => {
    // O popover fecha no clique; esperar o blur deixaria a escolha sem gravar
    // até o operador ir mexer em outro lugar da tela.
    expect(gravaAoSair("select")).toBe(false);
    expect(gravaAoEscolher("select")).toBe(true);
  });

  it("tipo desconhecido cai no blur, que é o comportamento seguro", () => {
    // Um `field_type` novo (a coluna é texto livre) nunca deve gravar por
    // tecla — no pior caso ele exige um clique fora, que é recuperável.
    expect(gravaAoSair("")).toBe(true);
  });
});

describe("valorMudou", () => {
  it("igual é igual", () => {
    expect(valorMudou("300", "300")).toBe(false);
    expect(valorMudou("", "")).toBe(false);
  });

  it("CRÍTICO: só o espaço em volta NÃO conta como mudança", () => {
    // `salvarValoresDoContato` grava `v.trim()`: entrar e sair de um campo
    // que a automação preencheu com espaços gravaria uma versão "limpa" que
    // ninguém pediu, e a ficha registraria uma edição que não houve.
    expect(valorMudou(" 300 ", "300")).toBe(false);
    expect(valorMudou("300", "  300")).toBe(false);
    expect(valorMudou("  ", "")).toBe(false);
  });

  it("mudança de verdade conta", () => {
    expect(valorMudou("300", "400")).toBe(true);
    expect(valorMudou("", "novo")).toBe(true);
  });

  it("esvaziar conta — é o gesto de APAGAR o valor", () => {
    // `""` no upsert compartilhado vira DELETE da linha; se isto devolvesse
    // `false`, limpar um campo nunca gravaria e o valor velho voltaria no
    // próximo carregamento.
    expect(valorMudou("300", "")).toBe(true);
    expect(valorMudou("300", "   ")).toBe(true);
  });

  it("espaço no MEIO é mudança (não é aparado)", () => {
    expect(valorMudou("Rua A", "Rua  A")).toBe(true);
  });
});

// ============================================================
// A fila de gravação
//
// O achado do Codex no PR #83: duas gravações concorrentes na mesma linha
// chegam ao banco fora de ordem, e a ANTIGA chegando por último apaga a edição
// mais nova — em silêncio.
// ============================================================

/** Um `gravar` cuja resolução é controlada pelo teste, na ordem que ele quiser. */
function gravadorManual() {
  const chamadas: string[] = [];
  const resolvers: ((ok: boolean) => void)[] = [];
  const gravar = (valor: string) => {
    chamadas.push(valor);
    return new Promise<boolean>((r) => resolvers.push(r));
  };
  return { chamadas, resolvers, gravar };
}

describe("criarFilaDeGravacao", () => {
  it("grava o que mudou e passa a considerá-lo salvo", async () => {
    const g = gravadorManual();
    const fila = criarFilaDeGravacao("", g.gravar);
    fila.enfileirar("a");
    expect(g.chamadas).toEqual(["a"]);
    g.resolvers[0](true);
    await Promise.resolve();
    await Promise.resolve();
    expect(fila.salvo()).toBe("a");
    expect(fila.emVoo()).toBe(false);
  });

  it("ignora o que não mudou — inclusive só por espaço em volta", () => {
    const g = gravadorManual();
    const fila = criarFilaDeGravacao(" 300 ", g.gravar);
    fila.enfileirar("300");
    fila.enfileirar(" 300");
    expect(g.chamadas).toEqual([]);
  });

  it("CRÍTICO: não dispara a segunda enquanto a primeira está em voo", () => {
    const g = gravadorManual();
    const fila = criarFilaDeGravacao("", g.gravar);
    fila.enfileirar("a");
    fila.enfileirar("b");
    fila.enfileirar("c");
    // Uma só saiu; as outras viraram "pendente", e só a MAIS NOVA sobrevive.
    expect(g.chamadas).toEqual(["a"]);
    expect(fila.emVoo()).toBe(true);
  });

  it("CRÍTICO: o ÚLTIMO valor vence, e os intermediários não vão ao banco", async () => {
    const g = gravadorManual();
    const fila = criarFilaDeGravacao("", g.gravar);
    fila.enfileirar("a");
    fila.enfileirar("b");
    fila.enfileirar("c");
    g.resolvers[0](true);
    await Promise.resolve();
    await Promise.resolve();
    // "b" foi descartado: o que importa é onde o campo PAROU.
    expect(g.chamadas).toEqual(["a", "c"]);
    g.resolvers[1](true);
    await Promise.resolve();
    await Promise.resolve();
    expect(fila.salvo()).toBe("c");
    expect(fila.emVoo()).toBe(false);
  });

  it("volta ao valor original enquanto a gravação está em voo: não regrava à toa", async () => {
    const g = gravadorManual();
    const fila = criarFilaDeGravacao("x", g.gravar);
    fila.enfileirar("y");
    fila.enfileirar("x"); // desfez antes de a primeira voltar
    g.resolvers[0](true);
    await Promise.resolve();
    await Promise.resolve();
    // Agora `salvo` é "y" e o pendente "x" É diferente — tem de ser gravado,
    // senão a tela mostra "x" e o banco guarda "y".
    expect(g.chamadas).toEqual(["y", "x"]);
  });

  it("falha não avança o `salvo` e o próximo gesto tenta de novo", async () => {
    const g = gravadorManual();
    const estados: string[] = [];
    const fila2 = criarFilaDeGravacao("", g.gravar, (e) => estados.push(e));
    fila2.enfileirar("a");
    g.resolvers[0](false);
    await Promise.resolve();
    await Promise.resolve();
    expect(fila2.salvo()).toBe("");
    expect(estados).toEqual(["gravando", "parado"]);
    fila2.enfileirar("a");
    expect(g.chamadas).toEqual(["a", "a"]);
  });

  it("avisa o estado na ordem que a tela precisa", async () => {
    const g = gravadorManual();
    const estados: string[] = [];
    const fila = criarFilaDeGravacao("", g.gravar, (e) => estados.push(e));
    fila.enfileirar("a");
    expect(estados).toEqual(["gravando"]);
    g.resolvers[0](true);
    await Promise.resolve();
    await Promise.resolve();
    expect(estados).toEqual(["gravando", "salvo"]);
  });
});
