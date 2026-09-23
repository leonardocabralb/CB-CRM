import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// O telefone que uma PESSOA digita passa pela NOSSA régua — travado
// estruturalmente (Fase 3-II do merge do upstream, 23/09/2026).
//
// O original resolveu o mesmo defeito (o #586: número sem código do país indo
// para outro país) EXIGINDO o `+` em todas estas telas, com a função
// `parseInternationalPhone`. Aqui a decisão é a oposta — o escritório digita
// "(81) 98874-5316" e o número ganha o 55 (`telefoneDigitado`) —, e um merge
// do original traz a versão dele para as MESMAS linhas: o formulário passaria
// a recusar o jeito como o escritório escreve, sem conflito nenhum no Git se
// o trecho não tiver sido tocado dos dois lados.
// ============================================================

const SRC = path.join(__dirname, '..', '..');

function fonte(rel: string): string {
  return fs
    .readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const TELAS: Record<string, string[]> = {
  // Uma chamada por tela: criação, edição e a ficha do Instagram decididas
  // no mesmo helper (testado em `telefone.test.ts`).
  'components/contacts/contact-form.tsx': ['escritaDoTelefone('],
  'components/contacts/contact-detail-view.tsx': ['escritaDoTelefone('],
  // As duas planilhas (importação de contatos e CSV do disparo) passam pelo
  // `dedupeByPhone`, que normaliza a linha e conta o inválido à parte.
  'lib/contacts/dedupe.ts': ['telefoneDigitado('],
};

describe('telefone digitado: a nossa régua, não o `+` obrigatório do original', () => {
  for (const [arquivo, chamadas] of Object.entries(TELAS)) {
    it(`${arquivo} passa o telefone digitado pela régua`, () => {
      const src = fonte(arquivo);
      for (const chamada of chamadas) expect(src).toContain(chamada);
      // Nas telas, UMA decisão — uma segunda cópia da regra divergiria.
      if (arquivo.startsWith('components/')) {
        expect(src.split('escritaDoTelefone(').length - 1).toBe(1);
      }
      expect(src).not.toContain('parseInternationalPhone');
    });
  }

  it('as duas planilhas usam o dedupe que normaliza, e ninguém traz a régua do original', () => {
    for (const arquivo of [
      'components/contacts/import-modal.tsx',
      'lib/broadcast-csv.ts',
      'components/broadcasts/step2-select-audience.tsx',
    ]) {
      expect(fonte(arquivo)).not.toContain('parseInternationalPhone');
    }
    expect(fonte('components/contacts/import-modal.tsx')).toContain('dedupeByPhone(');
    expect(fonte('lib/broadcast-csv.ts')).toContain('dedupeByPhone(');
  });

  it('o aviso de duplicata do formulário procura pelo número NORMALIZADO', () => {
    // Voltar para `phone.trim()` faria "81988745316" digitado sem o 55 achar
    // a ficha só pela tolerância dos 8 finais — aviso amarelo, não bloqueio.
    expect(fonte('components/contacts/contact-form.tsx')).toMatch(
      /const telefone = telefoneDigitado\(phone\);[\s\S]{0,200}const value = telefone\.digitos;/,
    );
  });
});
