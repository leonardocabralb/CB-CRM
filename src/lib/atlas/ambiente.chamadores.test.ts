import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// ============================================================
// AMBIENTE em toda linha do Atlas (1072) — DEFAULT-DENY sobre `src/`.
//
// O preview contra o STAGING do Atlas grava no banco da PRODUÇÃO (CLAUDE.md
// 8b), e o staging tem o mesmo id de escritório e ids copiados dos reais.
// Uma consulta a `cb_atlas_clientes` ou `cb_atlas_recusas` sem a cerca de
// ambiente (`noAmbiente`, `enderecos.ts`) deixaria a leitura do preview
// escrever por cima dos vínculos reais — ou a produção religar pelo que o
// teste gravou. Todo arquivo de `src/` que cita uma das duas tabelas chama
// `noAmbiente(`, ou entra na lista abaixo COM o motivo escrito.
//
// O pino é por ARQUIVO (não por consulta): ele pega o arquivo novo que
// esqueceu a cerca inteira, não a consulta nova num arquivo que já a usa —
// essa fica para a revisão. Testes e dublês ficam fora (citam as tabelas).
// ============================================================

const SRC = path.join(__dirname, "../..");
const TABELAS = /\bcb_atlas_(clientes|recusas)\b/;

/** Arquivo que cita as tabelas SEM a cerca, e por quê. Hoje, nenhum. */
const EXCECOES: Record<string, string> = {};

function* fontes(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* fontes(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/test-helper/.test(e.name)) yield p;
  }
}

const semComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const citam = [...fontes(SRC)]
  .map((arquivo) => ({ nome: path.relative(SRC, arquivo), texto: semComentarios(fs.readFileSync(arquivo, "utf8")) }))
  .filter((f) => TABELAS.test(f.texto));

describe("AMBIENTE em toda linha do Atlas (1072)", () => {
  it("a varredura acha quem cita as tabelas (senão o pino passaria vazio)", () => {
    expect(citam.map((f) => f.nome)).toEqual(expect.arrayContaining(["lib/atlas/criar-cliente.ts", "lib/atlas/situacoes.ts", "lib/atlas/conexao.ts"]));
  });

  it("CRÍTICO: todo arquivo que cita cb_atlas_clientes/cb_atlas_recusas chama noAmbiente(", () => {
    const semCerca = citam.filter((f) => !f.texto.includes("noAmbiente(") && !(f.nome in EXCECOES)).map((f) => f.nome);
    expect(semCerca).toEqual([]);
  });

  it("cada exceção continua necessária (quem passou a usar a cerca sai da lista)", () => {
    for (const nome of Object.keys(EXCECOES)) {
      const f = citam.find((c) => c.nome === nome);
      expect(f, `${nome} não cita mais as tabelas`).toBeDefined();
      expect(f!.texto.includes("noAmbiente("), `${nome} já usa noAmbiente`).toBe(false);
    }
  });

  it("a cerca é a de `enderecos.ts`: nulo = `api_url IS NULL`, o endereço = `api_url = <endereço>`", () => {
    const fonte = semComentarios(fs.readFileSync(path.join(__dirname, "enderecos.ts"), "utf8"));
    expect(fonte).toMatch(/ambiente === null \? q\.is\("api_url", null\) : q\.eq\("api_url", ambiente\)/);
  });
});
