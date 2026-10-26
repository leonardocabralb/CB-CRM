import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import ptBR from '../../../messages/pt-BR.json';
import type { Message } from '@/types';
import type { ModeloDoCatalogo } from '@/lib/whatsapp/modelo-da-mensagem';

// A bolha de MODELO mostra o cabeçalho de texto, o rodapé e os botões da linha
// local do modelo; sem catálogo (carregando, falhou) ou sem linha que case, é
// a bolha de sempre. O catálogo é o do hook de módulo, aqui trocado.

let catalogo: ModeloDoCatalogo[] | null = null;
vi.mock('@/hooks/use-modelos-da-conta', () => ({
  useModelosDaConta: () => catalogo,
}));

import { MessageBubble } from './message-bubble';

const MODELO: ModeloDoCatalogo = {
  name: 'retorno_do_processo',
  language: 'pt_BR',
  channel_id: 'canal-a',
  header_type: 'text',
  header_content: 'Atualização do seu caso',
  footer_text: 'Escritório Exemplo',
  buttons: [
    { type: 'QUICK_REPLY', text: 'Quero falar' },
    { type: 'URL', text: 'Ver detalhes', url: 'https://exemplo.test' },
  ],
  body_text: 'Olá {{1}}, o seu processo andou.',
};

function mensagem(p: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender_type: 'agent',
    content_type: 'template',
    content_text: 'Olá Maria, o seu processo andou.',
    template_name: 'retorno_do_processo',
    channel_id: 'canal-a',
    status: 'sent',
    created_at: '2026-10-25T12:00:00Z',
    ...p,
  } as Message;
}

function desenhar(m: Message, onResponderComOpcao?: (opcao: string) => void) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="pt-BR"
      messages={ptBR as unknown as AbstractIntlMessages}
      timeZone="America/Sao_Paulo"
    >
      <MessageBubble message={m} onResponderComOpcao={onResponderComOpcao} />
    </NextIntlClientProvider>
  );
}

describe('MessageBubble — modelo da Meta', () => {
  beforeEach(() => {
    catalogo = null;
  });

  it('com a linha do modelo: cabeçalho, corpo, rodapé e botões', () => {
    catalogo = [MODELO];
    const html = desenhar(mensagem());
    expect(html).toContain('Atualização do seu caso');
    expect(html).toContain('Olá Maria, o seu processo andou.');
    expect(html).toContain('Escritório Exemplo');
    expect(html).toContain('Quero falar');
    expect(html).toContain('Ver detalhes');
    // O cabeçalho vem ANTES do corpo, e o rodapé depois.
    expect(html.indexOf('Atualização do seu caso')).toBeLessThan(
      html.indexOf('Olá Maria')
    );
    expect(html.indexOf('Escritório Exemplo')).toBeGreaterThan(
      html.indexOf('Olá Maria')
    );
  });

  it('catálogo que não chegou (ou falhou): a bolha de sempre', () => {
    const html = desenhar(mensagem());
    expect(html).toContain(ptBR.Inbox.bubble.template);
    expect(html).toContain('Olá Maria, o seu processo andou.');
    expect(html).not.toContain('Escritório Exemplo');
    expect(html).not.toContain('Quero falar');
  });

  it('modelo de OUTRO número não empresta os botões', () => {
    catalogo = [MODELO];
    const html = desenhar(mensagem({ channel_id: 'canal-b' }));
    expect(html).not.toContain('Quero falar');
    expect(html).not.toContain('Atualização do seu caso');
  });

  it('a etiqueta "Modelo" inverte sobre a bolha da equipe (bg-primary)', () => {
    const html = desenhar(mensagem());
    expect(html).toContain('bg-primary-foreground/20 text-primary-foreground');
    expect(html).not.toContain('bg-primary/20');
  });
});

// A mensagem de EMPRESA recebida com opções de resposta (1111): as linhas
// `[opção]` saem do texto e viram botões que PREPARAM a resposta.
describe('MessageBubble — mensagem de empresa com opções de resposta (1111)', () => {
  const recebida = (p: Partial<Message> = {}) =>
    mensagem({
      sender_type: 'customer',
      template_name: undefined,
      channel_id: 'canal-a',
      content_text: 'Olá, Empresa Exemplo. Por favor, responda.\n\n[Sim]\n[Retorna mais tarde]',
      opcoes_de_resposta: ['Sim', 'Retorna mais tarde'],
      status: 'delivered',
      ...p,
    });
  const preparar = (opcao: string) =>
    ptBR.Inbox.bubble.prepararResposta.replace('{opcao}', opcao);

  beforeEach(() => {
    catalogo = null;
  });

  it('as linhas [opção] saem do texto e cada opção vira um botão', () => {
    const html = desenhar(recebida(), () => {});
    expect(html).toContain('Olá, Empresa Exemplo. Por favor, responda.');
    expect(html).not.toContain('[Sim]');
    expect(html).not.toContain('[Retorna mais tarde]');
    expect(html).toContain(`title="${preparar('Sim')}"`);
    expect(html).toContain(`title="${preparar('Retorna mais tarde')}"`);
    expect(html.match(/<button[^>]*title="Preparar a resposta/g)).toHaveLength(2);
  });

  it('sem o callback (quem não envia), as opções aparecem sem clique', () => {
    const html = desenhar(recebida());
    expect(html).toContain('Retorna mais tarde');
    expect(html).not.toContain('[Sim]');
    expect(html).not.toContain('Preparar a resposta');
  });

  it('mensagem apagada: as opções ficam só de retrato', () => {
    const html = desenhar(recebida({ deleted_at: '2026-10-26T15:00:00Z' }), () => {});
    expect(html).toContain('Retorna mais tarde');
    expect(html).not.toContain('Preparar a resposta');
  });

  it('mensagem anterior à 1111, sem opções gravadas: o texto inteiro, como antes', () => {
    const html = desenhar(recebida({ opcoes_de_resposta: null }), () => {});
    expect(html).toContain('[Sim]');
    expect(html).not.toContain('Preparar a resposta');
  });

  it('modelo da EQUIPE nunca oferece opção, mesmo com a coluna preenchida', () => {
    const html = desenhar(mensagem({ opcoes_de_resposta: ['Quero falar'] }), () => {});
    expect(html).not.toContain('Preparar a resposta');
  });

  it('mensagem de empresa sem nada legível: a frase do tipo não lido, não o rótulo cru', () => {
    const html = desenhar(
      recebida({ content_text: '[Unsupported message type: listMessage]', opcoes_de_resposta: null }),
    );
    expect(html).toContain(ptBR.Inbox.bubble.naoSuportada);
    expect(html).not.toContain('Unsupported message type');
  });
});
