import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// ============================================================
// QUEM apaga o ponteiro de mídia — travado estruturalmente, no mesmo desenho
// de `reopen.chamadores.test.ts`.
//
// `cb_message_media_ref` (906) guarda o payload cru do Baileys, e ele carrega
// as CHAVES DE DECIFRAGEM da mídia. A regra do projeto já era "some com o
// ponteiro assim que ele não for mais necessário — guardá-lo depois é
// superfície de risco de graça", e o caminho de sucesso do webhook a
// cumpria.
//
// O buraco (achado pelo Codex no PR #157): o caminho NOVO, que marca o anexo
// como grande demais, saía por um `continue` sem passar pela limpeza — e
// `too_large` desliga o download sob demanda PARA SEMPRE (`podeBaixarAnexo`
// o exclui e a rota o recusa na entrada). Ou seja: as chaves ficariam no
// banco indefinidamente, sem ninguém para consumi-las.
//
// Teste de comportamento com mock não pega "esqueci de limpar num ramo
// novo"; ler o fonte pega.
// ============================================================

const raiz = path.join(__dirname, "..", "..");

/** Fonte sem comentários — eles CITAM a tabela ao explicar a decisão. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(raiz, relativo), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const ARQUIVOS = [
  {
    caminho: "app/api/whatsapp/evolution/webhook/route.ts",
    quem: "webhook da Evolution",
  },
  {
    caminho: "app/api/cb/groups/media/[messageId]/route.ts",
    quem: "download sob demanda do grupo",
  },
];

describe("marcar `too_large` apaga o ponteiro do Baileys", () => {
  for (const { caminho, quem } of ARQUIVOS) {
    it(`${quem}: cada escrita de too_large tem a limpeza junto`, () => {
      const src = fonte(caminho);
      const escritas = [...src.matchAll(/'too_large'/g)];
      expect(
        escritas.length,
        "o arquivo precisa continuar tratando o anexo grande demais",
      ).toBeGreaterThan(0);

      for (const escrita of escritas) {
        // A limpeza mora no MESMO ramo — perto o bastante para o leitor ver
        // as duas juntas. Uma janela generosa deixa o formatador respirar
        // sem afrouxar a garantia: o que se cobra é que ninguém marque
        // `too_large` e siga adiante deixando as chaves para trás.
        const janela = src.slice(escrita.index, escrita.index + 900);
        expect(
          janela,
          `escrita de too_large em ${caminho} (posição ${escrita.index}) sem apagar cb_message_media_ref logo em seguida`,
        ).toContain("cb_message_media_ref");
      }
    });
  }
});
