import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// O canal é resolvido por um módulo à parte; mockar aqui deixa cada teste
// escolher se a conversa responde por um número da Meta ou por QR Code.
const resolveMock = vi.fn();
vi.mock('@/lib/cb-channels/resolve', () => ({
  resolveChannelForConversation: (...a: unknown[]) => resolveMock(...a),
}));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({}) }));

import { sendMessageToConversation, SendMessageError } from './send-message';

const GRUPO_JID = '120363123456789012@g.us';

/** DB mínimo: só sabe devolver a conversa que o teste montou. */
function dbCom(conversation: Record<string, unknown>): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: conversation, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

function conversaDeGrupo(grupo: Record<string, unknown> | null) {
  return {
    id: 'cv-g1',
    account_id: 'acct-1',
    contact_id: null,
    group_id: 'g1',
    contact: null,
    group: grupo,
  };
}

async function erroDe(
  db: SupabaseClient,
): Promise<SendMessageError> {
  try {
    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-g1',
      messageType: 'text',
      contentText: 'olá',
    });
  } catch (e) {
    return e as SendMessageError;
  }
  throw new Error('esperava SendMessageError, mas o envio passou');
}

beforeEach(() => resolveMock.mockReset());

describe('envio para GRUPO — as guardas', () => {
  it('⚠️ recusa canal da Meta com instrução do que fazer', async () => {
    // Grupo não existe na API oficial da Meta. A conversa chega assim quando
    // o atendente fixou o canal na mão — a mensagem tem que dizer o caminho
    // (trocar de canal), não um "não suportado" que o deixa sem saída.
    resolveMock.mockResolvedValue({ provider: 'meta', channelId: 'ch-meta' });
    const e = await erroDe(dbCom(conversaDeGrupo({ jid: GRUPO_JID })));
    expect(e.status).toBe(400);
    expect(e.code).toBe('not_supported');
    expect(e.message).toMatch(/troque o canal/i);
  });

  it('recusa grupo só-para-administradores quando não somos admin', async () => {
    resolveMock.mockResolvedValue({ provider: 'evolution', channelId: 'ch-1' });
    const e = await erroDe(
      dbCom(
        conversaDeGrupo({ jid: GRUPO_JID, is_announce: true, we_are_admin: false }),
      ),
    );
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/administradores/i);
  });

  it('⚠️ NÃO bloqueia quando ainda não sabemos se é só-admin', async () => {
    // `is_announce` nulo = grupo ainda não sincronizado. Bloquear no escuro
    // impediria de responder num grupo comum; se de fato for restrito, a
    // própria Evolution recusa e o erro aparece no envio.
    resolveMock.mockResolvedValue({ provider: 'evolution', channelId: 'ch-1' });
    const e = await erroDe(
      dbCom(conversaDeGrupo({ jid: GRUPO_JID, is_announce: null, we_are_admin: null })),
    );
    // Passa das guardas e morre adiante, por falta de credencial no mock —
    // o que importa é que NÃO foi barrado por "só admin".
    expect(e.message).not.toMatch(/administradores/i);
  });

  it('recusa conversa de grupo sem a linha do grupo', async () => {
    // Dado inconsistente. Enviar às cegas não é opção: não há para onde.
    resolveMock.mockResolvedValue({ provider: 'evolution', channelId: 'ch-1' });
    const e = await erroDe(dbCom(conversaDeGrupo(null)));
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/group not found/i);
  });

  it('não exige telefone de contato num grupo', async () => {
    // Era ESTA a guarda que barrava grupo até a Fase 6: a conversa não tem
    // contato, e `Contact phone number not found` estourava antes de tudo.
    resolveMock.mockResolvedValue({ provider: 'evolution', channelId: 'ch-1' });
    const e = await erroDe(dbCom(conversaDeGrupo({ jid: GRUPO_JID })));
    expect(e.message).not.toMatch(/contact phone number/i);
  });
});

describe('envio 1:1 segue exigindo telefone', () => {
  it('recusa contato sem telefone', async () => {
    resolveMock.mockResolvedValue({ provider: 'evolution', channelId: 'ch-1' });
    const e = await erroDe(
      dbCom({
        id: 'cv-1',
        account_id: 'acct-1',
        contact_id: 'c1',
        group_id: null,
        contact: { id: 'c1', phone: null },
        group: null,
      }),
    );
    expect(e.status).toBe(400);
    expect(e.message).toMatch(/contact phone number/i);
  });
});
