import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================
// 1097 — a Lixeira de contatos. A conferência da própria migration pega no
// BANCO o que foge do tratamento (tabela no fecho do CASCADE, ponteiro SET
// NULL, gatilho sem o WHEN do sinal) — mas só quando alguém tenta mover ou
// restaurar, e aí a ficha fica presa com `lixeira_sem_tratamento`. Este pino
// avisa no PR, lendo os `.sql`:
//
// (a) cada gatilho CALADO de `cb_lixeira_tratamento()` é criado na 1097 com o
//     WHEN do sinal (`nullif(current_setting('cb.lixeira', true), '') IS
//     NULL`) — sem ele, restaurar mandaria aviso, trilha e espera como se
//     tudo fosse novo;
// (b) DEFAULT-DENY: migration POSTERIOR que recrie um desses gatilhos sem o
//     WHEN reprova (o caso típico: um merge do upstream trazendo o
//     `set_updated_at` ou o `on_conversation_assigned` crus);
// (c) as portas: vencimento e drenagem só para o `service_role`; as RPCs da
//     tela para `authenticated`, nunca `anon`; as peças internas para
//     ninguém; função nova da 1097 sem porta declarada aqui reprova;
// (d) DEFAULT-DENY: migration posterior que crie FK (REFERENCES) para uma
//     tabela do FECHO da ficha tem de redefinir `cb_lixeira_tratamento` no
//     mesmo arquivo — ou entrar em `FK_SEM_TRATAMENTO_NOVO`, com o motivo.
//
// LIMITE DECLARADO: lê os `.sql`. DDL montado por `EXECUTE` dentro de um DO é
// invisível aqui — a conferência 14.3 da 1097 confere o catálogo.
// ============================================================

const DIR = __dirname;
const ARQUIVO = '1097_cb_lixeira_de_contatos.sql';
const NUMERO = 1097;

