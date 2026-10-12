import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  apagarOrdemDosBlocos,
  gravarOrdemDosBlocos,
  lerOrdemDosBlocos,
} from "./ordem-dos-blocos";

// ============================================================
// A ida e a volta da ordem pessoal dos blocos (1082).
//
// O que estes testes seguram é o que a tela não tem como perceber sozinha:
// - leitura que FALHA não é "sem ordem própria" (as pastilhas pulariam de
//   lugar sem ninguém ter mexido);
// - escrita que a RLS barra volta 0 linhas com `error: null` — e a tela
//   diria "salvo" sobre nada;
// - o `onConflict` do upsert tem de ser a PK da migration, senão o Postgres
//   recusa TODA gravação (42P10) e só a produção mostraria.
// ============================================================

const DONO = { userId: "u-1", accountId: "a-1" };

type Resposta = { data: unknown; error: { message: string } | null };

/**
 * Um cliente de mentira que devolve as respostas NA ORDEM em que as consultas
 * são disparadas e anota o que cada uma pediu. Imita só a forma que o módulo
 * usa (encadear e aguardar) — a forma real contra o PostgREST foi conferida no
 * preview, que é onde ela se prova.
 */
function clienteFalso(respostas: Resposta[]) {
  const chamadas: { metodo: string; args: unknown[] }[][] = [];
  const from = vi.fn(() => {
    const passos: { metodo: string; args: unknown[] }[] = [];
    chamadas.push(passos);
    const resposta = respostas[chamadas.length - 1];
    const elo: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "upsert", "delete", "maybeSingle"]) {
      elo[metodo] = (...args: unknown[]) => {
        passos.push({ metodo, args });
        return elo;
      };
    }
    elo.then = (ok: (r: Resposta) => unknown) => Promise.resolve(resposta).then(ok);
    return elo;
  });
  return { supabase: { from } as unknown as SupabaseClient, chamadas, from };
}

describe("lerOrdemDosBlocos", () => {
  it("sem sessão ainda: 'não sei', sem consultar nada", async () => {
    const { supabase, from } = clienteFalso([]);
    expect(await lerOrdemDosBlocos(supabase, null)).toEqual({ sabe: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("devolve a ordem gravada, recortada pelo dono E pela conta", async () => {
    const { supabase, chamadas } = clienteFalso([
      { data: { ordem: ["g-trab", "geral"] }, error: null },
    ]);
    expect(await lerOrdemDosBlocos(supabase, DONO)).toEqual({
      sabe: true,
      ordem: ["g-trab", "geral"],
    });
    const filtros = chamadas[0].filter((p) => p.metodo === "eq").map((p) => p.args);
    expect(filtros).toEqual([
      ["user_id", "u-1"],
      ["account_id", "a-1"],
    ]);
  });

  it("linha ausente é 'sem ordem própria' — sabe, e é null", async () => {
    const { supabase } = clienteFalso([{ data: null, error: null }]);
    expect(await lerOrdemDosBlocos(supabase, DONO)).toEqual({ sabe: true, ordem: null });
  });

  it("leitura que FALHA é 'não sei', nunca 'sem ordem própria'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = clienteFalso([{ data: null, error: { message: "fora do ar" } }]);
    expect(await lerOrdemDosBlocos(supabase, DONO)).toEqual({ sabe: false });
  });

  it("coluna com lixo não vira ordem", async () => {
    const { supabase } = clienteFalso([{ data: { ordem: "g1,g2" }, error: null }]);
    expect(await lerOrdemDosBlocos(supabase, DONO)).toEqual({ sabe: true, ordem: null });
  });
});

describe("gravarOrdemDosBlocos", () => {
  it("grava a linha do dono e confirma pela linha devolvida", async () => {
    const { supabase, chamadas } = clienteFalso([{ data: [{ user_id: "u-1" }], error: null }]);
    expect(await gravarOrdemDosBlocos(supabase, DONO, ["g-trab", "geral"])).toBe(true);
    const upsert = chamadas[0].find((p) => p.metodo === "upsert");
    expect(upsert?.args[0]).toEqual({
      user_id: "u-1",
      account_id: "a-1",
      ordem: ["g-trab", "geral"],
    });
  });

  it("ZERO linhas com error null (a RLS barrou) é falha, não sucesso", async () => {
    const { supabase } = clienteFalso([{ data: [], error: null }]);
    expect(await gravarOrdemDosBlocos(supabase, DONO, ["geral"])).toBe(false);
  });

  it("erro do banco é falha", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = clienteFalso([{ data: null, error: { message: "42501" } }]);
    expect(await gravarOrdemDosBlocos(supabase, DONO, ["geral"])).toBe(false);
  });

  it("o onConflict do upsert é a PRIMARY KEY da migration 1082", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "supabase/migrations/1082_cb_ordem_dos_blocos.sql"),
      "utf8",
    );
    const pk = /PRIMARY KEY \(([^)]+)\)/.exec(sql)?.[1].replace(/\s+/g, "");
    const fonte = fs.readFileSync(path.join(__dirname, "ordem-dos-blocos.ts"), "utf8");
    const alvo = /onConflict: '([^']+)'/.exec(fonte)?.[1];
    expect(pk).toBe("user_id,account_id");
    expect(alvo).toBe(pk);
    // A coluna é texto: a chave do bloco Geral é a palavra `geral`, não um uuid.
    expect(sql).toMatch(/ordem text\[\] NOT NULL/);
    expect(fonte).toContain("const TABELA = 'cb_ordem_dos_blocos'");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.cb_ordem_dos_blocos");
  });
});

