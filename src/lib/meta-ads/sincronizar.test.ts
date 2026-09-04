import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { encrypt } from "@/lib/whatsapp/encryption";

import { MetaAdsError, type ClienteMeta } from "./cliente";
import { sincronizarMetaAds } from "./sincronizar";

/**
 * A reconciliação da janela (achado P1 do Codex no PR #123): quando a Meta
 * reprocessa um dia para ZERO, ela OMITE a linha em vez de devolver 0. Um
 * upsert cego deixaria o valor antigo gravado, e assim que o dia saísse da
 * janela de 3 dias esse número errado viraria permanente — inflando
 * investimento, custo por lead e CAC para sempre.
 *
 * O dublê do Supabase é mínimo de propósito: registra o que foi gravado e o
 * que foi apagado. Não vale como teste de PostgREST — vale como pino do
 * COMPORTAMENTO.
 */

interface LinhaDeGasto {
  campaign_id: string;
  dia: string;
}

interface Registro {
  apagados: { dia: string; campanhas: string[] }[];
  gravados: Record<string, unknown>[];
  atualizacoes: Record<string, unknown>[];
}

function dubleDoAdmin(existentes: LinhaDeGasto[]): { admin: SupabaseClient; registro: Registro } {
  const registro: Registro = { apagados: [], gravados: [], atualizacoes: [] };

  function consulta(tabela: string): Record<string, unknown> {
    let diaAlvo = "";
    const dados = tabela === "cb_meta_ads_gastos" ? existentes : [];
    const encadeado: Record<string, unknown> = {
      select: () => encadeado,
      order: () => encadeado,
      range: () => encadeado,
      gte: () => encadeado,
      lte: () => encadeado,
      eq: (coluna: string, valor: string) => {
        if (coluna === "dia") diaAlvo = valor;
        return encadeado;
      },
      in: async (_coluna: string, campanhas: string[]) => {
        registro.apagados.push({ dia: diaAlvo, campanhas });
        return { error: null };
      },
      maybeSingle: async () => ({
        data: {
          account_id: "conta",
          ad_account_id: "act_1",
          access_token: encrypt("EAABtokenDeTeste"),
          last_sync_at: "2026-09-01T00:00:00Z",
        },
        error: null,
      }),
      upsert: async (linhas: Record<string, unknown>[]) => {
        registro.gravados.push(...linhas);
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => {
        registro.atualizacoes.push(patch);
        return { eq: async () => ({ error: null }) };
      },
      delete: () => encadeado,
      // A leitura da janela termina num `await` direto sobre a consulta.
      then: (resolver: (r: { data: LinhaDeGasto[]; error: null }) => unknown) =>
        resolver({ data: dados, error: null }),
    };
    return encadeado;
  }

  return { admin: { from: consulta } as unknown as SupabaseClient, registro };
}

function clienteFalso(gastos: { campaignId: string; dia: string; gasto: number }[]): ClienteMeta {
  return {
    conta: async () => ({ id: "act_1", nome: "CB", moeda: "BRL" }),
    campanhas: async () => [{ id: "c1", nome: "Campanha 1", status: "ACTIVE" }],
    gastos: async () => gastos,
  };
}

describe("sincronizarMetaAds — reconciliação da janela", () => {
  const agora = new Date("2026-09-04T12:00:00Z");

  it("apaga o dia que a Meta deixou de reportar e preserva o que voltou", async () => {
    const { admin, registro } = dubleDoAdmin([
      { campaign_id: "c1", dia: "2026-09-02" }, // sumiu do retrato → apagar
      { campaign_id: "c1", dia: "2026-09-03" }, // voltou no retrato → fica
    ]);

    const r = await sincronizarMetaAds(admin, "conta", {
      agora,
      cliente: () => clienteFalso([{ campaignId: "c1", dia: "2026-09-03", gasto: 10 }]),
    });

    expect(r.ok).toBe(true);
    expect(registro.gravados.some((g) => g.dia === "2026-09-03" && g.gasto === 10)).toBe(true);
    expect(registro.apagados).toEqual([{ dia: "2026-09-02", campanhas: ["c1"] }]);
  });

  it("retrato completo não apaga nada", async () => {
    const { admin, registro } = dubleDoAdmin([{ campaign_id: "c1", dia: "2026-09-03" }]);
    await sincronizarMetaAds(admin, "conta", {
      agora,
      cliente: () => clienteFalso([{ campaignId: "c1", dia: "2026-09-03", gasto: 7 }]),
    });
    expect(registro.apagados).toEqual([]);
  });

  it("falha da Meta marca erro com o CÓDIGO e não carimba a sincronização", async () => {
    const { admin, registro } = dubleDoAdmin([]);
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sincronizarMetaAds(admin, "conta", {
      agora,
      cliente: () => ({
        ...clienteFalso([]),
        campanhas: async () => {
          throw new MetaAdsError("sem_permissao", "sem acesso");
        },
      }),
    });
    espiao.mockRestore();

    expect(r).toEqual({ ok: false, codigo: "sem_permissao" });
    expect(registro.atualizacoes.at(-1)).toMatchObject({ status: "erro", last_error: "sem_permissao" });
    expect(registro.atualizacoes.some((a) => "last_sync_at" in a)).toBe(false);
  });
});
