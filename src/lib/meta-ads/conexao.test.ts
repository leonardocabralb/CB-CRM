import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { encrypt } from "@/lib/whatsapp/encryption";

import { MetaAdsError, type ClienteMeta } from "./cliente";
import { conferirMetaAds } from "./conexao";

// Só token FICTÍCIO aqui (nada de chave real em teste nem em commit).
const CIFRA = encrypt("token-ficticio-de-teste-meta-0000");

/** Dublê: a leitura devolve a conexão; cada UPDATE é gravado com os filtros. */
function dubleDoBanco() {
  const escritas: { patch: Record<string, unknown>; filtros: [string, string, unknown][] }[] = [];
  const admin = {
    from() {
      return {
        select() {
          const leitura = {
            eq: () => leitura,
            maybeSingle: async () => ({ data: { access_token: CIFRA, ad_account_id: "act_1" }, error: null }),
          };
          return leitura;
        },
        update(patch: Record<string, unknown>) {
          const registro = { patch, filtros: [] as [string, string, unknown][] };
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
            then(resolver: (r: { error: null }) => unknown) {
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

function cliente(conta: ClienteMeta["conta"]): () => ClienteMeta {
  return () => ({ conta, contas: async () => [], campanhas: async () => [], gastos: async () => [] }) as unknown as ClienteMeta;
}

describe("conferirMetaAds — o 'Testar agora' do Meta Ads", () => {
  it("⚠️ ler a conta NÃO limpa o sem_permissao da sincronização (campanhas e gastos não foram provados)", async () => {
    const { admin, escritas } = dubleDoBanco();
    const resultado = await conferirMetaAds(admin, "conta-1", {
      cliente: cliente(async () => ({ id: "act_1", name: "Conta fictícia", currency: "BRL" }) as never),
    });
    expect(resultado).toEqual({ ok: true });
    const limpeza = escritas.find((e) => e.patch.status === "conectado");
    const codigos = limpeza?.filtros.find(([op, coluna]) => op === "in" && coluna === "last_error")?.[2];
    expect(codigos).toEqual(expect.arrayContaining(["token_invalido", "conta_nao_encontrada", "chave_ilegivel"]));
    expect(codigos).not.toContain("sem_permissao");
  });

  it("a conta recusada por permissão continua marcando a conexão", async () => {
    const { admin, escritas } = dubleDoBanco();
    const resultado = await conferirMetaAds(admin, "conta-1", {
      cliente: cliente(async () => {
        throw new MetaAdsError("sem_permissao", "recusado");
      }),
    });
    expect(resultado).toEqual({ ok: false, codigo: "sem_permissao" });
    expect(escritas).toHaveLength(1);
    expect(escritas[0].patch).toMatchObject({ status: "erro", last_error: "sem_permissao" });
    expect(escritas[0].filtros).toContainEqual(["eq", "access_token", CIFRA]);
  });
});
