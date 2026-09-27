import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CASADO_POR, RESULTADOS_DO_EVENTO } from "@/lib/zapsign/log";

// ============================================================
// O cartão do ZapSign pede três famílias de chave MONTADA
// (`zapsign.motivo.<código>`, `zapsign.resultado.<r>`,
// `zapsign.casadoPor.<c>`), que o portão de i18n do CI só CONTA. Sem este
// teste, código novo aparece cru na tela com o CI verde.
//
// E a lista de códigos da tela (`CODIGOS_CONHECIDOS`) é FECHADA: código que
// a conexão devolve e que não está nela cai no texto genérico "erro do
// ZapSign" — a lição do `assinatura_incompleta` do Calendly. As listas são
// COLHIDAS do código (os tipos `CodigoDoErroZapSign` e `CodigoDaConexao`),
// nunca digitadas aqui.
// ============================================================

const raiz = path.join(__dirname, "../../..");
const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), "utf8");

function literaisDoTipo(fonte: string, tipo: string): string[] {
  const bloco = fonte.match(new RegExp(`export type ${tipo} =([\\s\\S]*?);`))?.[1] ?? "";
  return [...bloco.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

const doCartao = ler("src/components/settings/zapsign-card.tsx");
const conhecidos = [...(doCartao.match(/CODIGOS_CONHECIDOS = \[([\s\S]*?)\] as const/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

const emitidos = [
  ...literaisDoTipo(ler("src/lib/zapsign/cliente.ts"), "CodigoDoErroZapSign"),
  ...literaisDoTipo(ler("src/lib/zapsign/conexao.ts"), "CodigoDaConexao"),
  // `cartaoDoZapSign` devolve este quando o webhook não existe e não há erro gravado.
  "webhook_ausente",
];

function dicionario(arquivo: string) {
  return JSON.parse(ler(`messages/${arquivo}`)).Settings.integracoes.zapsign as Record<string, Record<string, unknown>>;
}

describe("cartão do ZapSign", () => {
  it("a colheita achou os códigos (senão o teste abaixo passaria vazio)", () => {
    expect(conhecidos.length).toBeGreaterThan(5);
    expect(emitidos.length).toBeGreaterThan(5);
  });

  it("CRÍTICO: todo código que a conexão devolve está na lista da tela", () => {
    expect(emitidos.filter((c) => !conhecidos.includes(c))).toEqual([]);
  });

  describe.each(["pt-BR.json", "en.json"])("dicionário %s", (arquivo) => {
    const z = dicionario(arquivo);
    it("todo código tem motivo", () => {
      expect(conhecidos.filter((c) => typeof z.motivo?.[c] !== "string")).toEqual([]);
    });
    it("todo resultado tem rótulo", () => {
      expect(RESULTADOS_DO_EVENTO.filter((r) => typeof z.resultado?.[r] !== "string")).toEqual([]);
    });
    it("todo 'casado por' tem rótulo", () => {
      expect(CASADO_POR.filter((c) => typeof z.casadoPor?.[c] !== "string")).toEqual([]);
    });
  });
});
