import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../messages/pt-BR.json';
import type { Message } from '@/types';

// A bolha da resposta de um AGENTE de IA diz "IA · <nome>" (o nome vem da
// rota de nomes, que qualquer membro lê). Sem o agente — o assistente
// anterior, ou o nome que ainda não chegou — fica o selo "IA" de sempre.

vi.mock('@/components/agentes-de-ia/nomes-dos-agentes', () => ({
  useNomeDoAgenteDeIa: (id: string | null) => (id === 'ag-1' ? 'Triagem' : null),
}));

import { MessageBubble } from './message-bubble';

function mensagem(p: Partial<Message>): Message {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender_type: 'bot',
    content_type: 'text',
    content_text: 'Olá! Como posso ajudar?',
    status: 'sent',
    created_at: '2026-09-26T12:00:00Z',
    ai_generated: true,
    ...p,
  } as Message;
}

function desenhar(m: Message) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={ptBR as unknown as AbstractIntlMessages} timeZone="America/Sao_Paulo">
      <MessageBubble message={m} />
    </NextIntlClientProvider>,
  );
}

describe('MessageBubble — resposta do agente de IA', () => {
  it('com ia_agente_id: "IA · <nome>"', () => {
    expect(desenhar(mensagem({ ia_agente_id: 'ag-1' }))).toContain('IA · Triagem');
  });

  it('nome ainda desconhecido: o selo "IA" de sempre, nunca o id', () => {
    const html = desenhar(mensagem({ ia_agente_id: 'ag-desconhecido' }));
    expect(html).toContain(`>${ptBR.Inbox.bubble.aiBadge}<`);
    expect(html).not.toContain('ag-desconhecido');
  });

  it('assistente anterior (sem agente): o selo "IA"', () => {
    const html = desenhar(mensagem({ ia_agente_id: null }));
    expect(html).toContain(ptBR.Inbox.bubble.aiBadge);
    expect(html).not.toContain('IA ·');
  });
});
