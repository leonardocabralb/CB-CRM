import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";

import en from "../../../messages/en.json";
import ptBR from "../../../messages/pt-BR.json";
import type { BlocoDeCampos } from "@/lib/contacts/grupos-de-campos";
import type { GrupoDeCampos } from "@/types";

import { MenuDeBlocos } from "./menu-de-blocos";

// ============================================================
// O menu de blocos da ficha e o botão "Minha ordem dos blocos" (1082).
//
// Seguram duas coisas que só apareceriam na tela: o botão some junto com o
// menu (com um bloco só não há ordem a escolher) e não aparece para quem
// chama sem `ordem`; e os rótulos dele existem nos DOIS dicionários.
// ============================================================

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u-1" }, accountId: "a-1" }),
}));

function bloco(id: string | null, nome: string): BlocoDeCampos {
  const grupo: GrupoDeCampos | null = id
    ? { id, account_id: "a-1", nome, posicao: 0, created_at: "2026-01-01" }
    : null;
  return { grupo, campos: [] };
}

const DOIS = [bloco(null, ""), bloco("g-banc", "Bancário")];

function desenhar(
  props: Partial<Parameters<typeof MenuDeBlocos>[0]>,
  messages: unknown = ptBR,
  locale = "pt-BR",
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={messages as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <MenuDeBlocos
        blocos={DOIS}
        chaveVisivel="geral"
        onEscolher={() => {}}
        rotuloDoGeral="Geral"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const ORDEM = { propria: false, aoMudar: () => {} };

describe("MenuDeBlocos", () => {
  it("desenha as pastilhas na ordem recebida — a ordem é de quem chama", () => {
    const html = desenhar({ blocos: [DOIS[1], DOIS[0]] });
    expect(html.indexOf("Bancário")).toBeLessThan(html.indexOf("Geral"));
  });

  it("com `ordem`, mostra o botão 'Minha ordem dos blocos'", () => {
    expect(desenhar({ ordem: ORDEM })).toContain('aria-label="Minha ordem dos blocos"');
    expect(desenhar({ ordem: ORDEM }, en, "en")).toContain('aria-label="My block order"');
  });

  it("sem `ordem`, o botão não existe", () => {
    expect(desenhar({})).not.toContain("Minha ordem");
  });

  it("com menos de dois blocos some tudo — menu e botão", () => {
    expect(desenhar({ blocos: [DOIS[1]], ordem: ORDEM })).toBe("");
  });

  it("os textos do 'Minha ordem' existem nos dois dicionários", () => {
    const chaves = [
      "myOrder",
      "myOrderHint",
      "moveBlockUp",
      "moveBlockDown",
      "saveOrder",
      "resetOrder",
      "toastOrderFailed",
      "toastOrderResetFailed",
    ];
    for (const dicionario of [en, ptBR]) {
      const campos = dicionario.Contacts.customFields as Record<string, string>;
      for (const chave of chaves) expect(campos[chave], chave).toBeTruthy();
    }
  });
});
