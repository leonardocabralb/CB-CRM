import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1092 — UNIR FICHAS (fase 2 das fichas duplicadas).
//
// O que este pino segura — cada item já foi um defeito em potencial que a
// prova na réplica do esquema de produção (13/10/2026) mediu:
// - os valores novos entram nos CHECKs ANTES das funções que os gravam (o
//   CHECK nascido inline é localizado pela FORMA), e o CHECK de forma da
//   trilha não exige `contact_id` (apagar contato faz SET NULL);
// - a porta da união é de ADMIN sem suspensão, conferida ANTES de travar
//   qualquer linha (um membro de outra conta não trava ficha alheia);
// - a ordem que as restrições REAIS impõem: o livro antes do DELETE, e a
//   identidade (telefone/BSUID) passada DEPOIS dele (`contacts_identidade_ck`
//   e os índices únicos não deixam antes); o `kommo_lead_id` zerado no card
//   que sai antes de ir para o que fica;
// - a conferência pelo CATÁLOGO: toda FK para `contacts` é varrida e a sobra
//   ESTOURA — tabela nova com `contact_id` não some calada;
// - a trilha é escrita pelo GATILHO do livro, nunca pela função; etiqueta
//   passa por UPDATE (não acende `tag_added` nem a trilha);
// - as tabelas novas: o navegador só LÊ (forma da 1032); a busca dos
//   cadastros só para o servidor, e com o primeiro nome;
// - a conferência da migration CHAMA a união num par fictício, desfeita por
//   SQLSTATE próprio.
// LIMITE DECLARADO: lê o `.sql`. Os cenários (as duas com conversa, só a que
// sai com conversa, ficha só-BSUID, bloqueios, portas, trava de tabela nova,
// sinal 4, volume de 200 mil mensagens) foram provados na réplica — ver o
// plano.
// ============================================================

const semComentarios = (texto: string) =>
  texto
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

const bruto = fs.readFileSync(path.join(__dirname, '1092_cb_unir_fichas.sql'), 'utf8');
const sql = semComentarios(bruto);

