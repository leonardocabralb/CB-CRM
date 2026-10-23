import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// ============================================================
// Quem DESENHA o texto da anotação desenha os anexos E a marca "editada" —
// DEFAULT-DENY (1102 e a Fase 3).
//
// Desde a 1102 a anotação pode ser SÓ de anexos (texto vazio). Uma tela que
// desenha o texto e esquece os anexos mostra a anotação em branco — um áudio
// para o colega que ninguém ouve, sem erro nenhum. E desde a Fase 3 ela se
// EDITA: a tela que esquece a `<MarcaDeEditada>` mostra o texto reescrito como
// se fosse o original (A4). Todo arquivo de `src/` que usa o tipo da anotação
// (`ConversationNote`) e LÊ um `.texto` monta `<AnexosDaNota>` (a anotação
// inteira) ou `<ResumoDosAnexos>` (onde ela aparece encolhida: a faixa da
// fixada e a citação), e a `<MarcaDeEditada>`. Arquivo novo assim reprova até
// montar os dois — ou entrar em SEM_ANEXOS com o motivo e as leituras EXATAS
// que ele faz (uma leitura nova no mesmo arquivo reprova).
//
// O detector lê a ÁRVORE do TypeScript, não o nome da variável: pega
// `n.texto`, `anotacao.texto`, `fixada.texto`, `nota!.texto`, `nota?.texto`,
// `nota['texto']` e a desestruturação (`{ texto } = nota`, `({ texto }) =>`).
// LIMITE DECLARADO: arquivo que recebe a anotação sem citar `ConversationNote`
// (um `Record<string, unknown>` cru, como o serializador da API v1) escapa.
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

/**
 * As leituras de `texto` no código, na forma em que aparecem (`nota.texto`,
 * `{ texto }`…). Comentário não conta: a árvore não os tem.
 */
