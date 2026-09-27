import { describe, expect, it } from "vitest";

import {
  gravarResultado,
  motivoDaRecusa,
  RECOLHER_CLAIM_MS,
  reivindicarEvento,
  TETO_DE_PROCESSAMENTO_MS,
} from "./claim";
import { criarBanco } from "./duble.test-helper";

const AGORA = new Date("2026-09-27T12:00:00Z").getTime();
const haMinutos = (m: number) => new Date(AGORA - m * 60_000).toISOString();

describe("o cadeado da entrega (gêmeo do Calendly)", () => {
  it("CRÍTICO: o teto é MENOR que o recolhimento, com folga", () => {
    // Sem a margem, "cadeado velho" não prova "dono morto": um processamento
    // lento seria tomado por outro clique e a automação rodaria em dobro.
    expect(TETO_DE_PROCESSAMENTO_MS).toBeLessThan(RECOLHER_CLAIM_MS);
    expect(RECOLHER_CLAIM_MS - TETO_DE_PROCESSAMENTO_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it("só reivindica linha reprocessável com o cadeado livre ou abandonado", async () => {
    const banco = criarBanco({
      cb_zapsign_eventos: [
        { id: "livre", account_id: "c", resultado: "sem_contato", processando_desde: null },
        { id: "vivo", account_id: "c", resultado: "sem_contato", processando_desde: haMinutos(1) },
        { id: "morto", account_id: "c", resultado: "incompleto", processando_desde: haMinutos(11) },
        { id: "rodou", account_id: "c", resultado: "disparado", processando_desde: null },
      ],
    });
    const pega = async (id: string) => (await reivindicarEvento(banco.cliente, { id, accountId: "c", agoraMs: AGORA })).linha?.id ?? null;
    expect(await pega("livre")).toBe("livre");
    expect(await pega("vivo")).toBeNull();
    expect(await pega("morto")).toBe("morto");
    expect(await pega("rodou")).toBeNull();
  });

  it("motivo da recusa: em curso vence o resultado", () => {
    expect(motivoDaRecusa(null, AGORA)).toBe("not_found");
    expect(motivoDaRecusa({ resultado: "disparado", processando_desde: null }, AGORA)).toBe("ja_processado");
    expect(motivoDaRecusa({ resultado: "disparado", processando_desde: haMinutos(1) }, AGORA)).toBe("ainda_processando");
  });

  it("CRÍTICO: a escrita do resultado leva a CERCA DE POSSE e não apaga o contato gravado", async () => {
    const banco = criarBanco({
      cb_zapsign_eventos: [{ id: "e1", resultado: "recebido", processando_desde: "claim-do-outro", contact_id: "c1" }],
    });
    expect(await gravarResultado(banco.cliente, "e1", { resultado: "falhou", detalhe: "x", contactId: null }, "meu-claim")).toEqual({ gravou: false });
    expect(banco.tabelas.cb_zapsign_eventos[0].resultado).toBe("recebido");
    expect(await gravarResultado(banco.cliente, "e1", { resultado: "falhou", detalhe: "x", contactId: null }, "claim-do-outro")).toEqual({ gravou: true });
    expect(banco.tabelas.cb_zapsign_eventos[0]).toMatchObject({ resultado: "falhou", contact_id: "c1", processando_desde: null });
  });
});
