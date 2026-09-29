import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pinos da 1066: `_bcast_bump` e `recompute_broadcast_counts` (SECURITY
// DEFINER, mexem nos contadores de `broadcasts`) só executam pelo
// service_role e por quem as chama rodando como dono. Abertas, qualquer
// pessoa com a chave anônima e o id de uma campanha mudava os números de uma
// campanha de qualquer conta.
//
// A conferência DENTRO da migration prova os privilégios no banco; este teste
// roda no job `verificar`, que é portão, e pega o que desfaz a 1066 SEM
// conflito:
//   - uma metade do REVOKE apagada, um GRANT acrescentado por engano, ou uma
//     migration posterior (inclusive uma do upstream) que recrie as funções —
//     DROP + CREATE devolve o EXECUTE a PUBLIC;
//   - ⚠️⚠️ a armadilha: a função do GATILHO que as chama recriada como
//     SECURITY INVOKER. Com o EXECUTE fechado, o papel efetivo dentro do
//     gatilho passaria a ser o de quem grava, e a rota do lote e o navegador
//     (que gravam `broadcast_recipients` como `authenticated`) levariam 42501
//     ao marcar o envio — com a mensagem já entregue. Medido num Postgres
//     descartável com as definições de produção.
//
// LIMITE DECLARADO: lê os `.sql`. Um GRANT ou um CREATE montado por
// `EXECUTE format(...)` dentro de um DO block é invisível aqui.
// ============================================================

const dir = __dirname;
const FUNCOES = [
  { nome: '_bcast_bump', args: 'uuid\\s*,\\s*text\\s*,\\s*integer' },
  { nome: 'recompute_broadcast_counts', args: 'uuid' },
] as const;
const CHAMA_OS_CONTADORES = /\b(_bcast_bump|recompute_broadcast_counts)\b/i;

/**
 * Quem pode chamar as duas. Chamador novo entra aqui por decisão visível no
 * diff — e, pelo teste abaixo, só se for SECURITY DEFINER.
 */
const CHAMADORES_PERMITIDOS = ['broadcast_recipient_aggregate_trigger'];

function semComentarios(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');
}

function ler(arquivo: string): string {
  return semComentarios(fs.readFileSync(path.join(dir, arquivo), 'utf8'));
}

/** Número da migration pelo prefixo do nome (`1066_...` → 1066). */
function numero(arquivo: string): number {
  return Number(arquivo.match(/^(\d+)_/)?.[1] ?? NaN);
}

const migrations = fs
  .readdirSync(dir)
  .filter((a) => a.endsWith('.sql') && Number.isFinite(numero(a)))
  .sort((a, b) => numero(a) - numero(b));

const sql = ler('1066_cb_contadores_do_disparo_so_pelo_servidor.sql');

/**
 * Recorta cada `CREATE [OR REPLACE] FUNCTION` até o `;` depois do corpo
 * entre `$tag$` — os atributos (SECURITY DEFINER, LANGUAGE) vêm antes do
 * corpo na forma do `pg_get_functiondef` e depois dele na da 0005.
 */
function definicoesDeFuncao(texto: string): { nome: string; trecho: string }[] {
  const saida: { nome: string; trecho: string }[] = [];
  const cabecalho = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
  for (const m of texto.matchAll(cabecalho)) {
    const inicio = m.index ?? 0;
    const abre = /\$([A-Za-z_]*)\$/g;
    abre.lastIndex = inicio;
    const tag = abre.exec(texto);
    let fim = texto.indexOf(';', inicio);
    if (tag) {
      const fechaCorpo = texto.indexOf(tag[0], tag.index + tag[0].length);
      fim = texto.indexOf(';', fechaCorpo === -1 ? tag.index : fechaCorpo + tag[0].length);
    }
    saida.push({ nome: m[1].toLowerCase(), trecho: texto.slice(inicio, fim === -1 ? texto.length : fim + 1) });
  }
  return saida;
}

describe('1066 — contadores do disparo só pelo servidor', () => {
  for (const { nome, args } of FUNCOES) {
    const f = `(?:public\\.)?${nome}\\s*\\(\\s*${args}\\s*\\)`;

    it(`${nome}: revoga as DUAS metades (PUBLIC e os papéis) na mesma instrução`, () => {
      expect(
        new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${f}\\s+FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated\\s*;`, 'i').test(sql)
      ).toBe(true);
    });

    it(`${nome}: devolve o EXECUTE ao service_role por escrito (banco novo não herda)`, () => {
      expect(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${f}\\s+TO\\s+service_role\\s*;`, 'i').test(sql)).toBe(true);
    });

    it(`${nome}: não concede nada a anon, authenticated nem PUBLIC`, () => {
      expect(
        new RegExp(`GRANT[^;]*ON\\s+FUNCTION\\s+${f}[^;]*\\b(anon|authenticated|public)\\b`, 'i').test(sql)
      ).toBe(false);
    });

    it(`${nome}: não é recriada (o corpo é o da 0005; recriar devolveria o EXECUTE a PUBLIC)`, () => {
      expect(new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${nome}\\b`, 'i').test(sql)).toBe(false);
    });
  }

  it('a conferência confere os três papéis, troca de papel e exige chamador SECURITY DEFINER', () => {
    for (const papel of ['anon', 'authenticated', 'service_role']) {
      expect(sql).toMatch(new RegExp(`has_function_privilege\\('${papel}'`));
    }
    expect(sql).toMatch(/ARRAY\['anon',\s*'authenticated'\]/);
    expect(sql).toMatch(/SET\s+LOCAL\s+ROLE\s+%I/i);
    expect(sql).toMatch(/SET\s+LOCAL\s+ROLE\s+service_role/i);
    expect(sql).toMatch(/WHEN\s+insufficient_privilege/i);
    // A armadilha: quem chama as duas tem de ser DEFINER, com dono que execute.
    expect(sql).toMatch(/p\.prosecdef/);
    expect(sql).toMatch(/has_function_privilege\(p\.proowner/);
  });

  it('volta ao papel de quem aplica com SET LOCAL, nunca RESET ROLE (que vale depois do commit)', () => {
    expect(sql).not.toMatch(/\bRESET\s+ROLE\b/i);
  });
});

describe('quem chama os contadores roda como dono (SECURITY DEFINER)', () => {
  // A definição VIGENTE de cada função é a da última migration que a cria.
  const vigentes = new Map<string, { arquivo: string; trecho: string }>();
  for (const arquivo of migrations) {
    for (const d of definicoesDeFuncao(ler(arquivo))) {
      vigentes.set(d.nome, { arquivo, trecho: d.trecho });
    }
  }
  const nomesDasDuas = new Set<string>(FUNCOES.map((f) => f.nome));
  const chamadores = [...vigentes.entries()]
    .filter(([nome, d]) => !nomesDasDuas.has(nome) && CHAMA_OS_CONTADORES.test(d.trecho))
    .map(([nome]) => nome)
    .sort();

  it('o recorte acha as definições (se isto falhar, os pinos abaixo não provam nada)', () => {
    for (const nome of ['_bcast_bump', 'recompute_broadcast_counts', ...CHAMADORES_PERMITIDOS]) {
      expect(vigentes.has(nome), `${nome} não foi achada em nenhuma migration`).toBe(true);
    }
  });

  it('só os chamadores permitidos chamam as duas', () => {
    expect(chamadores).toEqual([...CHAMADORES_PERMITIDOS].sort());
  });

  it.each(CHAMADORES_PERMITIDOS)('%s: a definição vigente é SECURITY DEFINER', (nome) => {
    const d = vigentes.get(nome);
    expect(d, `${nome} não foi encontrada nas migrations`).toBeDefined();
    expect(
      /\bSECURITY\s+DEFINER\b/i.test(d!.trecho) && !/\bSECURITY\s+INVOKER\b/i.test(d!.trecho),
      `${nome} (vigente em ${d!.arquivo}) não é SECURITY DEFINER: com a 1066, quem grava como authenticated leva 42501`
    ).toBe(true);
  });

  it.each(CHAMADORES_PERMITIDOS)('%s: nenhuma migration a altera para SECURITY INVOKER', (nome) => {
    for (const arquivo of migrations) {
      expect(
        new RegExp(`ALTER\\s+FUNCTION\\s+(public\\.)?${nome}\\b[^;]*SECURITY\\s+INVOKER`, 'i').test(ler(arquivo)),
        `${arquivo} deixa ${nome} SECURITY INVOKER`
      ).toBe(false);
    }
  });
});

describe('nenhuma migration POSTERIOR à 1066 reabre as funções', () => {
  const posteriores = migrations.filter((a) => numero(a) > 1066);

  it.each(posteriores.length ? posteriores : ['(nenhuma ainda)'])('%s', (arquivo) => {
    if (arquivo === '(nenhuma ainda)') return;
    const texto = ler(arquivo);
    for (const { nome } of FUNCOES) {
      if (!new RegExp(`\\b${nome}\\b`, 'i').test(texto)) continue;

      // GRANT a quem não é o servidor reabre o buraco.
      expect(
        new RegExp(`GRANT[^;]*ON\\s+FUNCTION\\s+(public\\.)?${nome}[^;]*\\b(anon|authenticated|public)\\b`, 'i').test(texto),
        `${arquivo} concede EXECUTE de ${nome} a anon/authenticated/PUBLIC`
      ).toBe(false);

      // Recriar (DROP + CREATE, ou CREATE numa assinatura nova) devolve o
      // EXECUTE a PUBLIC: quem recria, fecha de novo — as duas metades.
      const recria = new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?${nome}\\b`, 'i').test(texto);
      if (recria) {
        expect(
          new RegExp(`REVOKE\\s+(EXECUTE|ALL)[^;]*ON\\s+FUNCTION\\s+(public\\.)?${nome}[^;]*FROM\\s+PUBLIC\\s*,\\s*anon\\s*,\\s*authenticated`, 'i').test(texto),
          `${arquivo} recria ${nome} sem revogar de PUBLIC, anon e authenticated`
        ).toBe(true);
      }
    }
  });
});
