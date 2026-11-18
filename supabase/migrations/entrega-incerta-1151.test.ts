import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { ENTREGA_INCERTA, recipientStatusConfig } from '../../src/lib/broadcast-status';
import { RESUME_SCOPES, scopeStatuses } from '../../src/lib/whatsapp/broadcast-resume';

// ============================================================
// 1151 — ENTREGA INCERTA no destinatário do disparo. A regra mora em DOIS
// lugares, e este pino os amarra:
//  - o banco: o CHECK de `broadcast_recipients.status` aceita `uncertain`;
//  - o TS: quem envia reserva a linha como `uncertain` antes da Meta, a tela
//    a mostra (`recipientStatusConfig`), e NENHUM escopo de reenvio a pega.
// O estado novo no TS sem o CHECK faria toda reserva falhar (e o disparo não
// mandaria nada); um escopo que a incluísse mandaria o modelo PAGO em dobro.
//
// E segura a FORMA: o DROP do CHECK inline pela FORMA (o nome é do
// Postgres), o ADD com nome, o `lock_timeout` antes da 1ª ALTER e a
// conferência desfeita pelo SQLSTATE próprio, nunca `WHEN OTHERS`.
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1151_cb_entrega_incerta_do_disparo.sql'), 'utf8');
/** O SQL sem os comentários de linha (o cabeçalho explica o `WHEN OTHERS` que NÃO usa). */
const CODIGO = SQL.replace(/--.*$/gm, '');

/** Os valores do CHECK que a 1151 cria, na ordem escrita. */
function valoresDoCheck(): string[] {
  const m = SQL.match(
    /ADD CONSTRAINT broadcast_recipients_status_check\s+CHECK \(status IN \(([^)]*)\)\)/,
  );
  expect(m, 'o ADD CONSTRAINT do status não está na forma esperada').not.toBeNull();
  return m![1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
}

describe('1151 — entrega incerta do disparo', () => {
  it('o CHECK aceita exatamente os estados que o TS conhece — `uncertain` incluso', () => {
    const doBanco = valoresDoCheck();
    expect(doBanco).toContain(ENTREGA_INCERTA);
    expect([...doBanco].sort()).toEqual(Object.keys(recipientStatusConfig).sort());
  });

  it('⚠️⚠️ nenhum escopo de reenvio (Retomar, "Tentar de novo", todos) pega a incerta', () => {
    for (const escopo of RESUME_SCOPES) {
      expect(scopeStatuses(escopo), escopo).not.toContain(ENTREGA_INCERTA);
    }
  });

  it('o DROP é pela FORMA do CHECK inline, e o ADD dá o nome (o modelo da 989)', () => {
    expect(SQL).toContain("pg_get_constraintdef(oid) ~ 'status = ANY \\(ARRAY\\['");
    expect(SQL).toMatch(/EXECUTE format\('ALTER TABLE public\.broadcast_recipients DROP CONSTRAINT %I', r\.conname\)/);
    expect(SQL).not.toMatch(/DROP CONSTRAINT (IF EXISTS )?broadcast_recipients_status_check/);
  });

  it('`lock_timeout` vem antes da primeira ALTER', () => {
    const trava = SQL.indexOf("SET LOCAL lock_timeout = '5s';");
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(trava).toBeLessThan(SQL.indexOf('ALTER TABLE'));
  });

  it('concede o que a conferência exercita (banco vazio), e a conferência é desfeita só pelo SQLSTATE próprio', () => {
    expect(SQL).toContain('GRANT SELECT, UPDATE ON TABLE public.broadcast_recipients TO authenticated;');
    expect(SQL).toContain("RAISE EXCEPTION USING ERRCODE = 'P1151'");
    expect(SQL).toContain("WHEN SQLSTATE 'P1151' THEN");
    expect(SQL).toContain('WHEN check_violation THEN NULL;');
    expect(CODIGO).not.toMatch(/WHEN OTHERS/);
    // A reserva é provada como quem dispara (a rota do lote, sob a RLS).
    expect(SQL).toContain('SET LOCAL ROLE authenticated;');
  });

  it('a conferência prova que a incerta fica fora dos contadores', () => {
    expect(SQL).toContain("public._bcast_cols_for_status('uncertain') <> ARRAY[]::TEXT[]");
  });
});
