import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pino: as duas buscas de contato por texto livre (a tela de Contatos e o
// `?search=` da API v1) passam o termo pelo escape de `literal.ts`.
//
// As duas vieram do upstream com o termo cru dentro do `.or()`: vírgula e
// parêntese quebravam o filtro (400) e `%`, `_` e `*` viravam curingas. Um
// merge que traga a versão deles de volta não conflita — os arquivos são
// dele —, e é este teste que avisa.
// ============================================================

const raiz = path.resolve(__dirname, '../../..');
const ler = (rel: string) =>
  fs
    .readFileSync(path.join(raiz, rel), 'utf8')
    // Sem comentários: a explicação cita a forma antiga.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('buscas de contato por texto livre', () => {
  it('a tela de Contatos: `.or()` por ramoContem e o termo da RPC com escaparLike', () => {
    const fonte = ler('src/app/(dashboard)/contacts/page.tsx');
    expect(fonte).toMatch(/ramoContem\(coluna, term\)/);
    expect(fonte).toMatch(/p_search:\s*term \? escaparLike\(term\) : null/);
    expect(fonte).not.toMatch(/ilike\.\$\{/);
  });

  it('a API v1: `.or()` por ramoContem, sem o filtro que apagava caracteres', () => {
    const fonte = ler('src/app/api/v1/contacts/route.ts');
    expect(fonte).toMatch(/ramoContem\('name', search\)/);
    expect(fonte).toMatch(/ramoContem\('phone', search\)/);
    expect(fonte).not.toMatch(/ilike\.\*\$\{/);
    expect(fonte).not.toMatch(/sanitizeSearch/);
  });
});
