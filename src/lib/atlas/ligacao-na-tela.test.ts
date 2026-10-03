import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ============================================================
// Pino estrutural da LIGAÇÃO do Atlas na tela (Fase 2, PR B): o fio e a
// ficha de /contatos são arquivos do UPSTREAM (`docs/MERGE-UPSTREAM.md`), e
// um merge que os traga crus apaga a linha do Atlas da faixa, o botão e a
// aba SEM conflito e com o CI verde — os testes dos componentes continuam
// passando, porque ninguém mais os monta. Aqui se lê o FONTE (sem os
// comentários: citar o hook num comentário não é ligá-lo). O painel é nosso,
// mas a decisão da aba (`abaAtlasNoPainel`) mora nele e entra junto.
// ============================================================

const RAIZ = join(__dirname, "../..");

/** O fonte sem comentários de bloco (inclusive `{/* … *\/}` do JSX) e sem as linhas `// …`. */
function codigoDe(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//"))
    .join("\n");
}

describe("a ligação do Atlas no fio (message-thread.tsx, do upstream)", () => {
  const fio = codigoDe("components/inbox/message-thread.tsx");

  it("lê o Atlas do contato num hook PRÓPRIO e junta as duas fontes na faixa", () => {
    expect(fio).toMatch(/useAtlasDoContato\(/);
    expect(fio).toMatch(/const situacaoDoCliente = juntarSituacoes\(/);
    expect(fio).toMatch(/<FaixaDeSituacaoDoCliente\s+situacoes=\{situacaoDoCliente\}/);
  });
});

describe("a ligação do Atlas na ficha de /contatos (contact-detail-view.tsx, do upstream)", () => {
  const ficha = codigoDe("components/contacts/contact-detail-view.tsx");

  it("o hook, o botão \"Abrir no Atlas\" e a aba (gatilho e conteúdo)", () => {
    expect(ficha).toMatch(/useAtlasDoContato\(/);
    expect(ficha).toMatch(/<AbrirNoAtlas\b/);
    expect(ficha).toMatch(/<AbaAtlas\b/);
    expect(ficha.match(/value="atlas"/g) ?? []).toHaveLength(2);
  });
});

describe("a ligação do Atlas no painel da conversa (painel-do-contato.tsx)", () => {
  const painel = codigoDe("components/inbox/painel/painel-do-contato.tsx");

  it("o hook, o botão, a aba — e a decisão de mostrá-la pela última leitura (sem piscar)", () => {
    expect(painel).toMatch(/useAtlasDoContato\(/);
    expect(painel).toMatch(/<AbrirNoAtlas\b/);
    expect(painel).toMatch(/<AbaAtlas\b/);
    expect(painel).toMatch(/abaAtlasNoPainel\(\{[^}]*ultimaLeitura: atlas\.ultimaLeitura/);
    // Pelo vínculo do contato atual (nulo na carga), a aba voltaria a piscar.
    expect(painel).not.toMatch(/mostrarAbaAtlas\s*=[^;]*dados\?\.vinculo/);
  });
});
