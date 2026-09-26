import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buscarPorBsuid, fichaQueVenceuPorBsuid } from "./bsuid";

const BSUID = "BR.13491208655302741918";

/** O `.from().select().eq().eq().maybeSingle()` da busca, com as respostas em ordem. */
function dbComRespostas(respostas: Array<{ data: unknown; error: unknown }>) {
  let chamadas = 0;
  const filtros: Array<[string, unknown]> = [];
  const builder = {
    select: () => builder,
    eq: (col: string, valor: unknown) => {
      filtros.push([col, valor]);
      return builder;
    },
    maybeSingle: () => Promise.resolve(respostas[Math.min(chamadas++, respostas.length - 1)]),
  };
  return {
    db: { from: () => builder } as unknown as SupabaseClient,
    chamadas: () => chamadas,
    filtros,
  };
}
const semEspera = async () => {};

describe("buscarPorBsuid", () => {
  it("casa EXATO na conta: `account_id` e `wa_user_id`", async () => {
    const { db, filtros } = dbComRespostas([{ data: { id: "c1", phone: null }, error: null }]);
    const r = await buscarPorBsuid(db, "conta-1", BSUID);
    expect(r).toEqual({ contato: { id: "c1", phone: null }, falhou: false });
    expect(filtros).toEqual([
      ["account_id", "conta-1"],
      ["wa_user_id", BSUID],
    ]);
  });

  it("erro de banco é 'não sei', nunca 'não achei'", async () => {
    const { db } = dbComRespostas([{ data: null, error: { message: "timeout" } }]);
    expect(await buscarPorBsuid(db, "conta-1", BSUID)).toEqual({ contato: null, falhou: true });
  });
});

describe("fichaQueVenceuPorBsuid (a leitura repetida quando falha)", () => {
  it("leitura que FALHA é repetida, e a ficha é entregue", async () => {
    const { db, chamadas } = dbComRespostas([
      { data: null, error: { message: "timeout" } },
      { data: { id: "c1", phone: null }, error: null },
    ]);
    const r = await fichaQueVenceuPorBsuid(db, "conta-1", BSUID, semEspera);
    expect(r).toEqual({ contato: { id: "c1", phone: null }, falhou: false });
    expect(chamadas()).toBe(2);
  });

  it("para depois de três tentativas e diz que NÃO SABE", async () => {
    const { db, chamadas } = dbComRespostas([{ data: null, error: { message: "fora do ar" } }]);
    expect(await fichaQueVenceuPorBsuid(db, "conta-1", BSUID, semEspera)).toEqual({
      contato: null,
      falhou: true,
    });
    expect(chamadas()).toBe(3);
  });

  it("'não achei' com a consulta respondida NÃO é repetido", async () => {
    const { db, chamadas } = dbComRespostas([{ data: null, error: null }]);
    expect(await fichaQueVenceuPorBsuid(db, "conta-1", BSUID, semEspera)).toEqual({
      contato: null,
      falhou: false,
    });
    expect(chamadas()).toBe(1);
  });
});
