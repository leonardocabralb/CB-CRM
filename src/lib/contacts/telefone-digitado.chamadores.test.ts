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

// Fase 3-III: as portas por onde um INTEGRADOR (API v1) ou o operador
// ("Nova conversa") mandam um telefone. Antes, as três da API e a da "Nova
// conversa" apagavam o que não era dígito (`sanitizePhoneForMeta`) — e
// "(81) 98874-5316" virava a ficha +81 —, e o disparo exigia o `+` do
// original. Cada uma lê o texto pela régua, e nenhuma volta ao atalho.
const PORTAS: Record<string, string> = {
  'lib/api/v1/contacts.ts': 'telefoneDigitado(input.phone)',
  'lib/whatsapp/resolve-conversation.ts': 'telefoneDigitado(phone)',
  'lib/whatsapp/broadcast-core.ts': 'telefoneDigitado(to)',
  'app/api/cb/conversas/abrir/route.ts': 'telefoneDigitado(typeof telefone',
  'components/inbox/nova-conversa-dialog.tsx': 'telefoneDigitado(telefone)',
};

function arquivosDe(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivosDe(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

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

  for (const [arquivo, chamada] of Object.entries(PORTAS)) {
    it(`${arquivo} lê o telefone recebido pela régua`, () => {
      const src = fonte(arquivo);
      expect(src).toContain(chamada);
      // O atalho de antes (apagar o que não é dígito) aceitava "…@lid" e
      // "…@g.us" como telefone de ficha, e o `+` obrigatório do original
      // recusava o jeito como o escritório escreve.
      expect(src).not.toContain('sanitizePhoneForMeta');
      expect(src).not.toContain('isValidE164');
      expect(src).not.toContain('parseInternationalPhone');
    });
  }

  it('o disparo manda o texto CRU para o find-or-create, nunca os dígitos já lidos', () => {
    // `findOrCreateContact` passa o telefone pela régua DE NOVO: os dígitos de
    // "+41 55 555 12 12" relidos sem o `+` ganhariam o 55.
    expect(fonte('lib/whatsapp/broadcast-core.ts')).toMatch(
      /findOrCreateContact\(db, accountId, auditUserId, \{\s*phone: to,\s*\}\)/,
    );
  });

  it('a régua do original (`+` obrigatório) não existe em lugar nenhum de src/', () => {
    // Removida na 3-III: sem chamador, ela era convite a reintroduzir o `+`
    // obrigatório numa porta nova. Um merge do original que a traga de volta
    // reprova aqui.
    const achados = arquivosDe(SRC)
      .filter((p) => !p.endsWith('telefone-digitado.chamadores.test.ts'))
      .filter((p) => fonte(path.relative(SRC, p)).includes('parseInternationalPhone'))
      .map((p) => path.relative(SRC, p));
    expect(achados).toEqual([]);
  });

  it('o aviso de duplicata do formulário procura pelo número NORMALIZADO', () => {
    // Voltar para `phone.trim()` faria "81988745316" digitado sem o 55 achar
    // a ficha só pela tolerância dos 8 finais — aviso amarelo, não bloqueio.
    expect(fonte('components/contacts/contact-form.tsx')).toMatch(
      /const telefone = telefoneDigitado\(phone\);[\s\S]{0,200}const value = telefone\.digitos;/,
    );
  });
});
