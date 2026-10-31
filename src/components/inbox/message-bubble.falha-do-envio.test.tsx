import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../messages/pt-BR.json';
import type { Message } from '@/types';
import { naBolha } from '@/lib/inbox/falha-do-envio';

// ============================================================
// A bolha OTIMISTA que não saiu (19/10/2026): diz POR QUÊ, e só oferece
// "Tentar de novo" quando o fio passa `onTentarDeNovo`. A falha de RECIBO
// (saiu, o WhatsApp avisou depois) continua com a frase de sempre e sem
// botão — decisões de 05/10 (#390) e do 479 em grupo.
// ============================================================

vi.mock('@/components/agentes-de-ia/nomes-dos-agentes', () => ({
  useNomeDoAgenteDeIa: () => null,
}));

import { MessageBubble } from './message-bubble';

const b = ptBR.Inbox.bubble;

function otimista(p: Partial<Message>): Message {
  return {
    id: 'temp-1',
    conversation_id: 'c1',
    sender_type: 'agent',
    content_type: 'text',
    content_text: '*Atendente:*\nTexto de teste',
    status: 'sending',
    created_at: '2026-10-19T14:38:00Z',
    ...p,
  } as Message;
}

function desenhar(m: Message, onTentarDeNovo?: () => void) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={ptBR as unknown as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <MessageBubble message={m} onTentarDeNovo={onTentarDeNovo} />
    </NextIntlClientProvider>,
  );
}

describe('MessageBubble — envio da equipe que não saiu', () => {
  it('o caso de 19/10: número sem WhatsApp — "não enviada", nunca "o destinatário não recebeu"', () => {
    const html = desenhar(
      otimista(naBolha({ motivo: 'sem_whatsapp', detalhe: 'number x is not on WhatsApp', podeTentarDeNovo: false })),
    );
    expect(html).toContain(b.naoSaiu.sem_whatsapp);
    expect(html).not.toContain(b.naoEntregue);
    expect(html).not.toContain(b.tentarDeNovo);
  });

  it('barrado mostra o motivo na linha de baixo', () => {
    const html = desenhar(
      otimista(naBolha({ motivo: 'barrado', detalhe: 'Conversation not found', podeTentarDeNovo: false })),
    );
    expect(html).toContain(b.naoSaiu.barrado);
    expect(html).toContain('Motivo: Conversation not found');
  });

  it('incerto: a frase que manda conferir antes de reenviar', () => {
    const html = desenhar(otimista(naBolha({ motivo: 'incerto', detalhe: null, podeTentarDeNovo: false })));
    expect(html).toContain(b.naoSaiu.incerto);
    expect(html).not.toContain(b.tentarDeNovo);
  });

  it('o botão aparece só quando o fio o oferece', () => {
    const m = otimista(naBolha({ motivo: 'recusado', detalhe: 'Bad Request', podeTentarDeNovo: true }));
    expect(desenhar(m, () => {})).toContain(b.tentarDeNovo);
    expect(desenhar(m)).not.toContain(b.tentarDeNovo);
  });

  // 31/10/2026: a tentativa da equipe fica GRAVADA, e o anexo dela SEM o
  // arquivo (ele volta à prévia do compositor). A bolha nomeia o anexo —
  // nunca "carregando" nem "indisponível", que falariam de outra coisa.
  it('anexo GRAVADO sem o arquivo: o nome do anexo, sem "indisponível"', () => {
    const html = desenhar(
      otimista({
        id: 'uuid-gravada',
        content_type: 'document',
        content_text: '*Atendente:*\nSegue o contrato',
        media_url: undefined,
        media_filename: 'contrato-ficticio.pdf',
        created_at: new Date().toISOString(),
        sender_id: 'login-1',
        ...naBolha({ motivo: 'recusado', detalhe: 'Bad Request', podeTentarDeNovo: true }),
      }),
    );
    expect(html).toContain('contrato-ficticio.pdf');
    // A legenda que não saiu também aparece.
    expect(html).toContain('Segue o contrato');
    expect(html).toContain(b.naoSaiu.recusado);
    expect(html).not.toContain(b.unavailable.replace('{label}', 'contrato-ficticio.pdf'));
  });

  it('falha de RECIBO (saiu, tem message_id, sem nao_saiu): a frase de sempre, e nem com a prop há botão', () => {
    const html = desenhar(
      otimista({ id: 'uuid-real', status: 'failed', message_id: '3EB0FICTICIO' }),
      () => {},
    );
    expect(html).toContain(b.naoEntregue);
    expect(html).not.toContain(b.tentarDeNovo);
  });
});
