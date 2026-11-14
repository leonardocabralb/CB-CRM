import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// ============================================================
// Lixeira de anotações (1132): todo leitor de anotação filtra as APAGADAS
//
// Apagar MARCA a linha (`apagada_em`) em vez de apagá-la. A linha continua na
// tabela por 90 dias — e uma consulta que a esquecesse mostraria a anotação
// apagada no fio, na aba, na ficha, na API, ou a deixaria ser respondida,
// fixada e editada. Sem erro nenhum: a linha é válida.
//
// DEFAULT-DENY: cada `.from('cb_conversation_notes')` do app (fora de teste)
// ou é INSERT (a anotação nasce viva), ou FILTRA por `apagada_em` na mesma
// cadeia, ou está nesta lista com o MOTIVO e a contagem exata. Leitor novo
// reprova até decidir. E o DELETE de verdade é só do vencimento.
//
// ⚠️ A cadeia é lida pela ÁRVORE do TypeScript, elo por elo, nunca pelo texto
// até o próximo `;`: num arquivo sem ponto e vírgula o trecho corria linhas
// abaixo e um COMENTÁRIO com `apagada_em` bastava para passar. E só conta
// FILTRO (`.is`, `.not`, `.filter`, `.or`…) — um `.select('…, apagada_em')`
// lê a coluna, não recorta.
// ============================================================

const RAIZ = join(__dirname, '..', '..', '..');

/** Arquivo → quantas consultas SEM o filtro, e por quê. */
const EXCECOES: Record<string, { quantas: number; motivo: string }> = {
  'src/hooks/use-notas-dos-avisos.ts': {
    quantas: 1,
    motivo: 'A marca é a pergunta: o aviso diz "Anotação apagada" pela linha marcada.',
  },
  'src/lib/notes/lixeira-no-servidor.ts': {
    quantas: 2,
    motivo:
      'Apagar e restaurar leem a linha nos dois estados; o UPDATE é montado em duas partes (`base`), e a cerca por `apagada_em` (`.is` ao apagar, `.not` ao restaurar) vem na instrução seguinte.',
  },
  'src/app/api/cb/notes/[id]/route.ts': {
    quantas: 2,
    motivo:
      'O PATCH desafixa a anterior do cliente (a apagada nunca está fixada: CHECK da 1132); o `porQueNaoVeio` do PUT relê sem cerca e trata a apagada como NOTE_GONE.',
  },
  'src/app/api/cb/notes/route.ts': {
    quantas: 1,
    motivo:
      'Quem avisar da resposta sobe pela ESTRUTURA do fio de respostas: a apagada no meio continua ligando as pontas.',
  },
};

/** O único arquivo que apaga anotação DE VERDADE. */
const QUEM_APAGA_DE_VEZ = 'src/lib/notes/vencer-lixeira-de-anotacoes.ts';

function arquivos(dir: string, saida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) arquivos(p, saida);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) saida.push(p);
  }
  return saida;
}

interface Consulta {
  arquivo: string;
  linha: number;
  /** Os métodos da cadeia, na ordem, depois do `.from(...)`. */
  metodos: string[];
  /** Algum elo FILTRA por `apagada_em`. */
  filtraApagadas: boolean;
}

const FILTROS = new Set(['is', 'not', 'eq', 'neq', 'filter', 'or']);

function ehFromDasNotas(no: ts.Node): no is ts.CallExpression {
  return (
    ts.isCallExpression(no) &&
    ts.isPropertyAccessExpression(no.expression) &&
    no.expression.name.text === 'from' &&
    no.arguments.length === 1 &&
    ts.isStringLiteralLike(no.arguments[0]) &&
    no.arguments[0].text === 'cb_conversation_notes'
  );
}

