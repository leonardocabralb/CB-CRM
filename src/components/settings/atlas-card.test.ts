import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PERMISSOES_NECESSARIAS } from "@/lib/atlas/conexao";

import { PERMISSOES_CONHECIDAS } from "./atlas-card";

// ============================================================
// O cartão do Atlas pede duas famílias de chave MONTADA (`atlas.motivo.<c>`
// e `atlas.permissao.<p>`), que o portão de i18n do CI só CONTA. Sem este
// teste, código novo aparece cru na tela com o CI verde.
//
// A lista de códigos da tela (`CODIGOS_CONHECIDOS`) é FECHADA: código que a
// conexão devolve e que não está nela cai no texto genérico. As listas são
// COLHIDAS do código (os tipos `CodigoDoErroAtlas` e `CodigoDaConexao`),
// nunca digitadas aqui.
// ============================================================

const raiz = path.join(__dirname, "../../..");
const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), "utf8");

function literaisDoTipo(fonte: string, tipo: string): string[] {
  const bloco = fonte.match(new RegExp(`export type ${tipo} =([\\s\\S]*?);`))?.[1] ?? "";
  return [...bloco.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

const doCartao = ler("src/components/settings/atlas-card.tsx");
const conhecidos = [...(doCartao.match(/CODIGOS_CONHECIDOS = \[([\s\S]*?)\] as const/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

const emitidos = [
  ...literaisDoTipo(ler("src/lib/atlas/cliente.ts"), "CodigoDoErroAtlas"),
  ...literaisDoTipo(ler("src/lib/atlas/conexao.ts"), "CodigoDaConexao"),
];

function dicionario(arquivo: string) {
  return JSON.parse(ler(`messages/${arquivo}`)).Settings.integracoes.atlas as Record<string, Record<string, unknown>>;
}

describe("cartão do Atlas", () => {
  it("a colheita achou os códigos (senão o teste abaixo passaria vazio)", () => {
    expect(conhecidos.length).toBeGreaterThan(5);
    expect(emitidos.length).toBeGreaterThan(5);
  });

  it("CRÍTICO: todo código que a conexão devolve está na lista da tela", () => {
    expect(emitidos.filter((c) => !conhecidos.includes(c))).toEqual([]);
  });

  it("toda permissão que a conexão exige tem nome na tela", () => {
    expect(PERMISSOES_NECESSARIAS.filter((p) => !(PERMISSOES_CONHECIDAS as readonly string[]).includes(p))).toEqual([]);
  });

  describe.each(["pt-BR.json", "en.json"])("dicionário %s", (arquivo) => {
    const a = dicionario(arquivo);
    it("todo código tem motivo", () => {
      expect(conhecidos.filter((c) => typeof a.motivo?.[c] !== "string")).toEqual([]);
    });
    it("toda permissão tem nome", () => {
      expect(PERMISSOES_CONHECIDAS.filter((p) => typeof a.permissao?.[p] !== "string")).toEqual([]);
    });
  });
});
