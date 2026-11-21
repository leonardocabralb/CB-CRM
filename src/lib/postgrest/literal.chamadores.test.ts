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
  it('a tela de Contatos: `.or()` pela busca da tabela e o termo da RPC com escaparLike', () => {
    // Porte #679 (17/11/2026): a tela deixou de montar `name/phone/email`
    // à mão — o telefone cru não achava "(83) 98000-0016" — e passou a
    // `ramosDaBuscaNaTabela` (todo ramo por `ramoContem`, pinado abaixo). A
    // RPC recebe os DÍGITOS quando o termo tem cara de telefone, sempre pelo
    // escape do LIKE.
    const fonte = ler('src/app/(dashboard)/contacts/page.tsx');
    expect(fonte).toMatch(/ramosDaBuscaNaTabela\(term\)/);
    expect(fonte).toMatch(
      /p_search:\s*term\s*\?\s*escaparLike\(temCaraDeTelefone\(term\) \? term\.replace\(\/\\D\/g, ''\) : term\)\s*:\s*null/,
    );
    expect(fonte).not.toMatch(/ilike\.\$\{/);
    expect(fonte).not.toMatch(/\.or\(\s*\[/);
  });

  it('a API v1: `.or()` por ramoContem, sem o filtro que apagava caracteres', () => {
    const fonte = ler('src/app/api/v1/contacts/route.ts');
    expect(fonte).toMatch(/ramoContem\('name', search\)/);
    expect(fonte).toMatch(/ramoContem\('phone', search\)/);
    expect(fonte).not.toMatch(/ilike\.\*\$\{/);
    expect(fonte).not.toMatch(/sanitizeSearch/);
  });

  it('os seletores de cliente e a tabela de Contatos: todo ramo por ramoContem', () => {
    // 26/09/2026: os quatro ramos dos seletores (nome, os dois `@`,
    // telefone). 17/11/2026 (porte #679): a busca da tabela reusa as peças e
    // soma nome e e-mail — seis no total. Ramo novo escrito de outro jeito
    // muda a conta e reprova aqui.
    const fonte = ler('src/lib/contacts/busca-remota.ts');
    expect(fonte.match(/ramoContem\(/g)?.length).toBe(6);
    expect(fonte).toMatch(/ramoContem\('email', limpo\)/);
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
