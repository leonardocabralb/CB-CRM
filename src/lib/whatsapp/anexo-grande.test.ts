import { describe, expect, it, vi } from "vitest";

import { marcarAnexoGrandeDemais } from "./anexo-grande";

/**
 * Dublê mínimo do client: registra o que foi chamado e deixa o teste
 * escolher se o UPDATE falha. `update().eq()` resolve com `{ error }`, que é
 * a forma real do Supabase — ele NÃO lança, e é justamente isso que fazia o
 * `delete` seguinte correr sobre uma marcação que não pegou.
 */
function dubleDeDb(erroNoUpdate: { message: string } | null) {
  const chamadas: string[] = [];
  const db = {
    from(tabela: string) {
      return {
        update() {
          return {
            eq() {
              chamadas.push(`update:${tabela}`);
              return Promise.resolve({ error: erroNoUpdate });
            },
          };
        },
        delete() {
          return {
            eq() {
              chamadas.push(`delete:${tabela}`);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  // O tipo real é SupabaseClient; o dublê cobre só o que a função usa.
  return { db: db as never, chamadas };
}

describe("marcarAnexoGrandeDemais", () => {
  it("marcação OK + grupo: marca e apaga o ponteiro", async () => {
    const { db, chamadas } = dubleDeDb(null);
    const r = await marcarAnexoGrandeDemais({
      db,
      messageId: "m1",
      filename: "Instrumento.pdf",
      limparPonteiro: true,
    });
    expect(r.marcou).toBe(true);
    expect(chamadas).toEqual(["update:messages", "delete:cb_message_media_ref"]);
  });

  it("⚠️ marcação FALHOU: o ponteiro FICA — é o único caminho para o arquivo", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, chamadas } = dubleDeDb({ message: "timeout" });

    const r = await marcarAnexoGrandeDemais({
      db,
      messageId: "m1",
      limparPonteiro: true,
    });

    expect(r.marcou).toBe(false);
    expect(chamadas).toEqual(["update:messages"]);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("1:1 não tem ponteiro guardado: só marca", async () => {
    const { db, chamadas } = dubleDeDb(null);
    await marcarAnexoGrandeDemais({ db, messageId: "m1", limparPonteiro: false });
    expect(chamadas).toEqual(["update:messages"]);
  });
});
