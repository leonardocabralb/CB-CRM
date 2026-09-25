import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";

import { textoDoAviso, type AvisoComContato } from "./texto-do-aviso";

const RAIZ = join(__dirname, "..", "..", "..");
const dicionario = (arq: string) =>
  JSON.parse(readFileSync(join(RAIZ, "messages", arq), "utf8")) as Record<string, unknown>;

function tradutor(arq: string, locale: string) {
  const t = createTranslator({ locale, messages: dicionario(arq), namespace: "NotificationsPage.tipos" });
  return (c: string, v?: Record<string, string>) =>
    t(c as Parameters<typeof t>[0], v as Parameters<typeof t>[1]);
}

const base: AvisoComContato = {
  id: "n1",
  account_id: "a1",
  user_id: "u1",
  type: "conversation_assigned",
  // O que o gatilho da 0027 grava: inglês, e "with ." sem nome de contato.
  title: "New conversation assigned",
  body: "Dra. Isa Lenier assigned you a conversation with .",
  created_at: "2026-09-24T18:00:00Z",
};

describe("textoDoAviso", () => {
  const t = tradutor("pt-BR.json", "pt-BR");

  it("a atribuição sai do dicionário, com quem atribuiu e o contato — nunca o texto do gatilho", () => {
    const r = textoDoAviso({ ...base, contact: { name: "Maria Souza" } }, "Dra. Isa Lenier", t);
    expect(r).toEqual({
      titulo: "Conversa atribuída a você",
      corpo: "Dra. Isa Lenier atribuiu a você a conversa com Maria Souza",
    });
  });

  it("sem o nome de quem atribuiu, a voz passiva (não afirma que foi automação)", () => {
    expect(textoDoAviso({ ...base, contact: { name: "Maria" } }, null, t).corpo).toBe(
      "A conversa com Maria foi atribuída a você",
    );
  });

  it("contato sem nome: o telefone; sem contato nenhum: o texto de queda", () => {
    expect(textoDoAviso({ ...base, contact: { name: null, phone: "5583988745316" } }, "Ana", t).corpo).toBe(
      "Ana atribuiu a você a conversa com 5583988745316",
    );
    expect(textoDoAviso({ ...base, contact: null }, "Ana", t).corpo).toBe(
      "Ana atribuiu a você a conversa com um contato",
    );
  });

  it("os avisos nossos (menção, tarefas) passam como foram gravados", () => {
    const mencao: AvisoComContato = {
      ...base,
      type: "note_mention",
      title: "Ana mencionou você numa anotação",
      body: "olha isso",
    };
    expect(textoDoAviso(mencao, "Ana", t)).toEqual({ titulo: mencao.title, corpo: "olha isso" });
    expect(textoDoAviso({ ...mencao, body: undefined }, "Ana", t).corpo).toBeNull();
  });

  it("as quatro frases existem nos dois dicionários, com os mesmos valores", () => {
    const en = tradutor("en.json", "en");
    expect(textoDoAviso({ ...base, contact: { name: "Maria" } }, "Ana", en)).toEqual({
      titulo: "Conversation assigned to you",
      corpo: "Ana assigned you the conversation with Maria",
    });
    expect(textoDoAviso({ ...base, contact: null }, null, en).corpo).toBe(
      "The conversation with a contact was assigned to you",
    );
  });

  it("a página escreve pelo helper, com o contato embutido — nunca o título cru", () => {
    const pagina = readFileSync(join(RAIZ, "src", "app", "(dashboard)", "notifications", "page.tsx"), "utf8");
    expect(pagina).toMatch(/const texto = textoDoAviso\(/);
    expect(pagina).toMatch(/\{texto\.titulo\}/);
    expect(pagina).not.toMatch(/\{n\.title\}|\{n\.body\}/);
    expect(pagina).toMatch(/\.select\("\*, contact:contacts\(name, phone, wa_username, instagram_username\)"\)/);
  });
});
