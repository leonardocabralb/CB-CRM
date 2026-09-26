import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// Cancelamento FORA DE ORDEM e o teto do processamento (revisão do PR #235).
//
// B: o `invitee.canceled` processado ANTES do `invitee.created` do mesmo
//    convite terminava `ignorado` sem contato — e o agendamento, chegando
//    depois, disparava a automação de uma reunião cancelada.
// L: o contato só ia para a linha do agendamento no fim; passado o teto de
//    4 min, a rota gravava `falhou` com o contato NULO enquanto a automação
//    seguia, e o cancelamento desistia sem contato.
// ============================================================

const busca = vi.hoisted(() => ({ findExistingContact: vi.fn() }));
vi.mock("@/lib/contacts/dedupe", () => busca);

const motor = vi.hoisted(() => ({ dispararAutomacoes: vi.fn() }));
vi.mock("@/lib/automations/engine", () => motor);

const destino = vi.hoisted(() => ({ resolverDestinatario: vi.fn() }));
vi.mock("@/lib/automations/destinatario", () => destino);

import { processarAgendamento } from "./processar";
import { EVENTO_AGENDADO, EVENTO_CANCELADO, type Agendamento } from "./payload";

const AGENDAMENTO: Agendamento = {
  evento: EVENTO_AGENDADO,
  inviteeUri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
  eventoUri: "https://api.calendly.com/event_types/T1",
  eventoNome: "Reunião com Advogado",
  eventoAgendadoUri: null,
  nome: "Joel",
  email: null,
  telefone: "5519980000004",
  telefoneOrigem: "sms",
  inicio: "2026-09-09T19:00:00Z",
  fim: null,
  link: null,
  local: null,
  cancelarUrl: null,
  remarcarUrl: null,
  reagendado: false,
  fusoDoConvidado: null,
  perguntas: [],
};

type Filtro = [string, string, unknown];
interface Chamada {
  tabela: string;
  op: "select" | "update";
  valores?: Record<string, unknown>;
  filtros: Filtro[];
}

let chamadas: Chamada[] = [];
let ordem: string[] = [];
/** O que a consulta de cancelamento devolve. */
let cancelamento: { data: unknown; error: { message: string } | null } = { data: null, error: null };

const admin = {
  from(tabela: string) {
    const c: Chamada = { tabela, op: "select", filtros: [] };
    chamadas.push(c);
    const b: Record<string, unknown> = {
      select: () => b,
      update: (valores: Record<string, unknown>) => {
        c.op = "update";
        c.valores = valores;
        ordem.push(`update:${tabela}`);
        return b;
      },
      eq: (col: string, v: unknown) => (c.filtros.push(["eq", col, v]), b),
      is: (col: string, v: unknown) => (c.filtros.push(["is", col, v]), b),
      order: () => b,
      limit: () => b,
      maybeSingle: async () =>
        tabela === "cb_calendly_eventos" ? cancelamento : { data: null, error: null },
      then: (f: (v: unknown) => unknown) =>
        Promise.resolve({
          data:
            tabela === "automations" && c.op === "select"
              ? [{ trigger_type: "calendly_booking", trigger_config: {}, is_active: true }]
              : [],
          error: null,
        }).then(f),
    };
    return b;
  },
} as unknown as SupabaseClient;

beforeEach(() => {
  chamadas = [];
  ordem = [];
  cancelamento = { data: null, error: null };
  busca.findExistingContact.mockReset().mockResolvedValue({ contato: { id: "c1", phone: "5519980000004" }, falhou: false });
  destino.resolverDestinatario.mockReset();
  motor.dispararAutomacoes.mockReset().mockImplementation(async () => {
    ordem.push("disparo");
    return { candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: 0, emEspera: 0 };
  });
});

describe("B — o cancelamento que chegou ANTES do agendamento", () => {
  it("⚠️ reunião já cancelada: nada roda — nem busca de contato, nem ficha, nem automação", async () => {
    cancelamento = { data: { id: "cancel-1" }, error: null };
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO, undefined, { eventoId: "evt-1" });

    expect(r).toMatchObject({ resultado: "ignorado", contactId: null });
    expect(r.detalhe).toContain("cancelada");
    expect(busca.findExistingContact).not.toHaveBeenCalled();
    expect(destino.resolverDestinatario).not.toHaveBeenCalled();
    expect(motor.dispararAutomacoes).not.toHaveBeenCalled();
    // A pergunta é pelo cancelamento DESTE convite, nesta conta.
    const pergunta = chamadas.find((c) => c.tabela === "cb_calendly_eventos" && c.op === "select");
    expect(pergunta?.filtros).toEqual([
      ["eq", "account_id", "acct-1"],
      ["eq", "evento", EVENTO_CANCELADO],
      ["eq", "invitee_uri", AGENDAMENTO.inviteeUri],
    ]);
  });

  it("leitura do cancelamento que falha SEGUE (falha aberta): um soluço não cala o aviso ao advogado", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    cancelamento = { data: null, error: { message: "timeout" } };
    const r = await processarAgendamento(admin, "acct-1", AGENDAMENTO);
    expect(r.resultado).toBe("disparado");
    expect(motor.dispararAutomacoes).toHaveBeenCalledTimes(1);
    aviso.mockRestore();
  });
});

describe("L — o contato vai para a linha do agendamento ANTES das automações", () => {
  it("⚠️ com a linha do evento, grava o contato antes do disparo, sem trocar contato já gravado", async () => {
    await processarAgendamento(admin, "acct-1", AGENDAMENTO, undefined, { eventoId: "evt-1" });

    const escrita = chamadas.find((c) => c.tabela === "cb_calendly_eventos" && c.op === "update");
    expect(escrita?.valores).toEqual({ contact_id: "c1" });
    expect(escrita?.filtros).toEqual([
      ["eq", "id", "evt-1"],
      ["is", "contact_id", null],
    ]);
    expect(ordem.indexOf("update:cb_calendly_eventos")).toBeLessThan(ordem.indexOf("disparo"));
  });

  it("ficha criada pelo agendamento também vai para a linha antes do disparo", async () => {
    busca.findExistingContact.mockResolvedValue({ contato: null, falhou: false });
    destino.resolverDestinatario.mockResolvedValue({ contactId: "novo-1", conversationId: "conv-1", criouContato: true });
    await processarAgendamento(admin, "acct-1", AGENDAMENTO, undefined, { eventoId: "evt-1" });

    const escrita = chamadas.find((c) => c.tabela === "cb_calendly_eventos" && c.op === "update");
    expect(escrita?.valores).toEqual({ contact_id: "novo-1" });
    expect(ordem.indexOf("update:cb_calendly_eventos")).toBeLessThan(ordem.indexOf("disparo"));
  });

  it("sem a linha do evento (quem não passa), nada é gravado cedo", async () => {
    await processarAgendamento(admin, "acct-1", AGENDAMENTO);
    expect(chamadas.some((c) => c.tabela === "cb_calendly_eventos" && c.op === "update")).toBe(false);
  });

  it("as duas rotas passam a linha do evento (pino)", () => {
    const raiz = path.join(__dirname, "../../app/api/cb/calendly");
    const webhook = fs.readFileSync(path.join(raiz, "webhook/[token]/route.ts"), "utf8");
    const reprocessar = fs.readFileSync(path.join(raiz, "eventos/[id]/reprocessar/route.ts"), "utf8");
    expect(webhook).toContain("processarAgendamento(db, accountId, agendamento, undefined, { eventoId })");
    expect(reprocessar).toContain("{ eventoId: id })");
  });
});
