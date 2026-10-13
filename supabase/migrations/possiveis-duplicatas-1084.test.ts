import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1084 + 1086 + 1087 — possível duplicata: a mesma pessoa em duas fichas.
//
// O que este pino segura:
// - a RPC é SECURITY INVOKER: a RLS de `contacts` é a cerca (um DEFINER
//   enxergaria a base de todas as contas);
// - os TRÊS sinais, com os números que a medição de 13/10/2026 escolheu
//   (docs/PLANO-fichas-duplicadas.md): 2 min, lote de 10, e-mail em até 3
//   fichas. Mudar um deles sem medir de novo enche a tela de alarme falso;
// - nome SOZINHO nunca é sinal: o primeiro nome só é conferido nas
//   candidatas que o telefone ou o horário trouxeram;
// - SEM VARRER A CONTA (1086): as candidatas saem por índice, atrás de CTE
//   `MATERIALIZED`, e o telefone vizinho é procurado por IGUALDADE
//   (`unnest`) — a 1084, com o nome numa junção e `= ANY (lista)`, levava
//   289 ms em produção;
// - a ficha que nasceu num LOTE não busca candidatas pelo horário (1087): a
//   ficha conta as fichas em volta DELA (±1 min, parando na 11ª) e, com mais
//   de 10, nenhum par passaria — a 1086 trazia o lote inteiro (3,9 mil fichas
//   em produção) para concluir isso, a 177 ms por ficha;
// - o par descartado e o par já ligado em Relacionados saem do aviso;
// - decidir é de ADMIN, com a autoria de quem grava; ler é de qualquer
//   membro, na forma da 1032; a decisão não se edita;
// - nada para `anon`, e quem chama a RPC (INVOKER) chama as auxiliares.
// O corpo da RPC é lido da ÚLTIMA migration que a define: quem a redefinir
// de novo atualiza este pino. Os cenários (lote, e-mail de reserva, 9 a
// mais, invertidos, outra conta, suspenso) e o tempo com 6 mil fichas foram
// provados num Postgres 16 descartável — ver o plano.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const semComentarios = (texto: string) =>
  texto
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

const sql1084 = fs.readFileSync(path.join(__dirname, '1084_cb_possiveis_duplicatas.sql'), 'utf8');
const base = semComentarios(sql1084);

/** As migrations que (re)definem a RPC, em ordem de nome (a ordem do replay). */
const definicoes = fs
  .readdirSync(__dirname)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .filter((f) =>
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cb_possiveis_duplicatas\b/i.test(
      semComentarios(fs.readFileSync(path.join(__dirname, f), 'utf8')),
    ),
  );
const ultima = definicoes[definicoes.length - 1];

const TABELA = 'cb_duplicatas_descartadas';

/** O corpo da RPC na ÚLTIMA definição, do CREATE até o `$$` que fecha. */
function corpoDaRpc(): string {
  const texto = semComentarios(fs.readFileSync(path.join(__dirname, ultima), 'utf8'));
  const inicio = texto.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cb_possiveis_duplicatas\b/i);
  expect(inicio).toBeGreaterThanOrEqual(0);
  const resto = texto.slice(inicio);
  const abre = resto.indexOf('$$');
  const fecha = resto.indexOf('$$', abre + 2);
  return resto.slice(0, fecha);
}

/** O corpo de uma CTE do corpo da RPC: de `<nome> AS [MATERIALIZED] (` até o parêntese que fecha. */
function cte(nome: string): string {
  const corpo = corpoDaRpc();
  const m = new RegExp(`\\b${nome}\\s+AS\\s+(?:MATERIALIZED\\s+)?\\(`, 'i').exec(corpo);
  expect(m, `CTE ${nome}`).not.toBeNull();
  let nivel = 0;
  const inicio = m!.index + m![0].length - 1;
  for (let i = inicio; i < corpo.length; i++) {
    if (corpo[i] === '(') nivel++;
    else if (corpo[i] === ')' && --nivel === 0) return corpo.slice(inicio, i + 1);
  }
  throw new Error(`CTE ${nome} sem fim`);
}

