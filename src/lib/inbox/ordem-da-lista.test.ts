import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Conversation } from "@/types";
import { comMensagemNova, ordenarComoOBanco } from "./ordem-da-lista";

const conversa = (id: string, last_message_at?: string, extra: Partial<Conversation> = {}) =>
  ({ id, last_message_at, unread_count: 0, last_message_text: "antes", ...extra }) as Conversation;

describe("ordenarComoOBanco", () => {
  it("a mais recente primeiro — a conversa que recebeu mensagem SOBE", () => {
    const lista = [
      conversa("a", "2026-09-23T18:49:12.973+00:00"),
      conversa("b", "2026-09-23T18:48:02.665923+00:00"),
      conversa("c", "2026-09-23T19:01:35+00:00"), // acabou de receber
    ];
    expect(ordenarComoOBanco(lista).map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("sem mensagem vai para o FIM (nullsFirst: false), como na consulta", () => {
    const lista = [conversa("g"), conversa("a", "2026-09-01T00:00:00Z"), conversa("h", "")];
    expect(ordenarComoOBanco(lista).map((c) => c.id)).toEqual(["a", "g", "h"]);
  });

  it("carimbo ilegível também vai para o fim, em vez de embaralhar a lista", () => {
    const lista = [conversa("x", "não é data"), conversa("a", "2026-09-01T00:00:00Z")];
    expect(ordenarComoOBanco(lista).map((c) => c.id)).toEqual(["a", "x"]);
  });

  it("empate desempata por id crescente, como na consulta", () => {
    const t = "2026-09-23T18:00:00Z";
    const lista = [conversa("c", t), conversa("a", t), conversa("b", t), conversa("z"), conversa("m")];
    expect(ordenarComoOBanco(lista).map((c) => c.id)).toEqual(["a", "b", "c", "m", "z"]);
  });

  it("compara INSTANTES, não texto: o mesmo momento em formatos diferentes empata", () => {
    const lista = [
      conversa("b", "2026-09-23T18:00:00.000+00:00"),
      conversa("a", "2026-09-23T15:00:00-03:00"),
      conversa("c", "2026-09-23T17:59:59Z"),
    ];
    expect(ordenarComoOBanco(lista).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("devolve cópia e não toca a entrada (é estado do React)", () => {
    const lista = [conversa("a", "2026-09-01T00:00:00Z"), conversa("b", "2026-09-02T00:00:00Z")];
    const antes = lista.map((c) => c.id);
    const saida = ordenarComoOBanco(lista);
    expect(lista.map((c) => c.id)).toEqual(antes);
    expect(saida).not.toBe(lista);
  });
});

describe("comMensagemNova", () => {
  const base = conversa("a", "2026-09-23T18:00:00+00:00", { unread_count: 2 });

  it("mensagem mais nova avança a hora e a prévia e soma a não lida", () => {
    const c = comMensagemNova(base, { created_at: "2026-09-23T18:05:00+00:00", content_text: "Oi" }, false);
    expect(c.last_message_at).toBe("2026-09-23T18:05:00+00:00");
    expect(c.last_message_text).toBe("Oi");
    expect(c.unread_count).toBe(3);
  });

  it("⚠️ mensagem de carimbo ANTIGO não recua a hora nem troca a prévia", () => {
    const c = comMensagemNova(base, { created_at: "2026-06-10T12:00:00+00:00", content_text: "de junho" }, false);
    expect(c.last_message_at).toBe("2026-09-23T18:00:00+00:00");
    expect(c.last_message_text).toBe("antes");
    expect(c.unread_count).toBe(3);
  });

  it("o mesmo instante avança (duas mensagens no mesmo segundo: vale a que chegou por último)", () => {
    const c = comMensagemNova(base, { created_at: "2026-09-23T15:00:00-03:00", content_text: "par" }, false);
    expect(c.last_message_text).toBe("par");
  });

  it("conversa sem hora nenhuma sempre avança", () => {
    const c = comMensagemNova(conversa("a"), { created_at: "2026-09-23T18:00:00Z", content_text: undefined }, false);
    expect(c.last_message_at).toBe("2026-09-23T18:00:00Z");
    expect(c.last_message_text).toBe("");
  });

  it("a conversa aberta fica com zero não lidas", () => {
    const c = comMensagemNova(base, { created_at: "2026-09-23T18:05:00+00:00", content_text: "Oi" }, true);
    expect(c.unread_count).toBe(0);
  });
});

describe("pinos: quem usa a ordem", () => {
  const raiz = join(__dirname, "..", "..", "..");
  const lista = readFileSync(join(raiz, "src/components/inbox/conversation-list.tsx"), "utf8");
  const pagina = readFileSync(join(raiz, "src/app/(dashboard)/inbox/page.tsx"), "utf8");

  it("a lista exibida passa por ordenarComoOBanco", () => {
    expect(lista).toMatch(/ordenarComoOBanco\(aplicarFiltros\(conversations,/);
  });

  it("a consulta da lista continua na ordem que ordenarComoOBanco espelha", () => {
    expect(lista).toContain('.order("last_message_at", { ascending: false, nullsFirst: false })');
    expect(lista).toContain('.order("id", { ascending: true })');
  });

  it("o tempo real da página não grava a hora da mensagem crua — passa por comMensagemNova", () => {
    expect(pagina).toContain("comMensagemNova(c, newMsg, aberta)");
    expect(pagina).not.toMatch(/last_message_at:\s*newMsg\.created_at/);
  });
});
