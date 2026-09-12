import { describe, expect, it } from "vitest";

import {
  janelaFechada,
  minutosRestantes,
  restanteParaExibir,
  ultimaDoClienteNoCanal,
  type MensagemDaJanela,
} from "./janela-24h";

const AGORA = new Date("2026-08-31T12:00:00.000Z");

/** Os números de uma conta: dois oficiais (Meta), um por QR Code, um Instagram. */
const OFICIAL = { id: "canal-oficial", kind: "meta" } as const;
const OUTRO_OFICIAL = { id: "canal-oficial-2", kind: "meta" } as const;
const QR_CODE = { id: "canal-qr-code", kind: "evolution" } as const;
const INSTAGRAM = { id: "canal-instagram", kind: "instagram" } as const;

/** Ids de provedor como chegam de verdade: a Meta usa `wamid.`, o Baileys não. */
const WAMID = "wamid.HBgMNTU4Mzg4NzQ1MzE2FQIAEhggQTJEMEMwRjE1RkE0";
const ID_DO_BAILEYS = "3EB0C431C2A9F8E3B6A1";

function msg(
  sender_type: string,
  horasAtras: number,
  channel_id: string | null = null,
  message_id: string | null = null
): MensagemDaJanela {
  return {
    sender_type,
    created_at: new Date(
      AGORA.getTime() - horasAtras * 3600_000
    ).toISOString(),
    channel_id,
    message_id,
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
    expect(janelaFechada([msg("customer", 2, QR_CODE.id)], AGORA, null)).toBe(
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
    const fio = [
      msg("customer", 2, QR_CODE.id, ID_DO_BAILEYS),
      msg("agent", 1, QR_CODE.id),
    ];
    expect(janelaFechada(fio, AGORA, OFICIAL)).toBe(true);
  });

  it("…e a mesma conversa, respondida pelo número por QR Code, está aberta", () => {
    const fio = [
      msg("customer", 2, QR_CODE.id, ID_DO_BAILEYS),
      msg("agent", 1, QR_CODE.id),
    ];
    expect(janelaFechada(fio, AGORA, QR_CODE)).toBe(false);
  });

  it("vale a última do cliente NO OFICIAL, mesmo com outra mais nova pelo QR Code", () => {
    const fio = [
      msg("customer", 5, OFICIAL.id, WAMID),
      msg("customer", 1, QR_CODE.id, ID_DO_BAILEYS),
    ];
    expect(janelaFechada(fio, AGORA, OFICIAL)).toBe(false);
    expect(minutosRestantes(fio, AGORA, OFICIAL)).toBe(19 * 60);
  });

  it("oficial há mais de 24h + QR Code há 1h → FECHADA no oficial", () => {
    const fio = [
      msg("customer", 30, OFICIAL.id, WAMID),
      msg("customer", 1, QR_CODE.id, ID_DO_BAILEYS),
    ];
    expect(janelaFechada(fio, AGORA, OFICIAL)).toBe(true);
  });

  it("carimbada com o OUTRO número oficial não conta — o carimbo vence a procedência", () => {
    expect(
      janelaFechada([msg("customer", 1, OUTRO_OFICIAL.id, WAMID)], AGORA, OFICIAL)
    ).toBe(true);
  });

  it("fio VAZIO continua ABERTO com canal de saída (PR #79)", () => {
    expect(janelaFechada([], AGORA, OFICIAL)).toBe(false);
  });

  it("'vazio' é o FIO inteiro: só mensagens nossas pelo oficial → FECHADA", () => {
    expect(janelaFechada([msg("agent", 1, OFICIAL.id)], AGORA, OFICIAL)).toBe(
      true
    );
  });
});

describe("janelaFechada — mensagem SEM carimbo decide pela procedência (Codex, PR #192)", () => {
  it("da API da Meta (wamid) CONTA para o número oficial — o carimbo que faltou não tranca o compositor", () => {
    // Carimbo em UPDATE separado que falhou, ou canal resolvido nulo: o
    // cliente acabou de escrever e o compositor não pode trancar.
    expect(janelaFechada([msg("customer", 1, null, WAMID)], AGORA, OFICIAL)).toBe(
      false
    );
  });

  it("histórico da Meta de antes do multi-canal também conta (instalação que atualizou)", () => {
    expect(
      minutosRestantes([msg("customer", 3, null, WAMID)], AGORA, OFICIAL)
    ).toBe(21 * 60);
  });

  it("da Evolution (id do Baileys) NÃO conta — é a conversa mista que a Meta recusa", () => {
    expect(
      janelaFechada([msg("customer", 1, null, ID_DO_BAILEYS)], AGORA, OFICIAL)
    ).toBe(true);
  });

  it("sem id de provedor nenhum não conta", () => {
    expect(janelaFechada([msg("customer", 1, null, null)], AGORA, OFICIAL)).toBe(
      true
    );
  });

  it("da API da Meta NÃO conta quando a saída é o Instagram", () => {
    // A mensagem de WhatsApp não abre a janela do Direct.
    expect(
      janelaFechada([msg("customer", 1, null, WAMID)], AGORA, INSTAGRAM)
    ).toBe(true);
  });

  it("a carimbada pelo oficial ainda vence uma sem carimbo mais antiga", () => {
    const fio = [
      msg("customer", 20, null, WAMID),
      msg("customer", 2, OFICIAL.id, WAMID),
    ];
    expect(minutosRestantes(fio, AGORA, OFICIAL)).toBe(22 * 60);
  });
});

describe("ultimaDoClienteNoCanal", () => {
  it("pega a mais recente do cliente naquele canal, ignorando os outros", () => {
    const antiga = msg("customer", 10, OFICIAL.id, WAMID);
    const recente = msg("customer", 3, OFICIAL.id, WAMID);
    const fio = [antiga, recente, msg("customer", 1, QR_CODE.id, ID_DO_BAILEYS)];
    expect(ultimaDoClienteNoCanal(fio, OFICIAL)).toBe(recente);
  });

  it("sem mensagem do cliente naquele canal devolve undefined", () => {
    expect(
      ultimaDoClienteNoCanal(
        [msg("customer", 1, QR_CODE.id, ID_DO_BAILEYS)],
        OFICIAL
      )
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
    const fio = [msgMin("customer", 23 * 60 + 30, OFICIAL.id)];
    expect(restanteParaExibir(minutosRestantes(fio, AGORA, OFICIAL))).toEqual({
      unidade: "min",
      valor: 30,
    });
  });
});
