import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pino: as buscas por texto livre (a tela de Contatos, o `?search=` da API
// v1, os seletores de cliente e as duas do tl;dv) passam o termo pelo escape
// de `literal.ts`.
//
// A da tela e a da API vieram do upstream com o termo cru no `.or()`: vírgula e
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

  it('os seletores de cliente: todo ramo por ramoContem (26/09/2026)', () => {
    const fonte = ler('src/lib/contacts/busca-remota.ts');
    expect(fonte.match(/ramoContem\(/g)?.length).toBe(4);
    expect(fonte).not.toMatch(/ilike/);
  });

  it('o tl;dv: título por imatch literal e e-mail igual por imatch ancorado', () => {
    expect(ler('src/hooks/use-reunioes-transcritas.ts')).toMatch(
      /regexIMatch\('titulo', literalParaRegex\(termo\)\)/,
    );
    const tldv = ler('src/lib/tldv/sincronizar.ts');
    expect(tldv).toContain('entreAspasDoPostgrest(`^${literalParaRegex(email)}$`)');
    expect(tldv).not.toMatch(/ilike/);
  });
});
