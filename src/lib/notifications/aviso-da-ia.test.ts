import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Notification } from "@/types";

import {
  caixinhaTocaOSom,
  caixinhasDaConversa,
  idDaCaixinha,
  popUpDoSistemaCalaPelaCaixinha,
  TIPO_DO_AVISO_DA_IA,
} from "./aviso-da-ia";
import { popUpDoSino, silencioDoSino } from "./aviso-do-sino";
import { rotaDoAviso } from "./rota-do-aviso";

// ============================================================
// O aviso "IA passou a conversa para a equipe" (1139) na TELA: o link, a
// caixinha × o pop-up do sistema, o som e o que a fecha. Decisões D3/D4 do
// operador (`docs/PLANO-aviso-da-ia-que-passa-a-conversa.md`).
// ============================================================

const AVISO: Notification = {
  id: "aviso-1",
  account_id: "conta-1",
  user_id: "ana",
  type: TIPO_DO_AVISO_DA_IA,
  conversation_id: "conv-9",
  contact_id: "contato-9",
  title: "IA passou Fulana para a equipe",
  body: "Pendência da IA: Pediu ligação",
  created_at: "2026-11-11T22:00:00Z",
};

describe("o link do aviso da IA", () => {
  it("leva à CONVERSA (`/inbox?c=<id>`), no sino, no Meu dia e no pop-up", () => {
    expect(rotaDoAviso(AVISO)).toBe("/inbox?c=conv-9");
    expect(rotaDoAviso(AVISO, "notificacoes")).toBe("/inbox?c=conv-9&de=notificacoes");
    const popUp = popUpDoSino(AVISO, { titulo: AVISO.title, corpo: AVISO.body ?? null }, true);
    expect(popUp).toMatchObject({ rota: "/inbox?c=conv-9", conversaId: "conv-9", notaId: null, tag: "sino:aviso-1" });
  });

  it("a caixinha tem id próprio por aviso (não se confunde com os outros toasts)", () => {
    expect(idDaCaixinha("aviso-1")).toBe("ia:aviso-1");
  });
});

describe("caixinha × pop-up do sistema (D4)", () => {
  it("com a aba EM FOCO, o pop-up do sistema cala para o aviso da IA — e só para ele", () => {
    expect(popUpDoSistemaCalaPelaCaixinha(TIPO_DO_AVISO_DA_IA, true)).toBe(true);
    expect(popUpDoSistemaCalaPelaCaixinha(TIPO_DO_AVISO_DA_IA, false)).toBe(false);
    expect(popUpDoSistemaCalaPelaCaixinha("note_mention", true)).toBe(false);
  });

  it("o som sai da caixinha só quando o pop-up do sistema não vai tocar", () => {
    // Aba em foco: o pop-up calou — a caixinha toca.
    expect(caixinhaTocaOSom({ somNoSino: true, abaEmFoco: true, popUpPossivel: true })).toBe(true);
    // Fora de foco com o pop-up possível: o som é dele.
    expect(caixinhaTocaOSom({ somNoSino: true, abaEmFoco: false, popUpPossivel: true })).toBe(false);
    // Fora de foco sem pop-up (permissão negada, celular): a caixinha toca.
    expect(caixinhaTocaOSom({ somNoSino: true, abaEmFoco: false, popUpPossivel: false })).toBe(true);
    // "Tocar o som do CRM" desligado: nunca.
    expect(caixinhaTocaOSom({ somNoSino: false, abaEmFoco: true, popUpPossivel: false })).toBe(false);
  });

  it("cala como o pop-up do sino: a conversa já aberta na aba visível, o já lido e o repetido", () => {
    const base = { userId: "ana", podeVerCaixa: true, agoraMs: Date.now() };
    expect(silencioDoSino({ ...base, aviso: AVISO, vistos: new Map(), conversaAVista: "conv-9" })).toBe(
      "conversa_a_vista",
    );
    expect(silencioDoSino({ ...base, aviso: { ...AVISO, read_at: "x" }, vistos: new Map(), conversaAVista: null })).toBe(
      "ja_lido",
    );
    const vistos = new Map<string, number>();
    expect(silencioDoSino({ ...base, aviso: AVISO, vistos, conversaAVista: null })).toBeNull();
    expect(silencioDoSino({ ...base, aviso: AVISO, vistos, conversaAVista: null })).toBe("repetido");
    expect(
      silencioDoSino({ ...base, podeVerCaixa: false, aviso: AVISO, vistos: new Map(), conversaAVista: null }),
    ).toBe("sem_caixa_de_entrada");
  });
});

describe("o que fecha a caixinha (D3)", () => {
  it("abrir a conversa na caixa de entrada fecha as caixinhas DELA", () => {
    const abertas = new Map<string, string | null>([
      ["a1", "conv-9"],
      ["a2", "conv-7"],
      ["a3", "conv-9"],
      ["a4", null],
    ]);
    expect(caixinhasDaConversa(abertas, "conv-9")).toEqual(["a1", "a3"]);
    expect(caixinhasDaConversa(abertas, "conv-1")).toEqual([]);
  });
});

describe("pinos da montagem", () => {
  const SRC = path.join(__dirname, "../..");
  const ler = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

  it("a caixinha é montada no ouvinte da casca (uma vez por aba, depois do \"Continuar\")", () => {
    expect(ler("components/notifications/browser-notifications-listener.tsx")).toMatch(/useAvisoDaIaNaTela\(\);/);
  });

  it("o ouvinte da caixinha só abre para o tipo da IA, sem prazo, e fecha quando o aviso é lido por outro caminho", () => {
    const hook = ler("hooks/use-aviso-da-ia-na-tela.tsx");
    expect(hook).toMatch(/if \(aviso\.type !== TIPO_DO_AVISO_DA_IA\) return;/);
    expect(hook).toMatch(/duration: Infinity/);
    expect(hook).toMatch(/event: "UPDATE"/);
    expect(hook).toMatch(/window\.addEventListener\(EVENTO_CONVERSA_ABERTA, aoAbrirConversa\);/);
  });

  it("o pop-up do sistema confere a caixinha ANTES de exibir", () => {
    const hook = ler("hooks/use-avisos-do-sino-no-navegador.ts");
    const cala = hook.indexOf("popUpDoSistemaCalaPelaCaixinha(aviso.type, abaEmFoco())");
    expect(cala).toBeGreaterThan(-1);
    expect(cala).toBeLessThan(hook.indexOf("void exibir(aviso);"));
  });
});
