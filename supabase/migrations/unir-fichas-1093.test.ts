import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1093 — UNIR FICHAS: os ajustes da revisão da 1092 e as decisões do
// operador sobre ela (14/10/2026). A 1092 já estava aplicada: a receita da
// fusão vigente é a desta migration.
//
// O que este pino segura — cada item foi achado da revisão ou decisão do
// operador, e o comportamento foi provado na réplica do esquema de produção:
// - só funções: nenhuma ALTER em tabela;
// - as travas: as CONVERSAS antes das fichas (a ordem dos gatilhos da
//   conversa, que gravam na trilha e no sino com FK para a ficha);
// - D8': as execuções SEGUEM O CARD, decididas pela mesma peça na prévia e
//   na união; a que segue leva a conversa nova no contexto;
// - o BSUID da que sai só passa quando uma das duas não tem telefone, e a
//   janela da Meta é a do número para o qual a conversa unida ENVIA;
// - a espera (972) calculada ANTES de as mensagens mudarem de conversa, sem
//   a fala de conversa encerrada;
// - o que apontava para a CÓPIA repetida passa para a mensagem que fica;
// - D10: "Data e Hora Reunião" fica a mais nova, na união e no "ficou de
//   fora", sem nunca estourar com valor torto;
// - D9': a busca dos cadastros só pelo telefone (a assinatura com e-mail
//   some), com o primeiro nome, só para o servidor;
// - a foto guarda o que não passa;
// - a conferência CHAMA a união num par fictício, desfeita por SQLSTATE
//   próprio.
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const semComentarios = (texto: string) =>
  texto
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

const bruto = fs.readFileSync(path.join(__dirname, '1093_cb_unir_fichas_ajustes.sql'), 'utf8');
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

