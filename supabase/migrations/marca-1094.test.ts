import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  COLUNA_DA_PECA,
  LIMITE_DO_NOME,
  LIMITE_DO_NOME_CURTO,
  TETO_DE_BYTES_DA_MARCA,
  TIPOS_DA_PECA,
} from '@/lib/marca';
import { COLUNAS_DA_MARCA } from '@/lib/marca-servidor';

// ============================================================
// 1094 — a marca da instalação (`cb_marca` + bucket `marca`).
//
// O que este pino segura:
// - a tabela é FECHADA ao navegador (RLS, nenhuma policy, REVOKE de anon E
//   authenticated, GRANT ao service_role): o layout e a rota leem com
//   service role, e uma policy por papel deixaria o admin de qualquer conta
//   avulsa trocar o logo de todos (D1 do plano);
// - o SQL e o código dizem a MESMA coisa: teto e tipos do bucket, colunas
//   das peças e limites do nome. Os números do código são IMPORTADOS, nunca
//   digitados aqui — mudar um lado sem o outro faz o Storage recusar o que
//   a rota aceitou (ou a tela recusar o que o bucket aceitaria);
// - as colunas que o servidor pede (`COLUNAS_DA_MARCA`) existem: uma a mais
//   e o PostgREST recusa a leitura inteira, e `obterMarca` cai no padrão em
//   TODA página, sem quebrar nada que se veja.
// A conferência DENTRO da 1094 prova privilégio e bucket no banco; este
// teste roda no job `verificar`, que é portão.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1094_cb_marca.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

/** O corpo do `CREATE TABLE … cb_marca ( … );`. */
const corpoDaTabela =
  semComentarios.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.cb_marca\s*\(([\s\S]*?)\n\);/i)?.[1] ?? '';

/** Nome de cada coluna declarada (a 1ª palavra de cada linha que não é CONSTRAINT). */
const colunasDaTabela = corpoDaTabela
  .split('\n')
  .map((linha) => linha.trim())
  .filter((linha) => linha && !/^(CONSTRAINT|CHECK|PRIMARY|UNIQUE|FOREIGN)\b/i.test(linha))
  .map((linha) => linha.split(/\s+/)[0]!)
  .filter((nome) => /^[a-z_]+$/.test(nome));

/** O INSERT do bucket. */
const insercaoDoBucket =
  semComentarios.match(/INSERT\s+INTO\s+storage\.buckets[\s\S]*?;/i)?.[0] ?? '';

