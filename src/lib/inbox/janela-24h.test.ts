import { describe, expect, it } from "vitest";

import {
  janelaFechada,
  minutosRestantes,
  restanteParaExibir,
  ultimaDoClienteNoCanal,
  type MensagemDaJanela,
} from "./janela-24h";

const AGORA = new Date("2026-08-31T12:00:00.000Z");

/** O número oficial (Meta) e um número por QR Code (Evolution) da mesma conta. */
const OFICIAL = "canal-oficial";
const QR_CODE = "canal-qr-code";

function msg(
  sender_type: string,
  horasAtras: number,
  channel_id: string | null = null
): MensagemDaJanela {
  return {
    sender_type,
    created_at: new Date(
      AGORA.getTime() - horasAtras * 3600_000
    ).toISOString(),
    channel_id,
  };
}

function msgMin(
  sender_type: string,
  minutosAtras: number,
  channel_id: string | null = null
): MensagemDaJanela {
  return {
    sender_type,
    created_at: new Date(AGORA.getTime() - minutosAtras * 60_000).toISOString(),
    channel_id,
  };
}

describe("janelaFechada — conta sem conexão (canal de saída desconhecido)", () => {
  // `null` é o legado de número único: toda mensagem do cliente conta, como
  // antes do multi-canal. São as regras que já valiam.

  it("fio VAZIO responde ABERTA — é a conversa que o CRM acabou de abrir", () => {
    // Se respondesse "fechada", a primeira mensagem de toda conversa iniciada
    // pelo CRM (PR #79) seria barrada — a feature inteira.
    expect(janelaFechada([], AGORA, null)).toBe(false);
  });

  it("sem NENHUMA mensagem do cliente responde FECHADA", () => {
    // Só o cliente abre a janela: conversa em que só nós falamos nunca esteve
    // aberta.
    expect(
      janelaFechada([msg("agent", 1), msg("agent", 0)], AGORA, null)
    ).toBe(true);
  });

  it("cliente falou há menos de 24h → aberta", () => {
    expect(janelaFechada([msg("customer", 23)], AGORA, null)).toBe(false);
  });

  it("exatamente 24h já conta como fechada", () => {
    expect(janelaFechada([msg("customer", 24)], AGORA, null)).toBe(true);
  });

  it("cliente falou há mais de 24h → fechada", () => {
    expect(janelaFechada([msg("customer", 30)], AGORA, null)).toBe(true);
  });

  it("vale a mensagem MAIS RECENTE do cliente, não a primeira", () => {
    // A varredura é de trás para frente. Pegando a primeira, uma conversa
    // antiga com resposta de hoje apareceria como expirada.
    const fio = [msg("customer", 40), msg("agent", 20), msg("customer", 2)];
    expect(janelaFechada(fio, AGORA, null)).toBe(false);
  });

  it("o TEMPO sozinho fecha a janela — o mesmo fio, duas horas diferentes", () => {
    // É a razão de `agora` ser parâmetro: o portão do disparo lê a hora DELE,
    // não a do render que montou a tela.
    const fio = [msg("customer", 23)];
    expect(janelaFechada(fio, AGORA, null)).toBe(false);
    const duasHorasDepois = new Date(AGORA.getTime() + 2 * 3600_000);
    expect(janelaFechada(fio, duasHorasDepois, null)).toBe(true);
  });

  it("sem canal de saída, mensagem carimbada com qualquer número conta", () => {
    expect(janelaFechada([msg("customer", 2, QR_CODE)], AGORA, null)).toBe(
      false
    );
  });

  it("não muda a lista recebida", () => {
    const fio = [msg("customer", 40), msg("agent", 1)];
    const copia = [...fio];
    janelaFechada(fio, AGORA, null);
    expect(fio).toEqual(copia);
  });
});

