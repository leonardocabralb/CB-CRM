import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1050 — a rajada fica com a mensagem MAIS NOVA (Codex, #309). Provado num
// Postgres 16 descartável: a mais nova enfileira primeiro, a mais velha
// depois, e o gatilho, o agente e a etapa ficam os da mais nova; a passagem e
// a rajada comum seguem como na 1049. Estes pinos seguram a FORMA.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1050_cb_ia_rajada_fica_com_a_mais_nova.sql'), 'utf8');
const compacto = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n')
  .replace(/\s+/g, ' ')
  .toLowerCase();

describe('1050 — cb_ia_enfileirar_turno', () => {
  it('mantém a assinatura da 1049 (CREATE OR REPLACE, sem DROP)', () => {
    expect(compacto).toContain(
      'create or replace function public.cb_ia_enfileirar_turno( p_account_id uuid, p_conversation_id uuid, p_canal_id uuid, p_ia_agente_id uuid, p_deal_id uuid, p_stage_id uuid, p_mensagem_id uuid, p_espera_ms integer, p_veio_de_passagem boolean default false )',
    );
    expect(compacto).not.toContain('drop function');
  });

  it('a mensagem mais VELHA (por gravada_em) não troca o gatilho nem o agente, o card e a etapa', () => {
    const regua = 'coalesce((select n.gravada_em < v.gravada_em from messages n, messages v where n.id = excluded.mensagem_gatilho_id and v.id = t.mensagem_gatilho_id), false)';
    // gatilho + agente + card + etapa
    expect(compacto.split(regua).length - 1).toBe(4);
    expect(compacto).toContain(`when ${regua} then t.mensagem_gatilho_id`);
    for (const col of ['ia_agente_id', 'deal_id', 'stage_id']) {
      expect(compacto).toContain(`when not excluded.veio_de_passagem and ${regua} then t.${col}`);
    }
  });

  it('a passagem continua sem trocar o gatilho', () => {
    expect(compacto).toContain('when excluded.veio_de_passagem then t.mensagem_gatilho_id');
  });

  it('as duas metades do REVOKE e o GRANT de volta', () => {
    expect(compacto).toContain(
      'revoke execute on function public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean) from public, anon, authenticated;',
    );
    expect(compacto).toContain(
      'grant execute on function public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean) to service_role;',
    );
  });

  it('a conferência CHAMA a fila e se desfaz pelo SQLSTATE próprio (nunca WHEN OTHERS)', () => {
    expect(compacto).toContain('from public.cb_ia_enfileirar_turno(v_conta, v_conv, v_canal, v_agente, null, null, v_nova, 8000)');
    expect(compacto).toContain('from public.cb_ia_enfileirar_turno(v_conta, v_conv, v_canal, v_agente, null, null, v_velha, 8000)');
    expect(compacto).toContain("exception when sqlstate 'p1050' then null;");
    expect(compacto).not.toContain('when others');
  });
});