describe("apagarOrdemDosBlocos", () => {
  it("apaga só a linha do dono, nesta conta", async () => {
    const { supabase, chamadas, from } = clienteFalso([{ data: null, error: null }]);
    expect(await apagarOrdemDosBlocos(supabase, DONO)).toBe(true);
    expect(from).toHaveBeenCalledTimes(1);
    expect(chamadas[0].some((p) => p.metodo === "delete")).toBe(true);
    const filtros = chamadas[0].filter((p) => p.metodo === "eq").map((p) => p.args);
    expect(filtros).toEqual([
      ["user_id", "u-1"],
      ["account_id", "a-1"],
    ]);
  });

  it("sem linha para apagar já É o padrão — sucesso, sem segunda consulta", async () => {
    // DELETE e SELECT têm o mesmo recorte na 1082: reler não distinguiria
    // "não existe" de "não vejo mais" (Codex, PR #400). O limite está escrito
    // no módulo.
    const { supabase, from } = clienteFalso([{ data: null, error: null }]);
    expect(await apagarOrdemDosBlocos(supabase, DONO)).toBe(true);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("erro no DELETE é falha", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = clienteFalso([{ data: null, error: { message: "42501" } }]);
    expect(await apagarOrdemDosBlocos(supabase, DONO)).toBe(false);
  });

  it("o DELETE e o SELECT da 1082 têm o MESMO recorte de membro", () => {
    // É o que sustenta "zero linhas = sem ordem própria": se um dia o DELETE
    // ficar mais restrito que a leitura, a linha visível que não se apaga
    // passaria por sucesso — e aí a conferência tem de voltar.
    const sql = fs.readFileSync(
      path.join(process.cwd(), "supabase/migrations/1082_cb_ordem_dos_blocos.sql"),
      "utf8",
    );
    const corpo = (nome: string) =>
      sql.slice(sql.indexOf(`CREATE POLICY cb_ordem_dos_blocos_${nome}`)).split(";")[0];
    expect(corpo("select")).toMatch(/user_id = \(SELECT auth\.uid\(\)\)/);
    expect(corpo("select")).toContain("cb_contas_do_usuario()");
    expect(corpo("delete")).toContain("user_id = auth.uid() AND is_account_member(account_id)");
    expect(corpo("delete")).not.toMatch(/'(admin|agent|owner)'/);
  });
});