describe('1093 — ajustes da união de fichas', () => {
  it('só funções: nenhuma ALTER em tabela (a 1092 já está aplicada)', () => {
    expect(sql).not.toMatch(/ALTER\s+TABLE/i);
  });

  it('a porta antes de qualquer trava; as CONVERSAS travadas antes das fichas', () => {
    const unir = funcao('cb_unir_fichas');
    expect(unir.split('$$')[0]).toMatch(/SECURITY\s+DEFINER/i);
    expect(unir.split('$$')[0]).toMatch(/SET\s+lock_timeout/i);
    expect(unir).toMatch(/p\.suspenso_em\s+IS\s+NULL/i);
    const porta = unir.search(/is_account_member\(\s*v_conta,\s*'admin'::account_role_enum\s*\)/i);
    const conversas = unir.search(
      /FROM\s+conversations\s+c\s+WHERE\s+c\.contact_id\s+IN\s*\(\s*p_fica,\s*p_sai\s*\)\s+ORDER\s+BY\s+c\.id\s+FOR\s+UPDATE/i,
    );
    const fichas = unir.search(/FROM\s+contacts\s+c\s+WHERE\s+c\.id\s+IN\s*\(\s*p_fica,\s*p_sai\s*\)\s+ORDER\s+BY\s+c\.id\s+FOR\s+UPDATE/i);
    expect(porta).toBeGreaterThanOrEqual(0);
    expect(porta).toBeLessThan(unir.search(/FOR\s+UPDATE/i));
    expect(conversas).toBeGreaterThan(porta);
    expect(conversas).toBeLessThan(fichas);
    // A conversa criada entre as duas travas também é travada.
    expect(unir.slice(fichas)).toMatch(/FROM\s+conversations\s+c\s+WHERE\s+c\.contact_id\s+IN\s*\(\s*p_fica,\s*p_sai\s*\)\s+ORDER\s+BY\s+c\.id\s+FOR\s+UPDATE/i);
  });

  it("D8': as execuções seguem o CARD, pela mesma peça na prévia e na união", () => {
    const execucoes = funcao('cb_execucoes_da_uniao');
    expect(execucoes).toMatch(/WHEN\s+c\.acao\s*=\s*'apaga'\s+THEN\s+'interrompe'/i);
    expect(execucoes).toMatch(/WHEN\s+v\.contact_id\s*=\s*p_sai\s+THEN\s+'interrompe'/i);
    expect(execucoes).toMatch(/e\.context\s*->>\s*'deal_id'/i);
    const previa = funcao('cb_previa_da_uniao');
    expect(previa).toMatch(/cb_execucoes_da_uniao\(\s*p_fica,\s*p_sai\s*\)/i);
    expect(previa).toMatch(/'automacoes_que_seguem'/i);
    const unir = funcao('cb_unir_fichas');
    expect(unir).toMatch(/cb_execucoes_da_uniao\(\s*p_fica,\s*p_sai\s*\)/i);
    expect(unir).toMatch(/interrompida_por\s*=\s*'fusao'/i);
    // Por execução decidida, nunca mais "toda execução da que sai".
    expect(unir).toMatch(/WHERE\s+l\.id\s*=\s*ANY\s*\(\s*v_logs\s*\)/i);
    // As execuções são decididas ANTES de qualquer card mudar.
    expect(unir.search(/cb_execucoes_da_uniao/i)).toBeLessThan(unir.search(/DELETE\s+FROM\s+deals/i));
    // A que segue leva a conversa nova (a retomada recusa a que não existe).
    expect(unir).toMatch(/jsonb_set\(\s*e\.context,\s*'\{conversation_id\}',\s*to_jsonb\(\s*v_conv_fica\.id::text\s*\)\s*\)/i);
  });

  it('BSUID e janela da Meta pelas fichas como estavam: o BSUID só passa sem telefone numa delas', () => {
    const unir = funcao('cb_unir_fichas');
    expect(unir).toMatch(/v_bsuid_passa\s*:=\s*v_sai\.phone\s+IS\s+NULL\s+OR\s+v_fica\.phone\s+IS\s+NULL/i);
    expect(unir).toMatch(/wa_user_id\s*=\s*CASE\s+WHEN\s+v_bsuid_passa\s+THEN/i);
    expect(unir).not.toMatch(/wa_user_id\s*=\s*coalesce\(\s*c\.wa_user_id,\s*v_sai\.wa_user_id\s*\)\s*,/i);
    expect(unir).toMatch(/janela_meta\s*=\s*CASE\s+WHEN\s+v_janela_da_sai\s+THEN\s+v_conv_sai\.janela_meta\s+ELSE\s+c\.janela_meta\s+END/i);
    // A soma das duas janelas (o maior carimbo por número) não volta.
    expect(unir).not.toMatch(/jsonb_each_text\(\s*v_conv_sai\.janela_meta\s*\)/i);
    // Só a que sai tinha conversa: ela passa, mas a janela é do número dela.
    expect(unir).toMatch(/janela_meta\s*=\s*CASE\s+WHEN\s+v_janela_da_sai\s+THEN\s+janela_meta\s+ELSE\s+'\{\}'::jsonb\s+END/i);
  });

  it('a espera é calculada ANTES de as mensagens mudarem de conversa, sem a fala da encerrada', () => {
    const unir = funcao('cb_unir_fichas');
    const espera = unir.search(/INTO\s+v_espera/i);
    const move = unir.search(/UPDATE\s+messages\s+m\s+SET\s+conversation_id\s*=\s*v_conv_fica\.id/i);
    expect(espera).toBeGreaterThanOrEqual(0);
    expect(espera).toBeLessThan(move);
    expect(unir).toMatch(/v_conv_fica\.status\s*<>\s*'closed'\s+AND\s+m\.created_at\s*>=\s*v_conv_fica\.aguardando_desde/i);
    expect(unir).toMatch(/v_conv_sai\.status\s*<>\s*'closed'\s+AND\s+m\.created_at\s*>=\s*v_conv_sai\.aguardando_desde/i);
    expect(unir).toMatch(/aguardando_desde\s*=\s*CASE\s+WHEN\s+c\.status\s*=\s*'closed'\s+AND\s+v_conv_sai\.status\s*=\s*'closed'/i);
  });

  it('o que apontava para a CÓPIA repetida passa para a mensagem que fica, antes de a conversa sair', () => {
    const unir = funcao('cb_unir_fichas');
    for (const alvo of [
      /UPDATE\s+messages\s+m\s+SET\s+reply_to_message_id\s*=\s*p\.original/i,
      /UPDATE\s+cb_scheduled_messages\s+a\s+SET\s+reply_to_message_id\s*=\s*p\.original/i,
      /UPDATE\s+message_reactions\s+r\s+SET\s+message_id\s*=\s*p\.original/i,
      /UPDATE\s+cb_ligacoes\s+g\s+SET\s+message_id\s*=\s*p\.original/i,
      /UPDATE\s+cb_ia_turnos\s+t\s+SET\s+mensagem_gatilho_id\s*=\s*p\.original/i,
      /UPDATE\s+cb_ia_turnos\s+t\s+SET\s+mensagem_inicial_id\s*=\s*p\.original/i,
      /UPDATE\s+flow_runs\s+r\s+SET\s+last_prompt_message_id\s*=\s*p\.original/i,
      /UPDATE\s+cb_mensagens_sem_telefone\s+s\s+SET\s+message_id\s*=\s*p\.original/i,
    ]) {
      const pos = unir.search(alvo);
      expect(pos, String(alvo)).toBeGreaterThanOrEqual(0);
      expect(pos).toBeLessThan(unir.search(/DELETE\s+FROM\s+conversations\s+WHERE\s+id\s*=\s*v_conv_sai\.id/i));
    }
  });

  it('D10: "Data e Hora Reunião" fica a mais nova, na união e no "ficou de fora"; o instante nunca estoura', () => {
    const instante = funcao('cb_instante_do_valor');
    expect(instante).toMatch(/EXCEPTION\s+WHEN\s+invalid_datetime_format\s+OR\s+datetime_field_overflow\s+THEN\s+RETURN\s+NULL/i);
    expect(instante).not.toMatch(/WHEN\s+OTHERS/i);
    const unir = funcao('cb_unir_fichas');
    expect(unir).toMatch(
      /cf\.field_key\s*=\s*'data_e_hora_reuniao'\s+AND\s+cb_instante_do_valor\(\s*vs\.value\s*\)\s*>\s*cb_instante_do_valor\(\s*vf\.value\s*\)/i,
    );
    // A regra da reunião vem ANTES de "o vazio recebe o da que sai".
    expect(unir.search(/data_e_hora_reuniao/i)).toBeLessThan(
      unir.search(/coalesce\(\s*btrim\(\s*vf\.value\s*\),\s*''\s*\)\s*=\s*''\s+AND\s+coalesce\(\s*btrim\(\s*vs\.value\s*\),\s*''\s*\)\s*<>\s*''/i),
    );
    const divergencias = funcao('cb_divergencias_da_uniao');
    expect(divergencias).toMatch(/cf\.field_key\s*=\s*'data_e_hora_reuniao'/i);
    expect(divergencias).toMatch(/CASE\s+WHEN\s+x\.sai_mais_nova\s+THEN\s+vs\.value\s+ELSE\s+vf\.value\s+END/i);
  });

  it("D9': a busca dos cadastros só pelo TELEFONE antigo, com o primeiro nome, só para o servidor", () => {
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.cb_ficha_por_contato_antigo\(uuid,\s*text,\s*text,\s*text\);/i);
    const busca = funcao('cb_ficha_por_contato_antigo');
    expect(busca).toMatch(/\(\s*p_conta\s+uuid,\s*p_telefone_canonico\s+text,\s*p_nome\s+text\s*\)/i);
    expect(busca).toMatch(/a\.tipo\s*=\s*'telefone'/i);
    expect(busca).not.toMatch(/p_email/i);
    expect(busca).toMatch(/cb_primeiro_nome\(c\.name\)\s*=\s*cb_primeiro_nome\(p_nome\)/i);
    expect(sql).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_ficha_por_contato_antigo\(uuid,\s*text,\s*text\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated;/i,
    );
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_ficha_por_contato_antigo\(uuid,\s*text,\s*text\)\s+TO\s+service_role;/i);
  });

  it('as peças internas sem EXECUTE para fora; as RPCs da tela para authenticated', () => {
    for (const rpc of ['cb_previa_da_uniao(uuid, uuid)', 'cb_unir_fichas(uuid, uuid)']) {
      const nome = rpc.replace(/[()]/g, (c) => `\\${c}`);
      expect(sql).toMatch(new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${nome}\\s+FROM\\s+PUBLIC,\\s*anon;`, 'i'));
      expect(sql).toMatch(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${nome}\\s+TO\\s+authenticated;`, 'i'));
    }
    for (const interna of ['cb_instante_do_valor', 'cb_execucoes_da_uniao', 'cb_divergencias_da_uniao']) {
      expect(sql).toMatch(
        new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${interna}\\([^)]*\\)\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated;`, 'i'),
      );
      expect(sql).not.toMatch(new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${interna}\\b`, 'i'));
    }
  });

  it('a foto guarda o que não passa; a receita da 1092 continua (catálogo, livro → DELETE → identidade)', () => {
    const unir = funcao('cb_unir_fichas');
    for (const chave of ["'cards_apagados'", "'wa_user_id',\\s*v_sai\\.wa_user_id", "'ia_desligada'", "'relacionados'", "'atlas'"]) {
      expect(unir).toMatch(new RegExp(chave, 'i'));
    }
    expect(unir).toMatch(/RAISE\s+EXCEPTION\s+'uniao_sem_tratamento:%'/i);
    const livro = unir.search(/INSERT\s+INTO\s+cb_fichas_unidas/i);
    const apaga = unir.search(/DELETE\s+FROM\s+contacts\s+WHERE\s+id\s*=\s*p_sai/i);
    const identidade = unir.search(/SET\s+phone\s*=\s*CASE\s+WHEN\s+c\.phone\s+IS\s+NULL/i);
    expect(unir.search(/uniao_sem_tratamento/i)).toBeLessThan(livro);
    expect(livro).toBeLessThan(apaga);
    expect(apaga).toBeLessThan(identidade);
    expect(unir).not.toMatch(/INSERT\s+INTO\s+cb_lead_events/i);
    expect(unir).not.toMatch(/INSERT\s+INTO\s+contact_tags/i);
  });

  it('a conferência CHAMA a união num par fictício, desfeita por SQLSTATE próprio', () => {
    const inicio = sql.search(/DO\s+\$\$\s*DECLARE\s+v_conta/i);
    expect(inicio).toBeGreaterThan(0);
    const conferencia = sql.slice(inicio);
    expect(conferencia).toMatch(/public\.cb_previa_da_uniao\(\s*v_fica,\s*v_sai\s*\)/i);
    expect(conferencia).toMatch(/public\.cb_unir_fichas\(\s*v_fica,\s*v_sai\s*\)/i);
    expect(conferencia).toMatch(/public\.cb_ficha_por_contato_antigo\(\s*v_conta,/i);
    expect(conferencia).toMatch(/ERRCODE\s*=\s*'P1093'/i);
    expect(conferencia).toMatch(/WHEN\s+SQLSTATE\s+'P1093'/i);
    expect(conferencia).not.toMatch(/WHEN\s+OTHERS/i);
    expect(conferencia).toMatch(/RAISE\s+NOTICE\s+'1093: banco vazio/i);
  });
});
