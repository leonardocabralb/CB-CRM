import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// ============================================================
// QUEM marca "anexo grande demais" — travado estruturalmente, no mesmo
// desenho de `reopen.chamadores.test.ts`.
//
// A marcação são DOIS passos que precisam andar juntos: gravar
// `media_state='too_large'` e apagar o ponteiro `cb_message_media_ref` (906),
// que guarda as CHAVES DE DECIFRAGEM da mídia e nunca mais será usado —
// `too_large` desliga o download sob demanda para sempre.
//
// Os dois passos moram em `marcarAnexoGrandeDemais` (`lib/whatsapp/
// anexo-grande.ts`) porque, soltos nos call sites, já divergiram DUAS vezes
// em dois PRs: primeiro o ramo novo do webhook nem limpava (Codex, #157), e
// depois a rota de download limpava SEM conferir se a marcação pegou (Codex,
// #158) — deixando a mensagem `pending`, com o botão na tela e sem o
// ponteiro que o alimenta.
//
// Este teste é default-deny: ninguém escreve `too_large` fora do helper.
// Mock não pega "esqueci a regra num ramo novo"; ler o fonte pega.
// ============================================================

const raiz = path.join(__dirname, "..", "..");

/** Todo `.ts`/`.tsx` de `src/`, menos teste — o universo do default-deny. */
const ARQUIVOS_DO_APP: string[] = [];
(function varrer(dir: string) {
  for (const entrada of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entrada.name);
    if (entrada.isDirectory()) varrer(rel);
    else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
      ARQUIVOS_DO_APP.push(rel);
    }
  }
})(".");

/** Fonte sem comentários — eles CITAM a tabela ao explicar a decisão. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(raiz, relativo), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const CALL_SITES = [
  {
    caminho: "app/api/whatsapp/evolution/webhook/route.ts",
    quem: "webhook da Evolution",
  },
  {
    caminho: "app/api/cb/groups/media/[messageId]/route.ts",
    quem: "download sob demanda do grupo",
  },
];

describe("marcar `too_large` passa pelo helper, sempre", () => {
  for (const { caminho, quem } of CALL_SITES) {
    it(`${quem} chama marcarAnexoGrandeDemais`, () => {
      expect(fonte(caminho)).toContain("marcarAnexoGrandeDemais");
    });
  }

  it("⚠️ ninguém escreve media_state:'too_large' fora do helper", () => {
    const escritores = ARQUIVOS_DO_APP.filter((rel) =>
      /media_state:\s*'too_large'/.test(fonte(rel)),
    );
    expect(escritores).toEqual(["lib/whatsapp/anexo-grande.ts"]);
  });

  it("o helper é quem apaga o ponteiro", () => {
    expect(fonte("lib/whatsapp/anexo-grande.ts")).toContain("cb_message_media_ref");
  });
});
