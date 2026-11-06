import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// O token é lido cifrado; aqui ele é o que está gravado.
vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
}));

import { CalendlyError } from "./cliente";
import { EVENTOS_ASSINADOS, conectarCalendly, conferirAssinatura } from "./conexao";

// ------------------------------------------------------------
// ⚠️ A LISTA DE EVENTOS É FIXADA NA CRIAÇÃO da assinatura, lá no Calendly.
// Quem conectou antes de o cancelamento existir (20/09/2026) segue recebendo
// só `invitee.created` — e o sintoma é ausência: o cancelamento não chega, o
// lembrete da reunião cancelada sai, e a tela não diz nada. Por isso a
// conferência do cartão transforma isso em erro VISÍVEL.
// ------------------------------------------------------------

function bancoFalso(config: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from() {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: config, error: null }),
        update: (v: Record<string, unknown>) => {
          updates.push(v);
          return b;
        },
        then: (f: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(f),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, updates };
}

const clienteCom = (eventos: string[], estado: "active" | "disabled" = "active") =>
  () => ({ assinatura: async () => ({ estado, eventos }) }) as never;

const CONFIG = {
  access_token: "t",
  webhook_uri: "https://api.calendly.com/webhook_subscriptions/W1",
  webhook_state: "active",
  status: "ok",
  last_error: null,
};

describe("conferirAssinatura — assinatura incompleta", () => {
  it("CRÍTICO: assinatura sem o cancelamento vira erro visível", async () => {
    const { db, updates } = bancoFalso(CONFIG);
    await conferirAssinatura(db, "conta-1", { cliente: clienteCom(["invitee.created"]) });
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "erro", last_error: "assinatura_incompleta" }),
    );
  });

  it("assinatura completa não acusa nada", async () => {
    const { db, updates } = bancoFalso(CONFIG);
    await conferirAssinatura(db, "conta-1", { cliente: clienteCom([...EVENTOS_ASSINADOS]) });
    expect(updates.some((u) => u.last_error === "assinatura_incompleta")).toBe(false);
  });

  it("reassinou: o aviso some sozinho na conferência seguinte", async () => {
    const { db, updates } = bancoFalso({ ...CONFIG, status: "erro", last_error: "assinatura_incompleta" });
    await conferirAssinatura(db, "conta-1", { cliente: clienteCom([...EVENTOS_ASSINADOS]) });
    // ⚠️ "conectado", não "ok": o CHECK do 0977 só aceita 'conectado'|'erro',
    // e "ok" seria recusado em silêncio — o cartão ficaria vermelho para
    // sempre depois de reassinar (Codex, PR #235).
    expect(updates).toContainEqual(expect.objectContaining({ status: "conectado", last_error: null }));
  });

  it("⚠️ NÃO apaga erro de outra causa de carona", async () => {
    const { db, updates } = bancoFalso({ ...CONFIG, status: "erro", last_error: "token_invalido" });
    await conferirAssinatura(db, "conta-1", { cliente: clienteCom([...EVENTOS_ASSINADOS]) });
    expect(updates.some((u) => u.last_error === null)).toBe(false);
  });

  it("os dois eventos são assinados — o cancelamento não pode sair da lista", () => {
    expect(EVENTOS_ASSINADOS).toEqual(["invitee.created", "invitee.canceled"]);
  });
});

