import { describe, expect, it } from 'vitest';

import type { Message } from '@/types';
import { buildReplyPreview } from './reply-quote';

// A citação da mensagem de empresa com opções de resposta (1111): só o corpo,
// sem as linhas `[opção]` — como a bolha, e como o WhatsApp mostra.

const t = ((chave: string) => `<${chave}>`) as unknown as Parameters<typeof buildReplyPreview>[1];

const mensagem = (p: Partial<Message>) =>
  ({
    id: 'm1',
    conversation_id: 'c1',
    sender_type: 'customer',
    content_type: 'template',
    status: 'delivered',
    created_at: '2026-10-26T12:00:00Z',
    ...p,
  }) as Message;

describe('buildReplyPreview — mensagem de empresa com opções (1111)', () => {
  it('cita só o corpo, sem as linhas [opção]', () => {
    expect(
      buildReplyPreview(
        mensagem({ content_text: 'Olá, responda.\n\n[Sim]\n[Não]', opcoes_de_resposta: ['Sim', 'Não'] }),
        t,
      ),
    ).toBe('Olá, responda.');
  });

  it('só os botões: o rótulo do tipo, como a mensagem sem texto', () => {
    expect(
      buildReplyPreview(mensagem({ content_text: '[Sim]\n[Não]', opcoes_de_resposta: ['Sim', 'Não'] }), t),
    ).toBe('<template>');
  });

  it('sem opções gravadas, ou mensagem da equipe: o texto inteiro, como antes', () => {
    expect(buildReplyPreview(mensagem({ content_text: 'Olá\n\n[Sim]' }), t)).toBe('Olá\n\n[Sim]');
    expect(
      buildReplyPreview(
        mensagem({ sender_type: 'agent', content_text: 'Olá\n\n[Sim]', opcoes_de_resposta: ['Sim'] }),
        t,
      ),
    ).toBe('Olá\n\n[Sim]');
  });
});
