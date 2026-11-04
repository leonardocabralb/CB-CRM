import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import type { Message } from '@/types';

// ============================================================
// "Dados da mensagem" de grupo (1119): cada estado do balão, e o botão que
// só existe na mensagem NOSSA de grupo que saiu. Nomes e telefones fictícios.
// ============================================================

vi.mock('@/hooks/use-can', () => ({ useCan: () => true }));

import { ConteudoDosDados, type Estado } from './dados-da-mensagem-do-grupo';
import { MessageActions } from './message-actions';

const T = ptBR.Inbox.messageInfo;

function comIdioma(no: React.ReactNode, mensagens: unknown = ptBR) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={mensagens as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      {no}
    </NextIntlClientProvider>,
  );
}

const balao = (atual: Estado | null) => comIdioma(<ConteudoDosDados atual={atual} aoTentarDeNovo={() => {}} />);

describe('o balão "Dados da mensagem"', () => {
  it('carregando: nunca "nenhum"', () => {
    const html = balao(null);
    expect(html).toContain(T.loading);
    expect(html).not.toContain(T.none);
  });

  it('⚠️ falha diz que não carregou e oferece tentar de novo — nunca vira lista vazia', () => {
    const html = balao({ de: 'x', situacao: 'falhou' });
    expect(html).toContain(T.failed);
    expect(html).toContain(T.retry);
    expect(html).not.toContain(T.none);
  });

  it('⚠️ vazio é "nenhum recibo REGISTRADO" (a mensagem de antes do patch não tem), com a explicação', () => {
    const html = balao({ de: 'x', situacao: 'pronto', recibos: [], participantesDeFora: 4 });
    expect(html).toContain(T.none);
    expect(html).toContain(T.noneHint);
  });

  it('quem leu e quem só recebeu, com o resumo pelo denominador; sem nome nem telefone, "Número oculto"', () => {
    const html = balao({
      de: 'x',
      situacao: 'pronto',
      participantesDeFora: 3,
      recibos: [
        { participante: '444@lid', nome: null, telefone: null, entregueEm: '2026-11-04T18:54:26Z', lidaEm: '2026-11-04T19:01:00Z' },
        { participante: '111@lid', nome: 'Cliente de Teste', telefone: '5583980000016', entregueEm: '2026-11-04T18:54:24Z', lidaEm: null },
      ],
    });
    expect(html).toContain(T.readBy);
    expect(html).toContain(T.deliveredTo);
    expect(html).toContain('Recebida por 2 de 3 · lida por 1');
    expect(html).toContain('Cliente de Teste');
    expect(html).toContain(T.hiddenNumber);
    // O LID cru jamais aparece.
    expect(html).not.toContain('444@lid');
    expect(html.indexOf(T.readBy)).toBeLessThan(html.indexOf(T.deliveredTo));
  });

  it('sem denominador (grupo nunca conferido), a lista sem o resumo', () => {
    const html = balao({
      de: 'x',
      situacao: 'pronto',
      participantesDeFora: null,
      recibos: [{ participante: '111@lid', nome: 'Cliente de Teste', telefone: null, entregueEm: '2026-11-04T18:54:24Z', lidaEm: null }],
    });
    expect(html).toContain('Cliente de Teste');
    expect(html).not.toContain('Recebida por');
  });

  it('as frases existem nos DOIS dicionários', () => {
    expect(Object.keys(en.Inbox.messageInfo).sort()).toEqual(Object.keys(ptBR.Inbox.messageInfo).sort());
    expect(en.Inbox.actions.messageInfo).toBeTruthy();
    expect(ptBR.Inbox.actions.messageInfo).toBeTruthy();
  });
});

describe('o botão na barra de ações', () => {
  const msg = (over: Partial<Message> = {}) =>
    ({
      id: 'm1',
      conversation_id: 'c1',
      message_id: '3EB0000000000000AB26',
      sender_type: 'agent',
      content_type: 'text',
      content_text: 'Bom dia',
      status: 'sent',
      created_at: '2026-11-04T12:00:00Z',
      ...over,
    }) as Message;

  const barra = (m: Message, grupoId: string | null) =>
    comIdioma(
      <MessageActions message={m} onReply={() => {}} onReact={() => {}} grupoId={grupoId}>
        <p>Bom dia</p>
      </MessageActions>,
    );

  const temBotao = (html: string) => html.includes(`aria-label="${ptBR.Inbox.actions.messageInfo}"`);

  it('aparece na mensagem NOSSA de grupo que saiu', () => {
    expect(temBotao(barra(msg(), 'g-1'))).toBe(true);
    expect(temBotao(barra(msg({ sender_type: 'bot' }), 'g-1'))).toBe(true);
  });

  it('não aparece fora de grupo, na mensagem de quem escreveu no grupo, na que não saiu nem na otimista', () => {
    expect(temBotao(barra(msg(), null))).toBe(false);
    expect(temBotao(barra(msg({ sender_type: 'customer' }), 'g-1'))).toBe(false);
    expect(temBotao(barra(msg({ nao_saiu: true }), 'g-1'))).toBe(false);
    expect(temBotao(barra(msg({ id: 'temp-1', message_id: undefined }), 'g-1'))).toBe(false);
  });
});
