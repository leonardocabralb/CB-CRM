import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// O núcleo de envio pelo Instagram Direct (Fase 4). Ids fictícios.
// O que importa: o destino é o IGSID (nunca o telefone), o que o Direct não
// aceita é recusado ANTES da Meta, a janela de 24 h é conferida no servidor,
// recusa 4xx × "não sei" decide a entrega incerta, e o eco que gravou a linha
// primeiro é assumido (nunca um `db_error` com a mensagem no fio).
// ============================================================

const h = vi.hoisted(() => ({
  enviar: vi.fn(),
  assinatura: null as string | null,
  adminUpdates: [] as Record<string, unknown>[],
  adminFiltros: [] as [string, unknown][],
}));

vi.mock('@/lib/cb-channels/resolve', () => ({
  resolveChannelForConversation: vi.fn(),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => `dec(${s})`,
  encrypt: (s: string) => s,
  isLegacyFormat: () => false,
}));
vi.mock('@/lib/instagram/graph', async () => {
  const real = await vi.importActual<typeof import('@/lib/instagram/graph')>(
    '@/lib/instagram/graph'
  );
  return {
    ...real,
    criarClienteInstagram: (token: string) => ({
      enviarMensagem: (m: unknown) => h.enviar(token, m),
    }),
  };
});
vi.mock('@/lib/assinatura/resolver', () => ({
  nomeParaAssinar: async () => h.assinatura,
}));
vi.mock('@/lib/cb-channels/stamp', () => ({
  preencherCanalDaConversa: vi.fn(async () => {}),
  stampMessageChannel: vi.fn(async () => {}),
}));
vi.mock('@/lib/cb-channels/pipeline-routing', () => ({
  routeContactToPipeline: vi.fn(async () => null),
}));
vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: vi.fn(async () => false),
}));
vi.mock('@/lib/flows/parar-run', () => ({
  abortActiveRunsForContact: vi.fn(async () => {}),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b = {
        update: (v: Record<string, unknown>) => {
          h.adminUpdates.push(v);
          return b;
        },
        eq: (c: string, v: unknown) => {
          h.adminFiltros.push([c, v]);
          return b;
        },
        select: () => b,
        single: async () => ({
          data: { id: 'msg-do-eco', content_text: 'oi' },
          error: null,
        }),
      };
      return b;
    },
  }),
}));

import { resolveChannelForConversation } from '@/lib/cb-channels/resolve';
import { InstagramApiError } from '@/lib/instagram/graph';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

const resolver = vi.mocked(resolveChannelForConversation);

const CANAL_IG = {
  provider: 'instagram',
  channelId: 'ch-ig',
  access_token: 'token-cifrado',
  phone_number_id: null,
  waba_id: null,
  base_url: null,
  instance_name: null,
  api_key: null,
  legacyConfigId: null,
  source: 'cb_channels',
} as const;

const AGORA = Date.now();
const HA_UMA_HORA = new Date(AGORA - 3_600_000).toISOString();
const HA_DOIS_DIAS = new Date(AGORA - 48 * 3_600_000).toISOString();

interface Cenario {
  contato?: Record<string, unknown>;
  ultimaDoCliente?: string | null;
  erroDaJanela?: boolean;
  citada?: Record<string, unknown> | null;
  insertErro?: { code: string; message: string } | null;
}

