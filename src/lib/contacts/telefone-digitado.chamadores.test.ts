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

// Fase 3-III: as portas por onde um INTEGRADOR (API v1), o operador ("Nova
// conversa") ou um formulário (webhook de entrada) mandam um telefone. Antes, as três da API e a da "Nova
// conversa" apagavam o que não era dígito (`sanitizePhoneForMeta`) — e
// "(81) 98874-5316" virava a ficha +81 —, e o disparo exigia o `+` do
// original. Cada uma lê o texto pela régua, e nenhuma volta ao atalho.
// A chamada e, nas cinco do servidor, de onde saem os dígitos GRAVADOS — a
// chamada sozinha não prova nada se os dígitos vierem de outro lugar.
const PORTAS: Record<string, string[]> = {
  'lib/api/v1/contacts.ts': ['telefoneDigitado(input.phone)', 'const sanitized = telefone.digitos;'],
  'lib/whatsapp/resolve-conversation.ts': ['telefoneDigitado(phone)', 'const sanitized = telefone.digitos;'],
  'lib/whatsapp/broadcast-core.ts': ['telefoneDigitado(to)', 'const sanitized = telefone.digitos;'],
  'app/api/cb/conversas/abrir/route.ts': ['telefoneDigitado(typeof telefone', 'const digitos = lido.digitos'],
  'components/inbox/nova-conversa-dialog.tsx': ['telefoneDigitado(telefone)'],
  // O webhook de ENTRADA (o Typebot: o lead DIGITA num formulário público que
  // não dá para mudar do lado de cá). Pedido do operador em 23/09/2026.
  'lib/webhooks-de-entrada/processar.ts': ['telefoneDigitado(cru)', 'const digitos = telefone.digitos;'],
};

// O atalho de antes, em todas as formas que ele tem no código: apagar o que
// não é dígito aceitava "…@lid" como telefone de ficha, e o `+` obrigatório
// do original recusava o jeito como o escritório escreve. `normalizePhone` é
// o mesmo `replace` com outro nome (Lente 2 da revisão: sem ele na lista, a
// rota da "Nova conversa" — que não tem teste de comportamento — voltava ao
// defeito sem nada reprovar).
const ATALHOS = [
  // A régua dos SISTEMAS (Calendly, Asaas): aceita 8 e 9 dígitos sem DDD e
  // apaga letra — num telefone que alguém digitou, é a ficha +98 e o LID.
  // O NOME, não a chamada: importado com apelido (`as lerDigitos`), a forma
  // com parênteses passava (Lente 2 da revisão do webhook, medido).
  'digitosDoTelefone',
  'sanitizePhoneForMeta',
  'normalizePhone',
  'isValidE164',
  'parseInternationalPhone',
  'replace(/\\D/g',
];

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

  for (const [arquivo, trechos] of Object.entries(PORTAS)) {
    it(`${arquivo} lê o telefone recebido pela régua`, () => {
      const src = fonte(arquivo);
      for (const trecho of trechos) expect(src).toContain(trecho);
      for (const atalho of ATALHOS) expect(src).not.toContain(atalho);
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
