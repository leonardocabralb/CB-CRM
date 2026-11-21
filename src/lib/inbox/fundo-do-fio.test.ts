import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FUNDO_DO_ATLAS, FUNDO_NEUTRO, fundoDoFio } from "./fundo-do-fio";

// ⚠️ Nada aqui escreve a classe da imagem por extenso (nem em modelo com
// `${…}`): o Tailwind lê os testes também, geraria a classe com o texto do
// modelo como endereço e o build quebraria tentando resolvê-lo.

const PUBLICO = join(__dirname, "..", "..", "..", "public");

/** [cor de fundo, imagem, repetição] — a imagem só pelo endereço. */
function partes(classes: string) {
  const [cor, imagem, repeticao, ...resto] = classes.split(" ");
  return { cor, imagem, repeticao, resto };
}

describe("fundoDoFio — o fundo do fio pela marca", () => {
  it("marca padrão (Atlas CRM) leva o símbolo do Atlas", () => {
    expect(partes(fundoDoFio(false)).imagem).toContain(`'${FUNDO_DO_ATLAS}'`);
  });

  it("marca própria fica com os ícones neutros, nunca com o Atlas", () => {
    const { imagem } = partes(fundoDoFio(true));
    expect(imagem).toContain(`'${FUNDO_NEUTRO}'`);
    expect(imagem).not.toContain("atlas");
  });

  it("os dois ramos repetem o ladrilho sobre a cor de fundo", () => {
    for (const propria of [false, true]) {
      const { cor, imagem, repeticao, resto } = partes(fundoDoFio(propria));
      expect(cor).toBe("bg-background");
      expect(imagem.startsWith("bg-")).toBe(true);
      expect(repeticao).toBe("bg-repeat");
      expect(resto).toEqual([]);
    }
  });

  // O endereço da classe é literal; renomear o arquivo de `public/` sem
  // mexer lá deixaria o fio liso, sem erro nenhum.
  it.each([FUNDO_NEUTRO, FUNDO_DO_ATLAS])("%s existe em public/", (url) => {
    expect(existsSync(join(PUBLICO, url))).toBe(true);
  });

  // Mesmo traço do fundo neutro (o tom foi medido com estes atributos).
  it("o desenho do Atlas usa o traço do fundo neutro", () => {
    const atributos = (arquivo: string) => {
      const svg = readFileSync(join(PUBLICO, arquivo), "utf8");
      const raiz = svg.match(/<svg [^>]+>/)?.[0] ?? "";
      return [
        "stroke",
        "stroke-opacity",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
      ].map((nome) => raiz.match(new RegExp(` ${nome}="([^"]+)"`))?.[1]);
    };
    expect(atributos(FUNDO_DO_ATLAS)).toEqual(atributos(FUNDO_NEUTRO));
  });
});