/** Cada `.from('cb_conversation_notes')` da fonte, com a cadeia que sobe dele. */
function consultasNaFonte(arquivo: string, fonte: string): Consulta[] {
  const achadas: Consulta[] = [];
  const raiz = ts.createSourceFile(
    arquivo,
    fonte,
    ts.ScriptTarget.Latest,
    true,
    arquivo.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const visitar = (no: ts.Node): void => {
    if (ehFromDasNotas(no)) {
      const metodos: string[] = [];
      let filtraApagadas = false;
      // Cada elo é `<anterior>.metodo(...)`: o pai é o acesso, o avô a chamada.
      let atual: ts.Node = no;
      while (
        ts.isPropertyAccessExpression(atual.parent) &&
        atual.parent.expression === atual &&
        ts.isCallExpression(atual.parent.parent) &&
        atual.parent.parent.expression === atual.parent
      ) {
        const nome = atual.parent.name.text;
        const primeiro = atual.parent.parent.arguments[0];
        metodos.push(nome);
        if (
          FILTROS.has(nome) &&
          primeiro &&
          ts.isStringLiteralLike(primeiro) &&
          /\bapagada_em\b/.test(primeiro.text)
        ) {
          filtraApagadas = true;
        }
        atual = atual.parent.parent;
      }
      achadas.push({
        arquivo,
        linha: raiz.getLineAndCharacterOfPosition(no.getStart(raiz)).line + 1,
        metodos,
        filtraApagadas,
      });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(raiz);
  return achadas;
}

function consultas(): Consulta[] {
  const achadas: Consulta[] = [];
  for (const caminho of arquivos(join(RAIZ, 'src'))) {
    const fonte = readFileSync(caminho, 'utf8');
    if (!fonte.includes('cb_conversation_notes')) continue;
    achadas.push(
      ...consultasNaFonte(relative(RAIZ, caminho).split('\\').join('/'), fonte)
    );
  }
  return achadas;
}

describe('lixeira de anotações (1132): quem lê anotação filtra as apagadas', () => {
  const todas = consultas();

  it('acha as consultas (o varredor não ficou cego)', () => {
    expect(todas.length).toBeGreaterThan(10);
  });

  it('cada consulta sem `apagada_em` é INSERT ou está na lista, com a contagem exata', () => {
    const semFiltro = new Map<string, number[]>();
    for (const c of todas) {
      if (c.metodos.includes('insert') || c.filtraApagadas) continue;
      semFiltro.set(c.arquivo, [...(semFiltro.get(c.arquivo) ?? []), c.linha]);
    }
    const achado = Object.fromEntries(
      [...semFiltro].map(([arquivo, linhas]) => [arquivo, linhas.length])
    );
    const esperado = Object.fromEntries(
      Object.entries(EXCECOES).map(([arquivo, e]) => [arquivo, e.quantas])
    );
    expect(achado).toEqual(esperado);
  });

  it('só o vencimento apaga de VERDADE (o resto marca, pela rota)', () => {
    const quemApaga = todas
      .filter((c) => c.metodos.includes('delete'))
      .map((c) => c.arquivo);
    expect([...new Set(quemApaga)]).toEqual([QUEM_APAGA_DE_VEZ]);
  });

  it('o varredor lê a CADEIA: comentário e coluna no select não contam como filtro', () => {
    const fonte = [
      "const { data } = await db",
      "  .from('cb_conversation_notes')",
      "  // sem o filtro de apagada_em, de propósito",
      "  .select('id, apagada_em')",
      "  .eq('conversation_id', id)",
      "const outra = db.from('cb_conversation_notes').select('*').is('apagada_em', null)",
    ].join('\n');
    const [sem, com] = consultasNaFonte('x.ts', fonte);
    expect(sem).toMatchObject({ metodos: ['select', 'eq'], filtraApagadas: false });
    expect(com).toMatchObject({ metodos: ['select', 'is'], filtraApagadas: true });
  });

  it('cada exceção diz o motivo', () => {
    for (const e of Object.values(EXCECOES)) expect(e.motivo.length).toBeGreaterThan(20);
  });
});
