import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  aceitaNaoRepetir,
  HORAS_SEM_REPETIR_MAX,
  horasSemRepetir,
  horasSemRepetirValidas,
  rodouNoPrazo,
} from './nao-repetir';

describe('aceitaNaoRepetir — só os gatilhos por mensagem', () => {
  it.each(['new_message_received', 'keyword_match', 'interactive_reply'])('%s oferece', (tipo) => {
    expect(aceitaNaoRepetir(tipo)).toBe(true);
  });

  it.each([
    'first_inbound_message',
    'new_contact_created',
    'tag_added',
    'deal_stage_changed',
    'deal_status_changed',
    'date_field_offset',
    'calendly_booking',
    'webhook_received',
    'atlas_situacao_mudou',
    'asaas_cobranca_vence_hoje',
    'gatilho_que_ainda_nao_existe',
  ])('%s não oferece (default-deny)', (tipo) => {
    expect(aceitaNaoRepetir(tipo)).toBe(false);
  });
});

describe('horasSemRepetirValidas', () => {
  it.each([1, 24, HORAS_SEM_REPETIR_MAX])('%s vale', (v) => {
    expect(horasSemRepetirValidas(v)).toBe(true);
  });

  it.each([0, -1, 1.5, HORAS_SEM_REPETIR_MAX + 1, '24', null, undefined, NaN])(
    '%s não vale',
    (v) => {
      expect(horasSemRepetirValidas(v)).toBe(false);
    }
  );
});

describe('horasSemRepetir', () => {
  it('lê o prazo do gatilho', () => {
    expect(
      horasSemRepetir({ trigger_type: 'new_message_received', trigger_config: { nao_repetir_horas: 24 } })
    ).toBe(24);
  });

  it('sem a chave, roda a cada disparo', () => {
    expect(horasSemRepetir({ trigger_type: 'new_message_received', trigger_config: {} })).toBeNull();
    expect(horasSemRepetir({ trigger_type: 'new_message_received', trigger_config: null })).toBeNull();
  });

  it('a chave que sobrou num gatilho que não oferece a opção é ignorada', () => {
    expect(
      horasSemRepetir({ trigger_type: 'tag_added', trigger_config: { tag_id: 't', nao_repetir_horas: 24 } })
    ).toBeNull();
  });

  it('valor inválido não inventa prazo', () => {
    expect(
      horasSemRepetir({ trigger_type: 'new_message_received', trigger_config: { nao_repetir_horas: '24' } })
    ).toBeNull();
  });
});

function dbFalso(resposta: { data: unknown; error: { message: string } | null }) {
  const chamadas: [string, ...unknown[]][] = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'or', 'limit']) {
    b[m] = (...args: unknown[]) => {
      chamadas.push([m, ...args]);
      return m === 'limit' ? Promise.resolve(resposta) : b;
    };
  }
  const from = vi.fn(() => b);
  return { db: { from } as unknown as SupabaseClient, from, chamadas };
}

const AUTOMACAO = {
  id: 'a1',
  account_id: 'acct-1',
  trigger_type: 'new_message_received',
  trigger_config: { nao_repetir_horas: 24 },
};
const AGORA = Date.parse('2026-09-30T18:00:00.000Z');

describe('rodouNoPrazo', () => {
  it('pergunta pelos registros DESTA automação, DESTA conta e DESTE contato, no prazo, que não pararam numa condição', async () => {
    const { db, from, chamadas } = dbFalso({ data: [], error: null });
    expect(await rodouNoPrazo({ db, automation: AUTOMACAO, contactId: 'c1', agora: AGORA })).toBe('livre');
    expect(from).toHaveBeenCalledWith('automation_logs');
    expect(chamadas).toEqual([
      ['select', 'id'],
      ['eq', 'automation_id', 'a1'],
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'contact_id', 'c1'],
      // 24 h antes de AGORA.
      ['gte', 'created_at', '2026-09-29T18:00:00.000Z'],
      // `falhou` e a execução ainda rodando (desfecho nulo) CONTAM: o envio
      // que falhou pode ter saído. Só a `barrada` não conta.
      ['or', 'desfecho.is.null,desfecho.neq.barrada'],
      ['limit', 1],
    ]);
  });

  it('achou execução no prazo → rodou', async () => {
    const { db } = dbFalso({ data: [{ id: 'log-1' }], error: null });
    expect(await rodouNoPrazo({ db, automation: AUTOMACAO, contactId: 'c1', agora: AGORA })).toBe('rodou');
  });

  it('leitura que falha → erro (o motor descarta: falha FECHADA)', async () => {
    const { db } = dbFalso({ data: null, error: { message: 'banco fora' } });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await rodouNoPrazo({ db, automation: AUTOMACAO, contactId: 'c1', agora: AGORA })).toBe('erro');
    erro.mockRestore();
  });

  it('sem prazo ou sem contato, nem consulta', async () => {
    const { db, from } = dbFalso({ data: [{ id: 'log-1' }], error: null });
    expect(
      await rodouNoPrazo({ db, automation: { ...AUTOMACAO, trigger_config: {} }, contactId: 'c1' })
    ).toBe('livre');
    expect(await rodouNoPrazo({ db, automation: AUTOMACAO, contactId: null })).toBe('livre');
    expect(from).not.toHaveBeenCalled();
  });
});
