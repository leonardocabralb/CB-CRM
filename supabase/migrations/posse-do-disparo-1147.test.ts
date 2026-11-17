import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { MINUTOS_DA_TRAVA_DA_RETOMADA } from '../../src/lib/broadcast-painel';
import { PRAZO_DA_POSSE_MS } from '../../src/lib/whatsapp/broadcast-posse';
import { DELIVERY_LOCK_STALE_MS } from '../../src/lib/whatsapp/broadcast-resume';

// ============================================================
// 1147 — POSSE do envio do disparo. A regra mora em DOIS lugares, e este
// pino os amarra:
//  - o banco (as funções, com o relógio dele) diz quanto vale a posse e quando
//    a trava da retomada é velha;
//  - o TS (`broadcast-posse.ts`, `broadcast-resume.ts`) promete esses prazos na
//    tela e filtra a trava com eles.
// Mudou um lado sem o outro: a tela promete "em até 5 minutos" e o banco segura
// 10, ou a retomada assume uma posse que o banco ainda dá como válida.
//
// E segura a FORMA: INVOKER (a RLS da 964 decide quem escreve), o papel de
// quem dispara aqui ESCRITO na função (admin, nunca o 'agent' do original),
// os privilégios do banco vazio e a conferência que CHAMA as funções.
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1147_cb_posse_do_disparo.sql'), 'utf8');

/** O texto da função, do CREATE até o fechamento do dollar-quote. */
function funcao(nome: string): string {
  const inicio = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  expect(inicio, `${nome} não está na 1147`).toBeGreaterThanOrEqual(0);
  const abre = SQL.indexOf('$$', inicio);
  const fecha = SQL.indexOf('$$', abre + 2);
  return SQL.slice(inicio, fecha + 2);
}

const ESCRITORAS = ['cb_tomar_posse_do_disparo', 'cb_renovar_posse_do_disparo'] as const;
const TODAS = [...ESCRITORAS, 'cb_disparo_em_andamento'] as const;

describe('1147 — posse do envio do disparo', () => {
  it('o prazo da posse no banco é o do TS (a tela promete esse número)', () => {
    expect(PRAZO_DA_POSSE_MS).toBe(5 * 60 * 1000);
    for (const nome of ESCRITORAS) {
      expect(funcao(nome)).toContain("now() + INTERVAL '5 minutes'");
    }
  });

  it('a trava "velha" da retomada no banco é a do TS (DELIVERY_LOCK_STALE_MS)', () => {
    expect(DELIVERY_LOCK_STALE_MS).toBe(30 * 60 * 1000);
    expect(funcao('cb_tomar_posse_do_disparo')).toContain("now() - INTERVAL '30 minutes'");
    expect(funcao('cb_disparo_em_andamento')).toContain("now() - INTERVAL '30 minutes'");
    // A faixa da campanha promete esse prazo com a cópia da tela (o módulo do
    // servidor não vai ao navegador).
    expect(MINUTOS_DA_TRAVA_DA_RETOMADA * 60 * 1000).toBe(DELIVERY_LOCK_STALE_MS);
  });

  it('INVOKER, sem DEFINER: quem decide quem escreve é a RLS (e o papel escrito)', () => {
    for (const nome of TODAS) {
      const corpo = funcao(nome);
      expect(corpo, nome).toMatch(/SECURITY\s+INVOKER/);
      expect(corpo, nome).not.toMatch(/SECURITY\s+DEFINER/);
      expect(corpo, nome).toMatch(/SET search_path = public/);
    }
  });

  it("⚠️ o papel de quem dispara AQUI é admin (o original usa 'agent')", () => {
    for (const nome of ESCRITORAS) {
      expect(funcao(nome), nome).toContain("public.is_account_member(b.account_id, 'admin')");
      expect(funcao(nome), nome).not.toContain("'agent'");
    }
  });

  it('renovar exige o TOKEN; tomar aceita o mesmo token de volta (pedido repetido)', () => {
    expect(funcao('cb_renovar_posse_do_disparo')).toContain('b.delivery_lease_token = p_token');
    const tomar = funcao('cb_tomar_posse_do_disparo');
    expect(tomar).toContain('b.delivery_lease_token = p_token');
    expect(tomar).toContain('b.delivery_lease_until < now()');
    // Tomar respeita a trava da retomada.
    expect(tomar).toContain('b.delivery_locked_at IS NULL');
  });

  it('as colunas são as que o TS escreve e filtra', () => {
    expect(SQL).toContain('ADD COLUMN IF NOT EXISTS delivery_lease_until TIMESTAMPTZ');
    expect(SQL).toContain('ADD COLUMN IF NOT EXISTS delivery_lease_token UUID');
    const retomada = fs.readFileSync(
      path.join(__dirname, '../../src/lib/whatsapp/broadcast-resume.ts'),
      'utf8',
    );
    expect(retomada).toContain('delivery_lease_until.is.null,delivery_lease_until.lt.');
    expect(retomada).toContain('delivery_lease_token: null');
  });

  it('privilégios: nada para anon/PUBLIC, EXECUTE para authenticated, e o que o INVOKER precisa no banco vazio', () => {
    for (const assinatura of [
      'cb_tomar_posse_do_disparo(UUID, UUID)',
      'cb_renovar_posse_do_disparo(UUID, UUID)',
      'cb_disparo_em_andamento(UUID)',
    ]) {
      expect(SQL).toContain(
        `REVOKE ALL ON FUNCTION public.${assinatura} FROM PUBLIC, anon, authenticated;`,
      );
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${assinatura} TO authenticated;`);
    }
    expect(SQL).toContain('GRANT SELECT, UPDATE ON TABLE public.broadcasts TO authenticated;');
    expect(SQL).not.toMatch(/GRANT[^;]*\banon\b/);
  });

  it('a conferência CHAMA as três como authenticated, desfeita por SQLSTATE próprio', () => {
    const conferencia = SQL.slice(SQL.indexOf('DO $$'));
    for (const nome of TODAS) {
      expect(conferencia).toContain(`public.${nome}(`);
    }
    expect(conferencia).toContain('SET LOCAL ROLE authenticated');
    expect(conferencia).toContain("ERRCODE = 'P1147'");
    expect(conferencia).toContain("WHEN SQLSTATE 'P1147'");
    // O código, sem os comentários (que explicam por que não `WHEN OTHERS`).
    const semComentarios = conferencia.replace(/--[^\n]*/g, '');
    expect(semComentarios).not.toMatch(/WHEN\s+OTHERS/i);
  });
});