/** O corpo de uma função, do CREATE até o `$$` que fecha. */
function funcao(nome: string): string {
  const inicio = sql.search(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${nome}\\s*\\(`, 'i'));
  expect(inicio, nome).toBeGreaterThanOrEqual(0);
  const resto = sql.slice(inicio);
  const abre = resto.indexOf('$$');
  const fecha = resto.indexOf('$$', abre + 2);
  return resto.slice(0, fecha + 2);
}

describe('1092 — unir fichas', () => {
  it('trava com teto ANTES da primeira ALTER (as tabelas são escritas pelo motor e pelos gatilhos)', () => {
    const trava = sql.search(/SET\s+LOCAL\s+lock_timeout/i);
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(trava).toBeLessThan(sql.search(/ALTER\s+TABLE/i));
  });

  it('os CHECKs aceitam os valores novos, localizados pela FORMA e recriados com nome', () => {
    expect(sql).toMatch(/a\.attname\s*=\s*'interrompida_por'/i);
    expect(sql).toMatch(
      /ADD\s+CONSTRAINT\s+automation_logs_interrompida_por_check\s+CHECK\s*\(\s*interrompida_por\s+IN\s*\(\s*'resposta',\s*'etapa',\s*'parar',\s*'passo',\s*'desativacao',\s*'fusao'\s*\)/i,
    );
    expect(sql).toMatch(/a\.attname\s*=\s*'event_type'/i);
    expect(sql).toMatch(/ADD\s+CONSTRAINT\s+cb_lead_events_event_type_check[\s\S]*?'contacts_merged'/i);
    const forma = sql.slice(sql.search(/ADD\s+CONSTRAINT\s+cb_lead_events_shape/i));
    expect(forma).toMatch(/WHEN\s+'contacts_merged'\s+THEN\s+details\s+IS\s+NOT\s+NULL/i);
    // Apagar contato faz SET NULL (um UPDATE que revalida o CHECK).
    expect(forma.slice(0, forma.search(/ELSE\s+false/i))).not.toMatch(/contact_id\s+IS\s+NOT\s+NULL/i);
    // Os CHECKs vêm antes das funções que gravam os valores.
    expect(sql.search(/automation_logs_interrompida_por_check/i)).toBeLessThan(
      sql.search(/FUNCTION\s+public\.cb_unir_fichas/i),
    );
  });

  it('as tabelas novas: o navegador só LÊ (1032), sem policy de escrita; FKs compostas com CASCADE', () => {
    for (const tabela of ['cb_fichas_unidas', 'cb_contatos_antigos']) {
      expect(sql).toMatch(new RegExp(`ALTER\\s+TABLE\\s+public\\.${tabela}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'));
      const politicas = [...sql.matchAll(new RegExp(`CREATE\\s+POLICY\\s+\\S+\\s+ON\\s+public\\.${tabela}\\s+FOR\\s+(\\w+)([^;]*)`, 'gi'))];
      expect(politicas.map((p) => p[1].toUpperCase())).toEqual(['SELECT']);
      expect(politicas[0][2]).toMatch(/account_id\s*=\s*ANY\s*\(\s*ARRAY\s*\(\s*SELECT\s+public\.cb_contas_do_usuario\(\s*\)\s*\)\s*\)/i);
      expect(sql).toMatch(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+public\\.${tabela}\\s+FROM\\s+anon,\\s*authenticated`, 'i'));
      expect(sql).toMatch(new RegExp(`GRANT\\s+SELECT\\s+ON\\s+public\\.${tabela}\\s+TO\\s+authenticated;`, 'i'));
    }
    expect(sql).toMatch(
      /FOREIGN\s+KEY\s*\(\s*ficha_que_fica,\s*account_id\s*\)\s*REFERENCES\s+public\.contacts\s*\(\s*id,\s*account_id\s*\)\s*ON\s+DELETE\s+CASCADE/i,
    );
    expect(sql).toMatch(
      /FOREIGN\s+KEY\s*\(\s*contact_id,\s*account_id\s*\)\s*REFERENCES\s+public\.contacts\s*\(\s*id,\s*account_id\s*\)\s*ON\s+DELETE\s+CASCADE/i,
    );
    expect(sql).toMatch(/UNIQUE\s*\(\s*ficha_removida\s*\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*account_id,\s*tipo,\s*valor\s*\)/i);
  });

  it('a porta: admin sem suspensão, conferida ANTES de travar qualquer linha', () => {
    const unir = funcao('cb_unir_fichas');
    expect(unir.split('$$')[0]).toMatch(/SECURITY\s+DEFINER/i);
    expect(unir.split('$$')[0]).toMatch(/SET\s+lock_timeout/i);
    const porta = unir.search(/is_account_member\(\s*v_conta,\s*'admin'::account_role_enum\s*\)/i);
    expect(porta).toBeGreaterThanOrEqual(0);
    expect(porta).toBeLessThan(unir.search(/FOR\s+UPDATE/i));
    expect(unir).toMatch(/p\.suspenso_em\s+IS\s+NULL/i);
    // As duas fichas em ordem de id: duas uniões cruzadas não fecham ciclo.
    expect(unir).toMatch(/WHERE\s+c\.id\s+IN\s*\(\s*p_fica,\s*p_sai\s*\)\s+ORDER\s+BY\s+c\.id\s+FOR\s+UPDATE/i);
    expect(unir).toMatch(/cb_bloqueios_da_uniao\(\s*p_fica,\s*p_sai\s*\)/i);
  });

  it('D8: as execuções da que sai terminam com a marca durável `fusao`', () => {
    const unir = funcao('cb_unir_fichas');
    expect(unir).toMatch(/interrompida_por\s*=\s*'fusao'/i);
    expect(unir).toMatch(/SET\s+status\s*=\s*'cancelled'/i);
    expect(unir).toMatch(/status\s*=\s*'stopped_by_agent'/i);
  });

  it('a ordem das restrições reais: livro → DELETE → identidade; Kommo zerado antes de passar', () => {
    const unir = funcao('cb_unir_fichas');
    const livro = unir.search(/INSERT\s+INTO\s+cb_fichas_unidas/i);
    const apaga = unir.search(/DELETE\s+FROM\s+contacts\s+WHERE\s+id\s*=\s*p_sai/i);
    const identidade = unir.search(/SET\s+phone\s*=\s*CASE\s+WHEN\s+c\.phone\s+IS\s+NULL/i);
    expect(livro).toBeGreaterThanOrEqual(0);
    expect(livro).toBeLessThan(apaga);
    expect(apaga).toBeLessThan(identidade);
    const zera = unir.search(/UPDATE\s+deals\s+SET\s+kommo_lead_id\s*=\s*NULL/i);
    const passa = unir.search(/kommo_lead_id\s*=\s*coalesce\(\s*k\.kommo_lead_id/i);
    expect(zera).toBeGreaterThanOrEqual(0);
    expect(zera).toBeLessThan(passa);
  });

  it('a conferência pelo CATÁLOGO: toda FK para contacts (e para a conversa que sai), e a sobra estoura', () => {
    const unir = funcao('cb_unir_fichas');
    expect(unir).toMatch(/k\.confrelid\s*=\s*'public\.contacts'::regclass/i);
    expect(unir).toMatch(/k\.confrelid\s*=\s*'public\.conversations'::regclass/i);
    expect(unir).toMatch(/RAISE\s+EXCEPTION\s+'uniao_sem_tratamento:%'/i);
    // A conferência vem antes do livro e do DELETE.
    expect(unir.search(/uniao_sem_tratamento/i)).toBeLessThan(unir.search(/INSERT\s+INTO\s+cb_fichas_unidas/i));
  });

  it('a trilha sai do GATILHO do livro; etiqueta passa por UPDATE', () => {
    const unir = funcao('cb_unir_fichas');
    expect(unir).not.toMatch(/INSERT\s+INTO\s+cb_lead_events/i);
    expect(unir).not.toMatch(/INSERT\s+INTO\s+contact_tags/i);
    expect(unir).toMatch(/UPDATE\s+contact_tags\s+t\s+SET\s+contact_id\s*=\s*p_fica/i);
    expect(funcao('cb_log_fichas_unidas')).toMatch(/INSERT\s+INTO\s+cb_lead_events/i);
    expect(sql).toMatch(/AFTER\s+INSERT\s+ON\s+public\.cb_fichas_unidas\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.cb_log_fichas_unidas\(\)/i);
  });

  it('D9: a busca dos cadastros exige o mesmo primeiro nome e só o servidor a chama', () => {
    const busca = funcao('cb_ficha_por_contato_antigo');
    expect(busca).toMatch(/cb_primeiro_nome\(c\.name\)\s*=\s*cb_primeiro_nome\(p_nome\)/i);
    expect(sql).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_ficha_por_contato_antigo\(uuid,\s*text,\s*text,\s*text\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
    );
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_ficha_por_contato_antigo\(uuid,\s*text,\s*text,\s*text\)\s+TO\s+service_role;/i);
  });

  it('as RPCs da tela para authenticated; as peças internas para ninguém de fora', () => {
    for (const rpc of ['cb_previa_da_uniao(uuid, uuid)', 'cb_unir_fichas(uuid, uuid)']) {
      const nome = rpc.replace(/[()]/g, (c) => `\\${c}`);
      expect(sql).toMatch(new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${nome}\\s+FROM\\s+PUBLIC,\\s*anon;`, 'i'));
      expect(sql).toMatch(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${nome}\\s+TO\\s+authenticated;`, 'i'));
    }
    for (const interna of [
      'cb_bloqueios_da_uniao',
      'cb_ficha_sugerida_da_uniao',
      'cb_cards_da_uniao',
      'cb_nome_da_uniao',
      'cb_divergencias_da_uniao',
      'cb_contatos_antigos_da_uniao',
      'cb_log_fichas_unidas',
    ]) {
      expect(sql).toMatch(
        new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${interna}\\([^)]*\\)\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated;`, 'i'),
      );
      expect(sql).not.toMatch(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${interna}\\b`, 'i'));
    }
  });

  it('a conferência CHAMA a união num par fictício, desfeita por SQLSTATE próprio', () => {
    const inicio = sql.search(/DO\s+\$\$\s*DECLARE\s+v_def/i);
    expect(inicio).toBeGreaterThan(0);
    const conferencia = sql.slice(inicio);
    expect(conferencia).toMatch(/public\.cb_unir_fichas\(\s*v_fica,\s*v_sai\s*\)/i);
    expect(conferencia).toMatch(/ERRCODE\s*=\s*'P1092'/i);
    expect(conferencia).toMatch(/WHEN\s+SQLSTATE\s+'P1092'/i);
    expect(conferencia).not.toMatch(/WHEN\s+OTHERS/i);
    // Banco vazio (o replay do CI): nada a provar, sem estourar.
    expect(conferencia).toMatch(/RAISE\s+NOTICE\s+'1092: banco vazio/i);
  });
});
