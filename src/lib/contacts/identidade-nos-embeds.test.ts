import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================
// Pino da Fase 11.4: toda consulta que lê o NOME do contato para exibir traz
// também os dois @ — o do WhatsApp (`wa_username`, a ficha que a Meta manda
// só com o nome de usuário, sem telefone) e o do Instagram.
//
// `nomeDoContato`/`identidadeDoContato` só mostram o @ se a coluna CHEGOU:
// trocar `name || phone` pela função sem alargar o select continua mostrando
// o fallback ("Desconhecido", travessão, vazio) — e nada estoura. Esta é a
// crítica de completude da 11.4, e por isso a régua olha o SELECT, não a
// função: toda lista de colunas com `name, phone` num literal de `src/`.
//
// DEFAULT-DENY: consulta nova que leia `name, phone` sem os dois @ reprova
// até entrar em EXCECOES, com o motivo escrito.
// ============================================================

const SRC = path.join(__dirname, '..', '..');

/** Lê `name, phone` sem exibir a identidade — cada uma com o porquê. */
const EXCECOES: Record<string, string> = {
  'lib/asaas/levantamento.ts':
    'casa ficha por telefone e e-mail (o levantamento do vínculo), não exibe nome',
  'lib/asaas/espelho.ts':
    'lerFichas: nome e telefone no cartão do Asaas; limite escrito no plano — a ficha só-BSUID ligada por CPF/e-mail aparece sem identidade ali',
  'lib/automations/engine.ts':
    '{{contact.name|phone|…}}: a variável é o DADO cru; decisão 6 do operador (só documentar o telefone vazio)',
};

function* fontes(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* fontes(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
  }
}

const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/');

describe('a identidade chega aos embeds (Fase 11.4)', () => {
  it('toda lista de colunas com `name, phone` traz `wa_username` e `instagram_username`', () => {
    const faltando: string[] = [];
    const excecoesUsadas = new Set<string>();
    for (const arquivo of fontes(SRC)) {
      const r = rel(arquivo);
      const texto = fs.readFileSync(arquivo, 'utf8');
      for (const m of texto.matchAll(/(['"`])([^'"`\n]*\bname, phone\b[^'"`\n]*)\1/g)) {
        const colunas = m[2];
        const temOsDois = /\bwa_username\b/.test(colunas) && /\binstagram_username\b/.test(colunas);
        if (temOsDois) continue;
        if (r in EXCECOES) {
          excecoesUsadas.add(r);
          continue;
        }
        faltando.push(`${r}: ${colunas}`);
      }
    }
    expect(faltando).toEqual([]);
    // Exceção que não é mais usada sai da lista: senão ela vira porta aberta
    // para a próxima consulta daquele arquivo.
    expect([...excecoesUsadas].sort()).toEqual(Object.keys(EXCECOES).sort());
  });
});
