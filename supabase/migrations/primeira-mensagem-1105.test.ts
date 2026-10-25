import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pinos da 1105 (a primeira mensagem reivindicada). O replay do CI prova que
// ela APLICA; estes provam o que ela não pode ganhar numa edição: o
// preenchimento das conversas antigas (a 054 do original faz) e o default —
// os dois reescreveriam o sentido do NULL que a reivindicação disputa, e o
// preenchimento acenderia os gatilhos de UPDATE em toda conversa da base.
//
// LIMITE DECLARADO: lê o `.sql`. A prova de comportamento (sem reescrita,
// corrida entre duas sessões, banco vazio) foi num Postgres 16 descartável.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1105_cb_primeira_mensagem_reivindicada.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

describe('1105 — conversations.first_inbound_at', () => {
  it('a coluna nasce nula e SEM default, com teto de espera antes do ALTER', () => {
    expect(semComentarios).toMatch(
      /ALTER TABLE public\.conversations\s+ADD COLUMN IF NOT EXISTS first_inbound_at timestamptz;/,
    );
    const trava = semComentarios.indexOf("SET LOCAL lock_timeout = '5s';");
    expect(trava).toBeGreaterThan(-1);
    expect(trava).toBeLessThan(semComentarios.indexOf('ALTER TABLE'));
  });

  it('sem preenchimento: o único UPDATE é a prova da conferência, desfeita por SQLSTATE próprio', () => {
    const updates = semComentarios.match(/UPDATE public\.conversations/g) ?? [];
    expect(updates).toHaveLength(2);
    // As duas escritas da prova vêm antes do RAISE que desfaz o subbloco, e
    // nenhuma escrita sobra depois dele.
    const desfaz = semComentarios.indexOf("RAISE SQLSTATE 'P1105';");
    expect(desfaz).toBeGreaterThan(semComentarios.lastIndexOf('UPDATE public.conversations'));
    expect(semComentarios).toMatch(/EXCEPTION WHEN SQLSTATE 'P1105' THEN\s+NULL;/);
    expect(semComentarios).not.toMatch(/WHEN OTHERS/);
  });
});
