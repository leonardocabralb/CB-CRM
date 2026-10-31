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
// corrida entre duas sessões, banco vazio) foi num Postgres 16 descartável,
// e a conferência da migration é só catálogo (depois do ALTER, nada de dado).
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

  it('sem preenchimento e sem escrita depois do ALTER: a conferência é só catálogo', () => {
    // Nem a prova com dado: depois do ALTER a trava exclusiva fica até o fim
    // da migration, e ali só roda catálogo (`.claude/rules/supabase.md`).
    expect(semComentarios).not.toMatch(/UPDATE\s+public\.conversations/i);
    expect(semComentarios).not.toMatch(/\bFROM\s+public\.conversations\b/i);
    expect(semComentarios).toMatch(/FROM pg_attribute a/);
  });
});
