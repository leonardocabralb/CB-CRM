import { describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";

import {
  digitosDoTelefone,
  escritaDoTelefone,
  formatarTelefone,
  pareceTelefone,
  telefoneCanonico,
  telefoneDigitado,
  variantesDoNonoDigito,
} from "./telefone";

describe("digitosDoTelefone", () => {
  it("o lembrete por SMS vem com DDI e entra como veio", () => {
    expect(digitosDoTelefone("+55 96 99000-0016")).toBe("5596990000016");
    expect(digitosDoTelefone("+1 404-555-1234")).toBe("14045551234");
  });

  it("o que o brasileiro digita sem DDI ganha o 55", () => {
    expect(digitosDoTelefone("(96) 99000-0016")).toBe("5596990000016");
    expect(digitosDoTelefone("96 9000-0016")).toBe("559690000016");
    expect(digitosDoTelefone("83980000016")).toBe("5583980000016");
  });

  it("CRÍTICO: número de fora escrito só em dígitos NÃO ganha o 55 (o 9 na 3ª posição é o que separa)", () => {
    // "14045551234" tem 11 dígitos como um celular brasileiro; com o 55 ele
    // iria para outro destinatário, com os dados do agendamento junto.
    expect(digitosDoTelefone("14045551234")).toBe("14045551234");
    expect(digitosDoTelefone("1 404 555 1234")).toBe("14045551234");
    // celular brasileiro: DDD + 9 + 8 dígitos
    expect(digitosDoTelefone("83980000016")).toBe("5583980000016");
    expect(digitosDoTelefone("11 91234-5678")).toBe("5511912345678");
  });

  it("já com 55 e sem `+` não dobra o DDI", () => {
    expect(digitosDoTelefone("5596990000016")).toBe("5596990000016");
    expect(digitosDoTelefone("55 96 99000-0016")).toBe("5596990000016");
  });

  it("prefixo internacional 00 é DDI escrito de outro jeito", () => {
    expect(digitosDoTelefone("0055 96 99000 0016")).toBe("5596990000016");
  });

  it("curto ou longo demais não é telefone", () => {
    expect(digitosDoTelefone("1234567")).toBeNull();
    expect(digitosDoTelefone("1234567890123456")).toBeNull();
    expect(digitosDoTelefone("")).toBeNull();
    expect(digitosDoTelefone(null)).toBeNull();
  });
});

describe("pareceTelefone", () => {
  it("aceita as formas usuais", () => {
    expect(pareceTelefone("(96) 99000-0016")).toBe(true);
    expect(pareceTelefone("+55 96 99000-0016")).toBe(true);
    expect(pareceTelefone("96990000016")).toBe(true);
  });

  it("recusa texto com letras ou poucos dígitos", () => {
    expect(pareceTelefone("Rua 12, nº 340")).toBe(false);
    expect(pareceTelefone("R$ 15.000")).toBe(false);
    expect(pareceTelefone("12345")).toBe(false);
    expect(pareceTelefone("")).toBe(false);
  });
});

describe("formatarTelefone", () => {
  it("brasileiro com 9 dígitos", () => {
    expect(formatarTelefone("5596990000016")).toBe("(96) 99000-0016");
  });

  it("brasileiro com 8 dígitos (fixo)", () => {
    expect(formatarTelefone("558332221111")).toBe("(83) 3222-1111");
  });

  it("estrangeiro sai com `+`", () => {
    expect(formatarTelefone("14045551234")).toBe("+14045551234");
  });

  it("vazio fica vazio", () => {
    expect(formatarTelefone(null)).toBe("");
  });
});

describe("variantesDoNonoDigito", () => {
  it("celular gravado COM o 9 ganha a irmã sem ele — a original primeiro", () => {
    expect(variantesDoNonoDigito("5583980000016")).toEqual([
      "5583980000016",
      "558380000016",
    ]);
  });

  it("celular gravado SEM o 9 ganha a irmã com ele", () => {
    expect(variantesDoNonoDigito("558380000016")).toEqual([
      "558380000016",
      "5583980000016",
    ]);
  });

  it("⚠️ fixo não ganha 9: o nono dígito é só de celular (6, 7, 8 ou 9)", () => {
    expect(variantesDoNonoDigito("558333334444")).toEqual(["558333334444"]);
    // 13 dígitos com 9 na 5ª posição mas 3 na 6ª: não é celular com 9 na frente.
    expect(variantesDoNonoDigito("5583933334444")).toEqual(["5583933334444"]);
  });

  it("sem DDI 55, ou de outro país, volta sozinho", () => {
    expect(variantesDoNonoDigito("83980000016")).toEqual(["83980000016"]);
    expect(variantesDoNonoDigito("14045551234")).toEqual(["14045551234"]);
    expect(variantesDoNonoDigito("")).toEqual([""]);
  });
});

describe("telefoneCanonico (a chave única de contacts desde a 1024)", () => {
  it.each([
    ["558380000016", "5583980000016"], // celular sem o 9: ganha
    ["5583980000016", "5583980000016"], // com o 9: fica
    ["+55 (83) 8000-0016", "5583980000016"], // separadores saem
    ["551132345678", "551132345678"], // fixo (começa em 3): não inventa 9
    ["5511912345678", "5511912345678"], // 13 dígitos: fica como está
    ["14045551234", "14045551234"], // fora do Brasil: fica
    ["", ""],
  ])("%s → %s", (entrada, esperado) => {
    expect(telefoneCanonico(entrada)).toBe(esperado);
  });

  it("nulo e indefinido viram vazio (a ficha só do Instagram fica fora do índice)", () => {
    expect(telefoneCanonico(null)).toBe("");
    expect(telefoneCanonico(undefined)).toBe("");
  });

  it("as duas grafias do nono dígito têm SEMPRE a mesma canônica", () => {
    for (const numero of ["558380000016", "5583980000016", "5511987654321", "556199998888"]) {
      const [a, b] = variantesDoNonoDigito(numero);
      if (b === undefined) continue;
      expect(telefoneCanonico(a)).toBe(telefoneCanonico(b));
    }
  });

  it("dois números que NÃO são irmãos continuam distintos (os pares ambíguos do de-para)", () => {
    // Mesmos 8 finais, DDDs diferentes: duas pessoas.
    expect(telefoneCanonico("5582980000016")).not.toBe(telefoneCanonico("5515980000016"));
    // Fixo e celular que diferem só no 9: o fixo não tem irmã.
    expect(telefoneCanonico("551132345678")).not.toBe(telefoneCanonico("5511932345678"));
  });

  it("é ESPELHO da coluna gerada da 1024 — a régua do banco é a mesma", () => {
    // Mudar a regra de um lado só faz o código achar "pessoa nova" onde o
    // índice vê a mesma (23505 na cara) ou o contrário.
    const sql = fs.readFileSync(
      path.join(__dirname, "../../../supabase/migrations/1024_cb_telefone_canonico.sql"),
      "utf8",
    );
    expect(sql).toContain("regexp_replace(regexp_replace(phone, '\\D', '', 'g'),");
    expect(sql).toContain("'^(55[0-9]{2})([6-9][0-9]{7})$', '\\19\\2')");
    expect(sql).toContain("on public.contacts (account_id, telefone_canonico)");
    expect(sql).toContain("where telefone_canonico <> ''");
  });
});

describe("telefoneDigitado (a metade aditiva do #586, com a nossa régua)", () => {
  const ok = (digitos: string) => ({ ok: true, digitos });
  const nao = (motivo: string) => ({ ok: false, motivo });

  it("número brasileiro sem DDI ganha o 55 — é como o escritório digita", () => {
    expect(telefoneDigitado("(81) 98874-5316")).toEqual(ok("5581988745316"));
    expect(telefoneDigitado("81988745316")).toEqual(ok("5581988745316"));
    expect(telefoneDigitado("(81) 3456-7890")).toEqual(ok("558134567890"));
  });

  it("com + ou 00, os dígitos entram como vieram", () => {
    expect(telefoneDigitado("+55 81 98874-5316")).toEqual(ok("5581988745316"));
    expect(telefoneDigitado("+1 (404) 555-1234")).toEqual(ok("14045551234"));
    expect(telefoneDigitado("0055 81 98874 5316")).toEqual(ok("5581988745316"));
  });

  it("só dígitos, já com o DDI, é como a base guarda — passa", () => {
    expect(telefoneDigitado("5581988745316")).toEqual(ok("5581988745316"));
    expect(telefoneDigitado("5491123456789")).toEqual(ok("5491123456789"));
  });

  it("⚠️ sem + e sem DDD é CURTO — não vira número de outro país", () => {
    // "988745316" passaria em `digitosDoTelefone` e sairia para +98.
    expect(digitosDoTelefone("98874-5316")).toBe("988745316");
    expect(telefoneDigitado("98874-5316")).toEqual(nao("curto"));
    expect(telefoneDigitado("8874-5316")).toEqual(nao("curto"));
  });

  it("com +, o piso é o de isValidE164 (8 dígitos)", () => {
    expect(telefoneDigitado("+370 6394 983")).toEqual(ok("3706394983"));
    expect(telefoneDigitado("+1 555 12")).toEqual(nao("curto"));
  });

  it("vazio é VAZIO, não inválido", () => {
    expect(telefoneDigitado("")).toEqual(nao("vazio"));
    expect(telefoneDigitado("   ")).toEqual(nao("vazio"));
    expect(telefoneDigitado(null)).toEqual(nao("vazio"));
  });

  it("letra no meio é inválido — `digitosDoTelefone` a apagaria em silêncio", () => {
    expect(telefoneDigitado("81 98874 ramal 5316")).toEqual(nao("invalido"));
    expect(telefoneDigitado("tel: 81988745316")).toEqual(nao("invalido"));
    expect(telefoneDigitado("81 98874-5316+")).toEqual(nao("invalido"));
  });

  it("começar em 0 (tronco) é inválido", () => {
    expect(telefoneDigitado("081 98874-5316")).toEqual(nao("invalido"));
    expect(telefoneDigitado("0800 123 4567")).toEqual(nao("invalido"));
  });

  it("DDI 55 exige DDD + 8 ou 9 dígitos", () => {
    expect(telefoneDigitado("+55 81 9887-453")).toEqual(nao("invalido"));
    expect(telefoneDigitado("+55 81 98874-53161")).toEqual(nao("invalido"));
    expect(telefoneDigitado("55819887453161")).toEqual(nao("invalido"));
  });

  it("⚠️ número COLADO do WhatsApp (marcas invisíveis, traço tipográfico) passa", () => {
    // Medido na revisão: sem a limpeza, os cinco eram recusados como
    // "inválido" sem nada visível errado na caixa.
    expect(telefoneDigitado("\u202A+55 81 98874-5316\u202C")).toEqual(ok("5581988745316"));
    expect(telefoneDigitado("(81) 98874-5316\u200E")).toEqual(ok("5581988745316"));
    expect(telefoneDigitado("81 98874\u20115316")).toEqual(ok("5581988745316"));
    expect(telefoneDigitado("81 98874\u20135316")).toEqual(ok("5581988745316"));
    expect(telefoneDigitado("81\u200B98874-5316")).toEqual(ok("5581988745316"));
    expect(telefoneDigitado("\u00A0(81) 98874-5316\u00A0")).toEqual(ok("5581988745316"));
  });

  it("mais de 15 dígitos é inválido (o JID de grupo colado)", () => {
    expect(telefoneDigitado("120363025246125888")).toEqual(nao("invalido"));
  });
});

describe("escritaDoTelefone (editar a ficha)", () => {
  it("telefone que não mudou não é tocado — nem conferido", () => {
    // Ficha antiga fora da régua (número com +, estrangeiro de 11 dígitos):
    // corrigir o NOME não pode esbarrar no telefone que ninguém tocou.
    expect(escritaDoTelefone("+5511999999999", "+5511999999999")).toEqual({ ok: true });
    expect(escritaDoTelefone("14045551234", " 14045551234 ")).toEqual({ ok: true });
    // Ficha só do Instagram (989): telefone nulo, caixa vazia.
    expect(escritaDoTelefone(null, "")).toEqual({ ok: true });
  });

  it("telefone que mudou sai normalizado", () => {
    expect(escritaDoTelefone("5581988745316", "(81) 98874-5317")).toEqual({
      ok: true,
      phone: "5581988745317",
    });
  });

  it("telefone que mudou para algo fora da régua devolve o motivo", () => {
    expect(escritaDoTelefone("5581988745316", "98874-5316")).toEqual({
      ok: false,
      motivo: "curto",
    });
    expect(escritaDoTelefone("5581988745316", "")).toEqual({ ok: false, motivo: "vazio" });
  });

  it("na CRIAÇÃO não há 'não mudou': tudo passa pela régua, e vazio é recusado", () => {
    expect(escritaDoTelefone(undefined, "", { criacao: true })).toEqual({
      ok: false,
      motivo: "vazio",
    });
    expect(escritaDoTelefone(undefined, "(81) 98874-5316", { criacao: true })).toEqual({
      ok: true,
      phone: "5581988745316",
    });
    expect(escritaDoTelefone(undefined, "98874-5316", { criacao: true })).toEqual({
      ok: false,
      motivo: "curto",
    });
  });

  it("a ficha só do Instagram pode ficar SEM telefone — null, nunca ''", () => {
    // "" entraria no índice único da 1024 e colidiria com a próxima ficha sem.
    expect(escritaDoTelefone("5581988745316", "", { podeFicarSem: true })).toEqual({
      ok: true,
      phone: null,
    });
    // Mas o que é digitado continua passando pela régua.
    expect(escritaDoTelefone(null, "98874-5316", { podeFicarSem: true })).toEqual({
      ok: false,
      motivo: "curto",
    });
    // E na criação a exceção não vale.
    expect(escritaDoTelefone(undefined, "", { criacao: true, podeFicarSem: true })).toEqual({
      ok: false,
      motivo: "vazio",
    });
  });
});
