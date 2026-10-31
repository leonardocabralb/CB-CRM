import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { MetaApiError } from '@/lib/whatsapp/meta-api';
import { EvolutionApiError } from '@/lib/whatsapp/transport/evolution-client';
import {
  classificarFalha,
  falhouAoEnviar,
  motivoDaFalhaDoNucleo,
  registrarEnvioQueFalhou,
  registrarTentativaDaEquipe,
  type RascunhoDoEnvio,
  type TentativaDoNucleo,
} from './envio-que-falhou';
import { SendMessageError } from './send-message';

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
// A falha do NÚCLEO de gente → a bolha otimista (19/10/2026)
// ------------------------------------------------------------
describe('motivoDaFalhaDoNucleo — o que a rota do compositor diz à bolha', () => {
  const doProvedor = (code: string, cause: unknown) =>
    new SendMessageError(code, `Provider error: ${String(cause)}`, 502, { cause });

  it('o caso de 19/10: número sem WhatsApp (o code sozinho diria só "recusado")', () => {
    const err = doProvedor(
      'evolution_rejected',
      new EvolutionApiError('number 550000000000 is not on WhatsApp', 400, true),
    );
    expect(motivoDaFalhaDoNucleo(err)).toEqual({
      motivo: 'sem_whatsapp',
      detalhe: 'number 550000000000 is not on WhatsApp',
    });
  });

  it('a conexão fechada e a recusa genérica da Evolution', () => {
    expect(
      motivoDaFalhaDoNucleo(doProvedor('evolution_rejected', new EvolutionApiError('Error: Connection Closed', 400)))
        .motivo,
    ).toBe('conexao_fora_do_ar');
    expect(
      motivoDaFalhaDoNucleo(doProvedor('evolution_rejected', new EvolutionApiError('Bad Request', 400))).motivo,
    ).toBe('recusado');
  });

  it('tempo esgotado e 5xx são INCERTOS, nunca "não saiu"', () => {
    expect(
      motivoDaFalhaDoNucleo(doProvedor('evolution_error', new EvolutionApiError('timeout', 504))).motivo,
    ).toBe('incerto');
    expect(motivoDaFalhaDoNucleo(doProvedor('evolution_error', new Error('fetch failed'))).motivo).toBe('incerto');
  });

  it('Meta: 4xx recusado, 5xx incerto — o `meta_error` sozinho mistura os dois', () => {
    expect(
      motivoDaFalhaDoNucleo(doProvedor('meta_error', new MetaApiError('Re-engagement', { httpStatus: 400, code: 131047 })))
        .motivo,
    ).toBe('recusado');
    expect(
      motivoDaFalhaDoNucleo(doProvedor('meta_error', new MetaApiError('oops', { httpStatus: 500 }))).motivo,
    ).toBe('incerto');
  });

  it('sem o erro do provedor: só o 4xx da Evolution afirma "não saiu"', () => {
    expect(motivoDaFalhaDoNucleo({ code: 'evolution_rejected', message: 'x' })).toEqual({ motivo: 'recusado', detalhe: null });
    expect(motivoDaFalhaDoNucleo({ code: 'evolution_error', message: 'x' }).motivo).toBe('incerto');
    expect(motivoDaFalhaDoNucleo({ code: 'meta_error', message: 'x' }).motivo).toBe('incerto');
  });

  it('db_error SAIU (o CRM só não gravou): incerto, sem o texto cru do banco', () => {
    expect(
      motivoDaFalhaDoNucleo({ code: 'db_error', message: 'violates constraint cb_xyz on column abc' }),
    ).toEqual({ motivo: 'incerto', detalhe: null });
  });

  it('o resto parou NO CRM, antes de qualquer conexão: barrado, com a frase do núcleo', () => {
    for (const code of ['bad_request', 'not_found', 'not_supported', 'whatsapp_not_configured', 'channel_unavailable', 'not_allowed', 'template_malformed']) {
      expect(motivoDaFalhaDoNucleo({ code, message: 'Conversation not found' })).toEqual({
        motivo: 'barrado',
        detalhe: 'Conversation not found',
      });
    }
    expect(motivoDaFalhaDoNucleo({ code: 'bad_request', message: 'y'.repeat(1000) }).detalhe?.length).toBe(300);
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

// ------------------------------------------------------------
// A tentativa da EQUIPE (31/10/2026): a rota do compositor grava, com quem
// tentou.
// ------------------------------------------------------------
const TENTATIVA: TentativaDoNucleo = {
  accountId: 'acc-1',
  conversationId: 'conv-1',
  canalId: 'canal-1',
  contentType: 'document',
  texto: '*Atendente Teste:*\nSegue o contrato.',
  previa: '*Atendente Teste:*\nSegue o contrato.',
  mediaUrl: 'https://exemplo.test/chat-media/contrato.pdf',
  mediaFilename: 'contrato.pdf',
  replyToMessageId: 'msg-citada',
};

describe('registrarTentativaDaEquipe', () => {
  it('grava `agent` com QUEM tentou, a citação e o motivo — e devolve o id da linha', async () => {
    const { db, inserts } = makeDb();
    const id = await registrarTentativaDaEquipe(
      db,
      TENTATIVA,
      'login-1',
      new EvolutionApiError('number 5511900000000 is not on WhatsApp', 400, true),
    );
    expect(id).toBe('m-1');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'agent',
      sender_id: 'login-1',
      content_type: 'document',
      content_text: TENTATIVA.texto,
      media_filename: 'contrato.pdf',
      reply_to_message_id: 'msg-citada',
      status: 'failed',
      nao_saiu: true,
      error_title: 'sem_whatsapp',
      channel_id: 'canal-1',
    });
    expect(inserts[0]).not.toHaveProperty('message_id');
  });

  it('SEM o arquivo: o anexo volta à prévia do compositor, que o apaga no descarte', async () => {
    const { db, inserts } = makeDb();
    await registrarTentativaDaEquipe(db, TENTATIVA, 'login-1', new Error('x'));
    expect(inserts[0]).not.toHaveProperty('media_url');
  });

  it('sobe a conversa na lista, mas NÃO preenche o número (o núcleo já preencheu, e nunca em grupo)', async () => {
    const { db, updates } = makeDb();
    await registrarTentativaDaEquipe(db, TENTATIVA, 'login-1', new Error('x'));
    expect(updates.find((u) => 'channel_id' in u.row)).toBeUndefined();
    const previa = updates.find((u) => 'last_message_text' in u.row);
    expect(previa?.row.last_message_text).toBe(TENTATIVA.previa);
    expect(previa?.filtros).toContainEqual(['account_id', 'acc-1']);
  });

  it('INSERT recusado: devolve null e não mexe na conversa (a bolha fica só na tela de quem tentou)', async () => {
    const { db, updates } = makeDb({ insertError: { code: '42501', message: 'denied' } });
    await expect(registrarTentativaDaEquipe(db, TENTATIVA, 'login-1', new Error('x'))).resolves.toBeNull();
    expect(updates).toEqual([]);
  });

  it('o robô continua `bot`, sem `sender_id`', async () => {
    const { db, inserts } = makeDb();
    await registrarEnvioQueFalhou(db, RASCUNHO, new Error('x'));
    expect(inserts[0]).toMatchObject({ sender_type: 'bot' });
    expect(inserts[0]).not.toHaveProperty('sender_id');
  });
});

