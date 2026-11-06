import fs from "node:fs";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { encrypt } from "@/lib/whatsapp/encryption";

import { CARACTERES_DO_FINAL, finalDaChave, finalDaCifrada, INTEGRACOES, registrarTeste, TAMANHO_MINIMO_PARA_O_FINAL } from "./credencial";

// Só chaves FICTÍCIAS aqui (nada de chave real em teste nem em commit).

describe("finalDaChave — o que a tela pode ver da chave", () => {
  it("devolve os 4 últimos caracteres, e nunca mais que isso", () => {
    expect(finalDaChave("chave-ficticia-de-teste-abcd")).toBe("abcd");
    for (const chave of ["x".repeat(16), "y".repeat(40) + "1234", "$aact_prod_000ficticia_wxyz"]) {
      expect(finalDaChave(chave)?.length).toBe(CARACTERES_DO_FINAL);
    }
  });

  it("chave curta (menos de 16) não mostra nem o final: 4 de 10 seriam uma fração grande", () => {
    expect(finalDaChave("curta-123")).toBeNull();
    expect(finalDaChave("a".repeat(TAMANHO_MINIMO_PARA_O_FINAL - 1))).toBeNull();
    expect(finalDaChave("a".repeat(TAMANHO_MINIMO_PARA_O_FINAL))).toBe("aaaa");
  });

  it("ignora espaço colado nas pontas (o final é o da chave, não do espaço)", () => {
    expect(finalDaChave("  chave-ficticia-de-teste-abcd \n")).toBe("abcd");
  });
});

describe("finalDaCifrada — decifra só para tirar o final", () => {
  it("a cifra de verdade (AES-GCM) volta como os 4 últimos", () => {
    expect(finalDaCifrada(encrypt("chave-ficticia-de-teste-9z8y"))).toEqual({ final: "9z8y", ilegivel: false });
  });

  it("cifra que não decifra (ENCRYPTION_KEY trocada) é ILEGÍVEL, nunca 'sem chave'", () => {
    expect(finalDaCifrada("00ff:nao-e-cifra:00ff")).toEqual({ final: null, ilegivel: true });
    expect(finalDaCifrada("")).toEqual({ final: null, ilegivel: true });
    expect(finalDaCifrada(null)).toEqual({ final: null, ilegivel: true });
  });
});

