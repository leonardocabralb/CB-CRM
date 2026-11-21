import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import type { Message } from '@/types';
import { PastilhaDoInstagram, SeloDoInstagram } from '@/components/channels/selo-do-instagram';

// ============================================================
// A conversa do Instagram Direct se reconhece "passando o olho" (pedido do
// operador, 21/11/2026; desenho B, escolhido entre três): o selo no canto da
// foto (lista e cabeçalho), a pastilha "Instagram Direct" no cabeçalho e o
// glifo ao lado da hora em cada bolha do Direct.
//
// ⚠️ O que este pino segura é a régua do "é Instagram": pelo PREDICADO e só
// com os canais carregados — lista de canais vazia (carregando ou falhou) não
// vira a afirmação "é Instagram". A lista e o fio são grandes demais para
// montar aqui: o pino lê o fonte (como `simbolo-da-ia-na-lista.test.ts`).
// ============================================================

vi.mock('@/components/agentes-de-ia/nomes-dos-agentes', () => ({
  useNomeDoAgenteDeIa: () => null,
}));

import { MessageBubble } from './message-bubble';

function semComentarios(arquivo: string): string {
  return fs
    .readFileSync(path.join(__dirname, arquivo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function mensagem(p: Partial<Message>): Message {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender_type: 'customer',
    content_type: 'text',
    content_text: 'Oi',
    status: 'delivered',
    created_at: '2026-11-21T19:46:00Z',
    ...p,
  } as Message;
}

function desenhar(m: Message, doInstagram?: boolean) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={ptBR as unknown as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <MessageBubble message={m} doInstagram={doInstagram} />
    </NextIntlClientProvider>,
  );
}

describe('a bolha do Instagram Direct', () => {
  const via = ptBR.Inbox.bubble.viaInstagram;

  it('leva o glifo, com o texto para quem não enxerga, nos dois lados do fio', () => {
    expect(desenhar(mensagem({}), true)).toContain(via);
    expect(desenhar(mensagem({ sender_type: 'agent', status: 'sent' }), true)).toContain(via);
  });

  it('sem a prop (WhatsApp, ou canais ainda carregando) não diz nada', () => {
    expect(desenhar(mensagem({}))).not.toContain(via);
    expect(desenhar(mensagem({}), false)).not.toContain(via);
  });
});

describe('as peças do selo', () => {
  it('o selo com rótulo é lido; sem rótulo é decoração (o texto ao lado já diz)', () => {
    // Só o INVÓLUCRO conta: o glifo (o `<svg>` de dentro) é sempre `aria-hidden`.
    const tagDeFora = (html: string) => html.slice(0, html.indexOf('>') + 1);

    const lido = renderToStaticMarkup(<SeloDoInstagram rotulo="Conversa pelo Instagram Direct" />);
    expect(tagDeFora(lido)).toContain('title="Conversa pelo Instagram Direct"');
    expect(tagDeFora(lido)).not.toContain('aria-hidden');
    expect(lido).toContain('<span class="sr-only">Conversa pelo Instagram Direct</span>');

    const enfeite = renderToStaticMarkup(<SeloDoInstagram />);
    expect(tagDeFora(enfeite)).toContain('aria-hidden="true"');
    expect(enfeite).not.toContain('sr-only');
  });

  it('o degradê é classe LITERAL (o Tailwind não gera classe montada)', () => {
    const html = renderToStaticMarkup(<PastilhaDoInstagram texto="Instagram Direct" />);
    expect(html).toContain('bg-linear-to-tr from-amber-400 via-pink-500 to-purple-600');
    expect(html).toContain('Instagram Direct');
  });
});

describe('a régua do "é Instagram" (pino no fonte)', () => {
  it('na lista: o canal da CONVERSA pelo predicado, e só com os canais carregados', () => {
    const lista = semComentarios('conversation-list.tsx');
    expect(lista).toMatch(
      /doInstagram=\{\s*!canaisCarregando &&\s*!canaisFalharam &&\s*ehInstagram\(canaisPorId\.get\(canalDaConversa\(conv\) \?\? ""\) \?\? null\)\s*\}/,
    );
    expect(lista).toContain('{doInstagram && (');
    expect(lista).toContain('rotulo={t("doInstagram")}');
  });

  it('no cabeçalho, o número de SAÍDA; na bolha, o canal DA MENSAGEM', () => {
    const fio = semComentarios('message-thread.tsx');
    expect(fio).toContain('const conversaDoInstagram = ehInstagram(activeChannel);');
    expect(fio).toContain('doInstagram={ehInstagram(channelsById.get(msg.channel_id ?? "") ?? null)}');
    expect(fio).toContain('texto={t("instagramDireto")}');
  });
});

describe('os textos existem nos DOIS dicionários', () => {
  it('lista, cabeçalho e bolha', () => {
    expect(ptBR.Inbox.conversationList.doInstagram).toBe('Conversa pelo Instagram Direct');
    expect(ptBR.Inbox.messageThread.instagramDireto).toBe('Instagram Direct');
    expect(ptBR.Inbox.bubble.viaInstagram).toBe('Pelo Instagram Direct');
    expect(typeof en.Inbox.conversationList.doInstagram).toBe('string');
    expect(typeof en.Inbox.messageThread.instagramDireto).toBe('string');
    expect(typeof en.Inbox.bubble.viaInstagram).toBe('string');
  });
});