const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, '');
const SQL = semComentarios(fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8'));

/** As migrations NUMERADAS (4 dígitos), na ordem do replay. */
const MIGRATIONS = fs
  .readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((arquivo) => ({
    arquivo,
    numero: Number(arquivo.slice(0, 4)),
    sql: semComentarios(fs.readFileSync(path.join(DIR, arquivo), 'utf8')),
  }));
const POSTERIORES = MIGRATIONS.filter((m) => m.numero > NUMERO);

/** O texto de uma função: do CREATE até o `$$` que fecha. */
function corpoDaFuncao(sql: string, nome: string): string | null {
  const inicio = sql.search(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${nome}\\s*\\(`, 'i'));
  if (inicio < 0) return null;
  const resto = sql.slice(inicio);
  const abre = resto.indexOf('$$');
  const fecha = resto.indexOf('$$', abre + 2);
  return resto.slice(0, fecha + 2);
}

/** `cb_lixeira_tratamento()` vigente: a da ÚLTIMA migration que a define. */
function tratamentoVigente(): { arquivo: string; corpo: string } {
  let vigente: { arquivo: string; corpo: string } | null = null;
  for (const m of MIGRATIONS) {
    const corpo = corpoDaFuncao(m.sql, 'cb_lixeira_tratamento');
    if (corpo) vigente = { arquivo: m.arquivo, corpo };
  }
  expect(vigente, 'cb_lixeira_tratamento sumiu do replay').not.toBeNull();
  return vigente!;
}

/** Um trecho do tratamento: de `'<chave>'` até a chave seguinte. */
function trecho(corpo: string, chave: string, seguinte: string): string {
  const inicio = corpo.indexOf(`'${chave}'`);
  const fim = corpo.indexOf(`'${seguinte}'`, inicio + 1);
  expect(inicio, chave).toBeGreaterThanOrEqual(0);
  expect(fim, seguinte).toBeGreaterThan(inicio);
  return corpo.slice(inicio, fim);
}

function fecho(corpo: string): Map<string, string> {
  const pares = [...trecho(corpo, 'fecho', 'ordem').matchAll(/'(\w+)'\s*,\s*'(volta|par|nao_volta)'/g)];
  return new Map(pares.map((p) => [p[1], p[2]]));
}

function calados(corpo: string): string[] {
  return [...trecho(corpo, 'calados', 'livres').matchAll(/'(\w+\.\w+)'/g)].map((m) => m[1]);
}

/** Toda instrução CREATE [OR REPLACE] TRIGGER, com nome, tabela e o WHEN. */
function gatilhosCriados(sql: string): { chave: string; when: string; texto: string }[] {
  return [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)\b([^;]*);/gi)].map((m) => {
    const tabela = m[2].match(/\bON\s+(?:public\.)?"?(\w+)"?/i)?.[1] ?? '?';
    const when = m[2].match(/\bWHEN\s*\(([\s\S]*)\)\s*EXECUTE\b/i)?.[1] ?? '';
    return { chave: `${tabela}.${m[1]}`, when, texto: m[0] };
  });
}

const SINAL = "nullif(current_setting('cb.lixeira', true), '') IS NULL";
const temSinal = (when: string) => when.includes(SINAL);

/** As tabelas que um arquivo aponta por FK. */
function alvosDeFk(sql: string): string[] {
  return [...sql.matchAll(/\bREFERENCES\s+(?:public\.)?"?(\w+)"?/gi)].map((m) => m[1].toLowerCase());
}

/**
 * Migration posterior à 1097 que cria FK para o fecho SEM redefinir o
 * tratamento, e por que não precisa. Entrada nova aqui é decisão visível no
 * diff (ex.: recriar uma FK que já tem tratamento, com o mesmo nome).
 */
const FK_SEM_TRATAMENTO_NOVO: Record<string, string> = {};

describe('1097 — a Lixeira de contatos', () => {
  const vigente = tratamentoVigente();
  const fechoVigente = fecho(vigente.corpo);
  const caladosVigentes = calados(vigente.corpo);

  it('o leitor do tratamento acha o que interessa (senão o default-deny não prova nada)', () => {
    expect(vigente.arquivo >= ARQUIVO).toBe(true);
    expect(fechoVigente.get('contacts')).toBe('volta');
    expect(fechoVigente.get('cb_ia_turnos')).toBe('nao_volta');
    // As tabelas que o pino (d) tem de cobrir, no mínimo.
    for (const t of [
      'contacts',
      'conversations',
      'messages',
      'cb_tasks',
      'cb_conversation_notes',
      'cb_fichas_unidas',
      'cb_ia_turnos',
      'message_reactions',
    ]) {
      expect(fechoVigente.has(t), t).toBe(true);
    }
    expect(caladosVigentes).toContain('conversations.set_updated_at');
    expect(caladosVigentes).toContain('deals.set_updated_at');
    expect(caladosVigentes.length).toBeGreaterThanOrEqual(12);
  });

  // ── (a) e (b): os gatilhos calados ──────────────────────────────────────

  it('(a) cada gatilho calado é criado na 1097 com EXATAMENTE o WHEN do sinal', () => {
    const daqui = gatilhosCriados(SQL);
    for (const chave of calados(corpoDaFuncao(SQL, 'cb_lixeira_tratamento')!)) {
      const criado = daqui.filter((g) => g.chave === chave);
      expect(criado, `${chave} não é recriado na 1097`).toHaveLength(1);
      expect(temSinal(criado[0].when), `${chave} sem o WHEN do sinal`).toBe(true);
    }
  });

  it('(a) a conferência dos gatilhos procura a forma que o Postgres RENDERIZA do mesmo sinal', () => {
    const conferir = corpoDaFuncao(SQL, 'cb_lixeira_conferir_gatilhos')!;
    expect(conferir).toContain(
      "position('NULLIF(current_setting(''cb.lixeira''::text, true), ''''::text) IS NULL' IN v_g.def)",
    );
  });

  it('(b) DEFAULT-DENY: migration posterior que recrie um gatilho calado sem o WHEN reprova', () => {
    const fora: string[] = [];
    for (const m of POSTERIORES) {
      for (const g of gatilhosCriados(m.sql)) {
        if (caladosVigentes.includes(g.chave) && !temSinal(g.when)) fora.push(`${g.chave} (${m.arquivo})`);
      }
    }
    expect(fora).toEqual([]);
  });

  it('(b) a ÚLTIMA criação de cada gatilho calado, no replay inteiro, tem o WHEN', () => {
    const ultima = new Map<string, { arquivo: string; when: string }>();
    for (const m of MIGRATIONS) {
      for (const g of gatilhosCriados(m.sql)) ultima.set(g.chave, { arquivo: m.arquivo, when: g.when });
    }
    for (const chave of caladosVigentes) {
      const u = ultima.get(chave);
      expect(u, `${chave} não é criado em migration nenhuma`).toBeDefined();
      expect(temSinal(u!.when), `${chave} (última criação: ${u!.arquivo}) sem o WHEN do sinal`).toBe(true);
    }
  });

  it('(b) o detector pega a forma que interessa', () => {
    const cru = gatilhosCriados(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
    );
    expect(cru).toEqual([expect.objectContaining({ chave: 'deals.set_updated_at', when: '' })]);
    const comOutroWhen = gatilhosCriados(
      "CREATE OR REPLACE TRIGGER t AFTER INSERT ON messages FOR EACH ROW WHEN ((new.sender_type = 'agent'::text)) EXECUTE FUNCTION f();",
    );
    expect(comOutroWhen[0].chave).toBe('messages.t');
    expect(temSinal(comOutroWhen[0].when)).toBe(false);
  });

  it('o sinal é LOCAL à transação e nunca se cala gatilho por DISABLE TRIGGER', () => {
    const chamadas = [...SQL.matchAll(/set_config\(\s*'(cb\.lixeira(?:_pedido)?)'\s*,([^;]*?),\s*(\w+)\s*\)/g)];
    expect(chamadas.length).toBeGreaterThanOrEqual(8);
    for (const c of chamadas) expect(c[3], c[0]).toBe('true');
    expect(SQL).not.toMatch(/DISABLE\s+TRIGGER/i);
    expect(SQL).not.toMatch(/session_replication_role/i);
  });

  // ── (c) as portas ───────────────────────────────────────────────────────

  const SERVIDOR = ['cb_vencer_lixeira()', 'cb_reivindicar_arquivos_a_apagar(integer)'];
  const TELA = [
    'cb_mover_contatos_para_lixeira(uuid[], uuid)',
    'cb_previa_da_lixeira(uuid[])',
    'cb_restaurar_da_lixeira(uuid[], uuid)',
    'cb_excluir_da_lixeira(uuid[], boolean)',
    'cb_lixeira_da_conta(text)',
    'cb_negocios_na_lixeira(uuid[])',
    'cb_arquivos_da_lixeira_parados()',
  ];
  const INTERNAS = [
    'cb_lixeira_tratamento()',
    'cb_lixeira_fks()',
    'cb_lixeira_fotografar(uuid)',
    'cb_lixeira_ponteiros(jsonb)',
    'cb_lixeira_arquivos(jsonb, uuid)',
    'cb_lixeira_reinserir(regclass, jsonb, boolean)',
    'cb_lixeira_reapontar(jsonb)',
    'cb_lixeira_anular(jsonb)',
    'cb_lixeira_conferir_gatilhos()',
    'cb_lixeira_mover_um(uuid, uuid, uuid, uuid, text)',
    'cb_lixeira_restaurar_um(uuid)',
    'cb_lixeira_purgar_um(uuid, boolean)',
    'cb_log_lixeira()',
    'cb_arquivos_citados(uuid, text[])',
  ];
  /** A guarda do caminho: pura, a tela e o servidor a usam. */
  const GUARDA = ['cb_caminho_no_chat_media(text, uuid)'];

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const revoga = (sql: string, assinatura: string, de: string) =>
    new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${esc(assinatura)}\\s+FROM\\s+${de}\\s*;`, 'i').test(sql);
  const concessoes = (sql: string, assinatura: string) =>
    [
      ...sql.matchAll(
        new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${esc(assinatura)}\\s+TO\\s+([^;]+);`, 'gi'),
      ),
    ].flatMap((m) => m[1].split(',').map((p) => p.trim().toLowerCase()));

  it('(c) toda função da 1097 tem porta DECLARADA aqui (função nova sem decisão reprova)', () => {
    const criadas = [...SQL.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(/gi)].map((m) => m[1]).sort();
    const declaradas = [...SERVIDOR, ...TELA, ...INTERNAS, ...GUARDA].map((a) => a.slice(0, a.indexOf('('))).sort();
    expect(criadas).toEqual(declaradas);
  });

  it('(c) vencimento e drenagem: só o service_role (senão qualquer membro anteciparia o vencimento)', () => {
    for (const f of SERVIDOR) {
      expect(revoga(SQL, f, 'PUBLIC,\\s*anon,\\s*authenticated'), f).toBe(true);
      expect(concessoes(SQL, f), f).toEqual(['service_role']);
    }
  });

  it('(c) as RPCs da tela: authenticated sim (a porta de admin é por dentro), anon nunca', () => {
    for (const f of TELA) {
      expect(revoga(SQL, f, 'PUBLIC,\\s*anon'), f).toBe(true);
      expect(concessoes(SQL, f), f).toEqual(['authenticated']);
    }
  });

  it('(c) as peças internas: ninguém de fora (as RPCs rodam como dono)', () => {
    for (const f of INTERNAS) {
      expect(revoga(SQL, f, 'PUBLIC,\\s*anon,\\s*authenticated'), f).toBe(true);
      expect(concessoes(SQL, f), f).toEqual([]);
    }
  });

  it('(c) a guarda do caminho: authenticated e service_role, anon nunca', () => {
    for (const f of GUARDA) {
      expect(revoga(SQL, f, 'PUBLIC,\\s*anon'), f).toBe(true);
      expect(concessoes(SQL, f).sort(), f).toEqual(['authenticated', 'service_role']);
    }
  });

  it('(c) DEFAULT-DENY: migration posterior não abre vencimento, drenagem nem peça interna', () => {
    const fora: string[] = [];
    for (const m of POSTERIORES) {
      for (const f of [...SERVIDOR, ...INTERNAS]) {
        const abertas = concessoes(m.sql, f).filter((p) => p !== 'service_role');
        if (abertas.length > 0) fora.push(`${f} → ${abertas.join(', ')} (${m.arquivo})`);
      }
      for (const f of [...TELA, ...GUARDA]) {
        if (concessoes(m.sql, f).some((p) => p === 'anon' || p === 'public')) fora.push(`${f} → anon (${m.arquivo})`);
      }
    }
    expect(fora).toEqual([]);
  });

  it('(c) as duas tabelas são FECHADAS ao navegador: RLS ligada, sem policy, sem concessão', () => {
    for (const t of ['cb_lixeira_de_contatos', 'cb_arquivos_a_apagar']) {
      expect(SQL).toMatch(new RegExp(`ALTER\\s+TABLE\\s+public\\.${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'));
      expect(SQL).toMatch(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+public\\.${t}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i'));
      expect(SQL).toMatch(new RegExp(`GRANT\\s+ALL\\s+ON\\s+TABLE\\s+public\\.${t}\\s+TO\\s+service_role`, 'i'));
      for (const m of MIGRATIONS.filter((x) => x.numero >= NUMERO)) {
        expect(m.sql, `${t} ganhou policy em ${m.arquivo}`).not.toMatch(new RegExp(`CREATE\\s+POLICY\\s+\\S+\\s+ON\\s+public\\.${t}\\b`, 'i'));
      }
    }
  });

  // ── (d) FK nova para o fecho ────────────────────────────────────────────

  it('(d) DEFAULT-DENY: FK posterior para o fecho redefine o tratamento no mesmo arquivo', () => {
    const fora: string[] = [];
    for (const m of POSTERIORES) {
      const noFecho = [...new Set(alvosDeFk(m.sql).filter((t) => fechoVigente.has(t)))];
      if (noFecho.length === 0) continue;
      if (corpoDaFuncao(m.sql, 'cb_lixeira_tratamento')) continue;
      if (m.arquivo in FK_SEM_TRATAMENTO_NOVO) continue;
      fora.push(`${m.arquivo} → ${noFecho.join(', ')}`);
    }
    expect(fora).toEqual([]);
  });

  it('(d) a allowlist não guarda arquivo morto', () => {
    for (const arquivo of Object.keys(FK_SEM_TRATAMENTO_NOVO)) {
      expect(POSTERIORES.some((m) => m.arquivo === arquivo), `${arquivo} não existe (ou não é posterior)`).toBe(true);
    }
  });

  it('(d) o detector pega a forma que interessa', () => {
    expect(alvosDeFk('contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE')).toEqual(['contacts']);
    expect(alvosDeFk('ADD CONSTRAINT x FOREIGN KEY (a, b) REFERENCES conversations (id, account_id)')).toEqual([
      'conversations',
    ]);
    expect(alvosDeFk('nota uuid REFERENCES "cb_conversation_notes"(id)')).toEqual(['cb_conversation_notes']);
  });

  // ── a forma da migration ────────────────────────────────────────────────

  it('trava com teto ANTES da primeira ALTER, e a conferência desfaz a prova pelo SQLSTATE próprio', () => {
    const trava = SQL.search(/SET\s+LOCAL\s+lock_timeout/i);
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(trava).toBeLessThan(SQL.search(/ALTER\s+TABLE/i));
    const conferencia = SQL.slice(SQL.lastIndexOf('DO $$'));
    expect(conferencia).toMatch(/WHEN\s+SQLSTATE\s+'P1097'\s+THEN/);
    expect(conferencia).not.toMatch(/WHEN\s+OTHERS/i);
  });

  it('os CHECKs alargados vêm ANTES das funções que gravam os valores novos', () => {
    const marca = SQL.search(/automation_logs_interrompida_por_check\s+CHECK[^;]*'lixeira'/i);
    const evento = SQL.search(/cb_lead_events_event_type_check\s+CHECK[^;]*'contact_purged'/i);
    expect(marca).toBeGreaterThanOrEqual(0);
    expect(evento).toBeGreaterThanOrEqual(0);
    expect(marca).toBeLessThan(SQL.search(/FUNCTION\s+public\.cb_lixeira_mover_um/i));
    expect(evento).toBeLessThan(SQL.search(/FUNCTION\s+public\.cb_log_lixeira/i));
  });
});
