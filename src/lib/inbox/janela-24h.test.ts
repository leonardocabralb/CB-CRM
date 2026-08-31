import { describe, expect, it } from "vitest";

import {
  horasRestantes,
  janelaFechada,
  type MensagemDaJanela,
} from "./janela-24h";

const AGORA = new Date("2026-08-31T12:00:00.000Z");

function msg(
  sender_type: string,
  horasAtras: number
): MensagemDaJanela {
  return {
    sender_type,
    created_at: new Date(
      AGORA.getTime() - horasAtras * 3600_000
    ).toISOString(),
  };
}

describe("janelaFechada", () => {
  it("fio VAZIO responde ABERTA — é a conversa que o CRM acabou de abrir", () => {
    // Se respondesse "fechada", a primeira mensagem de toda conversa iniciada
    // pelo CRM (PR #79) seria barrada — a feature inteira.
    expect(janelaFechada([], AGORA)).toBe(false);
  });

  it("sem NENHUMA mensagem do cliente responde FECHADA", () => {
    // Só o cliente abre a janela: conversa em que só nós falamos nunca esteve
    // aberta.
    expect(janelaFechada([msg("agent", 1), msg("agent", 0)], AGORA)).toBe(true);
  });

  it("cliente falou há menos de 24h → aberta", () => {
    expect(janelaFechada([msg("customer", 23)], AGORA)).toBe(false);
  });

  it("exatamente 24h já conta como fechada", () => {
    expect(janelaFechada([msg("customer", 24)], AGORA)).toBe(true);
  });

  it("cliente falou há mais de 24h → fechada", () => {
    expect(janelaFechada([msg("customer", 30)], AGORA)).toBe(true);
  });

  it("vale a mensagem MAIS RECENTE do cliente, não a primeira", () => {
    // A varredura é de trás para frente. Pegando a primeira, uma conversa
    // antiga com resposta de hoje apareceria como expirada.
    const fio = [msg("customer", 40), msg("agent", 20), msg("customer", 2)];
    expect(janelaFechada(fio, AGORA)).toBe(false);
  });

  it("o TEMPO sozinho fecha a janela — o mesmo fio, duas horas diferentes", () => {
    // É a razão de `agora` ser parâmetro: o portão do disparo lê a hora DELE,
    // não a do render que montou a tela.
    const fio = [msg("customer", 23)];
    expect(janelaFechada(fio, AGORA)).toBe(false);
    const duasHorasDepois = new Date(AGORA.getTime() + 2 * 3600_000);
    expect(janelaFechada(fio, duasHorasDepois)).toBe(true);
  });

  it("não muda a lista recebida", () => {
    const fio = [msg("customer", 40), msg("agent", 1)];
    const copia = [...fio];
    janelaFechada(fio, AGORA);
    expect(fio).toEqual(copia);
  });
});

describe("horasRestantes", () => {
  it("conta a partir da última do cliente", () => {
    expect(horasRestantes([msg("customer", 5)], AGORA)).toBe(19);
  });

  it("sem mensagem do cliente devolve 0", () => {
    expect(horasRestantes([msg("agent", 1)], AGORA)).toBe(0);
  });
});