describe('1094 — a tabela é fechada ao navegador', () => {
  it('RLS ligada, REVOKE de anon E authenticated, GRANT ao service_role', () => {
    expect(semComentarios).toMatch(/ALTER\s+TABLE\s+public\.cb_marca\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(semComentarios).toMatch(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.cb_marca\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i,
    );
    expect(semComentarios).toMatch(/GRANT\s+ALL\s+ON\s+TABLE\s+public\.cb_marca\s+TO\s+service_role\s*;/i);
    expect(semComentarios).not.toMatch(/GRANT[^;]*\bON\s+(?:TABLE\s+)?(?:public\.)?cb_marca\b[^;]*\b(anon|authenticated)\b/i);
  });

  it('nenhuma policy na tabela, e nenhuma em storage.objects (só a rota escreve no bucket)', () => {
    expect(semComentarios).not.toMatch(/CREATE\s+POLICY[^;]*\bON\s+(?:public\.)?cb_marca\b/i);
    expect(semComentarios).not.toMatch(/CREATE\s+POLICY[^;]*\bON\s+storage\.objects\b/i);
  });

  it('UMA linha: chave booleana que só aceita true (alvo TOTAL do upsert da rota)', () => {
    expect(corpoDaTabela).toMatch(/^\s*id\s+boolean\s+NOT\s+NULL\s+DEFAULT\s+true\s*,/im);
    expect(corpoDaTabela).toMatch(/CONSTRAINT\s+cb_marca_pkey\s+PRIMARY\s+KEY\s*\(\s*id\s*\)/i);
    expect(corpoDaTabela).toMatch(/CONSTRAINT\s+cb_marca_uma_linha_ck\s+CHECK\s*\(\s*id\s*\)/i);
  });

  it('autoria com SET NULL: apagar o login de quem gravou não leva a marca', () => {
    expect(corpoDaTabela).toMatch(
      /atualizado_por\s+uuid\s+REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i,
    );
  });
});

describe('1094 — o SQL diz o mesmo que src/lib/marca.ts', () => {
  it('o bucket "marca" é PÚBLICO, com o teto do código', () => {
    expect(insercaoDoBucket).toMatch(/VALUES\s*\(\s*'marca'\s*,\s*'marca'\s*,\s*TRUE\s*,/i);
    const teto = insercaoDoBucket.match(/TRUE\s*,\s*(\d+)\s*,/i)?.[1];
    expect(Number(teto)).toBe(TETO_DE_BYTES_DA_MARCA);
    // A reexecução atualiza o bucket (ON CONFLICT), em vez de pular.
    expect(insercaoDoBucket).toMatch(/ON\s+CONFLICT\s*\(\s*id\s*\)\s+DO\s+UPDATE/i);
    for (const coluna of ['public', 'file_size_limit', 'allowed_mime_types']) {
      expect(insercaoDoBucket).toMatch(new RegExp(`${coluna}\\s*=\\s*EXCLUDED\\.${coluna}`, 'i'));
    }
  });

  it('os tipos do bucket são EXATAMENTE a união dos tipos das peças', () => {
    const lista = insercaoDoBucket.match(/ARRAY\s*\[([^\]]*)\]/i)?.[1] ?? '';
    const doSql = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    const doCodigo = [...new Set(Object.values(TIPOS_DA_PECA).flat())].sort();
    expect(doSql).toEqual(doCodigo);
  });

  it('a conferência do fim confere o mesmo teto e os mesmos tipos', () => {
    const conferencia = semComentarios.slice(semComentarios.search(/DO\s+\$\$/));
    expect(conferencia).toContain(`IS DISTINCT FROM ${TETO_DE_BYTES_DA_MARCA}`);
    for (const tipo of new Set(Object.values(TIPOS_DA_PECA).flat())) {
      expect(conferencia).toContain(`'${tipo}'`);
    }
  });

  it('as colunas *_path são exatamente as de COLUNA_DA_PECA', () => {
    const doSql = colunasDaTabela.filter((c) => c.endsWith('_path')).sort();
    expect(doSql).toEqual(Object.values(COLUNA_DA_PECA).sort());
  });

  it('os limites do nome e do nome curto são os do código', () => {
    expect(corpoDaTabela).toMatch(
      new RegExp(`cb_marca_nome_ck\\s+CHECK\\s*\\(\\s*nome\\s+IS\\s+NULL\\s+OR\\s+char_length\\(btrim\\(nome\\)\\)\\s+BETWEEN\\s+1\\s+AND\\s+${LIMITE_DO_NOME}\\s*\\)`, 'i'),
    );
    expect(corpoDaTabela).toMatch(
      new RegExp(`cb_marca_nome_curto_ck\\s+CHECK\\s*\\(\\s*nome_curto\\s+IS\\s+NULL\\s+OR\\s+char_length\\(btrim\\(nome_curto\\)\\)\\s+BETWEEN\\s+1\\s+AND\\s+${LIMITE_DO_NOME_CURTO}\\s*\\)`, 'i'),
    );
  });

  it('a cor do ícone tem a forma de corValida (#rrggbb)', () => {
    expect(corpoDaTabela).toMatch(
      /cb_marca_cor_do_icone_ck\s+CHECK\s*\(\s*cor_do_icone\s+IS\s+NULL\s+OR\s+cor_do_icone\s+~\s+'\^#\[0-9a-fA-F\]\{6\}\$'\s*\)/,
    );
  });

  it('COLUNAS_DA_MARCA (o que o servidor lê) só pede coluna que existe', () => {
    expect(colunasDaTabela.length).toBeGreaterThan(5);
    const pedidas = COLUNAS_DA_MARCA.split(',').map((c) => c.trim());
    expect(pedidas.filter((c) => !colunasDaTabela.includes(c))).toEqual([]);
  });
});
