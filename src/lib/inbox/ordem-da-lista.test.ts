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

  it("⚠️ aviso de SISTEMA do grupo não mexe na linha (o banco também não)", () => {
    const c = comMensagemNova(
      base,
      { created_at: "2026-09-23T18:05:00+00:00", content_text: "Fulano entrou", content_type: "system" },
      false,
    );
    expect(c).toBe(base);
  });

  it("ligação (1044) não tem texto: a prévia é o marcador que o banco grava, e a lista o traduz", () => {
    const c = comMensagemNova(
      base,
      { created_at: "2026-09-23T18:05:00+00:00", content_text: undefined, content_type: "call" },
      false,
    );
    expect(c.last_message_text).toBe("[call]");
    expect(c.last_message_at).toBe("2026-09-23T18:05:00+00:00");
  });

  it("a conversa aberta fica com zero não lidas", () => {
    const c = comMensagemNova(base, { created_at: "2026-09-23T18:05:00+00:00", content_text: "Oi" }, true);
    expect(c.unread_count).toBe(0);
  });
});

describe("comMensagemNova — a volta da Lixeira (1097)", () => {
  // A conversa restaurada às 18:30 (relógio do BANCO); as mensagens antigas
  // voltam com o `gravada_em` de quando chegaram de verdade.
  const restaurada = conversa("a", "2026-10-20T14:00:00+00:00", {
    unread_count: 2,
    restaurada_em: "2026-10-23T18:30:00.123456+00:00",
  });

  it("⚠️ a mensagem DEVOLVIDA não soma não lida, não troca a prévia nem reordena", () => {
    const c = comMensagemNova(
      restaurada,
      {
        // O carimbo pode até ser o mais novo da conversa: quem decide é a gravação.
        created_at: "2026-10-20T14:00:00+00:00",
        content_text: "fala antiga",
        gravada_em: "2026-10-20T14:00:01.5+00:00",
      },
      false,
    );
    expect(c).toBe(restaurada);
  });

  it("nem na conversa aberta: a linha fica como está até o UPDATE final (a não lida do banco)", () => {
    const c = comMensagemNova(
      restaurada,
      { created_at: "2026-10-01T10:00:00Z", content_text: "x", gravada_em: "2026-10-01T10:00:00Z" },
      true,
    );
    expect(c).toBe(restaurada);
  });

  it("a mensagem gravada DEPOIS da volta é nova: soma e avança como sempre", () => {
    const c = comMensagemNova(
      restaurada,
      {
        created_at: "2026-10-23T18:31:00+00:00",
        content_text: "Oi de novo",
        gravada_em: "2026-10-23T18:31:00.200+00:00",
      },
      false,
    );
    expect(c.unread_count).toBe(3);
    expect(c.last_message_text).toBe("Oi de novo");
  });

  it("⚠️ sem `gravada_em` (72% da produção: a carga) vale o `created_at` — a importada antiga não soma", () => {
    const c = comMensagemNova(
      restaurada,
      { created_at: "2025-03-01T10:00:00+00:00", content_text: "importada", gravada_em: null },
      false,
    );
    expect(c).toBe(restaurada);
  });

  it("sem `gravada_em` e `created_at` depois da volta: nova, soma como sempre", () => {
    const c = comMensagemNova(
      restaurada,
      { created_at: "2026-10-23T18:31:00+00:00", content_text: "sem gravação", gravada_em: null },
      false,
    );
    expect(c.unread_count).toBe(3);
  });

  it("conversa que nunca esteve na Lixeira: o `gravada_em` não muda nada", () => {
    const c = comMensagemNova(
      base0(),
      { created_at: "2026-09-23T18:05:00+00:00", content_text: "Oi", gravada_em: "2026-09-23T18:05:01Z" },
      false,
    );
    expect(c.unread_count).toBe(3);
  });

  function base0() {
    return conversa("a", "2026-09-23T18:00:00+00:00", { unread_count: 2, restaurada_em: null });
  }
});

describe("pinos: quem usa a ordem", () => {
  const raiz = join(__dirname, "..", "..", "..");
  const lista = readFileSync(join(raiz, "src/components/inbox/conversation-list.tsx"), "utf8");
  const pagina = readFileSync(join(raiz, "src/app/(dashboard)/inbox/page.tsx"), "utf8");

  it("a lista exibida passa por ordenarComoOBanco antes do recorte", () => {
    expect(lista).toMatch(/ordenarComoOBanco\(\s*conversations\s*\)/);
    expect(lista).toMatch(/aplicarFiltros\(\s*ordenadas\s*,/);
    expect(lista).not.toMatch(/aplicarFiltros\(\s*conversations\s*,/);
  });

  it("a consulta da lista continua na ordem que ordenarComoOBanco espelha", () => {
    expect(lista).toContain('.order("last_message_at", { ascending: false, nullsFirst: false })');
    expect(lista).toContain('.order("id", { ascending: true })');
  });

  it("o tempo real da página não grava a hora da mensagem crua — passa por comMensagemNova", () => {
    expect(pagina).toContain("comMensagemNova(c, newMsg, aberta)");
    expect(pagina).not.toMatch(/last_message_at:\s*newMsg\.created_at/);
  });

  it("⚠️ a volta da Lixeira: o INSERT da conversa grava `restaurada_em` ANTES das mensagens", () => {
    // O carimbo vai para o ref (o fio decide antes de qualquer render) e, na
    // linha VELHA que ainda está na lista (o "Desfazer"), para o estado — que
    // `comMensagemNova` lê no updater seguinte. Sem ele, cada mensagem
    // devolvida somava uma não lida até o UPDATE final.
    expect(pagina).toMatch(
      /if \(conv\.restaurada_em\) \{\s*restauradaEmRef\.current\.set\(conv\.id, conv\.restaurada_em\);\s*if \(activeConversation\?\.id === conv\.id\) setResyncToken\(\(n\) => n \+ 1\);\s*\}/,
    );
    expect(pagina).toMatch(
      /\} else if \(conv\.restaurada_em\) \{[\s\S]{0,700}?\{ \.\.\.c, restaurada_em: restauradaEm \}/,
    );
    // O fio aberto não recebe as devolvidas pelo fim (a releitura as traz na
    // ordem), nem recarrega as execuções por cada fala antiga do cliente.
    expect(pagina).toMatch(/const daRestauracao = reinseridaPelaRestauracao\(\s*newMsg\.gravada_em,[\s\S]{0,300}?newMsg\.created_at,\s*\);/);
    expect(pagina).toMatch(/if \(\s*!daRestauracao &&\s*activeConversation &&\s*newMsg\.conversation_id === activeConversation\.id\s*\)/);
  });

  it("o fio por cima da pauta (`conversa-em-painel`) repete a régua da página", () => {
    const painel = readFileSync(join(raiz, "src/components/inbox/conversa-em-painel.tsx"), "utf8");
    expect(painel).toMatch(
      /if \(event\.eventType === "INSERT" && event\.new\.restaurada_em\) \{\s*restauradaEmRef\.current = event\.new\.restaurada_em;\s*setResyncToken\(\(n\) => n \+ 1\);/,
    );
    expect(painel).toContain("if (reinseridaPelaRestauracao(msg.gravada_em, restauradaEmRef.current, msg.created_at)) return;");
  });
});
