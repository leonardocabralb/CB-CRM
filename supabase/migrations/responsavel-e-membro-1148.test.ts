import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1148 e 1149 — o responsável da conversa tem de ser membro da conta;
// remover membro devolve as conversas à fila; o `flow-media` só para
// atendente para cima, na pasta da conta. Porte do #682 do original.
//
// O que este pino segura (cada peça cai em silêncio num CREATE OR REPLACE
// posterior ou num merge que traga a 055 do original crua):
//   (a) o gatilho: BEFORE INSERT OR UPDATE OF assigned_agent_id, account_id,
//       SEM `WHEN` (roda na volta da Lixeira, declarado em `livres`), lendo o
//       perfil `FOR KEY SHARE` e sem olhar a suspensão (suspenso é membro,
//       1067);
//   (b) a ÚLTIMA `remove_account_member` do replay: a trava (alvo FOR UPDATE,
//       chamador FOR SHARE, em ordem de user_id) e as conversas de volta à
//       fila ANTES de mover o perfil, sem perder as guardas da 961/1067;
//   (c) a lista VIGENTE da Lixeira declara o gatilho em `livres`;
//   (d) as policies VIGENTES do `flow-media`: escrita só owner/admin/agent
//       ativos, só na pasta da conta, e nenhuma aceita a pasta por usuário;
//   (e) a conferência da 1148 desfaz a prova pelo SQLSTATE próprio.
//
// LIMITE DECLARADO: lê os `.sql`. DDL montado por `EXECUTE` dentro de um DO é
// invisível aqui — as conferências da 1148 e da 1149 leem o catálogo.
// ============================================================

const DIR = __dirname;
const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, '');

const MIGRATIONS = fs
  .readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((arquivo) => ({ arquivo, sql: semComentarios(fs.readFileSync(path.join(DIR, arquivo), 'utf8')) }));

const ARQUIVO_1148 = '1148_cb_responsavel_tem_de_ser_membro.sql';
const SQL_1148 = MIGRATIONS.find((m) => m.arquivo === ARQUIVO_1148)!.sql;