function fakeDb(c: Cenario) {
  const inserts: Record<string, unknown>[] = [];
  const from = (tabela: string) => {
    const estado = { op: 'select', cols: '' };
    const resolver = async () => {
      if (tabela === 'conversations') {
        return {
          data: {
            id: 'cv-1',
            account_id: 'acct-1',
            contact_id: 'c1',
            group_id: null,
            group: null,
            contact: c.contato ?? {
              id: 'c1',
              phone: null,
              instagram_id: 'igsid-1',
            },
          },
          error: null,
        };
      }
      if (estado.op === 'insert') {
        return c.insertErro
          ? { data: null, error: c.insertErro }
          : { data: { ...inserts.at(-1), id: 'msg-1' }, error: null };
      }
      if (estado.cols === 'created_at') {
        if (c.erroDaJanela) return { data: null, error: { message: 'boom' } };
        const quando =
          c.ultimaDoCliente === undefined ? HA_UMA_HORA : c.ultimaDoCliente;
        return { data: quando ? { created_at: quando } : null, error: null };
      }
      return { data: c.citada ?? null, error: null };
    };
    const b = {
      select: (cols?: string) => {
        if (estado.op === 'select') estado.cols = cols ?? '*';
        return b;
      },
      insert: (v: Record<string, unknown>) => {
        estado.op = 'insert';
        inserts.push(v);
        return b;
      },
      update: () => {
        estado.op = 'update';
        return b;
      },
      eq: () => b,
      order: () => b,
      limit: () => b,
      single: resolver,
      maybeSingle: resolver,
      then: (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(ok),
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, inserts };
}

async function enviar(c: Cenario, params: Partial<SendMessageParams> = {}) {
  const { db, inserts } = fakeDb(c);
  const r = await sendMessageToConversation(db, 'acct-1', {
    conversationId: 'cv-1',
    messageType: 'text',
    contentText: 'Olá, aqui é o escritório',
    senderUserId: 'user-1',
    ...params,
  });
  return { r, inserts };
}

async function erroDe(c: Cenario, params: Partial<SendMessageParams> = {}) {
  try {
    await enviar(c, params);
  } catch (e) {
    return e as SendMessageError;
  }
  throw new Error('esperava SendMessageError');
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assinatura = null;
  h.adminUpdates = [];
  h.adminFiltros = [];
  h.enviar.mockResolvedValue({ messageId: 'mid-novo' });
  resolver.mockResolvedValue(CANAL_IG as never);
});

describe('Instagram Direct — o envio', () => {
  it('manda ao IGSID com o token da conexão e grava o `mid` como message_id', async () => {
    const { r, inserts } = await enviar({});
    expect(h.enviar).toHaveBeenCalledWith('dec(token-cifrado)', {
      para: 'igsid-1',
      citando: null,
      texto: 'Olá, aqui é o escritório',
    });
    expect(inserts[0]).toMatchObject({
      message_id: 'mid-novo',
      sender_type: 'agent',
      sender_id: 'user-1',
      content_type: 'text',
      remote_jid: null,
    });
    expect(r).toMatchObject({
      messageId: 'msg-1',
      whatsappMessageId: 'mid-novo',
      channelId: 'ch-ig',
    });
  });

  it('⚠️ a assinatura sai SEM o negrito do WhatsApp — e é o que se grava', async () => {
    h.assinatura = 'Maria Souza';
    const { inserts } = await enviar({});
    expect(h.enviar.mock.calls[0][1]).toMatchObject({
      texto: 'Maria Souza:\nOlá, aqui é o escritório',
    });
    expect(inserts[0]).toMatchObject({ content_text: 'Maria Souza:\nOlá, aqui é o escritório' });
  });

  it('o telefone da ficha NUNCA é o destino, nem é "corrigido" depois', async () => {
    await enviar({
      contato: { id: 'c1', phone: '5583980000016', instagram_id: 'igsid-1' },
    });
    expect(h.enviar.mock.calls[0][1]).toMatchObject({ para: 'igsid-1' });
  });

  it('PDF sai como `file`, WAV como `audio` — sem legenda', async () => {
    await enviar(
      {},
      {
        messageType: 'document',
        contentText: null,
        mediaUrl: 'https://x/y/contrato.pdf',
        filename: 'contrato.pdf',
      }
    );
    expect(h.enviar.mock.calls[0][1]).toEqual({
      para: 'igsid-1',
      citando: null,
      anexo: { tipo: 'file', url: 'https://x/y/contrato.pdf' },
    });
    await enviar(
      {},
      {
        messageType: 'audio',
        contentText: null,
        mediaUrl: 'https://x/y/voice-1.wav',
        filename: 'voice-1.wav',
      }
    );
    expect(h.enviar.mock.calls[1][1]).toMatchObject({
      anexo: { tipo: 'audio' },
    });
  });

  it('cita pela `mid` da DM (a linha irmã de anexo extra cita a DM inteira)', async () => {
    await enviar(
      {
        citada: {
          message_id: 'mid-cliente#2',
          content_type: 'image',
          deleted_at: null,
          channel_id: 'ch-ig',
        },
      },
      { replyToMessageId: 'msg-citada' }
    );
    expect(h.enviar.mock.calls[0][1]).toMatchObject({ citando: 'mid-cliente' });
  });
});

describe('Instagram Direct — o que o Direct não aceita é recusado ANTES da Meta', () => {
  it.each([
    ['modelo', { messageType: 'template', templateName: 'x' }, 'not_supported'],
    [
      'legenda em anexo',
      {
        messageType: 'image',
        mediaUrl: 'https://x/a.jpg',
        contentText: 'veja',
      },
      'not_supported',
    ],
    [
      'documento que não é PDF',
      {
        messageType: 'document',
        contentText: null,
        mediaUrl: 'https://x/a.docx',
        filename: 'a.docx',
      },
      'not_supported',
    ],
    [
      'áudio Ogg',
      {
        messageType: 'audio',
        contentText: null,
        mediaUrl: 'https://x/a.ogg',
        filename: 'a.ogg',
      },
      'not_supported',
    ],
    [
      'texto acima de 1000 BYTES (501 caracteres de 2 bytes)',
      { contentText: 'ç'.repeat(501) },
      'text_too_long',
    ],
  ])('%s', async (_nome, params, codigo) => {
    const e = await erroDe({}, params as Partial<SendMessageParams>);
    expect(e.code).toBe(codigo);
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('⚠️ o teto de bytes conta a ASSINATURA', async () => {
    h.assinatura = 'Maria';
    const e = await erroDe({}, { contentText: 'a'.repeat(995) });
    expect(e.code).toBe('text_too_long');
  });

  it('citar mensagem apagada, ou de outra conexão, é recusado', async () => {
    const apagada = await erroDe(
      {
        citada: {
          message_id: 'mid-x',
          content_type: 'text',
          deleted_at: '2026-11-20T10:00:00Z',
          channel_id: 'ch-ig',
        },
      },
      { replyToMessageId: 'msg-citada' }
    );
    expect(apagada.message).toMatch(/apagada/);
    const outra = await erroDe(
      {
        citada: {
          message_id: 'wamid.x',
          content_type: 'text',
          deleted_at: null,
          channel_id: 'ch-whatsapp',
        },
      },
      { replyToMessageId: 'msg-citada' }
    );
    expect(outra.message).toMatch(/conexão do Instagram/);
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('contato sem IGSID numa conversa do Instagram não manda ao telefone', async () => {
    const e = await erroDe({
      contato: { id: 'c1', phone: '5583980000016', instagram_id: null },
    });
    expect(e.code).toBe('not_supported');
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('a ficha SÓ do Instagram numa conexão de WhatsApp ouve a frase certa', async () => {
    resolver.mockResolvedValue({
      ...CANAL_IG,
      provider: 'evolution',
      channelId: 'ch-qr',
    } as never);
    const e = await erroDe({});
    expect(e.message).toMatch(/só existe no Instagram/);
  });
});

describe('Instagram Direct — a janela de 24 h, no servidor', () => {
  it('última mensagem da pessoa há mais de 24 h: `window_closed`, nada sai', async () => {
    const e = await erroDe({ ultimaDoCliente: HA_DOIS_DIAS });
    expect(e.code).toBe('window_closed');
    expect(e.status).toBe(409);
    expect(e.tentativa).toBeUndefined();
    expect(h.enviar).not.toHaveBeenCalled();
  });

  it('sem mensagem da pessoa por esta conexão: fechada (só ela abre)', async () => {
    const e = await erroDe({ ultimaDoCliente: null });
    expect(e.code).toBe('window_closed');
  });

  it('leitura que falha NÃO é "fechada" nem "aberta": nada sai, e não é `db_error`', async () => {
    const e = await erroDe({ erroDaJanela: true });
    expect(e.code).toBe('window_unknown');
    expect(h.enviar).not.toHaveBeenCalled();
  });
});

describe('Instagram Direct — recusa × "não sei"', () => {
  it('4xx da Meta: `instagram_rejected`, com a tentativa (vira bolha "não enviada")', async () => {
    h.enviar.mockRejectedValue(
      new InstagramApiError('sem_permissao', 'no', 400, 10)
    );
    const e = await erroDe({});
    expect(e.code).toBe('instagram_rejected');
    expect(e.tentativa).toBeDefined();
  });

  it('tempo esgotado, 5xx e 2xx sem `mid`: `instagram_error` (pode ter saído)', async () => {
    for (const err of [
      new InstagramApiError('rede', 'timeout'),
      new InstagramApiError('meta_error', 'boom', 500),
      new InstagramApiError('meta_error', 'sem mid', 200),
    ]) {
      h.enviar.mockRejectedValueOnce(err);
      const e = await erroDe({});
      expect(e.code).toBe('instagram_error');
    }
  });

  it('a janela que fechou entre a conferência e a Meta: `window_closed`, sem bolha', async () => {
    h.enviar.mockRejectedValue(
      new InstagramApiError('janela_fechada', 'outside', 400, 10, 2534022)
    );
    const e = await erroDe({});
    expect(e.code).toBe('window_closed');
    expect(e.tentativa).toBeUndefined();
  });
});

describe('Instagram Direct — o eco que gravou a linha primeiro', () => {
  it('⚠️ o UNIQUE recusa a nossa: a linha do eco é ASSUMIDA, nunca `db_error`', async () => {
    const { r } = await enviar({
      insertErro: { code: '23505', message: 'duplicate key' },
    });
    expect(r.messageId).toBe('msg-do-eco');
    expect(h.adminUpdates[0]).toMatchObject({
      sender_type: 'agent',
      sender_id: 'user-1',
      from_device: false,
      content_text: 'Olá, aqui é o escritório',
    });
    expect(h.adminFiltros).toEqual([
      ['conversation_id', 'cv-1'],
      ['message_id', 'mid-novo'],
    ]);
  });

  it('outro erro de gravação continua `db_error` (saiu e não gravou)', async () => {
    const e = await erroDe({ insertErro: { code: 'XX000', message: 'boom' } });
    expect(e.code).toBe('db_error');
  });
});