describe("janelaFechada — a janela é POR NÚMERO (conversa mista)", () => {
  it("cliente escreveu há 2h SÓ pelo número por QR Code → o oficial está FECHADO", () => {
    // O caso que motivou a regra: a etiqueta dizia "22h restantes", o
    // compositor liberava texto livre e a Meta recusava (erro 131047).
    const fio = [msg("customer", 2, QR_CODE), msg("agent", 1, QR_CODE)];
    expect(janelaFechada(fio, AGORA, OFICIAL)).toBe(true);
  });

  it("…e a mesma conversa, respondida pelo número por QR Code, está aberta", () => {
    const fio = [msg("customer", 2, QR_CODE), msg("agent", 1, QR_CODE)];
    expect(janelaFechada(fio, AGORA, QR_CODE)).toBe(false);
  });

  it("vale a última do cliente NO OFICIAL, mesmo com outra mais nova pelo QR Code", () => {
    const fio = [msg("customer", 5, OFICIAL), msg("customer", 1, QR_CODE)];
    expect(janelaFechada(fio, AGORA, OFICIAL)).toBe(false);
    expect(minutosRestantes(fio, AGORA, OFICIAL)).toBe(19 * 60);
  });

  it("oficial há mais de 24h + QR Code há 1h → FECHADA no oficial", () => {
    const fio = [msg("customer", 30, OFICIAL), msg("customer", 1, QR_CODE)];
    expect(janelaFechada(fio, AGORA, OFICIAL)).toBe(true);
  });

  it("mensagem SEM carimbo NÃO conta quando o número de saída é conhecido", () => {
    // Anterior ao multi-canal ou de conexão apagada: nunca do oficial de hoje.
    expect(janelaFechada([msg("customer", 1, null)], AGORA, OFICIAL)).toBe(
      true
    );
  });

  it("fio VAZIO continua ABERTO com canal de saída (PR #79)", () => {
    expect(janelaFechada([], AGORA, OFICIAL)).toBe(false);
  });

  it("'vazio' é o FIO inteiro: só mensagens nossas pelo oficial → FECHADA", () => {
    expect(janelaFechada([msg("agent", 1, OFICIAL)], AGORA, OFICIAL)).toBe(
      true
    );
  });
});

describe("ultimaDoClienteNoCanal", () => {
  it("pega a mais recente do cliente naquele canal, ignorando os outros", () => {
    const antiga = msg("customer", 10, OFICIAL);
    const recente = msg("customer", 3, OFICIAL);
    const fio = [antiga, recente, msg("customer", 1, QR_CODE)];
    expect(ultimaDoClienteNoCanal(fio, OFICIAL)).toBe(recente);
  });

  it("sem mensagem do cliente naquele canal devolve undefined", () => {
    expect(
      ultimaDoClienteNoCanal([msg("customer", 1, QR_CODE)], OFICIAL)
    ).toBeUndefined();
  });
});

describe("minutosRestantes", () => {
  it("conta a partir da última do cliente", () => {
    expect(minutosRestantes([msg("customer", 5)], AGORA, null)).toBe(19 * 60);
  });

  it("sem mensagem do cliente devolve 0", () => {
    expect(minutosRestantes([msg("agent", 1)], AGORA, null)).toBe(0);
  });

  it("passadas as 24h devolve 0, nunca negativo", () => {
    expect(minutosRestantes([msg("customer", 30)], AGORA, null)).toBe(0);
  });

  it("carimbo no futuro (relógio do aparelho atrasado) não passa de 24h", () => {
    expect(minutosRestantes([msg("customer", -1)], AGORA, null)).toBe(24 * 60);
  });

  it("fechada é o mesmo que zero minuto — etiqueta e portão viram juntos", () => {
    const fio = [msgMin("customer", 24 * 60 - 1)];
    expect(minutosRestantes(fio, AGORA, null)).toBe(1);
    expect(janelaFechada(fio, AGORA, null)).toBe(false);
    const umMinutoDepois = new Date(AGORA.getTime() + 60_000);
    expect(minutosRestantes(fio, umMinutoDepois, null)).toBe(0);
    expect(janelaFechada(fio, umMinutoDepois, null)).toBe(true);
  });
});

describe("restanteParaExibir", () => {
  it("horas INTEIRAS, arredondando PARA BAIXO", () => {
    expect(restanteParaExibir(24 * 60)).toEqual({ unidade: "h", valor: 24 });
    expect(restanteParaExibir(24 * 60 - 1)).toEqual({ unidade: "h", valor: 23 });
    expect(restanteParaExibir(119)).toEqual({ unidade: "h", valor: 1 });
    expect(restanteParaExibir(60)).toEqual({ unidade: "h", valor: 1 });
  });

  it("na ÚLTIMA hora fala em minutos — antes pulava de '1h' direto para 'Expirada'", () => {
    expect(restanteParaExibir(59)).toEqual({ unidade: "min", valor: 59 });
    expect(restanteParaExibir(1)).toEqual({ unidade: "min", valor: 1 });
  });

  it("cliente que escreveu há 23h30 pelo oficial → 30 minutos", () => {
    const fio = [msgMin("customer", 23 * 60 + 30, OFICIAL)];
    expect(restanteParaExibir(minutosRestantes(fio, AGORA, OFICIAL))).toEqual({
      unidade: "min",
      valor: 30,
    });
  });
});