// ------------------------------------------------------------
// ⚠️ "Trocar chave" (1127) reconecta sem desconectar. Com o token antigo
// REVOGADO a assinatura antiga não se apaga e segue viva na mesma URL: o
// Calendly recusaria a nova ("url already exists") e a velha, assinada com a
// chave antiga, viraria 401 até ser desativada — 24 h de agendamentos
// perdidos. Por isso a URL só é reaproveitada quando a antiga SUMIU.
// ------------------------------------------------------------
describe("conectarCalendly — a URL do webhook na troca do token", () => {
  function bancoComUpsert(anterior: Record<string, unknown> | null) {
    const upserts: Record<string, unknown>[] = [];
    const db = {
      from() {
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => b,
          maybeSingle: async () => ({ data: anterior, error: null }),
          upsert: async (v: Record<string, unknown>) => {
            upserts.push(v);
            return { error: null };
          },
        };
        return b;
      },
    } as unknown as SupabaseClient;
    return { db, upserts };
  }

  const ANTERIOR = {
    webhook_token: "url-antiga-ficticia-0001",
    webhook_uri: "https://api.calendly.com/webhook_subscriptions/W1",
    access_token: "token-antigo-ficticio",
  };

  const clienteQue = (apagar: () => Promise<void>) =>
    () =>
      ({
        usuarioAtual: async () => ({ uri: "u", organizationUri: "o", nome: "Escritório", email: "contato@exemplo.test", schedulingUrl: null }),
        apagarAssinatura: apagar,
        criarAssinatura: async () => ({ uri: "https://api.calendly.com/webhook_subscriptions/W2", estado: "active", eventos: [...EVENTOS_ASSINADOS] }),
      }) as never;

  const conectar = (db: SupabaseClient, apagar: () => Promise<void>) =>
    conectarCalendly(db, "conta-1", "user-1", "token-novo-ficticio", "https://crm.exemplo.test", { cliente: clienteQue(apagar) });

  it("⚠️ a antiga não se apagou (token antigo revogado): a URL nasce NOVA", async () => {
    const { db, upserts } = bancoComUpsert(ANTERIOR);
    const r = await conectar(db, async () => {
      throw new CalendlyError("token_invalido", "401");
    });
    expect(r.ok).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].webhook_token).not.toBe(ANTERIOR.webhook_token);
  });

  it("a antiga foi apagada: a URL continua a mesma", async () => {
    const { db, upserts } = bancoComUpsert(ANTERIOR);
    await conectar(db, async () => {});
    expect(upserts[0].webhook_token).toBe(ANTERIOR.webhook_token);
  });

  it("a antiga já não existia (404): a URL continua a mesma", async () => {
    const { db, upserts } = bancoComUpsert(ANTERIOR);
    await conectar(db, async () => {
      throw new CalendlyError("nao_encontrado", "404", 404);
    });
    expect(upserts[0].webhook_token).toBe(ANTERIOR.webhook_token);
  });

  it("a troca carimba quando o token foi gravado e testado", async () => {
    const { db, upserts } = bancoComUpsert(ANTERIOR);
    await conectar(db, async () => {});
    expect(upserts[0]).toEqual(expect.objectContaining({ conectado_em: expect.any(String), conferido_em: expect.any(String) }));
  });
});

// ------------------------------------------------------------
// ⚠️ A tela só traduz código que esteja na lista FECHADA
// `CODIGOS_CONHECIDOS`; fora dela, cai no texto genérico "erro do Calendly".
// `assinatura_incompleta` nasceu de fora: a tradução existia, estava no
// lugar certo, e mesmo assim o operador não veria a instrução de reassinar —
// exatamente quando ela importa (Codex, PR #235). Pino estrutural, porque a
// lista mora num .tsx e importá-la aqui arrastaria a árvore de React.
// ------------------------------------------------------------
describe("o código de assinatura incompleta chega traduzido na tela", () => {
  it("está na lista fechada do cartão", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("src/components/settings/calendly-card.tsx", "utf-8");
    const lista = fonte.slice(fonte.indexOf("const CODIGOS_CONHECIDOS"), fonte.indexOf("]", fonte.indexOf("const CODIGOS_CONHECIDOS")));
    expect(lista).toContain('"assinatura_incompleta"');
  });

  it("e tem tradução nos dois dicionários", async () => {
    const { readFileSync } = await import("node:fs");
    for (const arquivo of ["messages/pt-BR.json", "messages/en.json"]) {
      const d = JSON.parse(readFileSync(arquivo, "utf-8"));
      expect(d.Settings.integracoes.calendly.motivo.assinatura_incompleta, arquivo).toBeTruthy();
    }
  });
});
