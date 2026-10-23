import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================
// 1101 — Lixeira de contatos, Fase 4: "Restaurar e unir". O comportamento foi
// provado num Postgres descartável com o esquema da produção (colisão por
// telefone, por BSUID, por Instagram, a reserva, terceira ficha, portas,
// trava, a prévia que não grava nada). Este pino segura, lendo o `.sql`, o
// que uma edição posterior quebraria em silêncio:
//
// - só funções (aditiva): nenhuma ALTER, tabela, gatilho ou policy;
// - as portas: três RPCs da tela para `authenticated` (+ `service_role`),
//   as peças internas para ninguém; função nova sem porta declarada reprova;
// - a porta (sessão, suspensão 1067, admin) vem ANTES de qualquer trava;
// - o item travado com NOWAIT e recortado pela conta; as CONVERSAS antes da
//   ficha (a ordem da união);
// - a volta pelo MIOLO da 1097 (`cb_lixeira_restaurar_um`), nunca copiado;
// - a prévia desfeita pelo SQLSTATE próprio P1101, nunca `WHEN OTHERS`;
// - a reserva (`lixeira:`) com o MESMO prefixo na peça que a cria e na regra
//   de bloqueio da união — e a ÚLTIMA definição de `cb_bloqueios_da_uniao`
//   no replay mantém a exceção (DEFAULT-DENY: uma migration posterior que
//   recrie a função sem ela devolve "contas diferentes" a toda ficha que
//   volta só com o BSUID);
// - a reserva NUNCA sobra: sai da ficha que fica, do livro e da trilha;
// - a faixa pelos três índices parciais da 1097, só para admin, sem a
//   fotografia, com o sinal de Instagram; a lista da Lixeira recriada com o
//   mesmo sinal e o corpo da 1097;
// - a conversa que volta entra como HISTÓRICO (encerrada, sem responsável,
//   sem espera, sem não lidas) e a janela da Meta SÓ AVANÇA (revisão de
//   23/10/2026: a união reabria a conversa de hoje e recuava a janela).
// LIMITE DECLARADO: lê os `.sql`.
// ============================================================

const DIR = __dirname;
const ARQUIVO = '1101_cb_lixeira_restaurar_e_unir.sql';
const NUMERO = 1101;

const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, '');
const BRUTO = fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8');
const SQL = semComentarios(BRUTO);
const SQL_1097 = semComentarios(fs.readFileSync(path.join(DIR, '1097_cb_lixeira_de_contatos.sql'), 'utf8'));

const MIGRATIONS = fs
  .readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((arquivo) => ({
    arquivo,
    numero: Number(arquivo.slice(0, 4)),
    sql: semComentarios(fs.readFileSync(path.join(DIR, arquivo), 'utf8')),
  }));

