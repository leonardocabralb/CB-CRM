import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MINUTOS_DA_JANELA,
  PREFIXO_DO_ID_DA_META,
  minutosRestantes,
  type MensagemDaJanela,
} from "./janela-24h";
import {
  LIMIAR_AMBAR_MIN,
  LIMIAR_VERMELHO_MIN,
  corDaJanela,
  seloDaJanela,
} from "./selo-da-janela";

const AGORA = Date.parse("2026-09-12T15:00:00Z");
const min = (n: number) => new Date(AGORA - n * 60_000).toISOString();

/** Os números de uma conta: dois oficiais (Meta), um por QR Code, um Instagram. */
const OFICIAL = { id: "canal-oficial", kind: "meta" } as const;
const OUTRO_OFICIAL = { id: "canal-oficial-2", kind: "meta" } as const;
const QR_CODE = { id: "canal-qr-code", kind: "evolution" } as const;
const INSTAGRAM = { id: "canal-instagram", kind: "instagram" } as const;

function conversa(
  janela_meta_desde: string | null | undefined,
  janela_meta_canal_id: string | null = OFICIAL.id,
  extra: { status?: "open" | "pending" | "closed"; group_id?: string | null } = {},
) {
  return {
    status: extra.status ?? ("open" as const),
    group_id: extra.group_id ?? null,
    janela_meta_desde,
    janela_meta_canal_id,
  };
}

describe("corDaJanela — as três cores que o operador escolheu", () => {
  it("os limiares são 12h e 3h", () => {
    expect(LIMIAR_AMBAR_MIN).toBe(720);
    expect(LIMIAR_VERMELHO_MIN).toBe(180);
  });

  it("24h a 12h é a padrão; 11h59 já é âmbar", () => {
    expect(corDaJanela(MINUTOS_DA_JANELA)).toBe("padrao");
    expect(corDaJanela(12 * 60)).toBe("padrao");
    expect(corDaJanela(12 * 60 - 1)).toBe("ambar");
  });

  it("3h ainda é âmbar; 2h59 já é vermelha", () => {
    expect(corDaJanela(3 * 60)).toBe("ambar");
    expect(corDaJanela(3 * 60 - 1)).toBe("vermelha");
    expect(corDaJanela(1)).toBe("vermelha");
  });
});

describe("seloDaJanela — quando a ampulheta aparece", () => {
  it("cliente que escreveu há 2h pelo número oficial: selo na cor padrão", () => {
    expect(seloDaJanela(conversa(min(120)), OFICIAL, AGORA)).toEqual({
      restante: 22 * 60,
      cor: "padrao",
    });
  });

  it("as cores viram nos minutos certos", () => {
    expect(seloDaJanela(conversa(min(12 * 60)), OFICIAL, AGORA)?.cor).toBe("padrao");
    expect(seloDaJanela(conversa(min(12 * 60 + 1)), OFICIAL, AGORA)?.cor).toBe("ambar");
    expect(seloDaJanela(conversa(min(21 * 60)), OFICIAL, AGORA)?.cor).toBe("ambar");
    expect(seloDaJanela(conversa(min(21 * 60 + 1)), OFICIAL, AGORA)?.cor).toBe("vermelha");
  });

  it("no último minuto ainda há selo; em 24h00 exatas não há mais", () => {
    expect(seloDaJanela(conversa(min(24 * 60 - 1)), OFICIAL, AGORA)).toEqual({
      restante: 1,
      cor: "vermelha",
    });
    expect(seloDaJanela(conversa(min(24 * 60)), OFICIAL, AGORA)).toBeNull();
    expect(seloDaJanela(conversa(min(3 * 24 * 60)), OFICIAL, AGORA)).toBeNull();
  });

  it("o cliente nunca escreveu pelo número oficial (coluna nula, ou pré-991): sem selo", () => {
    expect(seloDaJanela(conversa(null), OFICIAL, AGORA)).toBeNull();
    expect(seloDaJanela(conversa(undefined), OFICIAL, AGORA)).toBeNull();
    expect(seloDaJanela(conversa("não é data"), OFICIAL, AGORA)).toBeNull();
  });

  it("encerrada não mostra (decisão do operador); reaberta volta a mostrar", () => {
    expect(seloDaJanela(conversa(min(60), OFICIAL.id, { status: "closed" }), OFICIAL, AGORA)).toBeNull();
    expect(seloDaJanela(conversa(min(60), OFICIAL.id, { status: "pending" }), OFICIAL, AGORA)).not.toBeNull();
    expect(seloDaJanela(conversa(min(60), OFICIAL.id, { status: "open" }), OFICIAL, AGORA)).not.toBeNull();
  });

  it("grupo nunca tem selo", () => {
    expect(seloDaJanela(conversa(min(60), null, { group_id: "grupo" }), OFICIAL, AGORA)).toBeNull();
  });

  it("número de saída desconhecido (canais carregando ou consulta falhou): sem selo", () => {
    expect(seloDaJanela(conversa(min(60)), null, AGORA)).toBeNull();
  });

  it("só o WhatsApp oficial: QR Code e Instagram não mostram", () => {
    expect(seloDaJanela(conversa(min(60), QR_CODE.id), QR_CODE, AGORA)).toBeNull();
    expect(seloDaJanela(conversa(min(60), INSTAGRAM.id), INSTAGRAM, AGORA)).toBeNull();
    // Mesmo com a mensagem da Meta carimbada, a SAÍDA por QR Code não tem janela.
    expect(seloDaJanela(conversa(min(60), OFICIAL.id), QR_CODE, AGORA)).toBeNull();
  });

  it("a janela é POR NÚMERO: mensagem pelo outro oficial não abre a deste", () => {
    expect(seloDaJanela(conversa(min(60), OUTRO_OFICIAL.id), OFICIAL, AGORA)).toBeNull();
    expect(seloDaJanela(conversa(min(60), OUTRO_OFICIAL.id), OUTRO_OFICIAL, AGORA)).not.toBeNull();
  });

  it("mensagem da Meta SEM carimbo conta para qualquer número oficial, como no fio", () => {
    expect(seloDaJanela(conversa(min(60), null), OFICIAL, AGORA)).not.toBeNull();
    expect(seloDaJanela(conversa(min(60), null), OUTRO_OFICIAL, AGORA)).not.toBeNull();
    expect(seloDaJanela(conversa(min(60), null), QR_CODE, AGORA)).toBeNull();
  });

  it("carimbo no futuro (relógio do aparelho atrasado) não passa de 24h", () => {
    expect(seloDaJanela(conversa(min(-30)), OFICIAL, AGORA)).toEqual({
      restante: MINUTOS_DA_JANELA,
      cor: "padrao",
    });
  });
});

