import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { RECUSA_DE_SUSPENSO } from '../../src/lib/account/suspensao';

// ============================================================
// 1067 — membro SUSPENSO. O corte mora no banco; este pino segura as peças
// que um merge ou uma migration nova derrubariam em silêncio:
//
// 1. A ÚLTIMA definição de cada função que decide "é membro?" confere
//    `suspenso_em`. Um CREATE OR REPLACE posterior que reproduza o corpo
//    antigo (a lição da 922/960) devolveria o acesso a quem está suspenso,
//    sem erro nenhum.
// 2. DEFAULT-DENY: toda função SECURITY DEFINER que lê `profiles` pelo
//    `auth.uid()` ignora a RLS — e com ela a suspensão. Função nova assim
//    reprova até conferir `suspenso_em` ou entrar na lista abaixo, com o
//    motivo escrito.
// 3. As policies que escondem a própria linha e os avisos continuam na forma
//    da 1067 no fim do replay.
// 4. A mensagem `membro_suspenso` é contrato com o batimento de presença.
//
// LIMITE DECLARADO: lê os `.sql`. Função criada por `EXECUTE` dentro de um DO
// é invisível aqui — a conferência da própria 1067 confere o catálogo.
// ============================================================

const DIR = __dirname;
const SQL_1067 = fs.readFileSync(path.join(DIR, '1067_cb_membro_suspenso.sql'), 'utf8');

type Definicao = { arquivo: string; texto: string };

/** O texto da função: do CREATE até o fechamento do seu dollar-quote. */
function recortarFuncao(sql: string, inicio: number): string {
  const abre = /\$([A-Za-z_]*)\$/g;
  abre.lastIndex = inicio;
  const m = abre.exec(sql);
  if (!m) return sql.slice(inicio);
  const tag = m[0];
  const fecha = sql.indexOf(tag, m.index + tag.length);
  return sql.slice(inicio, fecha === -1 ? undefined : fecha + tag.length);
}

/** Replay: a ÚLTIMA definição de cada função, em ordem de nome de arquivo. */
function ultimasDefinicoes(): Map<string, Definicao> {
  const arquivos = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const cria = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi;
  const vivas = new Map<string, Definicao>();
  for (const arquivo of arquivos) {
    const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
    for (const m of sql.matchAll(cria)) {
      vivas.set(m[1].toLowerCase(), { arquivo, texto: recortarFuncao(sql, m.index!) });
    }
    // DROP FUNCTION tira a função do replay (a 0940 apaga um overload, por
    // exemplo) — sem assinatura aqui, basta o nome para esta pergunta.
    for (const m of sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(/gi)) {
      const nome = m[1].toLowerCase();
      const def = vivas.get(nome);
      if (def && def.arquivo !== arquivo) vivas.delete(nome);
    }
  }
  return vivas;
}

/** SECURITY DEFINER que lê `profiles` pelo `auth.uid()`: ignora a RLS. */
function lePerfilDoChamador(texto: string): boolean {
  return /SECURITY\s+DEFINER/i.test(texto) && /\bprofiles\b/i.test(texto) && /auth\.uid\(\)/i.test(texto);
}

/**
 * Quem lê `profiles` pelo `auth.uid()` SEM conferir a suspensão, e por quê
 * não precisa. Entrada nova aqui é decisão visível no diff.
 */
const SEM_CONFERIR_A_SUSPENSAO: Record<string, string> = {
  redeem_invitation:
    'exige que o chamador seja o DONO único da conta atual, e o dono não pode ser suspenso (cb_definir_suspensao recusa)',
  cb_lead_event_actor: 'só resolve o NOME do autor para a trilha (912); não é chamável pelo navegador',
  notify_conversation_assigned: 'gatilho: grava o aviso para quem RECEBE a conversa; não decide acesso de ninguém',
  cb_reunioes_marcos_carimbo:
    'gatilho (1063): só carimba o NOME de quem marcou; a escrita na tabela já exige is_account_member',
};

