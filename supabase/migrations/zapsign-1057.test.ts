import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { CASADO_POR, RESULTADOS_DO_EVENTO } from '../../src/lib/zapsign/log';

// ============================================================
// As tabelas do ZapSign (1057) guardam o token da API e a credencial do
// webhook CIFRADOS e o log de cada assinatura (nome de quem assinou, o
// cliente). Nenhuma das três dá NADA a `authenticated` — a tela lê pela rota,
// com service role — e as três ficam com RLS ligada, para um GRANT dado por
// engano no futuro não abrir a tabela inteira. Mesmo racional do
// `rls-das-tabelas-do-calendly.test.ts`.
//
// E os dois vocabulários do log são ESPELHO dos CHECKs: valor novo no TS sem
// migration faz a gravação do resultado levar 23514 em silêncio (o Supabase
// devolve `error`, não lança), e a linha ficaria `recebido` para sempre.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const TABELAS = ['cb_zapsign_config', 'cb_zapsign_eventos', 'cb_zapsign_documentos'] as const;

const sql = fs.readFileSync(path.join(__dirname, '1057_cb_zapsign.sql'), 'utf8');

const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

/** Os valores entre aspas do CHECK nomeado. */
function valoresDoCheck(nome: string): string[] {
  const m = semComentarios.match(new RegExp(`CONSTRAINT\\s+${nome}\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*\\)`, 'i'));
  if (!m) throw new Error(`CHECK ${nome} não encontrado`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('1057 — RLS das tabelas do ZapSign', () => {
  it.each(TABELAS)('%s tem ENABLE ROW LEVEL SECURITY', (tabela) => {
    const padrao = new RegExp(`ALTER\\s+TABLE\\s+${tabela}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    expect(padrao.test(semComentarios)).toBe(true);
  });

  it.each(TABELAS)('%s não dá NADA a authenticated nem a anon', (tabela) => {
    expect(
      new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${tabela}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i').test(
        semComentarios,
      ),
    ).toBe(true);
    expect(new RegExp(`GRANT[^;]*\\bON\\s+TABLE\\s+${tabela}\\b[^;]*\\b(authenticated|anon)\\b`, 'i').test(semComentarios)).toBe(
      false,
    );
    expect(new RegExp(`CREATE\\s+POLICY[^;]*\\bON\\s+${tabela}\\b`, 'i').test(semComentarios)).toBe(false);
  });

  it.each(TABELAS)('%s concede tudo ao service_role por escrito', (tabela) => {
    expect(new RegExp(`GRANT\\s+ALL\\s+ON\\s+TABLE\\s+${tabela}\\s+TO\\s+service_role`, 'i').test(semComentarios)).toBe(true);
  });

  it('a idempotência do webhook é um UNIQUE TOTAL, não um "if" no código', () => {
    expect(
      /UNIQUE\s*\(\s*account_id\s*,\s*doc_token\s*,\s*event_type\s*,\s*signer_token\s*\)/i.test(semComentarios),
    ).toBe(true);
    // NOT NULL com DEFAULT '': só índice total serve de alvo do ON CONFLICT.
    expect(/signer_token\s+text\s+NOT\s+NULL\s+DEFAULT\s+''/i.test(semComentarios)).toBe(true);
  });

  it('um documento por conta, e o cadeado do disparo mora nele', () => {
    expect(/UNIQUE\s*\(\s*account_id\s*,\s*doc_token\s*\)/i.test(semComentarios)).toBe(true);
    expect(/disparo_evento_id\s+uuid\s+REFERENCES\s+cb_zapsign_eventos/i.test(semComentarios)).toBe(true);
  });

  it('contato e negócio com FK COMPOSTA e SET NULL só da coluna', () => {
    expect(/FOREIGN KEY \(contact_id, account_id\)/.test(semComentarios)).toBe(true);
    expect(/REFERENCES contacts \(id, account_id\) ON DELETE SET NULL \(contact_id\)/.test(semComentarios)).toBe(true);
    expect(/REFERENCES deals \(id, account_id\) ON DELETE SET NULL \(deal_id\)/.test(semComentarios)).toBe(true);
  });
});

describe('1057 — o log do TS é espelho dos CHECKs', () => {
  it('resultado', () => {
    expect(valoresDoCheck('cb_zapsign_eventos_resultado_ck').sort()).toEqual([...RESULTADOS_DO_EVENTO].sort());
  });

  it('casado_por', () => {
    expect(valoresDoCheck('cb_zapsign_eventos_casado_por_ck').sort()).toEqual([...CASADO_POR].sort());
  });
});