describe('1084 + 1086 + 1087 — possível duplicata', () => {
  it('a última definição da RPC é a da 1087 (redefiniu? atualize este pino)', () => {
    expect(definicoes).toEqual([
      '1084_cb_possiveis_duplicatas.sql',
      '1086_cb_duplicatas_sem_varredura.sql',
      '1087_cb_duplicatas_fora_do_lote.sql',
    ]);
  });

  it('trava antes de criar e liga a RLS da tabela das decisões', () => {
    const trava = base.search(/SET\s+LOCAL\s+lock_timeout/i);
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(trava).toBeLessThan(base.search(/CREATE\s+TABLE/i));
    expect(
      new RegExp(`ALTER\\s+TABLE\\s+public\\.${TABELA}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(base),
    ).toBe(true);
  });

  it('a RPC roda como quem chama (INVOKER), nunca como dona', () => {
    const cabecalho = corpoDaRpc().split('$$')[0];
    expect(cabecalho).toMatch(/SECURITY\s+INVOKER/i);
    expect(cabecalho).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(cabecalho).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it('os três sinais, com os números da medição', () => {
    // 1) mesmo e-mail, aparado e minúsculo, em até 3 fichas
    const email = cte('por_email');
    expect(email).toMatch(/lower\(btrim\(o\.email\)\)\s*=\s*eu\.email/i);
    expect(email).toMatch(/lower\(btrim\(x\.email\)\)\s*=\s*eu\.email\)\s*<=\s*3/i);
    // 2) telefone a um dígito de distância: os vizinhos calculados uma vez, na ficha
    expect(cte('eu')).toMatch(/public\.cb_vizinhos_do_telefone\(nullif\(c\.telefone_canonico,\s*''\)\)\s+AS\s+vizinhos/i);
    // 3) até 2 min (a janela calculada na ficha), fora de lote de mais de 10 fichas
    expect(cte('eu')).toMatch(/c\.created_at\s*-\s*interval\s+'2 minutes'\s+AS\s+janela_de/i);
    expect(cte('eu')).toMatch(/c\.created_at\s*\+\s*interval\s+'2 minutes'\s+AS\s+janela_ate/i);
    const horario = cte('por_horario');
    expect(horario.match(/interval\s+'1 minute'/gi)?.length).toBe(2);
    // A contagem do par para na 11ª: passar de 10 já reprova.
    expect(horario).toMatch(/\+\s*interval\s+'1 minute'\s+LIMIT\s+11\)\s+AS\s+t\)\s*<=\s*10/i);
  });

  it('a ficha de LOTE não busca candidatas pelo horário (1087), com a mesma régua do par', () => {
    // As fichas em volta DELA (±1 min), até 11 — a janela de qualquer par a contém.
    const eu = cte('eu');
    expect(eu).toMatch(
      /x\.created_at\s+BETWEEN\s+c\.created_at\s*-\s*interval\s+'1 minute'\s+AND\s+c\.created_at\s*\+\s*interval\s+'1 minute'\s+LIMIT\s+11\)\s+AS\s+t\)\s+AS\s+em_volta/i,
    );
    // Mais de 10 em volta = lote: as candidatas do horário nem são buscadas.
    expect(cte('da_mesma_hora')).toMatch(/eu\.em_volta\s*<=\s*10/i);
  });

  it('sem varrer a conta: candidatas por índice, atrás da cerca, e o vizinho por IGUALDADE', () => {
    const corpo = corpoDaRpc();
    for (const nome of ['eu', 'vizinhas', 'da_mesma_hora']) {
      expect(corpo).toMatch(new RegExp(`\\b${nome}\\s+AS\\s+MATERIALIZED\\s*\\(`, 'i'));
    }
    const vizinhas = cte('vizinhas');
    expect(vizinhas).toMatch(/unnest\(eu\.vizinhos\)\s+AS\s+v\(tel\)/i);
    expect(vizinhas).toMatch(/o\.telefone_canonico\s*=\s*v\.tel/i);
    // O predicado do índice parcial do telefone canônico (1024).
    expect(vizinhas).toMatch(/o\.telefone_canonico\s*<>\s*''/i);
    // A forma lenta da 1084 não volta.
    expect(corpo).not.toMatch(/=\s*ANY\s*\(\s*(?:eu\.vizinhos|public\.cb_vizinhos_do_telefone)/i);
    // A janela é comparada nua (timestamp), sem conta dentro da condição.
    expect(cte('da_mesma_hora')).toMatch(/o\.created_at\s+BETWEEN\s+eu\.janela_de\s+AND\s+eu\.janela_ate/i);
  });

  it('nome SOZINHO nunca é sinal: o primeiro nome só é conferido nas candidatas do telefone ou do horário', () => {
    const corpo = corpoDaRpc();
    const comparacoes = [...corpo.matchAll(/cb_primeiro_nome\((\w+)\.name\)\s*=\s*eu\.nome/gi)].map((m) => m[1]);
    expect(comparacoes.sort()).toEqual(['h', 'v']);
    expect(cte('por_telefone')).toMatch(/FROM\s+vizinhas\s+v\b/i);
    expect(cte('por_horario')).toMatch(/FROM\s+da_mesma_hora\s+h\b/i);
  });

  it('o par descartado e o par já ligado em Relacionados saem do aviso', () => {
    const corpo = corpoDaRpc();
    expect(corpo).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.cb_duplicatas_descartadas/i);
    expect(corpo).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.cb_contatos_relacionados/i);
    // O par ligado é procurado pela MESMA expressão do índice único da 1069.
    expect(corpo).toMatch(/least\(r\.contact_a_id,\s*r\.contact_b_id\)/i);
    expect(corpo).toMatch(/greatest\(r\.contact_a_id,\s*r\.contact_b_id\)/i);
  });

  it('o par da decisão é ORDENADO, único, e as duas pontas são FK composta com CASCADE', () => {
    expect(base).toMatch(/CHECK\s*\(\s*contato_menor\s*<\s*contato_maior\s*\)/i);
    expect(base).toMatch(/UNIQUE\s*\(\s*contato_menor,\s*contato_maior\s*\)/i);
    for (const coluna of ['contato_menor', 'contato_maior']) {
      expect(base).toMatch(
        new RegExp(
          `FOREIGN\\s+KEY\\s*\\(\\s*${coluna},\\s*account_id\\s*\\)\\s*REFERENCES\\s+public\\.contacts\\s*\\(\\s*id,\\s*account_id\\s*\\)\\s*ON\\s+DELETE\\s+CASCADE`,
          'i',
        ),
      );
    }
    expect(base).toMatch(/ON\s+public\.cb_duplicatas_descartadas\s*\(\s*contato_maior\s*\)/i);
  });

  it('ler: qualquer membro (1032); decidir e desfazer: admin, com a autoria de quem grava; sem UPDATE', () => {
    const politicas = [
      ...base.matchAll(new RegExp(`CREATE\\s+POLICY\\s+(\\S+)\\s+ON\\s+public\\.${TABELA}\\s+FOR\\s+(\\w+)([^;]*)`, 'gi')),
    ];
    const porComando = new Map(politicas.map((p) => [p[2].toUpperCase(), p[3]]));
    expect([...porComando.keys()].sort()).toEqual(['DELETE', 'INSERT', 'SELECT']);

    const leitura = porComando.get('SELECT')!;
    expect(leitura).toMatch(/account_id\s*=\s*ANY\s*\(\s*ARRAY\s*\(\s*SELECT\s+public\.cb_contas_do_usuario\(\s*\)\s*\)\s*\)/i);
    expect(leitura).not.toMatch(/is_account_member|\bIN\s*\(\s*SELECT/i);

    const insercao = porComando.get('INSERT')!;
    expect(insercao).toMatch(/is_account_member\(account_id,\s*'admin'::account_role_enum\)/i);
    expect(insercao).toMatch(/descartado_por\s+IS\s+NOT\s+DISTINCT\s+FROM\s+auth\.uid\(\)/i);
    expect(porComando.get('DELETE')!).toMatch(/is_account_member\(account_id,\s*'admin'::account_role_enum\)/i);

    expect(base).toMatch(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+public\\.${TABELA}\\s+FROM\\s+anon,\\s*authenticated`, 'i'));
    expect(base).toMatch(
      new RegExp(`GRANT\\s+SELECT,\\s*INSERT,\\s*DELETE\\s+ON\\s+public\\.${TABELA}\\s+TO\\s+authenticated`, 'i'),
    );
  });

  it('nada para anon; quem chama a RPC chama as auxiliares', () => {
    for (const funcao of ['cb_primeiro_nome(text)', 'cb_vizinhos_do_telefone(text)', 'cb_possiveis_duplicatas(uuid)']) {
      const nome = funcao.replace(/[()]/g, (c) => `\\${c}`);
      expect(base).toMatch(new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${nome}\\s+FROM\\s+PUBLIC,\\s*anon`, 'i'));
      expect(base).toMatch(
        new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${nome}\\s+TO\\s+authenticated,\\s*service_role`, 'i'),
      );
    }
  });

  it('o primeiro nome tira o acento DEPOIS de decompor (NFD), como a régua de etiqueta', () => {
    expect(base).toMatch(/normalize\(lower\(coalesce\(p_nome,\s*''\)\),\s*NFD\)/i);
    expect(sql1084).toContain("'[\\u0300-\\u036f]'");
    expect(base).toMatch(/length\(s\.t\)\s*>=\s*3/i);
  });
});
