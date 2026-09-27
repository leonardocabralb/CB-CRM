import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { salvarValoresDoContato } from "./custom-values";

// Banco falso: registra o upsert (linhas + opções) e o delete (filtros), na
// forma que o helper usa.
interface Registro {
  upserts: { linhas: unknown[]; opcoes: unknown }[];
  deletes: { filtros: [string, unknown][] }[];
}

let r: Registro;

function banco(): SupabaseClient {
  return {
    from(tabela: string) {
      expect(tabela).toBe("contact_custom_values");
      return {
        upsert(linhas: unknown[], opcoes: unknown) {
          r.upserts.push({ linhas, opcoes });
          return Promise.resolve({ error: null });
        },
        delete() {
          const filtros: [string, unknown][] = [];
          r.deletes.push({ filtros });
          const q = {
            eq(col: string, val: unknown) {
              filtros.push([col, val]);
              return q;
            },
            in(col: string, val: unknown) {
              filtros.push([col, val]);
              return Promise.resolve({ error: null });
            },
          };
          return q;
        },
      };
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  r = { upserts: [], deletes: [] };
});

describe("salvarValoresDoContato", () => {
  it("manterExistentes: INSERT … ON CONFLICT DO NOTHING, e vazio NUNCA vira DELETE", async () => {
    // É a primeira origem do anúncio: o campo que a ficha já tem não pode
    // ser trocado nem apagado por esta gravação.
    const erro = await salvarValoresDoContato(
      banco(),
      "contato-1",
      { a: " x ", b: "" },
      { manterExistentes: true },
    );
    expect(erro).toBeNull();
    expect(r.upserts).toEqual([
      {
        linhas: [{ contact_id: "contato-1", custom_field_id: "a", value: "x" }],
        opcoes: {
          onConflict: "contact_id,custom_field_id",
          ignoreDuplicates: true,
        },
      },
    ]);
    expect(r.deletes).toEqual([]);
  });

  it("sem a opção, nada muda: upsert que sobrescreve e delete do esvaziado", async () => {
    const erro = await salvarValoresDoContato(banco(), "contato-1", {
      a: "x",
      b: "",
    });
    expect(erro).toBeNull();
    expect(r.upserts).toEqual([
      {
        linhas: [{ contact_id: "contato-1", custom_field_id: "a", value: "x" }],
        opcoes: { onConflict: "contact_id,custom_field_id" },
      },
    ]);
    expect(r.deletes).toEqual([
      {
        filtros: [
          ["contact_id", "contato-1"],
          ["custom_field_id", ["b"]],
        ],
      },
    ]);
  });

  it("mapa vazio: nenhuma chamada", async () => {
    expect(await salvarValoresDoContato(banco(), "contato-1", {})).toBeNull();
    expect(
      await salvarValoresDoContato(
        banco(),
        "contato-1",
        {},
        { manterExistentes: true },
      ),
    ).toBeNull();
    expect(r.upserts).toEqual([]);
    expect(r.deletes).toEqual([]);
  });
});
