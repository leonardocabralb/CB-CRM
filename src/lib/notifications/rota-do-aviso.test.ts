import { describe, expect, it } from "vitest";

import { rotaDoAviso } from "./rota-do-aviso";

describe("rotaDoAviso", () => {
  it("aviso de tarefa vai para Tarefas — mesmo que um dia traga conversa", () => {
    expect(rotaDoAviso({ task_id: "t1" })).toBe("/tarefas");
    expect(rotaDoAviso({ task_id: "t1", conversation_id: "c1" })).toBe("/tarefas");
  });

  it("aviso de conversa abre o fio", () => {
    expect(rotaDoAviso({ conversation_id: "c1" })).toBe("/inbox?c=c1");
  });

  it("1114: aviso de anotação abre o fio JÁ na anotação que o gerou", () => {
    expect(rotaDoAviso({ conversation_id: "c1", note_id: "n1" })).toBe("/inbox?c=c1&nota=n1");
    // Aviso anterior à 1114 (sem a coluna): só a conversa, como antes.
    expect(rotaDoAviso({ conversation_id: "c1", note_id: null })).toBe("/inbox?c=c1");
    // A tarefa continua vencendo.
    expect(rotaDoAviso({ task_id: "t1", conversation_id: "c1", note_id: "n1" })).toBe("/tarefas");
  });

  it("28/10: a tela de onde o clique saiu vira a faixa de volta (`de`) — e a tarefa segue indo para Tarefas", () => {
    expect(rotaDoAviso({ conversation_id: "c1", note_id: "n1" }, "notificacoes")).toBe(
      "/inbox?c=c1&nota=n1&de=notificacoes",
    );
    expect(rotaDoAviso({ conversation_id: "c1" }, "meu-dia")).toBe("/inbox?c=c1&de=meu-dia");
    expect(rotaDoAviso({ task_id: "t1", conversation_id: "c1" }, "notificacoes")).toBe("/tarefas");
  });

  it("sem destino devolve null", () => {
    expect(rotaDoAviso({})).toBeNull();
  });
});
