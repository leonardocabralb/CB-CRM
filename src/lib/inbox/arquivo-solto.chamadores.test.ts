import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// O compositor decide a lista de anexos POR CONVERSA (decisão do operador,
// 02/10/2026: página .html só nas conexões por QR code). As três portas — o
// `accept=` dos seletores, o arrastar/colar e a subida — leem o MESMO
// `porQrCode`, e ele exige o transporte CONHECIDO: enquanto a lista de
// conexões não chega, o .html não pode passar, senão a conversa do número
// oficial o aceitaria e a Meta o recusaria depois do envio.
// ============================================================

const fonte = fs.readFileSync(
  path.join(__dirname, "../../components/inbox/message-composer.tsx"),
  "utf8",
);

describe("compositor × arquivo-solto", () => {
  it("`porQrCode` exige o transporte conhecido E Evolution", () => {
    expect(fonte).toMatch(/const porQrCode = transporteConhecido && ehEvolution\(channelKind\);/);
    expect(fonte).toMatch(/const aceite = aceiteDoSeletor\(porQrCode\);/);
  });

  it("as três portas usam a mesma decisão", () => {
    // O `accept=` dos três seletores...
    for (const tipo of ["image", "video", "document"]) {
      expect(fonte).toContain(`accept={aceite.${tipo}}`);
    }
    // ...o arrastar e o colar...
    expect(fonte).toMatch(/escolherArquivos\(arquivos, draftsRef\.current\.length, porQrCode\)/);
    // ...e a subida, que resolve o tipo de cada arquivo.
    expect(fonte).toMatch(/tipoDoArquivo\(arquivo\.type, porQrCode\)/);
    // Nenhuma chamada sem a decisão (cairia na lista estrita sem ninguém ver).
    expect(fonte).not.toMatch(/tipoDoArquivo\([^,)]*\)/);
    expect(fonte).not.toMatch(/escolherArquivos\([^,)]*,[^,)]*\)/);
  });

  it("o aviso de recusa lista o que ESTA conexão aceita", () => {
    expect(fonte).toMatch(
      /porQrCode\s*\?\s*t\("arquivoNaoSuportadoQrCode", \{ n: r\.recusados \}\)\s*:\s*t\("arquivoNaoSuportado", \{ n: r\.recusados \}\)/,
    );
  });
});
