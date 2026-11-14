import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RELEITURA_DAS_NOTAS_MS } from "./use-notas-dos-avisos";

// ============================================================
// O aviso de anotação apagada com a página ABERTA. A lixeira (1132) só
// escreve em `cb_conversation_notes`, e o sino e o Meu dia assinam só
// `notifications`: sem a releitura por tempo, a anotação que OUTRA pessoa
// apagou ou restaurou nunca chegava ao aviso de quem ficou com a tela aberta.
// ============================================================

const fonte = readFileSync(join(process.cwd(), "src/hooks/use-notas-dos-avisos.ts"), "utf8");

describe("useNotasDosAvisos — a releitura", () => {
  it("relê a cada minuto, e só com a aba à vista", () => {
    expect(RELEITURA_DAS_NOTAS_MS).toBe(60_000);
    expect(fonte).toMatch(
      /setInterval\(\(\) => \{\s*if \(document\.visibilityState === "visible"\) setTique\(/,
    );
    expect(fonte).toMatch(/clearInterval\(relogio\)/);
  });

  it("a lista nova, a volta para o app e o minuto são gatilhos da MESMA leitura", () => {
    expect(fonte).toMatch(/\}, \[chave, avisos, volta, tique\]\);/);
  });
});