/** Dublê do supabase-js: grava cada UPDATE com os filtros; nunca falha. */
function dubleDoBanco() {
  const escritas: { tabela: string; patch: Record<string, unknown>; filtros: [string, string, unknown][] }[] = [];
  const admin = {
    from(tabela: string) {
      return {
        update(patch: Record<string, unknown>) {
          const registro = { tabela, patch, filtros: [] as [string, string, unknown][] };
          escritas.push(registro);
          const consulta = {
            eq(coluna: string, valor: unknown) {
              registro.filtros.push(["eq", coluna, valor]);
              return consulta;
            },
            in(coluna: string, valor: unknown) {
              registro.filtros.push(["in", coluna, valor]);
              return consulta;
            },
            then<T>(resolver: (r: { error: null }) => T) {
              return Promise.resolve({ error: null }).then(resolver);
            },
          };
          return consulta;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, escritas };
}

const CODIGOS = { marca: ["chave_invalida", "chave_ilegivel"], limpa: ["chave_invalida", "chave_ilegivel"] };
const CERCA = { coluna: "api_key", valor: "cifra-ficticia-lida" };
const DA_CHAVE_TESTADA: [string, string, unknown][] = [
  ["eq", "account_id", "conta-1"],
  ["eq", "api_key", "cifra-ficticia-lida"],
];

describe("registrarTeste — o que o 'Testar agora' grava na conexão", () => {
  it("respondeu: carimba conferido_em e só limpa o erro que o teste PROVA resolvido", async () => {
    const { admin, escritas } = dubleDoBanco();
    await registrarTeste(admin, "cb_tldv_config", "conta-1", { ok: true }, CODIGOS, CERCA);
    expect(escritas).toHaveLength(2);
    expect(Object.keys(escritas[0].patch)).toEqual(["conferido_em"]);
    expect(escritas[0].filtros).toEqual(DA_CHAVE_TESTADA);
    // ⚠️ A volta a "conectado" é CERCADA: erro de rede de uma sincronização
    // (outra coisa) não se apaga de carona.
    expect(escritas[1].patch).toMatchObject({ status: "conectado", last_error: null });
    expect(escritas[1].filtros).toEqual([
      ...DA_CHAVE_TESTADA,
      ["eq", "status", "erro"],
      ["in", "last_error", ["chave_invalida", "chave_ilegivel"]],
    ]);
  });

  it("recusou por causa da chave: a conexão vai a erro com o código", async () => {
    const { admin, escritas } = dubleDoBanco();
    await registrarTeste(admin, "cb_tldv_config", "conta-1", { ok: false, codigo: "chave_invalida" }, CODIGOS, CERCA);
    expect(escritas).toEqual([
      { tabela: "cb_tldv_config", patch: expect.objectContaining({ status: "erro", last_error: "chave_invalida" }), filtros: DA_CHAVE_TESTADA },
    ]);
  });

  it("⚠️ toda escrita leva a CERCA da cifra lida: trocada a chave no meio, o 401 da antiga não marca a nova", async () => {
    const { admin, escritas } = dubleDoBanco();
    await registrarTeste(admin, "cb_tldv_config", "conta-1", { ok: false, codigo: "chave_invalida" }, CODIGOS, CERCA);
    await registrarTeste(admin, "cb_tldv_config", "conta-1", { ok: true }, CODIGOS, CERCA);
    for (const e of escritas) expect(e.filtros).toContainEqual(["eq", "api_key", "cifra-ficticia-lida"]);
  });

  it("rede, limite ou erro do provedor não dizem nada sobre a chave: nada muda", async () => {
    const { admin, escritas } = dubleDoBanco();
    for (const codigo of ["rede", "limite", "tldv_error", "db_error"]) {
      await registrarTeste(admin, "cb_tldv_config", "conta-1", { ok: false, codigo }, CODIGOS, CERCA);
    }
    expect(escritas).toEqual([]);
  });
});

// Pino: a data da chave de IA vem da coluna da 1127, nunca de `updated_at` —
// a 1047 copiou as chaves com `now()` e o autor da config antiga, e a tela
// diria "gravada no dia da migration por quem criou a config".
describe("chaves de IA: 'gravada em' é chave_gravada_em", () => {
  const fonte = fs.readFileSync(path.resolve(__dirname, "../ia-chaves/repo.ts"), "utf8");
  const credencial = fonte.slice(fonte.indexOf("export async function credencialDoProvedor"), fonte.indexOf("export async function gravarChave"));
  const gravar = fonte.slice(fonte.indexOf("export async function gravarChave"));

  it("credencialDoProvedor lê chave_gravada_em e não updated_at", () => {
    expect(credencial).toMatch(/select\('api_key, chave_gravada_em, atualizada_por'\)/);
    expect(credencial).not.toMatch(/updated_at/);
  });

  it("gravarChave carimba chave_gravada_em", () => {
    expect(gravar).toMatch(/chave_gravada_em: agora/);
  });
});

// Pino: toda conexão (e toda TROCA, que passa pelo mesmo caminho) grava
// QUANDO a chave foi gravada e que ela respondeu — senão o bloco "Chave
// guardada" mostraria a data da chave ANTERIOR depois de uma troca.
describe("quem grava a chave carimba conectado_em e conferido_em", () => {
  const raiz = path.resolve(__dirname, "../../..");
  const QUEM_GRAVA: Record<(typeof INTEGRACOES)[number], string> = {
    tldv: "src/lib/tldv/conexao.ts",
    calendly: "src/lib/calendly/conexao.ts",
    meta_ads: "src/app/api/cb/meta-ads/config/route.ts",
    asaas: "src/lib/asaas/conexao.ts",
    zapsign: "src/lib/zapsign/conexao.ts",
    atlas: "src/lib/atlas/conexao.ts",
  };
  for (const [integracao, arquivo] of Object.entries(QUEM_GRAVA)) {
    it(`${integracao}: ${arquivo}`, () => {
      const fonte = fs.readFileSync(path.join(raiz, arquivo), "utf8");
      expect(fonte).toMatch(/conectado_em: agora/);
      expect(fonte).toMatch(/conferido_em: agora/);
    });
  }
});
