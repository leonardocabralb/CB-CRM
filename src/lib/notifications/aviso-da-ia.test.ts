import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Notification } from "@/types";

import {
  avisosParaReabrir,
  caixinhaTocaOSom,
  caixinhasDaConversa,
  desdeDaReabertura,
  idDaCaixinha,
  JANELA_DA_REABERTURA_MS,
  ehAlarmeDaIa,
  popUpDoSistemaCalaPelaCaixinha,
  temCaixinha,
  TETO_NA_REABERTURA,
  TIPO_DO_ALARME_DA_IA,
  TIPO_DO_AVISO_DA_IA,
  TIPOS_COM_CAIXINHA,
  tomDaCaixinha,
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

describe("o ALARME de que a IA parou (1140, F1–F2)", () => {
  const ALARME: Notification = {
    id: "alarme-1",
    account_id: "conta-1",
    user_id: "ana",
    type: TIPO_DO_ALARME_DA_IA,
    title: "A IA parou de responder (Anthropic)",
    body: "Créditos ou cota de Anthropic esgotados…",
    created_at: "2026-11-12T13:05:00Z",
  };

  it("abre a caixinha VERMELHA; o \"voltou\" fica só no sino; a passagem segue âmbar", () => {
    expect(TIPOS_COM_CAIXINHA).toEqual(["ia_transferiu", "ia_falhou"]);
    expect(temCaixinha("ia_falhou")).toBe(true);
    expect(temCaixinha("ia_voltou")).toBe(false);
    expect(temCaixinha("note_mention")).toBe(false);
    expect(tomDaCaixinha("ia_falhou")).toBe("falha");
    expect(tomDaCaixinha("ia_transferiu")).toBe("aviso");
  });

  it("sem conversa própria, leva às conversas \"Em atraso\" (F2) — no sino, no Meu dia, no pop-up e na caixinha", () => {
    expect(ehAlarmeDaIa("ia_falhou")).toBe(true);
    expect(ehAlarmeDaIa("ia_voltou")).toBe(true);
    expect(ehAlarmeDaIa("ia_transferiu")).toBe(false);
    expect(rotaDoAviso(ALARME)).toBe("/inbox?ver=em-atraso");
    expect(rotaDoAviso({ ...ALARME, type: "ia_voltou" }, "notificacoes")).toBe("/inbox?ver=em-atraso&de=notificacoes");
    expect(rotaDoAviso(ALARME, "meu-dia")).toBe("/inbox?ver=em-atraso&de=meu-dia");
    const popUp = popUpDoSino(ALARME, { titulo: ALARME.title, corpo: ALARME.body ?? null }, true);
    expect(popUp).toMatchObject({ rota: "/inbox?ver=em-atraso", conversaId: null, tag: "sino:alarme-1" });
  });

  it("com a aba em foco, a caixinha basta: o pop-up do sistema cala; o \"voltou\" (sem caixinha) não cala", () => {
    expect(popUpDoSistemaCalaPelaCaixinha("ia_falhou", true)).toBe(true);
    expect(popUpDoSistemaCalaPelaCaixinha("ia_falhou", false)).toBe(false);
    expect(popUpDoSistemaCalaPelaCaixinha("ia_voltou", true)).toBe(false);
  });

  it("nenhuma conversa aberta o cala (ele não tem conversa)", () => {
    const base = { userId: "ana", podeVerCaixa: true, agoraMs: Date.now() };
    expect(silencioDoSino({ ...base, aviso: ALARME, vistos: new Map(), conversaAVista: "conv-9" })).toBeNull();
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

describe("a caixinha VOLTA enquanto o aviso não é lido (D6, 12/11/2026)", () => {
  it("as últimas 24 h, no máximo 5 de uma vez", () => {
    expect(JANELA_DA_REABERTURA_MS).toBe(24 * 60 * 60 * 1000);
    expect(TETO_NA_REABERTURA).toBe(5);
    const agora = Date.parse("2026-11-12T12:00:00Z");
    expect(desdeDaReabertura(agora)).toBe("2026-11-11T12:00:00.000Z");
  });

  it("o mais antigo primeiro; ⚠️ o que o tempo real já disse LIDO enquanto a consulta estava no ar não volta (Codex, #511)", () => {
    const daConsulta = [{ id: "novo" }, { id: "meio" }, { id: "velho" }];
    expect(avisosParaReabrir(daConsulta, new Set()).map((a) => a.id)).toEqual(["velho", "meio", "novo"]);
    expect(avisosParaReabrir(daConsulta, new Set(["meio"])).map((a) => a.id)).toEqual(["velho", "novo"]);
    // Não mexe na lista recebida.
    expect(daConsulta.map((a) => a.id)).toEqual(["novo", "meio", "velho"]);
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
    // Os dois tipos com caixinha (1139 e 1140), no INSERT e no UPDATE.
    expect(hook).toMatch(/if \(!temCaixinha\(aviso\.type\)\) return;/);
    expect(hook).toMatch(/if \(!aviso\.read_at \|\| !temCaixinha\(aviso\.type\)\) return;/);
    expect(hook).toMatch(/duration: Infinity/);
    expect(hook).toMatch(/event: "UPDATE"/);
    expect(hook).toMatch(/window\.addEventListener\(EVENTO_CONVERSA_ABERTA, aoAbrirConversa\);/);
  });

  it("D6: ao montar, lê os avisos da IA NÃO lidos da PRÓPRIA pessoa, das últimas 24 h, e os mostra SEM som", () => {
    const hook = ler("hooks/use-aviso-da-ia-na-tela.tsx");
    const consulta = hook.slice(hook.indexOf('.from("notifications")\n        .select("*")'));
    expect(consulta).toMatch(/\.eq\("user_id", userId\)/);
    expect(consulta).toMatch(/\.in\("type", \[\.\.\.TIPOS_COM_CAIXINHA\]\)/);
    expect(consulta).toMatch(/\.is\("read_at", null\)/);
    expect(consulta).toMatch(/\.gte\("created_at", desdeDaReabertura\(Date\.now\(\)\)\)/);
    expect(consulta).toMatch(/\.limit\(TETO_NA_REABERTURA\)/);
    expect(hook).toMatch(/avisosParaReabrir\(\(data \?\? \[\]\) as Notification\[\], lidos\)\) mostrar\(aviso, false\)/);
    // O UPDATE guarda o lido ANTES de fechar, e `mostrar` o recusa.
    expect(hook).toMatch(/lidos\.add\(aviso\.id\);\s*if \(abertas\.has\(aviso\.id\)\) fechar\(aviso\.id\);/);
    expect(hook).toMatch(
      /const mostrar = \(aviso: Notification, comSom: boolean\) => \{\s*if \(lidos\.has\(aviso\.id\) \|\| dispensadas\.has\(aviso\.id\)\) return;/,
    );
    // O que chega pelo tempo real é novo: toca.
    expect(hook).toMatch(/mostrar\(aviso, true\)/);
    // ⚠️ A consulta só roda com o canal JÁ inscrito (Codex, #511): antes, um
    // INSERT no vão entre a consulta e a entrada no canal se perdia.
    expect(hook).toMatch(/\.subscribe\(\(status\) => \{\s*if \(status === "SUBSCRIBED"\) void reabrirNaoLidos\(\);\s*\}\);/);
    expect(hook.match(/reabrirNaoLidos\(\)/g)).toHaveLength(1);
    // A releitura da reconexão não reabre o que a pessoa fechou no X.
    expect(hook).toMatch(/if \(lidos\.has\(aviso\.id\) \|\| dispensadas\.has\(aviso\.id\)\) return;/);
  });

  it("o pop-up do sistema confere a caixinha ANTES de exibir", () => {
    const hook = ler("hooks/use-avisos-do-sino-no-navegador.ts");
    const cala = hook.indexOf("popUpDoSistemaCalaPelaCaixinha(aviso.type, abaEmFoco())");
    expect(cala).toBeGreaterThan(-1);
    expect(cala).toBeLessThan(hook.indexOf("void exibir(aviso);"));
  });
});
