import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// NOSSO (1151): o envio pelo SERVIDOR (`deliverBroadcast` — o Retomar, o
// "Tentar de novo os que falharam" e a API v1) monta, RESERVA e só então
// manda cada linha; o 5xx, o tempo esgotado e o erro de rede deixam a linha
// `uncertain`, nunca `failed`.
//
// Antes, toda falha virava `failed` sem cerca, e o "Tentar de novo" mandava
// de novo o que podia ter saído — o modelo PAGO em dobro. E o processo que
// morria no meio deixava a linha no escopo de origem, para ser reenviada.
// ============================================================

const { enviarModelo } = vi.hoisted(() => ({ enviarModelo: vi.fn() }));

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }));
vi.mock('@/lib/api/v1/contacts', () => ({ findOrCreateContact: vi.fn() }));
vi.mock('@/lib/whatsapp/meta-api', async (original) => ({
  ...(await original<typeof import('@/lib/whatsapp/meta-api')>()),
  sendTemplateMessage: enviarModelo,
}));

import { MetaApiError } from '@/lib/whatsapp/meta-api';
import { deliverBroadcast, type BroadcastPlan } from './broadcast-core';

type Chamada = {
  tabela: string;
  op: 'select' | 'update';
  patch?: Record<string, unknown>;
  filtros: [string, unknown][];
};

