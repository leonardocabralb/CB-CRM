// ============================================================
// Pino do manifesto e do ícone do app instalado na Tela de Início.
//
// Os modos de falha daqui não estouram em lugar nenhum: um escopo
// estreitado devolve a moldura de navegador do iPhone por cima de cada
// conversa aberta, e um ícone que some do `<head>` (ou que aponta para um
// tamanho que o `apple-icon.tsx` não gera) vira ícone improvisado ou
// quebrado na Tela de Início. Tudo só aparece no aparelho, e só para quem
// instalar DEPOIS da mudança.
//
// E a marca: manifesto, ícones e layout leem `obterMarca()` A CADA PEDIDO.
// Se algum deles voltar a ser estático, o `next build` (sem service role no
// CI) assa o padrão, e a marca gravada pela aba Marca nunca aparece — sem
// erro nenhum.
// ============================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MetadataRoute } from "next";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { marcaPadrao, TAMANHOS_DO_ICONE, type Marca } from "@/lib/marca";

const MARCA_DE_TESTE: Marca = {
  ...marcaPadrao(),
  propria: true,
  nome: "Marca de Teste Ltda",
  nomeCurto: "Teste",
  versao: "1700000000000",
};

vi.mock("@/lib/marca-servidor", () => ({
  obterMarca: async () => MARCA_DE_TESTE,
}));

import manifest, { dynamic } from "./manifest";

const fonte = (arquivo: string) =>
  readFileSync(join(process.cwd(), "src/app", arquivo), "utf8");

describe("manifesto do app instalado", () => {
  let m: MetadataRoute.Manifest;
  beforeAll(async () => {
    m = await manifest();
  });

  it("o escopo é a raiz: todo endereço do CRM fica dentro do app", () => {
    // Sem isso, abrir uma conversa no iPhone cobria a tela com a moldura
    // de navegador (relato do operador com print, 14/09/2026).
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
  });

  it("abre na caixa de entrada, dentro do próprio escopo", () => {
    expect(m.start_url).toBe("/inbox");
    expect(m.start_url?.startsWith(m.scope ?? "")).toBe(true);
  });

  it("tem identidade fixa, que não muda junto com a tela de abertura", () => {
    expect(m.id).toBe("/");
  });

  it("aponta um ícone para cada tamanho que o apple-icon gera, e só para eles", () => {
    const icones = m.icons ?? [];
    const esperados = TAMANHOS_DO_ICONE.map((lado) => `/apple-icon/${lado}`);
    const caminho = (src: string) => src.split("?")[0];

    for (const src of esperados) {
      expect(icones.map((i) => caminho(i.src))).toContain(src);
    }
    for (const icone of icones) {
      expect(esperados).toContain(caminho(icone.src));
      const lado = caminho(icone.src).split("/").pop();
      expect(icone.sizes).toBe(`${lado}x${lado}`);
      expect(icone.type).toBe("image/png");
    }
  });

  it("tem os dois tamanhos que o Android exige para instalar", () => {
    const tamanhos = (m.icons ?? []).map((i) => i.sizes);
    expect(tamanhos).toContain("192x192");
    expect(tamanhos).toContain("512x512");
  });

  it("nome e nome curto são os da marca da instalação", () => {
    expect(m.name).toBe(MARCA_DE_TESTE.nome);
    expect(m.short_name).toBe(MARCA_DE_TESTE.nomeCurto);
  });

  it("todo ícone carrega a versão da marca (marca trocada = endereço novo, sem o ícone antigo em cache)", () => {
    for (const icone of m.icons ?? []) {
      expect(icone.src).toMatch(new RegExp(`\\?v=${MARCA_DE_TESTE.versao}$`));
    }
  });
});

describe("a marca nunca é assada no build", () => {
  it("o manifesto é dinâmico", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("os dois ícones são dinâmicos e rodam em Node (o símbolo padrão é lido do disco)", () => {
    for (const arquivo of ["icon.tsx", "apple-icon.tsx"]) {
      expect(fonte(arquivo), arquivo).toMatch(
        /^export const dynamic = "force-dynamic";$/m,
      );
      expect(fonte(arquivo), arquivo).toMatch(
        /^export const runtime = "nodejs";$/m,
      );
    }
  });

  it("o layout espera a conexão antes de ler a marca, no metadata e no corpo", () => {
    const layout = fonte("layout.tsx");
    // Uma vez em `generateMetadata`, outra no `RootLayout`.
    expect(layout.match(/await connection\(\);/g)?.length).toBe(2);
    expect(layout).not.toMatch(/export const metadata\b/);
  });
});

describe("ícone do app instalado no <head>", () => {
  it("o layout NÃO declara `icons` — a declaração desliga o apple-touch-icon", () => {
    // Medido em 14/09/2026 (Next 16.2): com `metadata.icons` no layout, o
    // Next ignora TODOS os ícones de arquivo, e o `<head>` saía sem nenhum
    // `apple-touch-icon`. O `icons` veio do upstream e um merge o traz de
    // volta sem conflito nenhum.
    expect(fonte("layout.tsx")).not.toMatch(/^\s*icons\s*:/m);
  });
});
