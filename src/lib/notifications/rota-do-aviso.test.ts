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

  it("sem destino devolve null", () => {
    expect(rotaDoAviso({})).toBeNull();
  });
});
