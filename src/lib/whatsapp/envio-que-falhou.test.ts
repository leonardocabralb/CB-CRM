import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { MetaApiError } from '@/lib/whatsapp/meta-api';
import { EvolutionApiError } from '@/lib/whatsapp/transport/evolution-client';
import {
  classificarFalha,
  falhouAoEnviar,
  registrarEnvioQueFalhou,
  type RascunhoDoEnvio,
} from './envio-que-falhou';

// ============================================================
// A tentativa do robô que não saiu vira bolha no fio (06/10/2026). Ids e
// números fictícios.
// ============================================================

describe('classificarFalha — a mesma régua de `recusaComprovada`', () => {
  it('Evolution 4xx "Connection Closed" = conexão fora do ar', () => {
    expect(classificarFalha(new EvolutionApiError('Error: Connection Closed', 400)).motivo).toBe(
      'conexao_fora_do_ar',
    );
  });
  it('Evolution 4xx sem WhatsApp = sem_whatsapp (vence o texto)', () => {
    expect(classificarFalha(new EvolutionApiError('not on WhatsApp', 400, true)).motivo).toBe('sem_whatsapp');
  });
  it('Evolution outro 4xx = recusado; 5xx = incerto', () => {
    expect(classificarFalha(new EvolutionApiError('Bad Request', 400)).motivo).toBe('recusado');
    expect(classificarFalha(new EvolutionApiError('Connection Closed', 502)).motivo).toBe('incerto');
  });
  it('Meta 4xx = recusado com o código dela; 5xx = incerto', () => {
    const r = classificarFalha(new MetaApiError('Re-engagement message', { httpStatus: 400, code: 131047 }));
    expect(r).toMatchObject({ motivo: 'recusado', codigo: 131047 });
    expect(classificarFalha(new MetaApiError('oops', { httpStatus: 500 })).motivo).toBe('incerto');
  });
  it('erro de rede / tempo esgotado (não é do provedor) = incerto', () => {
    expect(classificarFalha(new Error('fetch failed')).motivo).toBe('incerto');
    expect(classificarFalha('texto solto').motivo).toBe('incerto');
  });
  it('o detalhe sai sem token da Meta e com teto', () => {
    const r = classificarFalha(
      new MetaApiError('Malformed access token EAABsbCS1iHgBAKZBxyz123456 here', { httpStatus: 401 }),
    );
    expect(r.detalhe).not.toMatch(/EAAB/);
    expect(classificarFalha(new Error('x'.repeat(1000))).detalhe.length).toBeLessThanOrEqual(300);
  });
});

// ------------------------------------------------------------
// O que fica gravado
// ------------------------------------------------------------
function makeDb(opts: { insertError?: unknown } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const updates: { tabela: string; row: Record<string, unknown>; filtros: [string, unknown][] }[] = [];
  const db = {
    from(tabela: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push(row);
          return {
            select: () => ({
              single: async () =>
                opts.insertError ? { data: null, error: opts.insertError } : { data: { id: 'm-1' }, error: null },
            }),
          };
        },
        update(row: Record<string, unknown>) {
          const filtros: [string, unknown][] = [];
          updates.push({ tabela, row, filtros });
          const chain: Record<string, unknown> = {
            eq: (k: string, v: unknown) => (filtros.push([k, v]), chain),
            is: (k: string, v: unknown) => (filtros.push([`is:${k}`, v]), chain),
            then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
          };
          return chain;
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, inserts, updates };
}

const RASCUNHO: RascunhoDoEnvio = {
  accountId: 'acc-1',
  conversationId: 'conv-1',
  canalId: 'canal-1',
  contentType: 'text',
  texto: 'Escritório: sua reunião está confirmada.',
  previa: 'Escritório: sua reunião está confirmada.',
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('registrarEnvioQueFalhou', () => {
  it('grava a bolha: bot, failed, nao_saiu, SEM message_id, com o número e o motivo', async () => {
    const { db, inserts } = makeDb();
    await registrarEnvioQueFalhou(db, RASCUNHO, new EvolutionApiError('Connection Closed', 400));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'bot',
      content_type: 'text',
      content_text: RASCUNHO.texto,
      status: 'failed',
      nao_saiu: true,
      error_title: 'conexao_fora_do_ar',
      channel_id: 'canal-1',
    });
    expect(inserts[0]).not.toHaveProperty('message_id');
  });

  it('dá o número à conversa SEM número e sobe a conversa na lista (prévia e hora)', async () => {
    const { db, updates } = makeDb();
    await registrarEnvioQueFalhou(db, RASCUNHO, new Error('x'));
    const numero = updates.find((u) => 'channel_id' in u.row);
    expect(numero?.filtros).toEqual([
      ['id', 'conv-1'],
      ['account_id', 'acc-1'],
      ['is:channel_id', null],
      ['is:group_id', null],
    ]);
    const previa = updates.find((u) => 'last_message_text' in u.row);
    expect(previa?.row.last_message_text).toBe(RASCUNHO.previa);
    expect(typeof previa?.row.last_message_at).toBe('string');
    expect(previa?.filtros).toContainEqual(['account_id', 'acc-1']);
  });

  it('INSERT recusado: não lança e não mexe na conversa (sem bolha, sem prévia)', async () => {
    const { db, updates } = makeDb({ insertError: { code: '42501', message: 'denied' } });
    await expect(registrarEnvioQueFalhou(db, RASCUNHO, new Error('x'))).resolves.toBeUndefined();
    expect(updates).toEqual([]);
  });

  it('banco que LANÇA: não lança (o erro do provedor é que sobe)', async () => {
    const db = { from: () => { throw new Error('rede'); } } as unknown as SupabaseClient;
    await expect(registrarEnvioQueFalhou(db, RASCUNHO, new Error('x'))).resolves.toBeUndefined();
  });
});

describe('falhouAoEnviar', () => {
  it('com aoFalhar (o motor): entrega o rascunho e NÃO grava', async () => {
    const { db, inserts } = makeDb();
    const aoFalhar = vi.fn();
    await falhouAoEnviar(db, RASCUNHO, new Error('x'), aoFalhar);
    expect(aoFalhar).toHaveBeenCalledWith(RASCUNHO);
    expect(inserts).toEqual([]);
  });

  it('sem aoFalhar (robô, agente de IA): grava na hora', async () => {
    const { db, inserts } = makeDb();
    await falhouAoEnviar(db, RASCUNHO, new Error('x'));
    expect(inserts).toHaveLength(1);
  });

  it('aoFalhar que lança não derruba o envio', async () => {
    const { db } = makeDb();
    await expect(
      falhouAoEnviar(db, RASCUNHO, new Error('x'), () => {
        throw new Error('boom');
      }),
    ).resolves.toBeUndefined();
  });
});