function leiturasDoTexto(codigo: string, nome = 'x.tsx'): string[] {
  const arquivo = ts.createSourceFile(
    nome,
    codigo,
    ts.ScriptTarget.Latest,
    true,
    nome.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const achadas: string[] = [];
  const visitar = (no: ts.Node): void => {
    if (ts.isPropertyAccessExpression(no) && no.name.text === 'texto') {
      achadas.push(no.getText(arquivo));
    } else if (
      ts.isElementAccessExpression(no) &&
      ts.isStringLiteralLike(no.argumentExpression) &&
      no.argumentExpression.text === 'texto'
    ) {
      achadas.push(no.getText(arquivo));
    } else if (ts.isBindingElement(no) && ts.isObjectBindingPattern(no.parent)) {
      const chave = no.propertyName ?? no.name;
      if ((ts.isIdentifier(chave) || ts.isStringLiteralLike(chave)) && chave.text === 'texto') {
        achadas.push(`{ ${no.getText(arquivo)} }`);
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);
  return [...new Set(achadas)].sort();
}

function codigo(rel: string): string {
  return fs.readFileSync(path.join(raiz, rel), 'utf8');
}

/** Usa o tipo da anotação — fora de comentário. */
function usaANota(rel: string): boolean {
  const semComentarios = codigo(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  return /\bConversationNote\b/.test(semComentarios);
}

const DESENHA_OS_ANEXOS = /<(?:AnexosDaNota|ResumoDosAnexos)\b/;
const DESENHA_A_MARCA = /<MarcaDeEditada\b/;

/** Os cinco lugares do plano (docs/PLANO-anotacao-com-anexos-e-edicao.md). */
const CONHECIDOS = [
  'src/components/contacts/contact-detail-view.tsx',
  'src/components/inbox/cartao-de-nota.tsx',
  'src/components/inbox/citacao-da-nota.tsx',
  'src/components/inbox/nota-fixada-bar.tsx',
  'src/components/inbox/note-line.tsx',
];

/**
 * Usa o tipo da anotação e lê um `.texto` que NÃO é o dela — com o motivo e
 * as leituras exatas (outra leitura no mesmo arquivo reprova).
 */
const SEM_ANEXOS: Record<string, { motivo: string; leituras: string[] }> = {
  'src/components/inbox/internal-note-box.tsx': {
    motivo:
      'a caixa de ESCREVER: `r.texto` é o resultado da menção aplicada (aplicarMencao) e `emEdicao?.texto` o rascunho inicial da EDIÇÃO (os anexos atuais viram fichas removíveis, `mantidos`); a anotação respondida aparece pela CitacaoDaNota',
    leituras: ['emEdicao?.texto', 'r.texto'],
  },
  'src/components/inbox/message-composer.tsx': {
    motivo:
      'o compositor de MENSAGEM: `p.texto`/`pendente.texto` são a mensagem retida na janela de desfazer e `r.texto` a menção; a anotação é escrita no InternalNoteBox',
    leituras: ['p.texto', 'pendente.texto', 'r.texto'],
  },
  'src/components/inbox/message-thread.tsx': {
    motivo:
      '`cor.texto` é a classe de cor de uma faixa do fio; a anotação no fio é desenhada pela NoteLine',
    leituras: ['cor.texto'],
  },
};

describe('anotação: quem desenha o texto desenha os anexos e a marca "editada" (default-deny)', () => {
  const leem = ARQUIVOS.filter(
    (rel) => usaANota(rel) && leiturasDoTexto(codigo(rel), rel).length > 0
  ).sort();

  it('o detector acha os cinco lugares conhecidos', () => {
    for (const rel of CONHECIDOS) expect(leem, rel).toContain(rel);
  });

  it('todo arquivo que usa a anotação e lê `.texto` monta <AnexosDaNota> ou <ResumoDosAnexos>', () => {
    const fora = leem.filter(
      (rel) => !(rel in SEM_ANEXOS) && !DESENHA_OS_ANEXOS.test(codigo(rel))
    );
    expect(fora).toEqual([]);
  });

  it('todo arquivo que usa a anotação e lê `.texto` monta a <MarcaDeEditada> (Fase 3)', () => {
    const fora = leem.filter(
      (rel) => !(rel in SEM_ANEXOS) && !DESENHA_A_MARCA.test(codigo(rel))
    );
    expect(fora).toEqual([]);
    // Os cinco lugares, nomeados: renomear a peça num deles reprova aqui.
    for (const rel of CONHECIDOS) expect(codigo(rel), rel).toMatch(DESENHA_A_MARCA);
  });

  it('a exceção vale só para as leituras escritas nela', () => {
    for (const [rel, { motivo, leituras }] of Object.entries(SEM_ANEXOS)) {
      expect(motivo.trim(), rel).not.toBe('');
      expect(leem, `${rel} saiu do detector: tire da lista`).toContain(rel);
      expect(leiturasDoTexto(codigo(rel), rel), rel).toEqual([...leituras].sort());
    }
  });

  it('o fio e os cartões desenham os anexos INTEIROS; a faixa e a citação, o resumo', () => {
    for (const rel of [
      'src/components/inbox/note-line.tsx',
      'src/components/inbox/cartao-de-nota.tsx',
      'src/components/contacts/contact-detail-view.tsx',
    ]) {
      expect(codigo(rel), rel).toMatch(/<AnexosDaNota\b/);
    }
    for (const rel of [
      'src/components/inbox/nota-fixada-bar.tsx',
      'src/components/inbox/citacao-da-nota.tsx',
    ]) {
      expect(codigo(rel), rel).toMatch(/<ResumoDosAnexos\b/);
    }
  });

  it('o detector enxerga as formas que interessam (senão o default-deny não prova nada)', () => {
    const casos: [string, string[]][] = [
      ['<TextoComLinks texto={nota.texto} />', ['nota.texto']],
      ['const a = n.texto;', ['n.texto']],
      ['f(anotacao.texto, fixada.texto)', ['anotacao.texto', 'fixada.texto']],
      ['g(nota!.texto)', ['nota!.texto']],
      ['g(nota?.texto)', ['nota?.texto']],
      ["g(nota['texto'])", ["nota['texto']"]],
      ['const { texto } = nota;', ['{ texto }']],
      ['const { id, texto: corpo } = nota;', ['{ texto: corpo }']],
      ['const X = ({ texto }: ConversationNote) => texto;', ['{ texto }']],
      ['lista.map(({ id, texto }) => id + texto)', ['{ texto }']],
    ];
    for (const [trecho, esperado] of casos) {
      expect(leiturasDoTexto(trecho), trecho).toEqual(esperado);
    }
    // O que NÃO é leitura do texto de alguém.
    for (const trecho of [
      'fetch(u, { body: JSON.stringify({ texto: limpo }) })',
      'interface N { texto: string }',
      'const [texto, setTexto] = useState("");',
      '// nota.texto num comentário',
      'const s = "nota.texto";',
    ]) {
      expect(leiturasDoTexto(trecho), trecho).toEqual([]);
    }
    expect(usaANota('src/types/index.ts')).toBe(true);
  });
});
