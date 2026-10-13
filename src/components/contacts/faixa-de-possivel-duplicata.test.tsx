import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";

import en from "../../../messages/en.json";
import ptBR from "../../../messages/pt-BR.json";
import { canDecideDuplicates } from "@/lib/auth/roles";
import type { Candidata } from "@/lib/contacts/duplicatas";

import { FaixaDePossivelDuplicata } from "./faixa-de-possivel-duplicata";

// ============================================================
// A faixa "Possível duplicata" (1088). Todos veem e comparam; só o admin
// decide (D1) — e quem não é admin precisa LER isso na faixa, em vez de abrir
// o "Comparar" esperando um botão que não vai achar. Dados fictícios.
// ============================================================

const PARECIDA: Candidata = {
  contatoId: "00000000-0000-4000-8000-000000000002",
  ficha: {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Fulana Teste",
    phone: "5511900000000",
    created_at: "2026-10-13T12:00:00Z",
  },
  motivos: [{ tipo: "telefone_parecido" }, { tipo: "criadas_juntas", segundos: 36 }],
};

function desenhar(
  candidatas: Candidata[] | null,
  podeDecidir: boolean,
  messages: unknown = ptBR,
  locale = "pt-BR",
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={messages as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <FaixaDePossivelDuplicata candidatas={candidatas} podeDecidir={podeDecidir} aoComparar={() => {}} />
    </NextIntlClientProvider>
  );
}

describe("FaixaDePossivelDuplicata", () => {
  it("carregando (nula) ou sem candidata: não desenha nada — nunca afirma 'sem duplicata'", () => {
    expect(desenhar(null, true)).toBe("");
    expect(desenhar([], true)).toBe("");
  });

  it("quem não é admin compara, e a faixa diz que a decisão é de um administrador", () => {
    const html = desenhar([PARECIDA], false);
    expect(html).toContain("Comparar");
    expect(html).toContain(ptBR.Duplicatas.dicaTodos);
    expect(html).not.toContain(ptBR.Duplicatas.dicaAdmin);
  });

  it("o admin lê a dica de quem decide", () => {
    const html = desenhar([PARECIDA], true);
    expect(html).toContain(ptBR.Duplicatas.dicaAdmin);
    expect(html).not.toContain(ptBR.Duplicatas.dicaTodos);
  });

  it("o poder de decidir é só do admin (o mesmo predicado que a tela usa)", () => {
    expect(canDecideDuplicates("owner")).toBe(true);
    expect(canDecideDuplicates("admin")).toBe(true);
    expect(canDecideDuplicates("agent")).toBe(false);
    expect(canDecideDuplicates("viewer")).toBe(false);
  });

  it("o primeiro nome entra UMA vez, no fim, quando telefone ou horário dependeram dele", () => {
    expect(desenhar([PARECIDA], true)).toContain(
      "telefone com um dígito de diferença · fichas criadas com 36 s de diferença · mesmo primeiro nome",
    );
    const soEmail: Candidata = { ...PARECIDA, motivos: [{ tipo: "mesmo_email" }] };
    const html = desenhar([soEmail], true);
    expect(html).toContain("mesmo e-mail");
    expect(html).not.toContain("mesmo primeiro nome");
  });

  it("ficha apagada entre a conferência e a leitura: a linha fica, sem 'Comparar' ativo", () => {
    const html = desenhar([{ ...PARECIDA, ficha: null }], true);
    expect(html).toContain(ptBR.Duplicatas.fichaSumiu);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Comparar<\/button>/);
  });

  it("é anunciada ao leitor de tela", () => {
    expect(desenhar([PARECIDA], false)).toContain('role="status"');
  });

  it("inglês também desenha (as chaves existem nos DOIS dicionários)", () => {
    const html = desenhar([PARECIDA], false, en, "en");
    expect(html).toContain(en.Duplicatas.dicaTodos);
    expect(html).toContain(en.Duplicatas.comparar);
  });
});