/** Supabase de mentira que registra tudo; a reserva responde `reserva(id)`. */
function bancoFalso(reserva: (id: string) => { data: unknown[] | null; error: unknown } = (id) => ({
  data: [{ id }],
  error: null,
})) {
  const chamadas: Chamada[] = [];
  const db = {
    from(tabela: string) {
      const c: Chamada = { tabela, op: 'select', filtros: [] };
      chamadas.push(c);
      const resultado = () => {
        if (c.op === 'update' && tabela === 'broadcast_recipients' && c.patch?.status === 'uncertain') {
          return reserva(String(c.filtros.find(([k]) => k === 'id')?.[1]));
        }
        if (c.op === 'select') return { data: [], count: 0, error: null };
        return { data: [{ id: 'x' }], error: null };
      };
      const q: Record<string, unknown> = {
        update(patch: Record<string, unknown>) {
          c.op = 'update';
          c.patch = patch;
          return q;
        },
        select: () => q,
        eq(k: string, v: unknown) {
          c.filtros.push([k, v]);
          return q;
        },
        in(k: string, v: unknown) {
          c.filtros.push([`${k} in`, v]);
          return q;
        },
        then: (ok: (r: unknown) => unknown, falha: (e: unknown) => unknown) =>
          Promise.resolve(resultado()).then(ok, falha),
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, chamadas };
}

const escritasNaLinha = (chamadas: Chamada[], id: string) =>
  chamadas.filter(
    (c) => c.tabela === 'broadcast_recipients' && c.op === 'update' && c.filtros.some(([k, v]) => k === 'id' && v === id),
  );

function plano(extra: Partial<BroadcastPlan> = {}): BroadcastPlan {
  return {
    broadcastId: 'bc-1',
    channelId: 'canal-1',
    templateName: 'modelo',
    templateLanguage: 'pt_BR',
    phoneNumberId: 'pn-1',
    accessToken: 'EAABsegredodotoken123',
    templateRow: null,
    planned: [{ recipientRowId: 'r1', phone: '5583988745316', params: [] }],
    rejected: 0,
    ...extra,
  };
}

beforeEach(() => {
  enviarModelo.mockReset();
  enviarModelo.mockImplementation(async ({ to }: { to: string }) => ({ messageId: `wamid.${to}` }));
});

describe('deliverBroadcast — reserva e desfecho (1151)', () => {
  it('⚠️⚠️ reserva ANTES da Meta (de `pending`, o padrão) e grava `sent` cercado pela reserva', async () => {
    const { db, chamadas } = bancoFalso();
    const ordem: string[] = [];
    enviarModelo.mockImplementation(async ({ to }: { to: string }) => {
      ordem.push(`enviou depois de ${escritasNaLinha(chamadas, 'r1').length} escrita(s)`);
      return { messageId: `wamid.${to}` };
    });
    await deliverBroadcast(db, plano());
    const [reserva, desfecho] = escritasNaLinha(chamadas, 'r1');
    expect(reserva.patch).toEqual({ status: 'uncertain', error_message: null });
    expect(reserva.filtros).toEqual([
      ['id', 'r1'],
      ['status in', ['pending']],
    ]);
    expect(ordem).toEqual(['enviou depois de 1 escrita(s)']);
    expect(desfecho.patch).toMatchObject({ status: 'sent', whatsapp_message_id: 'wamid.5583988745316' });
    expect(desfecho.filtros).toEqual([
      ['id', 'r1'],
      ['status', 'uncertain'],
    ]);
  });

  it('a retomada reserva só da situação do ESCOPO (`origens`)', async () => {
    const { db, chamadas } = bancoFalso();
    await deliverBroadcast(db, plano({ origens: ['failed'] }));
    expect(escritasNaLinha(chamadas, 'r1')[0].filtros).toContainEqual(['status in', ['failed']]);
  });

  it('⚠️⚠️ 5xx, tempo esgotado ou rede: a linha FICA incerta (só o motivo), nunca `failed`', async () => {
    for (const erro of [
      new MetaApiError('Service temporarily unavailable', { httpStatus: 503 }),
      new TypeError('fetch failed'),
    ]) {
      const { db, chamadas } = bancoFalso();
      enviarModelo.mockRejectedValueOnce(erro);
      await deliverBroadcast(db, plano());
      const escritas = escritasNaLinha(chamadas, 'r1');
      expect(escritas).toHaveLength(2);
      expect(escritas[1].patch).toEqual({ error_message: erro.message });
      expect(escritas[1].filtros).toContainEqual(['status', 'uncertain']);
    }
  });

  it('recusa comprovada (4xx): `failed`, com a mensagem limpa do token', async () => {
    const { db, chamadas } = bancoFalso();
    enviarModelo.mockRejectedValueOnce(
      new MetaApiError('Malformed access token EAABsegredodotoken123', { httpStatus: 401, code: 190 }),
    );
    await deliverBroadcast(db, plano());
    expect(escritasNaLinha(chamadas, 'r1')[1].patch).toEqual({
      status: 'failed',
      error_message: 'Malformed access token «token»',
    });
  });

  it('⚠️⚠️ linha que não se reserva (outra mão a tem) ou reserva que falha: nada vai à Meta', async () => {
    for (const reserva of [
      () => ({ data: [], error: null }),
      () => ({ data: null, error: { message: 'timeout' } }),
    ]) {
      const { db, chamadas } = bancoFalso(reserva);
      await deliverBroadcast(db, plano());
      expect(enviarModelo).not.toHaveBeenCalled();
      expect(escritasNaLinha(chamadas, 'r1')).toHaveLength(1);
    }
  });

  it('o modelo que não MONTA: `failed` na situação planejada, sem reserva e sem Meta', async () => {
    const { db, chamadas } = bancoFalso();
    await deliverBroadcast(
      db,
      plano({
        origens: ['pending', 'failed'],
        templateRow: {
          name: 'modelo',
          language: 'pt_BR',
          body_text: 'Olá',
          header_type: 'image',
          header_media_url: null,
          buttons: [],
        } as unknown as BroadcastPlan['templateRow'],
      }),
    );
    expect(enviarModelo).not.toHaveBeenCalled();
    const [falha] = escritasNaLinha(chamadas, 'r1');
    expect(falha.patch).toMatchObject({ status: 'failed' });
    expect(String(falha.patch?.error_message)).toMatch(/^Template cannot be sent: /);
    expect(falha.filtros).toContainEqual(['status in', ['pending', 'failed']]);
  });

  it('a campanha fecha pelas linhas no fim (finalizeBroadcastStatus)', async () => {
    const { db, chamadas } = bancoFalso();
    await deliverBroadcast(db, plano());
    expect(chamadas.some((c) => c.tabela === 'broadcasts' && c.op === 'update')).toBe(true);
  });
});