/** O texto de uma função: do CREATE até o dollar-quote que fecha. */
function corpoDaFuncao(sql: string, nome: string): string | null {
  const inicio = sql.search(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${nome}\\s*\\(`, 'i'));
  if (inicio < 0) return null;
  const resto = sql.slice(inicio);
  const abre = resto.indexOf('$$');
  const fecha = resto.indexOf('$$', abre + 2);
  return resto.slice(0, fecha + 2);
}

/** A ÚLTIMA definição da função no replay. */
function vigente(nome: string): { arquivo: string; corpo: string } {
  let achada: { arquivo: string; corpo: string } | null = null;
  for (const m of MIGRATIONS) {
    const corpo = corpoDaFuncao(m.sql, nome);
    if (corpo) achada = { arquivo: m.arquivo, corpo };
  }
  expect(achada, `${nome} sumiu do replay`).not.toBeNull();
  return achada!;
}

/** A ÚLTIMA criação de um gatilho ou de uma policy, no replay. */
function ultimaInstrucao(re: RegExp): { arquivo: string; texto: string } | null {
  let achada: { arquivo: string; texto: string } | null = null;
  for (const m of MIGRATIONS) {
    for (const x of m.sql.matchAll(re)) achada = { arquivo: m.arquivo, texto: x[0] };
  }
  return achada;
}

const compacto = (s: string) => s.replace(/\s+/g, ' ');

describe('1148 — (a) o gatilho do responsável', () => {
  const gatilho = ultimaInstrucao(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+cb_responsavel_tem_de_ser_membro_trigger\b[^;]*;/gi);
  const funcao = vigente('cb_responsavel_tem_de_ser_membro');

  it('BEFORE INSERT OR UPDATE OF assigned_agent_id, account_id, por linha, SEM WHEN', () => {
    expect(gatilho).not.toBeNull();
    const t = compacto(gatilho!.texto);
    expect(t).toMatch(
      /BEFORE INSERT OR UPDATE OF assigned_agent_id, account_id ON public\.conversations FOR EACH ROW EXECUTE FUNCTION public\.cb_responsavel_tem_de_ser_membro\(\)/i
    );
    // Com o WHEN do sinal ele calaria na volta da Lixeira — está em `livres`.
    expect(t).not.toMatch(/\bWHEN\b/i);
  });

  it('SECURITY DEFINER com search_path fixo, perfil lido FOR KEY SHARE, suspenso conta como membro', () => {
    const f = funcao.corpo;
    expect(f).toMatch(/SECURITY\s+DEFINER/i);
    expect(f).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(compacto(f)).toMatch(
      /FROM profiles WHERE user_id = NEW\.assigned_agent_id AND account_id = NEW\.account_id FOR KEY SHARE/i
    );
    // A suspensão (1067) não reatribui nada: o gatilho não pode olhá-la.
    expect(f).not.toMatch(/suspenso_em/i);
    // Fica o anterior (se ainda for membro) ou ninguém — nunca recusa a escrita.
    expect(compacto(f)).toMatch(/NEW\.assigned_agent_id := OLD\.assigned_agent_id/);
    expect(compacto(f)).toMatch(/NEW\.assigned_agent_id := NULL/);
    expect(f).not.toMatch(/RAISE\s+EXCEPTION/i);
  });

  it('a função do gatilho não é RPC: EXECUTE revogado de PUBLIC, anon e authenticated', () => {
    expect(SQL_1148).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_responsavel_tem_de_ser_membro\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i
    );
  });
});

describe('1148 — (b) a ÚLTIMA remove_account_member do replay', () => {
  const { arquivo, corpo } = vigente('remove_account_member');
  const c = compacto(corpo);

  it('é a da 1148 ou de uma posterior (refazer sem as peças novas reprova aqui)', () => {
    expect(arquivo >= ARQUIVO_1148).toBe(true);
  });

  it('trava em ordem de user_id: o ALVO FOR UPDATE, o CHAMADOR FOR SHARE', () => {
    expect(c).toContain('IF auth.uid() < p_user_id THEN');
    expect(c).toContain('PERFORM 1 FROM profiles WHERE user_id = p_user_id FOR UPDATE;');
    expect(c).toContain('PERFORM 1 FROM profiles WHERE user_id = auth.uid() FOR SHARE;');
    // A trava vem antes de qualquer leitura do papel.
    expect(c.indexOf('FOR UPDATE')).toBeLessThan(c.indexOf('SELECT account_id, account_role, suspenso_em'));
  });

  it('devolve as conversas à fila ANTES de mover o perfil (a trilha ainda acha o nome)', () => {
    const solta = c.indexOf(
      'UPDATE conversations SET assigned_agent_id = NULL WHERE account_id = v_target_account_id AND assigned_agent_id = p_user_id;'
    );
    expect(solta).toBeGreaterThan(-1);
    expect(solta).toBeLessThan(c.indexOf('UPDATE profiles SET account_id = v_new_account_id'));
  });

  it('não perde as guardas que vieram de antes (961, 1067)', () => {
    expect(c).toContain('perfil_id = NULL');
    expect(c).toContain('suspenso_em = NULL');
    expect(c).toMatch(/RAISE EXCEPTION 'membro_suspenso' USING ERRCODE = '42501'/);
    expect(c).toContain("Cannot remove the account owner");
  });
});

describe('1148 — (c) a Lixeira declara o gatilho', () => {
  it('a lista VIGENTE o tem em `livres`, nunca em `calados`', () => {
    const corpo = vigente('cb_lixeira_tratamento').corpo;
    const calados = corpo.slice(corpo.indexOf("'calados'"), corpo.indexOf("'livres'"));
    const livres = corpo.slice(corpo.indexOf("'livres'"));
    expect(livres).toContain("'conversations.cb_responsavel_tem_de_ser_membro_trigger'");
    expect(calados).not.toContain('cb_responsavel_tem_de_ser_membro');
  });
});

describe('1149 — (d) as policies VIGENTES do flow-media', () => {
  const ESCRITA = ['Members can upload flow media', 'Members can update flow media', 'Members can delete flow media'];
  const LEITURA = 'Flow media is readable by account members';

  const ultima = (nome: string) => {
    const achada = ultimaInstrucao(new RegExp(`CREATE\\s+POLICY\\s+"${nome}"[^;]*;`, 'gi'));
    expect(achada, nome).not.toBeNull();
    return { ...achada!, texto: compacto(achada!.texto) };
  };

  it('escrita: owner/admin/agent ATIVOS, só na pasta da conta — da 1149 ou posterior', () => {
    for (const nome of ESCRITA) {
      const p = ultima(nome);
      expect(p.arquivo >= '1149', nome).toBe(true);
      expect(p.texto, nome).toContain("p.account_role IN ('owner', 'admin', 'agent')");
      expect(p.texto, nome).toContain('p.suspenso_em IS NULL');
      expect(p.texto, nome).toContain("('account-' || p.account_id::text) = (storage.foldername(name))[1]");
      expect(p.texto, nome).not.toMatch(/viewer/i);
    }
  });

  it('nenhuma (escrita nem leitura) aceita a pasta por usuário', () => {
    for (const nome of [...ESCRITA, LEITURA]) {
      expect(ultima(nome).texto, nome).not.toMatch(/auth\.uid\(\)::text\s*=\s*\(storage\.foldername/i);
    }
  });
});

describe('1148 — (e) a conferência', () => {
  const cru = fs.readFileSync(path.join(DIR, ARQUIVO_1148), 'utf8');

  it('trava antes da primeira DDL e desfaz a prova pelo SQLSTATE próprio, sem WHEN OTHERS', () => {
    const trava = cru.search(/SET\s+LOCAL\s+lock_timeout/i);
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(trava).toBeLessThan(cru.search(/CREATE\s+OR\s+REPLACE\s+TRIGGER/i));
    expect(SQL_1148).toMatch(/WHEN\s+SQLSTATE\s+'P1148'\s+THEN\s+NULL/);
    expect(SQL_1148).not.toMatch(/WHEN\s+OTHERS/i);
    // A prova CHAMA a função recriada (regra 3 do CLAUDE.md).
    expect(SQL_1148).toMatch(/PERFORM\s+public\.remove_account_member\(v_alvo\)/);
  });
});
