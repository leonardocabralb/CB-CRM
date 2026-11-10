import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

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
// ou é INSERT (a anotação nasce viva), ou leva `apagada_em` na mesma
// instrução, ou está nesta lista com o MOTIVO e a contagem exata. Leitor
// novo reprova até decidir. E o DELETE de verdade é só do vencimento.
// ============================================================

const RAIZ = join(__dirname, '..', '..', '..');

/** Arquivo → quantas consultas SEM o filtro, e por quê. */
const EXCECOES: Record<string, { quantas: number; motivo: string }> = {
  'src/hooks/use-conversation-notes.ts': {
    quantas: 1,
    motivo:
      'Lê vivas E apagadas: devolve as duas listas (`notas` e `apagadas`, a lixeira da aba) derivadas por `estaApagada`.',
  },
  'src/hooks/use-notas-dos-avisos.ts': {
    quantas: 1,
    motivo: 'A marca é a pergunta: o aviso diz "Anotação apagada" pela linha marcada.',
  },
  'src/lib/notes/lixeira-no-servidor.ts': {
    quantas: 1,
    motivo:
      'Apagar e restaurar leem a linha nos dois estados (o UPDATE, esse sim, é cercado por `apagada_em`).',
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
  trecho: string;
}

function consultas(): Consulta[] {
  const achadas: Consulta[] = [];
  for (const caminho of arquivos(join(RAIZ, 'src'))) {
    const fonte = readFileSync(caminho, 'utf8');
    const re = /\.from\(\s*['"]cb_conversation_notes['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fonte))) {
      const fim = fonte.indexOf(';', m.index);
      achadas.push({
        arquivo: relative(RAIZ, caminho).split('\\').join('/'),
        linha: fonte.slice(0, m.index).split('\n').length,
        trecho: fonte.slice(m.index, fim < 0 ? m.index + 1500 : fim),
      });
    }
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
      if (/\.insert\(/.test(c.trecho) || /apagada_em/.test(c.trecho)) continue;
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
      .filter((c) => /\.delete\(/.test(c.trecho))
      .map((c) => c.arquivo);
    expect([...new Set(quemApaga)]).toEqual([QUEM_APAGA_DE_VEZ]);
  });

  it('cada exceção diz o motivo', () => {
    for (const e of Object.values(EXCECOES)) expect(e.motivo.length).toBeGreaterThan(20);
  });
});
