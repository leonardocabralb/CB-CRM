import { describe, expect, it } from "vitest";

import { acharNoFio, type MensagemBuscavel } from "./achados-no-fio";

/** Fio curto, na ordem em que o `.order('created_at')` devolve. */
function fio(...textos: (string | null)[]): MensagemBuscavel[] {
  return textos.map((content_text, i) => ({ id: `m${i + 1}`, content_text }));
}

describe("acharNoFio", () => {
  it("devolve os ids na ordem do fio, do mais antigo para o mais novo", () => {
    const msgs = fio("o contrato", "nada", "outro contrato", "contrato final");
    expect(acharNoFio(msgs, "contrato")).toEqual(["m1", "m3", "m4"]);
  });

  it("nenhum achado devolve lista vazia, nunca nulo", () => {
    expect(acharNoFio(fio("alo"), "contrato")).toEqual([]);
    expect(acharNoFio([], "contrato")).toEqual([]);
  });

  it("ignora acento e caixa, como o `lower(unaccent())` do banco", () => {
    const msgs = fio("A PETIÇÃO foi protocolada", "peticao simples");
    expect(acharNoFio(msgs, "peticao")).toEqual(["m1", "m2"]);
    expect(acharNoFio(msgs, "PETIÇÃO")).toEqual(["m1", "m2"]);
  });

  it("casa no meio da palavra — é substring, igual ao LIKE '%x%'", () => {
    expect(acharNoFio(fio("subcontratação"), "contrat")).toEqual(["m1"]);
  });

  it("⚠️ o piso de 3 caracteres é o mesmo da caixa e o mesmo da RPC", () => {
    const msgs = fio("pf e pj");
    expect(acharNoFio(msgs, "pf")).toEqual([]);
    expect(acharNoFio(msgs, "  a  ")).toEqual([]);
    expect(acharNoFio(msgs, "")).toEqual([]);
  });

  it("⚠️ o piso vale sobre o termo NORMALIZADO, como no banco", () => {
    // O banco mede `length(cb_texto_para_busca(btrim(p_termo))) >= 3`, não o
    // comprimento do texto cru. Texto colado em NFD tem a letra e o acento
    // como caracteres separados: "ré" pode chegar com TRÊS caracteres crus e
    // dois depois de normalizar. Medindo no cru, o banco recusaria buscar e o
    // fio buscaria assim mesmo, com uma agulha menor que o piso.
    const nfd = "ré"; // r + e + acento agudo combinante = 3 crus, 2 normalizados
    expect(nfd).toHaveLength(3);
    expect(acharNoFio(fio("o réu compareceu"), nfd)).toEqual([]);
  });

  it("⚠️ agulha que normaliza para VAZIO não pode casar com tudo", () => {
    // `^`, `` ` ``, `´` e `¨` existem sozinhos como caractere. Com
    // `\\p{Diacritic}` — a faixa que o `semAcento` usava — eles sumiam na
    // normalização, a agulha virava "" e `includes("")` é verdadeiro para
    // QUALQUER texto: buscar "^^^" acendia todas as bolhas da conversa e o
    // contador dizia "113 de 113", enquanto o banco não achava nenhuma.
    const msgs = fio("primeira", "segunda", "terceira");
    for (const agulha of ["^^^", "```", "´´´", "¨¨¨", "~~~"]) {
      expect(acharNoFio(msgs, agulha)).toEqual([]);
    }
    // E o acento sozinho continua sendo procurado quando ele existe mesmo.
    expect(acharNoFio(fio("a^b^c"), "a^b")).toEqual(["m1"]);
  });

  it("apara o termo nas pontas, como o `btrim(p_termo)` da RPC", () => {
    expect(acharNoFio(fio("o contrato"), "  contrato  ")).toEqual(["m1"]);
  });

  it("⚠️ mensagem apagada fica de fora — o fio ainda a desenha, mas o ↑/↓ não para nela", () => {
    const msgs: MensagemBuscavel[] = [
      { id: "m1", content_text: "o contrato", deleted_at: null },
      { id: "m2", content_text: "o contrato", deleted_at: "2026-08-01T10:00:00Z" },
      { id: "m3", content_text: "o contrato" },
    ];
    expect(acharNoFio(msgs, "contrato")).toEqual(["m1", "m3"]);
  });

  it("mensagem sem texto (mídia sem legenda) não entra — a RPC exige content_text", () => {
    const msgs: MensagemBuscavel[] = [
      { id: "m1", content_text: null },
      { id: "m2" },
      { id: "m3", content_text: "" },
      { id: "m4", content_text: "contrato" },
    ];
    expect(acharNoFio(msgs, "contrato")).toEqual(["m4"]);
  });

  it("⚠️ busca só o texto VIGENTE — `text_before_edit` não conta", () => {
    // Espelha a RPC: quem foi corrigido não deve ser achado pelo que dizia
    // antes, senão o salto leva a uma mensagem que não fala mais daquilo.
    const msgs = [
      {
        id: "m1",
        content_text: "valor corrigido",
        text_before_edit: "o contrato antigo",
      } as MensagemBuscavel & { text_before_edit: string },
    ];
    expect(acharNoFio(msgs, "contrato")).toEqual([]);
  });

  it("⚠️ `%` e `_` são literais, não coringas — a RPC os escapa antes do LIKE", () => {
    const msgs = fio("desconto de 50% hoje", "nada disso aqui");
    expect(acharNoFio(msgs, "50%")).toEqual(["m1"]);
    // O caso que morde: um `%` sozinho não pode "achar tudo".
    expect(acharNoFio(msgs, "%%%")).toEqual([]);
    expect(acharNoFio(fio("a_b_c", "abxc"), "a_b")).toEqual(["m1"]);
  });

  it("⚠️ divergência CONHECIDA e medida: o banco dobra pontuação tipográfica, o JS não", () => {
    // Varredura de todo caractere do corpo das mensagens desta conta: só três
    // fazem `cb_texto_para_busca` divergir do `semAcento` daqui —
    //   … (U+2026) → '...'   – (U+2013) → '-'   × (U+00D7) → '*'
    // O banco dobra MAIS, então o fio acha um SUBCONJUNTO do que a lista acha:
    // o contador pode ficar abaixo do "N msgs" da linha, nunca acima. Este
    // teste existe para a diferença ficar escrita e medida, não descoberta em
    // produção — se um dia alguém replicar a tabela do `unaccent`, ele falha e
    // obriga a decisão a ser consciente.
    expect(acharNoFio(fio("prazo – vencido"), "prazo - vencido")).toEqual([]);
    expect(acharNoFio(fio("e assim…"), "assim...")).toEqual([]);
    // O que casa por dentro do trecho continua casando: a diferença só morde
    // quando o caractere está DENTRO do pedaço procurado.
    expect(acharNoFio(fio("prazo – vencido"), "vencido")).toEqual(["m1"]);
  });

  it("o mesmo termo aparecendo duas vezes na mensagem conta uma linha só", () => {
    // O contador do fio ("1 de N") conta MENSAGENS, como o `count(*)` da RPC
    // conta linhas de `messages`. Duas ocorrências na mesma bolha não são dois
    // lugares para onde saltar.
    expect(acharNoFio(fio("contrato do contrato"), "contrato")).toEqual(["m1"]);
  });
});
