import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PERMISSOES_NECESSARIAS } from "./conexao";
import { SITUACOES_DO_GATILHO } from "./gatilho";
import {
  DESCRICAO_DA_PERMISSAO_OPCIONAL,
  PASSOS_DO_ATLAS,
  PASSOS_FORA_DO_GATILHO_DO_ATLAS,
  PERMISSAO_DA_ACAO,
  PERMISSOES_OPCIONAIS,
  ROTULO_DA_PERMISSAO,
  SITUACOES_DO_ONBOARDING,
  SITUACOES_ESCREVIVEIS,
  bytesUtf8,
  recortarBytes,
  recortarUtf16,
  trocaApagaAlgo,
} from "./passos-do-atlas";

// ============================================================
// O nó "Atlas" (30/09/2026): as listas puras que o construtor, a validação,
// o resumo e o motor repartem, e a chave MONTADA da situação do item do
// onboarding (`atlas.onboarding.situacao.<s>`), que o portão de i18n do CI
// só CONTA — colhida da lista, nunca digitada aqui.
// ============================================================

const raiz = path.join(__dirname, "../../..");
const builder = (arquivo: string) => JSON.parse(fs.readFileSync(path.join(raiz, "messages", arquivo), "utf8")).Automations.builder;

describe("as listas do nó Atlas", () => {
  it("as situações que o passo escreve são as do contrato §8, SEM `em_negociacao` (a mesma lista do gatilho)", () => {
    expect([...SITUACOES_ESCREVIVEIS]).toEqual([...SITUACOES_DO_GATILHO]);
    expect(SITUACOES_ESCREVIVEIS as readonly string[]).not.toContain("em_negociacao");
  });

  it("cada ação nova tem a sua permissão; as opcionais nunca são exigidas para conectar", () => {
    expect(Object.keys(PERMISSAO_DA_ACAO).sort()).toEqual(PASSOS_DO_ATLAS.filter((p) => p !== "atlas_criar_cliente").sort());
    expect(PERMISSOES_OPCIONAIS.filter((p) => (PERMISSOES_NECESSARIAS as readonly string[]).includes(p))).toEqual([]);
    for (const p of PERMISSOES_NECESSARIAS) expect(ROTULO_DA_PERMISSAO[p], p).toBeTruthy();
  });

  it("as OPCIONAIS não têm rótulo da tela do Atlas enquanto ele não for conferido: descrição + nome técnico, nunca um rótulo inventado", () => {
    for (const p of PERMISSOES_OPCIONAIS) {
      expect(ROTULO_DA_PERMISSAO[p], p).toBeUndefined();
      expect(DESCRICAO_DA_PERMISSAO_OPCIONAL[p], p).toBeTruthy();
    }
    // A INSTALACAO (viaja para quem instala) cita o nome técnico, não o rótulo provisório.
    const instalacao = fs.readFileSync(path.join(raiz, "docs/INSTALACAO.md"), "utf8");
    for (const p of PERMISSOES_OPCIONAIS) expect(instalacao, p).toContain(`\`${p}\``);
    expect(instalacao).not.toMatch(/\*\*Criar Tarefas\*\*|\*\*Criar\s+Transcrições\*\*|\*\*Atualizar Onboarding\*\*/);
  });

  it("o gatilho do Atlas recusa criar e atualizar o cliente — e SÓ isso (tarefa, transcrição e onboarding ficam)", () => {
    expect([...PASSOS_FORA_DO_GATILHO_DO_ATLAS].sort()).toEqual(["atlas_atualizar_cliente", "atlas_criar_cliente"]);
  });

  describe.each(["pt-BR.json", "en.json"])("dicionário %s", (arquivo) => {
    it("toda situação do item do onboarding tem rótulo (chave montada)", () => {
      const rotulos = builder(arquivo).atlas.onboarding.situacao as Record<string, unknown>;
      expect(SITUACOES_DO_ONBOARDING.filter((s) => typeof rotulos[s] !== "string")).toEqual([]);
      expect(Object.keys(rotulos).sort()).toEqual([...SITUACOES_DO_ONBOARDING].sort());
    });

    it("o cartão cita as opcionais pelo nome técnico (o rótulo do Atlas não foi conferido)", () => {
      const atlas = JSON.parse(fs.readFileSync(path.join(raiz, "messages", arquivo), "utf8")).Settings.integracoes.atlas;
      for (const p of PERMISSOES_OPCIONAIS) {
        expect(atlas.permissoesOpcionaisDica, p).toContain(`(${p})`);
        expect(atlas.permissao[p], p).toContain(`(${p})`);
      }
    });

    it("a ajuda da tarefa diz que ela FALHA com o cadastro na lixeira (o terceiro caso de `criarTarefaNoAtlas`)", () => {
      expect(builder(arquivo).atlas.tarefaAjuda).toMatch(arquivo === "en.json" ? /trash/ : /lixeira/);
    });

    it("todo passo do nó tem nome no construtor", () => {
      const nomes = builder(arquivo).steps as Record<string, unknown>;
      expect(PASSOS_DO_ATLAS.filter((p) => typeof nomes[p] !== "string")).toEqual([]);
    });
  });
});

describe("os recortes para os tetos do Atlas", () => {
  it("UTF-16 (a observação): cabe com o '…', e nunca parte um emoji", () => {
    expect(recortarUtf16("abc", 3)).toBe("abc");
    expect(recortarUtf16("abcd", 3)).toBe("ab…");
    // 1998 letras + um emoji (2 unidades) = 2000; com mais uma letra passa do teto.
    const texto = `${"a".repeat(1998)}😀b`;
    const cortado = recortarUtf16(texto, 2000);
    expect(cortado.length).toBeLessThanOrEqual(2000);
    expect(cortado.endsWith("…")).toBe(true);
    expect(cortado).not.toMatch(/[\uD800-\uDBFF]…$/);
  });

  it("bytes (as notas): cabe com o sufixo, sem partir caractere", () => {
    expect(recortarBytes("olá", 100)).toBe("olá");
    const cortado = recortarBytes("ééééé", 8, "[…]");
    expect(bytesUtf8(cortado)).toBeLessThanOrEqual(8);
    expect(cortado).toBe("é[…]");
    expect(recortarBytes("abc", 2, "[…]")).toBe("");
  });

  it("a troca pede confirmação só quando sai de uma config que não é a vazia", () => {
    expect(trocaApagaAlgo({}, {})).toBe(false);
    expect(trocaApagaAlgo({ tipo_de_contrato: "fixo" }, { tipo_de_contrato: "fixo" })).toBe(false);
    expect(trocaApagaAlgo({ tipo_de_contrato: "fixo", campo_proposta: "data_da_proposta" }, { tipo_de_contrato: "fixo" })).toBe(true);
  });
});
