import { describe, expect, it } from "vitest";

import { ehOrigemDoInbox, notaDaUrl, recorteDaUrl, urlDoInbox } from "./url";

describe("urlDoInbox", () => {
  it("sem nada → /inbox, nunca /inbox?", () => {
    expect(urlDoInbox({})).toBe("/inbox");
    expect(urlDoInbox({ c: null, etapa: null, de: null })).toBe("/inbox");
    expect(urlDoInbox({ c: "", de: "" })).toBe("/inbox");
  });

  it("as combinações de verdade", () => {
    expect(urlDoInbox({ c: "cv1" })).toBe("/inbox?c=cv1");
    expect(urlDoInbox({ c: "cv1", de: "funil" })).toBe("/inbox?c=cv1&de=funil");
    // A faixa de volta aos avisos sobrevive aos replaces, como a do funil.
    expect(urlDoInbox({ c: "cv2", de: "notificacoes" })).toBe("/inbox?c=cv2&de=notificacoes");
    expect(urlDoInbox({ c: "cv2", de: "meu-dia" })).toBe("/inbox?c=cv2&de=meu-dia");
    expect(urlDoInbox({ etapa: "s1", de: "funil" })).toBe(
      "/inbox?etapa=s1&de=funil",
    );
    expect(urlDoInbox({ de: "funil" })).toBe("/inbox?de=funil");
  });

  it("a pauta de reuniões também tem faixa de volta: `de=reunioes` sobrevive", () => {
    expect(urlDoInbox({ c: "cv1", de: "reunioes" })).toBe(
      "/inbox?c=cv1&de=reunioes",
    );
    expect(urlDoInbox({ de: "reunioes" })).toBe("/inbox?de=reunioes");
  });

  it("⚠️ c VENCE etapa — os dois juntos não têm leitor (pina a decisão)", () => {
    expect(urlDoInbox({ c: "cv1", etapa: "s1", de: "funil" })).toBe(
      "/inbox?c=cv1&de=funil",
    );
  });

  it("valores passam por encodeURIComponent", () => {
    expect(urlDoInbox({ c: "a&b" })).toBe("/inbox?c=a%26b");
  });

  it("⚠️ `de` só sai com os valores que têm leitor — lixo de link colado não gruda nos replaces", () => {
    expect(urlDoInbox({ c: "cv1", de: "whatsapp" })).toBe("/inbox?c=cv1");
    expect(urlDoInbox({ de: "qualquer" })).toBe("/inbox");
    // Parecido não é igual: a comparação é exata.
    expect(urlDoInbox({ c: "cv1", de: "Reunioes" })).toBe("/inbox?c=cv1");
    expect(urlDoInbox({ de: "reunioes&x=1" })).toBe("/inbox");
  });
});

describe("a anotação do aviso (`nota`, 1114)", () => {
  const NOTA = "9b1d2c3e-1111-4222-8333-444455556666";

  it("sai com a conversa, logo depois do `c`", () => {
    expect(urlDoInbox({ c: "cv1", nota: NOTA })).toBe(`/inbox?c=cv1&nota=${NOTA}`);
    expect(urlDoInbox({ c: "cv1", nota: NOTA, de: "funil" })).toBe(
      `/inbox?c=cv1&nota=${NOTA}&de=funil`,
    );
    expect(urlDoInbox({ c: "cv1", nota: null })).toBe("/inbox?c=cv1");
  });

  it("⚠️ sem conversa não sai: não há fio onde saltar", () => {
    expect(urlDoInbox({ nota: NOTA })).toBe("/inbox");
    expect(urlDoInbox({ etapa: "s1", nota: NOTA })).toBe("/inbox?etapa=s1");
  });

  it("notaDaUrl é PARSE: o que não tem forma de id não pede salto", () => {
    expect(notaDaUrl(NOTA)).toBe(NOTA);
    expect(notaDaUrl(NOTA.toUpperCase())).toBe(NOTA.toUpperCase());
    expect(notaDaUrl("nota-1")).toBeNull();
    expect(notaDaUrl(`${NOTA}"]`)).toBeNull();
    expect(notaDaUrl("")).toBeNull();
    expect(notaDaUrl(null)).toBeNull();
  });
});

describe("recorte do Meu dia (`conexao` + `ver`)", () => {
  const CANAL = "0f8e5a2c-1111-4222-8333-444455556666";

  it("sai com a conexão e o número clicado", () => {
    expect(urlDoInbox({ conexao: CANAL, ver: "nao-lidas" })).toBe(
      `/inbox?conexao=${CANAL}&ver=nao-lidas`,
    );
    expect(urlDoInbox({ conexao: CANAL, ver: "em-atraso" })).toBe(
      `/inbox?conexao=${CANAL}&ver=em-atraso`,
    );
    expect(urlDoInbox({ conexao: CANAL })).toBe(`/inbox?conexao=${CANAL}`);
  });

  it("⚠️ é porta de ENTRADA: c e etapa vencem, e `ver` sem conexão não sai", () => {
    expect(urlDoInbox({ c: "cv1", conexao: CANAL, ver: "nao-lidas" })).toBe(
      "/inbox?c=cv1",
    );
    expect(urlDoInbox({ etapa: "s1", conexao: CANAL })).toBe("/inbox?etapa=s1");
    expect(urlDoInbox({ ver: "nao-lidas" })).toBe("/inbox");
  });

  it("recorteDaUrl é PARSE: conexão sem forma de id não semeia; ver estranho é ignorado", () => {
    expect(recorteDaUrl(CANAL, "em-atraso")).toEqual({
      conexao: CANAL,
      ver: "em-atraso",
    });
    expect(recorteDaUrl(CANAL, "tudo")).toEqual({ conexao: CANAL, ver: null });
    expect(recorteDaUrl(CANAL, null)).toEqual({ conexao: CANAL, ver: null });
    expect(recorteDaUrl("bancario", "nao-lidas")).toBeNull();
    expect(recorteDaUrl(null, "nao-lidas")).toBeNull();
    expect(recorteDaUrl("", null)).toBeNull();
  });
});

describe("ehOrigemDoInbox", () => {
  it("só os valores com leitor (as quatro faixas de volta)", () => {
    expect(ehOrigemDoInbox("funil")).toBe(true);
    expect(ehOrigemDoInbox("reunioes")).toBe(true);
    // 28/10/2026: a volta aos avisos do sino e do card do Meu dia.
    expect(ehOrigemDoInbox("notificacoes")).toBe(true);
    expect(ehOrigemDoInbox("meu-dia")).toBe(true);
    expect(ehOrigemDoInbox("notifications")).toBe(false);
    expect(ehOrigemDoInbox("qualquer")).toBe(false);
    expect(ehOrigemDoInbox("")).toBe(false);
    expect(ehOrigemDoInbox(null)).toBe(false);
    expect(ehOrigemDoInbox(undefined)).toBe(false);
  });
});
