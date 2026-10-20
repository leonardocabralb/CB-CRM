import { describe, expect, it } from "vitest";
import type { Notification } from "@/types";
import { DEDUPE_WINDOW_MS } from "./browser-notify";
import { popUpDoSino, silencioDoSino } from "./aviso-do-sino";

const EU = "u-eu";
const AGORA = Date.parse("2026-10-20T15:00:00Z");

function aviso(over: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    account_id: "a1",
    user_id: EU,
    type: "note_mention",
    conversation_id: "c1",
    title: "Ana mencionou você numa anotação",
    body: "Pode ligar hoje?",
    created_at: new Date(AGORA).toISOString(),
    ...over,
  };
}

function decide(
  over: Partial<Notification> = {},
  opts: {
    vistos?: Map<string, number>;
    conversaAVista?: string | null;
    agoraMs?: number;
    podeVerCaixa?: boolean;
  } = {},
) {
  return silencioDoSino({
    aviso: aviso(over),
    userId: EU,
    podeVerCaixa: opts.podeVerCaixa ?? true,
    vistos: opts.vistos ?? new Map(),
    conversaAVista: opts.conversaAVista ?? null,
    agoraMs: opts.agoraMs ?? AGORA,
  });
}

describe("silencioDoSino — todo aviso do sino vira pop-up (D2)", () => {
  it("avisa menção, resposta, tarefa, conversa atribuída e alerta do WhatsApp", () => {
    expect(decide({ type: "note_mention" })).toBeNull();
    expect(decide({ type: "note_reply" })).toBeNull();
    expect(decide({ type: "task_assigned", conversation_id: undefined, task_id: "t1" })).toBeNull();
    expect(decide({ type: "task_reply", conversation_id: undefined, task_id: "t1" })).toBeNull();
    expect(decide({ type: "conversation_assigned" })).toBeNull();
    expect(decide({ type: "whatsapp_alert", conversation_id: undefined })).toBeNull();
  });

  it("perfil sem a Caixa de entrada não recebe pop-up: o cartão nem aparece para desligá-lo", () => {
    expect(decide({}, { podeVerCaixa: false })).toBe("sem_caixa_de_entrada");
    expect(decide({ type: "task_assigned", task_id: "t1" }, { podeVerCaixa: false })).toBe(
      "sem_caixa_de_entrada",
    );
  });

  it("aviso de outra pessoa ou já lido não avisa", () => {
    expect(decide({ user_id: "u-outro" })).toBe("de_outra_pessoa");
    expect(decide({ read_at: new Date(AGORA).toISOString() })).toBe("ja_lido");
  });

  it("o mesmo id entregue de novo pelo realtime avisa uma vez só, e a janela passa", () => {
    const vistos = new Map<string, number>();
    expect(decide({}, { vistos })).toBeNull();
    expect(decide({}, { vistos, agoraMs: AGORA + 1_000 })).toBe("repetido");
    expect(decide({ id: "n2" }, { vistos, agoraMs: AGORA + 1_000 })).toBeNull();
    expect(decide({}, { vistos, agoraMs: AGORA + DEDUPE_WINDOW_MS + 1 })).toBeNull();
  });

  it("a repetição de um aviso calado pela tela continua calada", () => {
    const vistos = new Map<string, number>();
    expect(decide({}, { vistos, conversaAVista: "c1" })).toBe("conversa_a_vista");
    expect(decide({}, { vistos, agoraMs: AGORA + 1_000 })).toBe("repetido");
  });

  it("com a conversa da anotação na tela, cala; outra conversa na tela, avisa", () => {
    expect(decide({}, { conversaAVista: "c1" })).toBe("conversa_a_vista");
    expect(decide({}, { conversaAVista: "c2" })).toBeNull();
  });

  it("aviso de tarefa não se cala pela conversa na tela: o destino dele é Tarefas", () => {
    expect(decide({ type: "task_assigned", task_id: "t1", conversation_id: "c1" }, { conversaAVista: "c1" })).toBeNull();
  });
});

describe("popUpDoSino", () => {
  const texto = { titulo: "Ana mencionou você numa anotação", corpo: "Pode ligar hoje?" };

  it("menção: título e corpo do sino, um pop-up por aviso, clique na conversa", () => {
    expect(popUpDoSino(aviso(), texto, true)).toEqual({
      titulo: "Ana mencionou você numa anotação",
      corpo: "Pode ligar hoje?",
      tag: "sino:n1",
      rota: "/inbox?c=c1",
      conversaId: "c1",
    });
  });

  it("a tag não colide com a do pop-up de mensagem (o id da conversa)", () => {
    expect(popUpDoSino(aviso(), texto, true).tag).not.toBe("c1");
  });

  it("'Mostrar o texto' desligado esconde o corpo (D5); corpo vazio vira null", () => {
    expect(popUpDoSino(aviso(), texto, false).corpo).toBeNull();
    expect(popUpDoSino(aviso(), { titulo: "x", corpo: "   " }, true).corpo).toBeNull();
    expect(popUpDoSino(aviso(), { titulo: "x", corpo: null }, true).corpo).toBeNull();
  });

  it("corpo longo é cortado como o da mensagem", () => {
    const corpo = popUpDoSino(aviso(), { titulo: "x", corpo: "palavra ".repeat(60) }, true).corpo;
    expect(corpo!.length).toBeLessThanOrEqual(121);
    expect(corpo!.endsWith("…")).toBe(true);
  });

  it("tarefa vai para Tarefas e não abre conversa, mesmo se um dia trouxer uma", () => {
    const p = popUpDoSino(aviso({ type: "task_assigned", task_id: "t1", conversation_id: "c1" }), texto, true);
    expect(p.rota).toBe("/tarefas");
    expect(p.conversaId).toBeNull();
  });

  it("alerta do WhatsApp não leva a lugar nenhum: o clique só marca lido", () => {
    const p = popUpDoSino(aviso({ type: "whatsapp_alert", conversation_id: undefined }), texto, true);
    expect(p.rota).toBeNull();
    expect(p.conversaId).toBeNull();
  });
});