/** O texto de uma função: do CREATE até o `$$` que fecha. */
function corpoDaFuncao(sql: string, nome: string): string | null {
  const inicio = sql.search(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${nome}\\s*\\(`, 'i'));
  if (inicio < 0) return null;
  const resto = sql.slice(inicio);
  const abre = resto.indexOf('$$');
  const fecha = resto.indexOf('$$', abre + 2);
  return resto.slice(0, fecha + 2);
}

function funcao(nome: string): string {
  const corpo = corpoDaFuncao(SQL, nome);
  expect(corpo, `${nome} sumiu da 1101`).not.toBeNull();
  return corpo!;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const revoga = (assinatura: string, de: string) =>
  new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${esc(assinatura)}\\s+FROM\\s+${de}\\s*;`, 'i').test(SQL);
const concessoes = (sql: string, assinatura: string) =>
  [
    ...sql.matchAll(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${esc(assinatura)}\\s+TO\\s+([^;]+);`, 'gi')),
  ].flatMap((m) => m[1].split(',').map((p) => p.trim().toLowerCase()));

const TELA = [
  'cb_lixeira_da_mesma_pessoa(uuid)',
  'cb_previa_restaurar_e_unir(uuid, uuid)',
  'cb_restaurar_e_unir(uuid, uuid)',
];
const INTERNAS = ['cb_lixeira_preparar_uniao(uuid, uuid, uuid)', 'cb_bloqueios_da_uniao(uuid, uuid)'];
/** A lista da Lixeira (1097), recriada com uma coluna: as portas da 1097. */
const RECRIADAS_DA_1097 = ['cb_lixeira_da_conta(text)'];

describe('1101 — restaurar e unir', () => {
  it('ADITIVA e só funções: nenhuma ALTER, tabela, gatilho ou policy; o único DROP é o da lista, recriada logo abaixo', () => {
    expect(SQL).not.toMatch(/\bALTER\s+TABLE\b/i);
    const drops = [...SQL.matchAll(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.(\w+)\(([^)]*)\)/gi)];
    expect(drops.map((m) => `${m[1]}(${m[2]})`)).toEqual(RECRIADAS_DA_1097);
    const drop = SQL.search(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.cb_lixeira_da_conta\(text\)/i);
    const cria = SQL.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cb_lixeira_da_conta\(/i);
    expect(cria).toBeGreaterThan(drop);
    expect(SQL.slice(drop, cria)).not.toMatch(/;[\s\S]*;/);
    expect(SQL).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|POLICY)\b/i);
    expect(SQL).not.toMatch(/\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b/i);
    expect(SQL).not.toMatch(/DISABLE\s+TRIGGER|session_replication_role/i);
  });

  // ── As portas ───────────────────────────────────────────────────────────

  it('toda função da 1101 tem porta DECLARADA aqui (função nova sem decisão reprova)', () => {
    const criadas = [...SQL.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(/gi)].map((m) => m[1]).sort();
    const declaradas = [...TELA, ...INTERNAS, ...RECRIADAS_DA_1097].map((a) => a.slice(0, a.indexOf('('))).sort();
    expect(criadas).toEqual(declaradas);
  });

  it('a lista recriada: as portas da 1097 de novo (authenticated, nunca anon)', () => {
    for (const f of RECRIADAS_DA_1097) {
      expect(revoga(f, 'PUBLIC,\\s*anon'), f).toBe(true);
      expect(concessoes(SQL, f), f).toEqual(['authenticated']);
    }
  });

  it('a lista recriada é o corpo da 1097 mais o sinal de Instagram, no fim', () => {
    const daqui = corpoDaFuncao(SQL, 'cb_lixeira_da_conta')!;
    const da1097 = corpoDaFuncao(SQL_1097, 'cb_lixeira_da_conta')!;
    const sem = (t: string) =>
      t
        .replace(/,\s*ocupada_com_instagram\s+boolean/i, '')
        .replace(/,\s*CASE\s+WHEN\s+o\.id\s+IS\s+NOT\s+NULL\s+THEN\s+x\.instagram_id[^\n]*END/i, '')
        .replace(/,\s*c\.instagram_id\s*\n/i, '\n')
        .replace(/\s+/g, ' ');
    expect(sem(daqui)).toBe(sem(da1097));
    expect(daqui).toMatch(/ocupada_com_instagram\s+boolean\s*\)/i);
  });

  it('as RPCs da tela: authenticated e service_role, nunca anon; a porta de admin é por dentro', () => {
    for (const f of TELA) {
      expect(revoga(f, 'PUBLIC,\\s*anon,\\s*authenticated'), f).toBe(true);
      expect(concessoes(SQL, f).sort(), f).toEqual(['authenticated', 'service_role']);
    }
  });

  it('as peças internas: ninguém de fora (as RPCs rodam como dono)', () => {
    for (const f of INTERNAS) {
      expect(revoga(f, 'PUBLIC,\\s*anon,\\s*authenticated'), f).toBe(true);
      expect(concessoes(SQL, f), f).toEqual([]);
    }
  });

  it('DEFAULT-DENY: migration posterior não abre as peças internas nem dá as RPCs ao anon', () => {
    const fora: string[] = [];
    for (const m of MIGRATIONS.filter((x) => x.numero > NUMERO)) {
      for (const f of INTERNAS) {
        const abertas = concessoes(m.sql, f).filter((p) => p !== 'service_role');
        if (abertas.length > 0) fora.push(`${f} → ${abertas.join(', ')} (${m.arquivo})`);
      }
      for (const f of TELA) {
        if (concessoes(m.sql, f).some((p) => p === 'anon' || p === 'public')) fora.push(`${f} → anon (${m.arquivo})`);
      }
    }
    expect(fora).toEqual([]);
  });

  it('a porta (sessão, suspensão, admin) vem ANTES da peça que trava e escreve', () => {
    for (const nome of ['cb_previa_restaurar_e_unir', 'cb_restaurar_e_unir']) {
      const f = funcao(nome);
      expect(f.split('$$')[0], nome).toMatch(/SECURITY\s+DEFINER/i);
      expect(f.split('$$')[0], nome).toMatch(/SET\s+search_path\s*=\s*public/i);
      expect(f.split('$$')[0], nome).toMatch(/SET\s+lock_timeout/i);
      const sessao = f.search(/IF\s+v_uid\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION\s+'so_admin'\s+USING\s+ERRCODE\s*=\s*'42501'/i);
      const suspenso = f.search(/p\.suspenso_em\s+IS\s+NOT\s+NULL\)\s+THEN\s+RAISE\s+EXCEPTION\s+'membro_suspenso'\s+USING\s+ERRCODE\s*=\s*'42501'/i);
      const admin = f.search(/is_account_member\(\s*v_conta,\s*'admin'::account_role_enum\s*\)/i);
      const peca = f.search(/cb_lixeira_preparar_uniao\(/i);
      expect(sessao, nome).toBeGreaterThan(0);
      expect(suspenso, nome).toBeGreaterThan(sessao);
      expect(admin, nome).toBeGreaterThan(suspenso);
      expect(peca, nome).toBeGreaterThan(admin);
    }
  });

  // ── A peça: trava, identidade provisória, volta ─────────────────────────

  it('o item travado sem esperar e recortado pela conta; a recusa vira em_processamento', () => {
    const p = funcao('cb_lixeira_preparar_uniao');
    expect(p.split('$$')[0]).not.toMatch(/SECURITY\s+DEFINER/i);
    const trava = p.search(
      /FROM\s+cb_lixeira_de_contatos\s+x\s+WHERE\s+x\.id\s*=\s*p_item\s+AND\s+x\.account_id\s*=\s*p_conta\s+FOR\s+UPDATE\s+NOWAIT/i,
    );
    expect(trava).toBeGreaterThan(0);
    expect(trava).toBeLessThan(p.search(/\bUPDATE\s+cb_lixeira_de_contatos/i));
    expect(p).toMatch(/WHEN\s+lock_not_available\s+THEN\s+RAISE\s+EXCEPTION\s+'em_processamento'/i);
  });

  it('as CONVERSAS da ficha que fica antes da ficha (a ordem da união e dos gatilhos)', () => {
    const p = funcao('cb_lixeira_preparar_uniao');
    const conversas = p.search(/FROM\s+conversations\s+c\s+WHERE\s+c\.contact_id\s*=\s*p_fica\s+ORDER\s+BY\s+c\.id\s+FOR\s+UPDATE/i);
    const ficha = p.search(/FROM\s+contacts\s+c\s+WHERE\s+c\.id\s*=\s*p_fica\s+FOR\s+UPDATE/i);
    expect(conversas).toBeGreaterThan(0);
    expect(ficha).toBeGreaterThan(conversas);
  });

  it('anula SÓ o que colide com a ficha que fica; a reserva só quando nada sobra; o item acompanha', () => {
    const p = funcao('cb_lixeira_preparar_uniao');
    expect(p).toMatch(/v_phone\s*:=\s*CASE\s+WHEN\s+v_bate_tel\s+THEN\s+NULL\s+ELSE\s+v_ficha\s*->>\s*'phone'\s+END/i);
    expect(p).toMatch(/v_wa\s*:=\s*CASE\s+WHEN\s+v_bate_wa\s+THEN\s+NULL\s+ELSE\s+v_ficha\s*->>\s*'wa_user_id'\s+END/i);
    expect(p).toMatch(/v_ig\s*:=\s*CASE\s+WHEN\s+v_bate_ig\s+THEN\s+NULL\s+ELSE\s+v_ficha\s*->>\s*'instagram_id'\s+END/i);
    expect(p).toMatch(/IF\s+v_phone\s+IS\s+NULL\s+AND\s+v_wa\s+IS\s+NULL\s+AND\s+v_ig\s+IS\s+NULL\s+THEN\s+v_reserva\s*:=/i);
    // As colunas que a conferência B2 de `cb_lixeira_restaurar_um` lê.
    const b2 = corpoDaFuncao(SQL_1097, 'cb_lixeira_restaurar_um')!;
    for (const coluna of ['telefone_canonico', 'phone_normalized', 'wa_user_id', 'instagram_id']) {
      expect(b2, `a B2 da 1097 não lê mais ${coluna} — revise a 1101`).toMatch(new RegExp(`v\\.${coluna}`));
      expect(p, coluna).toMatch(new RegExp(`\\b${coluna}\\s*=`, 'i'));
    }
    expect(p).toMatch(/'\{contacts,0\}',\s*v_ficha\s*\|\|\s*jsonb_build_object\('phone',\s*v_phone/i);
    expect(p).toMatch(/IF\s+NOT\s+\(v_bate_tel\s+OR\s+v_bate_wa\s+OR\s+v_bate_ig\)\s+THEN\s+RAISE\s+EXCEPTION\s+'identidade_nao_casa'/i);
  });

  it('a volta é o MIOLO da 1097, reaproveitado — nunca uma cópia da reinserção nem do sinal', () => {
    const p = funcao('cb_lixeira_preparar_uniao');
    expect(p).toMatch(/v_res\s*:=\s*cb_lixeira_restaurar_um\(\s*v\.id\s*\)/i);
    expect(SQL).not.toMatch(/cb_lixeira_reinserir\(|cb_lixeira_reapontar\(/i);
    // O sinal liga e desliga dentro do miolo; aqui só se garante desligado.
    for (const m of SQL.matchAll(/set_config\(\s*'cb\.lixeira'\s*,\s*'([^']*)'\s*,\s*(\w+)\s*\)/g)) {
      expect(m[1], m[0]).toBe('');
      expect(m[2], m[0]).toBe('true');
    }
    // A recusa do miolo (identidade de uma TERCEIRA ficha) desfaz tudo.
    expect(p).toMatch(/IF\s+v_res\s*->>\s*'resultado'\s+IS\s+DISTINCT\s+FROM\s+'restaurada'\s+THEN\s+RAISE\s+EXCEPTION/i);
  });

  // ── A prévia e a união ──────────────────────────────────────────────────

  it('a prévia: a peça e a prévia da união num subbloco desfeito pelo P1101, nunca WHEN OTHERS', () => {
    const f = funcao('cb_previa_restaurar_e_unir');
    const peca = f.search(/cb_lixeira_preparar_uniao\(/i);
    const previa = f.search(/v_previa\s*:=\s*cb_previa_da_uniao\(\s*p_fica,/i);
    const desfaz = f.search(/RAISE\s+EXCEPTION\s+USING\s+ERRCODE\s*=\s*'P1101'/i);
    expect(peca).toBeGreaterThan(0);
    expect(previa).toBeGreaterThan(peca);
    expect(desfaz).toBeGreaterThan(previa);
    expect(f).toMatch(/WHEN\s+SQLSTATE\s+'P1101'\s+THEN\s+NULL/i);
    expect(SQL).not.toMatch(/WHEN\s+OTHERS/i);
    expect(f).not.toMatch(/cb_unir_fichas\(/i);
  });

  it('a união: a peça, `cb_unir_fichas(fica, restaurada)` e a recusa que desfaz tudo', () => {
    const f = funcao('cb_restaurar_e_unir');
    const peca = f.search(/cb_lixeira_preparar_uniao\(/i);
    const uniao = f.search(/v_uniao\s*:=\s*cb_unir_fichas\(\s*p_fica,\s*v_contato\s*\)/i);
    expect(peca).toBeGreaterThan(0);
    expect(uniao).toBeGreaterThan(peca);
    // As recusas que voltam como dado; o resto (a porta, 42501) estoura.
    expect(f).toMatch(/WHEN\s+lock_not_available\s+OR\s+deadlock_detected\s+OR\s+unique_violation\s+OR\s+foreign_key_violation\s+THEN/i);
    expect(f).toMatch(/WHEN\s+SQLSTATE\s+'P0001'\s+THEN/i);
    expect(f).not.toMatch(/WHEN\s+insufficient_privilege/i);
  });

  it('a reserva: o MESMO prefixo na peça e na regra de bloqueio da união', () => {
    const p = funcao('cb_lixeira_preparar_uniao');
    const prefixo = p.match(/v_reserva\s*:=\s*'([^']+)'\s*\|\|\s*v\.id::text/i)?.[1];
    expect(prefixo).toBe('lixeira:');
    const bloqueios = funcao('cb_bloqueios_da_uniao');
    const exc = [...bloqueios.matchAll(/left\(\s*([fs])\.wa_user_id,\s*(\d+)\s*\)\s*<>\s*'([^']+)'/gi)];
    expect(exc.map((m) => m[1]).sort()).toEqual(['f', 's']);
    for (const m of exc) {
      expect(m[3]).toBe(prefixo);
      expect(Number(m[2])).toBe(prefixo!.length);
    }
    // O resto da regra da 1092 de pé: Instagram e BSUIDs diferentes.
    expect(bloqueios).toMatch(/'instagram'/);
    expect(bloqueios).toMatch(/'bsuid_diferentes'/);
  });

  it('DEFAULT-DENY: a ÚLTIMA definição de cb_bloqueios_da_uniao no replay mantém a exceção da reserva', () => {
    let ultima: { arquivo: string; corpo: string } | null = null;
    for (const m of MIGRATIONS) {
      const corpo = corpoDaFuncao(m.sql, 'cb_bloqueios_da_uniao');
      if (corpo) ultima = { arquivo: m.arquivo, corpo };
    }
    expect(ultima).not.toBeNull();
    expect(ultima!.arquivo >= ARQUIVO).toBe(true);
    expect(ultima!.corpo, `${ultima!.arquivo} recriou a regra sem a exceção da reserva`).toMatch(/'lixeira:'/);
  });

  it('a conversa da fotografia entra como HISTÓRICO: encerrada, sem responsável, sem espera, sem não lidas, IA como o encerrar deixa', () => {
    const p = funcao('cb_lixeira_preparar_uniao');
    expect(p).toMatch(
      /'status',\s*'closed',\s*'assigned_agent_id',\s*NULL,\s*'aguardando_desde',\s*NULL,\s*'unread_count',\s*0/i,
    );
    // O que `cb_encerrar_limpa_ia` faz ao encerrar, para a que estava aberta.
    for (const campo of ['ia_agente_id', 'ai_autoreply_disabled', 'ia_pausada_por', 'ia_pausada_em', 'ia_retomada_em']) {
      expect(p, campo).toMatch(new RegExp(`'${campo}'`));
    }
    // Antes da volta (o miolo reinsere a fotografia já assim).
    expect(p.search(/jsonb_set\(\s*x\.fotografia,\s*'\{conversations\}'/i)).toBeLessThan(
      p.search(/cb_lixeira_restaurar_um\(/i),
    );
  });

  it('a janela da Meta SÓ AVANÇA: a de hoje lida antes da união, a maior por chave, só quando casou pelo número', () => {
    const p = funcao('cb_lixeira_preparar_uniao');
    expect(p.search(/SELECT\s+c\.janela_meta\s+INTO\s+v_janela_fica/i)).toBeLessThan(p.search(/cb_lixeira_restaurar_um\(/i));
    expect(p).toMatch(/'casou_por_numero',\s*v_bate_tel\s+OR\s+v_bate_wa/i);
    const f = funcao('cb_restaurar_e_unir');
    const uniao = f.search(/v_uniao\s*:=\s*cb_unir_fichas\(/i);
    const janela = f.search(/IF\s+\(v_prep\s*->>\s*'casou_por_numero'\)::boolean/i);
    expect(janela).toBeGreaterThan(uniao);
    expect(f.slice(janela)).toMatch(/cb_instante_do_valor\(j\.foto[\s\S]*?>\s*cb_instante_do_valor\(j\.fica/i);
  });

  it('a reserva NUNCA sobra: sai da ficha que fica, o livro e a trilha levam a identidade original, e a função confere', () => {
    const f = funcao('cb_restaurar_e_unir');
    expect(f).toMatch(/UPDATE\s+contacts\s+c\s+SET\s+wa_user_id\s*=\s*NULL[\s\S]*?WHERE\s+c\.id\s*=\s*p_fica\s+AND\s+c\.wa_user_id\s*=\s*v_reserva/i);
    expect(f).toMatch(/UPDATE\s+cb_fichas_unidas\s+u\s+SET\s+foto\s*=[\s\S]*?'\{ficha,telefone\}'[\s\S]*?'\{ficha,wa_user_id\}'/i);
    expect(f).toMatch(/UPDATE\s+cb_lead_events\s+e\s+SET\s+details\s*=\s*jsonb_set\(\s*e\.details,\s*'\{removida\}'/i);
    // A trilha pela ficha que fica (o índice `(account_id, contact_id, …)`).
    const naTrilha = [...f.matchAll(/FROM\s+cb_lead_events\s+e[\s\S]*?(?:;|\))|UPDATE\s+cb_lead_events\s+e[\s\S]*?;/gi)];
    expect(naTrilha.length).toBeGreaterThanOrEqual(2);
    for (const m of naTrilha) expect(m[0]).toMatch(/e\.contact_id\s*=\s*p_fica/i);
    // O limite do tempo real (o INSERT da trilha com a identidade provisória)
    // fica escrito no cabeçalho.
    expect(BRUTO).toMatch(/LIMITE CONHECIDO \(o tempo real\)/);
    expect(f).toMatch(/RAISE\s+EXCEPTION\s+'lixeira_reserva_sobrou'/i);
  });

  // ── A faixa ─────────────────────────────────────────────────────────────

  it('a faixa: os três índices parciais da 1097, só contas de admin, nunca a fotografia', () => {
    const f = funcao('cb_lixeira_da_mesma_pessoa');
    const predicados: Record<string, string> = {};
    for (const m of SQL_1097.matchAll(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+(cb_lixeira_de_contatos_(?:telefone|bsuid|instagram)_idx)\s+ON[^\n]*\n\s*WHERE\s+([^;]+);/gi,
    )) {
      predicados[m[1]] = m[2].trim();
    }
    expect(Object.keys(predicados).sort()).toEqual([
      'cb_lixeira_de_contatos_bsuid_idx',
      'cb_lixeira_de_contatos_instagram_idx',
      'cb_lixeira_de_contatos_telefone_idx',
    ]);
    for (const [indice, predicado] of Object.entries(predicados)) {
      // O predicado do índice, com as colunas do alias `x`, tem de estar na
      // consulta — senão o planejador não pode usar o índice parcial.
      const comAlias = predicado.replace(/\b(telefone_canonico|wa_user_id|instagram_id)\b/g, 'x.$1');
      expect(f.replace(/\s+/g, ' '), indice).toContain(comAlias.replace(/\s+/g, ' '));
    }
    expect(f).toMatch(/cb_contas_do_usuario\(\s*'admin'::public\.account_role_enum\s*\)/i);
    expect(f).toMatch(/AS\s+MATERIALIZED/i);
    expect(f).toMatch(/com_instagram\s+boolean/i);
    expect(f).toMatch(/x\.instagram_id\s+IS\s+NOT\s+NULL\s+OR\s+f\.ig\s+IS\s+NOT\s+NULL/i);
    // Só colunas de lista: nem a fotografia, nem o BSUID, nem o Instagram.
    const [cabecalho, corpo] = f.split('AS $$');
    expect(cabecalho).not.toMatch(/fotografia|wa_user_id|instagram_id\b/i);
    expect(corpo).not.toMatch(/fotografia/i);
    expect(f).not.toMatch(/\bprofiles\b/i);
  });

  // ── A conferência ───────────────────────────────────────────────────────

  it('a conferência CHAMA as três RPCs numa ficha fictícia, desfeita pelo P11C1, e pula no banco vazio', () => {
    const conferencia = SQL.slice(SQL.lastIndexOf('DO $$'));
    for (const f of ['cb_lixeira_da_mesma_pessoa', 'cb_previa_restaurar_e_unir', 'cb_restaurar_e_unir', 'cb_mover_contatos_para_lixeira']) {
      expect(conferencia, f).toMatch(new RegExp(`public\\.${f}\\(`));
    }
    expect(conferencia).toMatch(/RAISE\s+EXCEPTION\s+USING\s+ERRCODE\s*=\s*'P11C1'/);
    expect(conferencia).toMatch(/WHEN\s+SQLSTATE\s+'P11C1'\s+THEN/);
    expect(conferencia).toMatch(/RAISE\s+NOTICE\s+'1101:\s+banco\s+vazio/);
    expect(conferencia).not.toMatch(/\b(ALTER|CREATE|DROP|GRANT|REVOKE)\s+/i);
    // A prévia é provada sem rastro: o item igual antes e depois.
    expect(conferencia).toMatch(/a prévia deixou rastro/);
  });
});
