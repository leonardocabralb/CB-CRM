import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// O telefone que chega por webhook de entrada passa pela régua das telas e da
// API (`telefoneDigitado`, Fase 3-III). Quem manda aqui é, na maioria, um
// formulário em que o LEAD digita — o Typebot, que não dá para mudar do lado
// de cá. Antes a leitura era `digitosDoTelefone`: "98874-5316" virava a ficha
// +98 e um `…@lid` colado virava telefone.
// ============================================================

const motor = vi.hoisted(() => ({ dispararAutomacoes: vi.fn() }));
vi.mock("@/lib/automations/engine", () => motor);

const destino = vi.hoisted(() => ({ resolverDestinatario: vi.fn() }));
vi.mock("@/lib/automations/destinatario", () => destino);

import { detalheDoTelefone, processarAcionamento } from "./processar";

const admin = {
  from() {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      then: (f: (v: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: "a1", trigger_config: { webhook_id: "w1" } }], error: null }).then(f),
    };
    return b;
  },
} as unknown as SupabaseClient;

// O corpo PADRÃO do Typebot: a variável do bloco de telefone se chama `phone`.
const WEBHOOK = {
  id: "w1",
  nome: "Typebot · Lead e respostas",
  is_active: true,
  campo_telefone: "phone",
  campo_nome: "name",
};

beforeEach(() => {
  destino.resolverDestinatario
    .mockReset()
    .mockResolvedValue({ contactId: "c1", conversationId: "conv1", criouContato: true });
  motor.dispararAutomacoes
    .mockReset()
    .mockResolvedValue({ candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: 0, emEspera: 0 });
});

describe("processarAcionamento — o telefone do lead", () => {
  it.each([
    ["o bloco de telefone do Typebot (+55, validado)", "+5581988745316", "5581988745316"],
    ["internacional com espaços", "+55 81 98874-5316", "5581988745316"],
    ["digitado sem DDI", "(81) 98874-5316", "5581988745316"],
    ["só dígitos, com 55", "5581988745316", "5581988745316"],
    ["planilha que virou número decimal", "81988745316.0", "5581988745316"],
    ["de outro país, com +", "+1 404 555 1234", "14045551234"],
  ])("%s → a ficha nasce com %s", async (_caso, phone, esperado) => {
    const r = await processarAcionamento(admin, "conta-1", WEBHOOK, {
      variaveis: { phone, name: "Maria" },
    });

    expect(r.resultado).toBe("disparado");
    expect(destino.resolverDestinatario).toHaveBeenCalledWith(
      admin,
      "conta-1",
      esperado,
      "Maria",
      { conversaNovaEncerrada: true }
    );
  });

  it.each([
    ["sem DDD (a régua antiga criava a ficha +98)", "98874-5316", "curto demais — faltou o DDD?"],
    ["JID colado (a régua antiga fazia do LID um telefone)", "5581988745316@lid", "não é um telefone válido"],
    ["0 de tronco", "081 98874-5316", "não é um telefone válido"],
    ["55 com tamanho errado", "+55 81 9887-453", "não é um telefone válido"],
  ])("%s → sem_telefone com o motivo, sem ficha nem automação", async (_caso, phone, frase) => {
    const r = await processarAcionamento(admin, "conta-1", WEBHOOK, {
      variaveis: { phone, name: "Maria" },
    });

    expect(r.resultado).toBe("sem_telefone");
    expect(r.detalhe).toContain(frase);
    expect(r.detalhe).toContain('"phone"');
    expect(r.contactId).toBeNull();
    expect(destino.resolverDestinatario).not.toHaveBeenCalled();
    expect(motor.dispararAutomacoes).not.toHaveBeenCalled();
  });

  it("o campo que não veio continua dizendo isso, sem acusar o número", async () => {
    const r = await processarAcionamento(admin, "conta-1", WEBHOOK, {
      variaveis: { name: "Maria" },
    });

    expect(r.resultado).toBe("sem_telefone");
    expect(r.detalhe).toBe('o campo "phone" não veio no payload, ou veio vazio');
    expect(destino.resolverDestinatario).not.toHaveBeenCalled();
  });
});

describe("detalheDoTelefone", () => {
  it("webhook sem campo configurado diz isso, qualquer que seja o motivo", () => {
    expect(detalheDoTelefone(null, "vazio")).toBe("este webhook não tem campo de telefone configurado");
    expect(detalheDoTelefone("", "invalido")).toBe("este webhook não tem campo de telefone configurado");
  });

  it("curto e inválido têm frases diferentes, e as duas dizem a regra", () => {
    const curto = detalheDoTelefone("phone", "curto");
    const invalido = detalheDoTelefone("phone", "invalido");
    expect(curto).not.toBe(invalido);
    for (const frase of [curto, invalido]) {
      expect(frase).toContain("(81) 98874-5316");
      expect(frase).toContain("com + e o código do país");
    }
  });
});
