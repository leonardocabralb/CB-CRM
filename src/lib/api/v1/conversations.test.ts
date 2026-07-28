import { describe, it, expect } from 'vitest';
import type { Conversation, Message } from '@/types';
import { serializeConversation, serializeMessage } from './conversations';

describe('serializeConversation', () => {
  it('projects public fields + nested contact/tags and drops internals', () => {
    const conv = {
      id: 'conv1',
      user_id: 'internal-user',
      account_id: 'internal-acct',
      contact_id: 'c1',
      status: 'open',
      last_message_text: 'hi',
      last_message_at: '2026-01-01T00:00:00Z',
      unread_count: 2,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      contact: {
        id: 'c1',
        phone: '+1',
        name: 'Jane',
        tags: [{ id: 't1', name: 'vip', color: '#fff' }],
      },
    } as unknown as Conversation;

    const out = serializeConversation(conv);
    expect(out).not.toHaveProperty('user_id');
    expect(out).not.toHaveProperty('account_id');
    expect(out.contact?.tags).toEqual([{ id: 't1', name: 'vip', color: '#fff' }]);
    expect(out.unread_count).toBe(2);
  });

  it('expõe channel_id, e null quando a conversa é pré-multi-canal', () => {
    // Sem isso, um painel construído sobre a API v1 não consegue separar
    // "atendimento Comercial" de "clientes do Dr. Leonardo".
    const base = { id: 'conv1', contact_id: 'c1', status: 'open' };

    const comCanal = { ...base, channel_id: 'ch-1' } as unknown as Conversation;
    expect(serializeConversation(comCanal).channel_id).toBe('ch-1');

    const semCanal = base as unknown as Conversation;
    expect(serializeConversation(semCanal).channel_id).toBeNull();
  });

  it('não explode com conversa de grupo (contato nulo)', () => {
    // As rotas da v1 filtram `.is('group_id', null)`, então isto NÃO deve
    // acontecer. O teste existe para a rota nova que alguém escrever amanhã
    // esquecendo o filtro: o pior caso tem que ser um campo nulo no JSON, não
    // um 500 derrubando a integração de quem consome.
    const grupo = {
      id: 'conv-grupo',
      contact_id: null,
      group_id: 'g1',
      status: 'open',
      contact: null,
    } as unknown as Conversation;

    const out = serializeConversation(grupo);
    expect(out.contact_id).toBeNull();
    expect(out.contact).toBeNull();
    expect(out.id).toBe('conv-grupo');
  });
});

describe('serializeMessage', () => {
  it('maps message_id → whatsapp_message_id and derives direction', () => {
    const inbound = {
      id: 'm1',
      conversation_id: 'conv1',
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'hello',
      message_id: 'wamid.123',
      status: 'delivered',
      created_at: '2026-01-01T00:00:00Z',
    } as unknown as Message;
    const outMsg = serializeMessage(inbound);
    expect(outMsg.direction).toBe('inbound');
    expect(outMsg.whatsapp_message_id).toBe('wamid.123');
    expect(outMsg).not.toHaveProperty('message_id');

    const agent = { ...inbound, sender_type: 'agent' } as unknown as Message;
    expect(serializeMessage(agent).direction).toBe('outbound');
  });

  it('expõe channel_id, e null quando a mensagem é pré-multi-canal', () => {
    const base = {
      id: 'm1',
      conversation_id: 'conv1',
      sender_type: 'customer',
      content_type: 'text',
    };
    const comCanal = { ...base, channel_id: 'ch-2' } as unknown as Message;
    expect(serializeMessage(comCanal).channel_id).toBe('ch-2');
    expect(serializeMessage(base as unknown as Message).channel_id).toBeNull();
  });
});