describe("a lista e o fio nunca discordam sobre o que resta", () => {
  // O fio conta sobre as MENSAGENS (`minutosRestantes`); a lista, sobre o
  // carimbo que o gatilho da 991 deixou na conversa. Mesma mensagem, mesmo
  // instante — mesmo número.
  const casos = [1, 59, 60, 179, 180, 719, 720, 721, 1000, 1439];

  it.each(casos)("cliente escreveu há %i min pelo número oficial", (minutosAtras) => {
    const mensagens: MensagemDaJanela[] = [
      { sender_type: "agent", created_at: min(minutosAtras + 10), channel_id: OFICIAL.id },
      {
        sender_type: "customer",
        created_at: min(minutosAtras),
        channel_id: OFICIAL.id,
        message_id: `${PREFIXO_DO_ID_DA_META}ABC`,
      },
    ];
    const doFio = minutosRestantes(mensagens, new Date(AGORA), OFICIAL);
    const daLista = seloDaJanela(conversa(min(minutosAtras)), OFICIAL, AGORA);
    expect(daLista?.restante).toBe(doFio);
  });

  it("mensagem da Meta sem carimbo: os dois contam para o número oficial", () => {
    const mensagens: MensagemDaJanela[] = [
      {
        sender_type: "customer",
        created_at: min(100),
        channel_id: null,
        message_id: `${PREFIXO_DO_ID_DA_META}ABC`,
      },
    ];
    expect(minutosRestantes(mensagens, new Date(AGORA), OFICIAL)).toBe(
      seloDaJanela(conversa(min(100), null), OFICIAL, AGORA)?.restante,
    );
  });
});

describe("o gatilho da 991 espelha a regra do fio", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/991_cb_janela_da_meta_na_conversa.sql"),
    "utf8",
  );

  it("reconhece a mensagem da Meta sem carimbo pelo MESMO prefixo", () => {
    // Trigger e acervo: as duas ocorrências do LIKE usam o prefixo do fio.
    const ocorrencias = sql.match(/LIKE '([^']+)%'/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2);
    for (const o of ocorrencias) {
      expect(o).toBe(`LIKE '${PREFIXO_DO_ID_DA_META}%'`);
    }
  });

  it("só o cliente abre a janela, e só a conexão da Meta conta", () => {
    expect(sql).toMatch(/WHEN \(NEW\.sender_type = 'customer'\)/);
    expect(sql).toMatch(/v_kind IS DISTINCT FROM 'meta'/);
  });

  it("conexão apagada anula o número, como a 902 faz com o carimbo", () => {
    expect(sql).toMatch(/REFERENCES cb_channels\(id\) ON DELETE SET NULL/);
  });
});