describe('1067 — membro suspenso', () => {
  const vivas = ultimasDefinicoes();

  it('as funções que decidem "é membro?" conferem a suspensão na ÚLTIMA definição', () => {
    for (const nome of [
      'is_account_member',
      'cb_contas_do_usuario',
      'touch_presence',
      'cb_marcar_conversa_aberta',
      'set_member_role',
      'remove_account_member',
      'transfer_account_ownership',
      'enforce_profile_privilege_columns',
      'cb_definir_suspensao',
    ]) {
      const def = vivas.get(nome);
      expect(def, `${nome} não foi encontrada no replay`).toBeDefined();
      expect(def!.texto, `${nome} (em ${def!.arquivo}) não confere suspenso_em`).toMatch(/suspenso_em/);
    }
  });

  it('as duas perguntas centrais cortam o suspenso do MESMO jeito', () => {
    for (const nome of ['is_account_member', 'cb_contas_do_usuario']) {
      expect(vivas.get(nome)!.texto, nome).toMatch(/p\.suspenso_em\s+IS\s+NULL/i);
    }
  });

  it('DEFAULT-DENY: SECURITY DEFINER que lê profiles pelo auth.uid() confere suspenso_em ou tem motivo escrito', () => {
    const fora: string[] = [];
    for (const [nome, def] of vivas) {
      if (!lePerfilDoChamador(def.texto)) continue;
      if (/suspenso_em/.test(def.texto)) continue;
      if (nome in SEM_CONFERIR_A_SUSPENSAO) continue;
      fora.push(`${nome} (${def.arquivo})`);
    }
    expect(fora).toEqual([]);
  });

  it('a lista de exceções não guarda nome morto nem função que já confere', () => {
    for (const nome of Object.keys(SEM_CONFERIR_A_SUSPENSAO)) {
      const def = vivas.get(nome);
      expect(def, `${nome} saiu do replay — tire da lista`).toBeDefined();
      expect(lePerfilDoChamador(def!.texto), `${nome} não lê profiles pelo auth.uid() — tire da lista`).toBe(true);
      expect(def!.texto, `${nome} já confere suspenso_em — tire da lista`).not.toMatch(/suspenso_em/);
    }
  });

  it('o detector pega a forma que interessa — senão o default-deny não prova nada', () => {
    expect(
      lePerfilDoChamador("SECURITY DEFINER AS $$ SELECT 1 FROM profiles WHERE user_id = auth.uid() $$"),
    ).toBe(true);
    expect(lePerfilDoChamador('SECURITY INVOKER AS $$ SELECT 1 FROM profiles WHERE user_id = auth.uid() $$')).toBe(
      false,
    );
    expect(vivas.get('touch_presence')!.arquivo).not.toBe('0024_member_presence.sql');
  });

  it('a própria linha e os avisos: as policies ficam na forma da 1067', () => {
    const alter = (politica: string) => {
      const m = SQL_1067.match(new RegExp(`ALTER\\s+POLICY\\s+${politica}\\s+ON[^;]*;`, 'i'));
      expect(m, `${politica} não é alterada pela 1067`).not.toBeNull();
      return m![0];
    };
    expect(alter('profiles_select')).toMatch(/user_id\s+AND\s+suspenso_em\s+IS\s+NULL/i);
    expect(alter('profiles_update')).toMatch(/suspenso_em\s+IS\s+NULL/i);
    for (const p of ['notifications_select', 'notifications_update']) {
      expect(alter(p)).toMatch(/=\s*ANY\s*\(\s*ARRAY\s*\(\s*SELECT\s+public\.cb_contas_do_usuario\(\)\s*\)\s*\)/i);
    }

    // Nenhuma migration POSTERIOR à 1067 mexe nelas sem manter o corte.
    const depois = fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith('.sql') && f > '1067_cb_membro_suspenso.sql');
    for (const arquivo of depois) {
      const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
      for (const m of sql.matchAll(/(?:ALTER|CREATE)\s+POLICY\s+(profiles_select|profiles_update|notifications_select|notifications_update)\s+ON[^;]*;/gi)) {
        const corte = m[1].startsWith('profiles') ? /suspenso_em/ : /cb_contas_do_usuario/;
        expect(m[0], `${m[1]} em ${arquivo}`).toMatch(corte);
      }
    }
  });

  it('a recusa `membro_suspenso` é a mesma mensagem que o navegador reconhece', () => {
    expect(RECUSA_DE_SUSPENSO).toBe('membro_suspenso');
    const recusas = [...SQL_1067.matchAll(/RAISE\s+EXCEPTION\s+'(membro_suspenso)'\s+USING\s+ERRCODE\s*=\s*'42501'/g)];
    // touch_presence, cb_marcar_conversa_aberta, set_member_role,
    // remove_account_member e cb_definir_suspensao.
    expect(recusas).toHaveLength(5);
  });

  it('a migration trava antes de mexer em profiles, e a conferência desfaz a prova pelo SQLSTATE próprio', () => {
    const trava = SQL_1067.search(/SET\s+LOCAL\s+lock_timeout/i);
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(trava).toBeLessThan(SQL_1067.search(/ALTER\s+TABLE\s+public\.profiles/i));
    const semComentarios = SQL_1067.replace(/--[^\n]*/g, '');
    expect(semComentarios).toMatch(/WHEN\s+SQLSTATE\s+'P1067'\s+THEN\s+NULL/);
    expect(semComentarios).not.toMatch(/WHEN\s+OTHERS/i);
  });
});
