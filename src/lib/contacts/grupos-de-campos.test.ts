import { describe, expect, it } from "vitest";

import {
  agruparCampos,
  ordenarCampos,
  chaveDoBloco,
  moverCampo,
  ordenarGrupos,
  posicoesDoBloco,
} from "./grupos-de-campos";
import type { CustomField, GrupoDeCampos } from "@/types";

function campo(parcial: Partial<CustomField>): CustomField {
  return {
    id: "x",
    user_id: "u",
    account_id: "a",
    field_name: "Campo",
    field_type: "text",
    field_key: "campo",
    categoria: "geral",
    grupo_id: null,
    posicao: null,
    created_at: "2026-01-01",
    ...parcial,
  };
}

function grupo(parcial: Partial<GrupoDeCampos>): GrupoDeCampos {
  return {
    id: "g",
    account_id: "a",
    nome: "Grupo",
    posicao: 0,
    created_at: "2026-01-01",
    ...parcial,
  };
}

describe("ordenarCampos", () => {
  it("ordena pela posição", () => {
    const lista = ordenarCampos([
      campo({ id: "b", posicao: 2 }),
      campo({ id: "a", posicao: 1 }),
      campo({ id: "c", posicao: 3 }),
    ]);
    expect(lista.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("posição NULA vai para o FIM, não para o começo", () => {
    // É o campo recém-criado (o insert não carimba posição) e o que o
    // semeador de traqueamento cria em lote. Ele tem de nascer no fim do
    // bloco: nascendo no topo, semear 10 campos empurraria para baixo a ordem
    // que o operador acabou de montar.
    const lista = ordenarCampos([
      campo({ id: "novo", posicao: null }),
      campo({ id: "primeiro", posicao: 0 }),
    ]);
    expect(lista.map((c) => c.id)).toEqual(["primeiro", "novo"]);
  });

  it("empate de posição desempata pelo nome", () => {
    const lista = ordenarCampos([
      campo({ id: "z", field_name: "Zebra", posicao: 1 }),
      campo({ id: "a", field_name: "Abacate", posicao: 1 }),
    ]);
    expect(lista.map((c) => c.id)).toEqual(["a", "z"]);
  });

  it("dois nulos desempatam pelo nome, não pela ordem de chegada", () => {
    const lista = ordenarCampos([
      campo({ id: "z", field_name: "Zebra", posicao: null }),
      campo({ id: "a", field_name: "Abacate", posicao: null }),
    ]);
    expect(lista.map((c) => c.id)).toEqual(["a", "z"]);
  });

  it("não muda a lista recebida", () => {
    const original = [campo({ id: "b", posicao: 2 }), campo({ id: "a", posicao: 1 })];
    ordenarCampos(original);
    expect(original.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("ordenarGrupos", () => {
  it("ordena pela posição e desempata pelo nome", () => {
    // O DEFAULT de `posicao` é 0, então grupo criado fora da tela empata com
    // todos os outros zerados — sem o desempate a ordem viraria a do
    // planejador, e mudaria entre duas cargas da MESMA tela.
    const lista = ordenarGrupos([
      grupo({ id: "3", nome: "Zebra", posicao: 0 }),
      grupo({ id: "1", nome: "Abacate", posicao: 0 }),
      grupo({ id: "2", nome: "Meio", posicao: -1 }),
    ]);
    expect(lista.map((g) => g.id)).toEqual(["2", "1", "3"]);
  });
});

describe("agruparCampos", () => {
  const bancario = grupo({ id: "b", nome: "Bancário", posicao: 2 });
  const traqueamento = grupo({ id: "t", nome: "Traqueamento", posicao: 1 });

  it("o bloco Geral vem PRIMEIRO, antes de qualquer grupo", () => {
    // Decisão do operador: campo sem grupo é o bloco fixo do topo. Um grupo
    // com `posicao` negativa não pode passar na frente dele — a ficha do
    // cliente ficaria com um bloco nomeado antes dos campos principais.
    const blocos = agruparCampos(
      [campo({ id: "solto" }), campo({ id: "no-grupo", grupo_id: "b" })],
      [grupo({ id: "b", nome: "Bancário", posicao: -99 })]
    );
    expect(blocos.map((bl) => bl.grupo?.nome ?? null)).toEqual([
      null,
      "Bancário",
    ]);
  });

  it("os grupos vêm na ordem da posição deles", () => {
    const blocos = agruparCampos(
      [
        campo({ id: "1", grupo_id: "b" }),
        campo({ id: "2", grupo_id: "t" }),
      ],
      [bancario, traqueamento]
    );
    expect(blocos.map((bl) => bl.grupo?.nome)).toEqual([
      "Traqueamento",
      "Bancário",
    ]);
  });

  it("bloco vazio some por padrão e aparece com incluirVazios", () => {
    // A ficha do cliente esconde (cabeçalho sem campo embaixo não informa e
    // ainda ocupa a coluna estreita); o catálogo mostra, senão um grupo
    // recém-criado sumiria da tela que acabou de criá-lo.
    const semNada = agruparCampos([], [bancario]);
    expect(semNada).toEqual([]);

    const comVazios = agruparCampos([], [bancario], { incluirVazios: true });
    expect(comVazios.map((bl) => bl.grupo?.nome)).toEqual(["Bancário"]);
    expect(comVazios[0].campos).toEqual([]);
  });

  it("o bloco Geral some quando não há campo solto", () => {
    const blocos = agruparCampos(
      [campo({ id: "1", grupo_id: "b" })],
      [bancario],
      { incluirVazios: true }
    );
    expect(blocos.map((bl) => bl.grupo?.nome ?? null)).toEqual(["Bancário"]);
  });

  it("campo de grupo DESCONHECIDO cai no Geral, nunca some", () => {
    // Corrida real: outro admin apaga o grupo entre a carga dos grupos e a
    // dos campos. Descartar o campo faria a tela afirmar que ele não existe
    // mais — e ele existe, com valor gravado em todo cliente.
    const blocos = agruparCampos(
      [campo({ id: "orfao", grupo_id: "apagado" })],
      [bancario],
      { incluirVazios: true }
    );
    expect(blocos[0].grupo).toBeNull();
    expect(blocos[0].campos.map((c) => c.id)).toEqual(["orfao"]);
  });

  it("cada bloco sai com os campos dele já ordenados", () => {
    const blocos = agruparCampos(
      [
        campo({ id: "b2", grupo_id: "b", posicao: 2 }),
        campo({ id: "b1", grupo_id: "b", posicao: 1 }),
        campo({ id: "geral-novo", posicao: null, field_name: "Zebra" }),
        campo({ id: "geral-1", posicao: 0, field_name: "Abacate" }),
      ],
      [bancario],
      { incluirVazios: true }
    );
    expect(blocos[0].campos.map((c) => c.id)).toEqual(["geral-1", "geral-novo"]);
    expect(blocos[1].campos.map((c) => c.id)).toEqual(["b1", "b2"]);
  });
});

describe("moverCampo", () => {
  const bancario = grupo({ id: "b", nome: "Bancário", posicao: 1 });

  /** Geral com a, b, c; Bancário com x. */
  function cena() {
    return agruparCampos(
      [
        campo({ id: "a", posicao: 0 }),
        campo({ id: "b", posicao: 1 }),
        campo({ id: "c", posicao: 2 }),
        campo({ id: "x", grupo_id: "b", posicao: 0 }),
      ],
      [bancario],
      { incluirVazios: true }
    );
  }

  it("arrastar para BAIXO deixa o campo depois do alvo", () => {
    // Mesma semântica do `arrayMove` do dnd-kit, que é o que a animação
    // mostrou enquanto o operador arrastava. Divergir aqui faria o campo
    // pousar uma casa além de onde ele foi solto.
    const r = moverCampo(cena(), "a", "c");
    expect(r?.[0].campos.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("arrastar para CIMA deixa o campo antes do alvo", () => {
    const r = moverCampo(cena(), "c", "a");
    expect(r?.[0].campos.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("soltar sobre um campo de OUTRO bloco muda o campo de bloco", () => {
    const r = moverCampo(cena(), "a", "x");
    expect(r?.[0].campos.map((c) => c.id)).toEqual(["b", "c"]);
    expect(r?.[1].campos.map((c) => c.id)).toEqual(["a", "x"]);
  });

  it("soltar na ÁREA de um bloco vazio põe o campo lá — é o único caminho", () => {
    // Sem isto, um bloco recém-criado seria inalcançável: não há campo dentro
    // dele para servir de alvo, e a linha não tem seletor de bloco.
    const vazio = agruparCampos([campo({ id: "a" })], [bancario], {
      incluirVazios: true,
    });
    const r = moverCampo(vazio, "a", chaveDoBloco("b"));
    expect(r?.[1].campos.map((c) => c.id)).toEqual(["a"]);
  });

  it("soltar na área do bloco de ORIGEM manda o campo para o fim dele", () => {
    const r = moverCampo(cena(), "a", chaveDoBloco(null));
    expect(r?.[0].campos.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("soltar onde já estava devolve null — nada a gravar", () => {
    // Um arrastar que não moveu ninguém não pode virar escrita no banco.
    expect(moverCampo(cena(), "a", "a")).toBeNull();
  });

  it("alvo inexistente devolve null", () => {
    expect(moverCampo(cena(), "a", "sumiu")).toBeNull();
  });

  it("não muda os blocos recebidos", () => {
    const original = cena();
    moverCampo(original, "a", "c");
    expect(original[0].campos.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("posicoesDoBloco", () => {
  it("numera de 0 a N-1 e carimba o grupo do bloco", () => {
    // Normaliza o bloco inteiro a cada arrastar: as posições do banco NÃO são
    // densas (campo novo nasce nulo, o semeador cria vários de uma vez), então
    // uma reordenação por diferença deixaria buracos que reaparecem como
    // ordem errada no próximo arrastar.
    const payload = posicoesDoBloco(
      [campo({ id: "a" }), campo({ id: "b" }), campo({ id: "c" })],
      "grupo-1"
    );
    expect(payload).toEqual([
      { id: "a", grupo_id: "grupo-1", posicao: 0 },
      { id: "b", grupo_id: "grupo-1", posicao: 1 },
      { id: "c", grupo_id: "grupo-1", posicao: 2 },
    ]);
  });

  it("o bloco Geral manda grupo_id null — é o que a RPC grava", () => {
    // Arrastar um campo para o Geral é a única forma de TIRÁ-LO de um grupo.
    // Mandando o id antigo, o campo voltaria para o bloco de onde saiu.
    expect(posicoesDoBloco([campo({ id: "a", grupo_id: "b" })], null)).toEqual([
      { id: "a", grupo_id: null, posicao: 0 },
    ]);
  });
});
