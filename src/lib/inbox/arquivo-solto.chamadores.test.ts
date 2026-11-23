import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { TETO_DA_IMAGEM_DO_DIRECT } from "@/lib/instagram/envio";
import { MEDIA_MAX_BYTES_BY_KIND, MEDIA_MAX_BYTES_ENTRADA } from "@/lib/storage/upload-media";

// ============================================================
// O compositor decide a lista de anexos POR CONVERSA (decisão do operador,
// 02/10/2026: página .html só nas conexões por QR code). As três portas — o
// `accept=` dos seletores, o arrastar/colar e a subida — leem o MESMO
// `porQrCode`, e ele exige o transporte CONHECIDO: enquanto a lista de
// conexões não chega, o .html não pode passar, senão a conversa do número
// oficial o aceitaria e a Meta o recusaria depois do envio. Na conversa do
// Instagram, as mesmas portas leem também o `noDirect` (a lista do Direct).
// ============================================================

const fonte = fs.readFileSync(
  path.join(__dirname, "../../components/inbox/message-composer.tsx"),
  "utf8",
);

describe("compositor × arquivo-solto", () => {
  it("`porQrCode` exige o transporte conhecido E Evolution", () => {
    expect(fonte).toMatch(/const porQrCode = transporteConhecido && ehEvolution\(channelKind\);/);
    expect(fonte).toMatch(/const noDirect = ehInstagram\(channelKind\);/);
    expect(fonte).toMatch(/const aceite = aceiteDoSeletor\(porQrCode, noDirect\);/);
  });

  it("as três portas usam a mesma decisão", () => {
    // O `accept=` dos três seletores...
    for (const tipo of ["image", "video", "document"]) {
      expect(fonte).toContain(`accept={aceite.${tipo}}`);
    }
    // ...o arrastar e o colar (a fila de AGORA da conversa, desde a fila por
    // conversa de 21/10/2026)...
    expect(fonte).toMatch(/const naFila = lerDrafts\(\)\.length;\s*const r = escolherArquivos\(arquivos, naFila, porQrCode, noDirect\)/);
    // ...e a subida, que resolve o tipo de cada arquivo.
    expect(fonte).toMatch(/tipoDoArquivo\(arquivo\.type, porQrCode, noDirect\)/);
    // Nenhuma chamada sem as DUAS decisões (cairia na lista estrita sem
    // ninguém ver; no Instagram, o MOV do iPhone seria barrado antes de subir).
    expect(fonte).not.toMatch(/tipoDoArquivo\([^,)]*(,[^,)]*)?\)/);
    expect(fonte).not.toMatch(/escolherArquivos\([^,)]*,[^,)]*(,[^,)]*)?\)/);
    expect(fonte).not.toMatch(/aceiteDoSeletor\([^,)]*\)/);
  });

  it("⚠️ no Instagram Direct a imagem sobe até o teto do Direct, não o da Meta", () => {
    // O teto da Meta (5 MiB) barraria a foto de 5 a 8 MB que o Direct aceita;
    // vídeo, áudio e documento já cabem (16 MiB nossos × 25 MB do Direct).
    expect(fonte).toMatch(
      /const max =\s*noDirect && kind === "image" \? TETO_DA_IMAGEM_DO_DIRECT : MEDIA_MAX_BYTES_BY_KIND\[kind\];/,
    );
    expect(TETO_DA_IMAGEM_DO_DIRECT).toBeGreaterThan(MEDIA_MAX_BYTES_BY_KIND.image);
    expect(TETO_DA_IMAGEM_DO_DIRECT).toBeLessThanOrEqual(MEDIA_MAX_BYTES_ENTRADA);
    for (const k of ["video", "audio", "document"] as const) {
      expect(MEDIA_MAX_BYTES_BY_KIND[k]).toBeLessThanOrEqual(25 * 1000 * 1000);
    }
  });

  it("⚠️ a fila confere DE NOVO na hora de enviar ou agendar (Codex, PR #376)", () => {
    // A conexão pode mudar com o .html já na fila (seletor do cabeçalho, ou a
    // conversa solta que segue o cliente): sem a conferência, ele sairia pela
    // Meta, que o recusa.
    expect(fonte).toMatch(/mime: file\.type,/);
    expect(fonte).toMatch(
      /const sendDraft = useCallback\(async \(\) => \{[\s\S]{0,1100}?if \(drafts\.some\(\(d\) => d\.mime !== undefined && tipoDoArquivo\(d\.mime, porQrCode, noDirect\) === null\)\) \{\s*toast\.error\(noDirect \? t\("instagramNaoCabe"\) : t\("anexoSoNoQrCode"\)\);\s*return;\s*\}/,
    );
    // E vem ANTES do desvio do agendamento (agendar também leva o anexo).
    const corpo = fonte.slice(fonte.indexOf("const sendDraft = useCallback"));
    expect(corpo.indexOf('t("anexoSoNoQrCode")')).toBeLessThan(corpo.indexOf("if (quandoAg) {"));
  });

  it("⚠️ a prévia de anexo também recebe o colar (relato do operador, 10/11/2026)", () => {
    // A prévia SUBSTITUI o compositor e leva a caixa de texto junto: com o
    // colar só na caixa, o segundo print colado não entrava.
    expect(fonte).toContain("onPaste={aoColar}");
    expect(fonte).toContain("onColar={aoColar}");
    const previa = fonte.slice(fonte.indexOf("function MediaDraftPreview("));
    expect(previa).toMatch(/<div className="[^"]*" onPaste=\{onColar\}>/);
    // E a legenda pega o foco que caiu no corpo da página (a caixa sumiu),
    // senão o Ctrl+V seguinte não chega à prévia. Só nesse caso: na troca de
    // conversa o foco está na lista, e roubá-lo abriria o teclado do celular.
    expect(previa).toMatch(/if \(ativo === null \|\| ativo === document\.body\) el\.focus\(\);/);
    expect(previa).toMatch(/<input\s+ref=\{refDaLegenda\}/);
  });

  it("o aviso de recusa lista o que ESTA conexão aceita", () => {
    // O Direct primeiro: com a lista dele, a frase da Meta (que fala em WebP e
    // Office) mentiria sobre o que a conversa aceita.
    expect(fonte).toMatch(
      /noDirect\s*\?\s*t\("arquivoNaoSuportadoInstagram", \{ n: r\.recusados \}\)\s*:\s*porQrCode\s*\?\s*t\("arquivoNaoSuportadoQrCode", \{ n: r\.recusados \}\)\s*:\s*t\("arquivoNaoSuportado", \{ n: r\.recusados \}\)/,
    );
  });
});
