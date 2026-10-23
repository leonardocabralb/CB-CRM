import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================
// Quem DESENHA o texto da anotação desenha os anexos — DEFAULT-DENY (1102).
//
// Desde a 1102 a anotação pode ser SÓ de anexos (texto vazio). Uma tela que
// desenha `nota.texto` e esquece os anexos mostra a anotação em branco — um
// áudio para o colega que ninguém ouve, sem erro nenhum. Todo arquivo de
// `src/` que lê o texto de uma anotação (`nota.texto`, `note.texto`,
// `original.texto`) monta também `<AnexosDaNota>` (a anotação inteira) ou
// `<ResumoDosAnexos>` (onde ela aparece encolhida: a faixa da fixada e a
// citação). Arquivo novo assim reprova até montar um dos dois — ou entrar em
// SEM_ANEXOS, com o motivo.
//
// LIMITE DECLARADO: segue os nomes de variável com que as telas recebem a
// anotação. Por isso os CINCO lugares conhecidos precisam continuar sendo
// achados — renomear a variável num deles tira o arquivo do pino, e o teste
// "acha os cinco" reprova.
// ============================================================

const raiz = path.join(__dirname, '..', '..', '..');

const ARQUIVOS: string[] = [];
(function varrer(dir: string) {
  for (const e of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) varrer(rel);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) ARQUIVOS.push(rel);
  }
})('src');

/** Fonte sem comentários (eles citam o texto da anotação ao explicar). */
function fonte(rel: string): string {
  return fs
    .readFileSync(path.join(raiz, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const LE_O_TEXTO = /\b(?:nota|note|original)\??\.texto\b/;
const DESENHA_OS_ANEXOS = /<(?:AnexosDaNota|ResumoDosAnexos)\b/;

/** Os cinco lugares do plano (docs/PLANO-anotacao-com-anexos-e-edicao.md). */
const CONHECIDOS = [
  'src/components/contacts/contact-detail-view.tsx',
  'src/components/inbox/cartao-de-nota.tsx',
  'src/components/inbox/citacao-da-nota.tsx',
  'src/components/inbox/nota-fixada-bar.tsx',
  'src/components/inbox/note-line.tsx',
];

/** Lê o texto e, de propósito, não desenha anexo — com o motivo. */
const SEM_ANEXOS: Record<string, string> = {};

describe('anexos da anotação: quem desenha o texto desenha os anexos (default-deny)', () => {
  const leem = ARQUIVOS.filter((rel) => LE_O_TEXTO.test(fonte(rel))).sort();

  it('o detector acha os cinco lugares conhecidos', () => {
    for (const rel of CONHECIDOS) expect(leem, rel).toContain(rel);
  });

  it('todo arquivo que lê o texto da anotação monta <AnexosDaNota> ou <ResumoDosAnexos>', () => {
    const fora = leem.filter(
      (rel) => !(rel in SEM_ANEXOS) && !DESENHA_OS_ANEXOS.test(fonte(rel))
    );
    expect(fora).toEqual([]);
  });

  it('a lista de exceções não guarda arquivo morto', () => {
    for (const rel of Object.keys(SEM_ANEXOS)) expect(leem, rel).toContain(rel);
  });

  it('o fio e os cartões desenham os anexos INTEIROS; a faixa e a citação, o resumo', () => {
    for (const rel of [
      'src/components/inbox/note-line.tsx',
      'src/components/inbox/cartao-de-nota.tsx',
      'src/components/contacts/contact-detail-view.tsx',
    ]) {
      expect(fonte(rel), rel).toMatch(/<AnexosDaNota\b/);
    }
    for (const rel of [
      'src/components/inbox/nota-fixada-bar.tsx',
      'src/components/inbox/citacao-da-nota.tsx',
    ]) {
      expect(fonte(rel), rel).toMatch(/<ResumoDosAnexos\b/);
    }
  });

  it('o detector enxerga as formas que interessam', () => {
    expect(LE_O_TEXTO.test('<TextoComLinks texto={nota.texto} />')).toBe(true);
    expect(LE_O_TEXTO.test('{original.texto}')).toBe(true);
    expect(LE_O_TEXTO.test('note?.texto')).toBe(true);
    expect(LE_O_TEXTO.test('setTexto(r.texto)')).toBe(false);
    expect(LE_O_TEXTO.test('p.texto')).toBe(false);
  });
});
