import { describe, expect, it } from 'vitest';

import type { Message } from '@/types';

import {
  comBolhaPublicada,
  comLinhaDoTempoReal,
  ehOtimista,
  recargaComFalhadas,
} from './bolhas-otimistas';

// Ids fictícios: o login de quem está na tela e o de um colega.
const EU = 'login-eu';
const COLEGA = 'login-colega';
const CONVERSA = 'conv-1';

function msg(id: string, p: Partial<Message> = {}): Message {
  return {
    id,
    conversation_id: CONVERSA,
    sender_type: 'agent',
    content_type: 'text',
    content_text: id,
    status: 'sent',
    created_at: '2026-10-25T12:00:00.000Z',
    ...p,
  };
}
/** A bolha que o fio publica ao enviar (sem `sender_id`, como no fio). */
const otimista = (id: string, p: Partial<Message> = {}) =>
  msg(id, { status: 'sending', ...p });
/** A linha que o banco grava para o envio de quem está na tela. */
const minha = (id: string, p: Partial<Message> = {}) =>
  msg(id, { sender_id: EU, ...p });
const ids = (lista: Message[]) => lista.map((m) => m.id);
/** O `onUpdateMessage` da página: troca por id, sem acrescentar. */
const atualizar = (lista: Message[], id: string, u: Partial<Message>) =>
  lista.map((m) => (m.id === id ? { ...m, ...u } : m));

describe('ehOtimista', () => {
  it('reconhece o id provisório do fio', () => {
    expect(ehOtimista({ id: 'temp-1730000000000' })).toBe(true);
    expect(ehOtimista({ id: '7d1f0c1e-0000-4000-8000-000000000000' })).toBe(
      false
    );
  });
});

describe('comLinhaDoTempoReal', () => {
  it('cliente escreve com uma bolha FALHADA na tela: ela fica', () => {
    const antes = [otimista('temp-1', { status: 'failed' })];
    const depois = comLinhaDoTempoReal(
      antes,
      msg('in-1', { sender_type: 'customer', content_text: 'oi?' }),
      EU
    );
    expect(ids(depois)).toEqual(['temp-1', 'in-1']);
    expect(depois[0].status).toBe('failed');
  });

  it('cliente escreve: nem a pendente sai (a linha dela ainda vem)', () => {
    const antes = [otimista('temp-1')];
    const depois = comLinhaDoTempoReal(
      antes,
      msg('in-1', { sender_type: 'customer' }),
      EU
    );
    expect(ids(depois)).toEqual(['temp-1', 'in-1']);
  });

  it('envio confirmado ANTES do tempo real: uma bolha só', () => {
    // `marcarEnviada` já trocou o texto pelo que o servidor gravou.
    let lista = [otimista('temp-1', { content_text: '*Leo*:\noi' })];
    lista = atualizar(lista, 'temp-1', {
      status: 'sent',
      content_text: '*Leonardo*:\noi',
    });
    lista = comLinhaDoTempoReal(
      lista,
      minha('real-1', { content_text: '*Leonardo*:\noi' }),
      EU
    );
    expect(ids(lista)).toEqual(['real-1']);
  });

  it('envio confirmado DEPOIS do tempo real: uma bolha só', () => {
    let lista = [otimista('temp-1', { content_text: '*Leo*:\noi' })];
    lista = comLinhaDoTempoReal(
      lista,
      minha('real-1', { content_text: '*Leonardo*:\noi' }),
      EU
    );
    expect(ids(lista)).toEqual(['real-1']);
    // A resposta do servidor chega depois e procura a otimista que já saiu.
    lista = atualizar(lista, 'temp-1', {
      status: 'sent',
      content_text: '*Leonardo*:\noi',
    });
    expect(ids(lista)).toEqual(['real-1']);
  });

  it('duas otimistas de texto IGUAL: cada linha leva uma, a mais antiga primeiro', () => {
    let lista = [
      otimista('temp-1', { content_text: 'ok' }),
      otimista('temp-2', { content_text: 'ok' }),
    ];
    lista = comLinhaDoTempoReal(
      lista,
      minha('real-1', { content_text: 'ok' }),
      EU
    );
    expect(ids(lista)).toEqual(['temp-2', 'real-1']);
    lista = comLinhaDoTempoReal(
      lista,
      minha('real-2', { content_text: 'ok' }),
      EU
    );
    expect(ids(lista)).toEqual(['real-1', 'real-2']);
  });

  it('o texto exato vence a mais antiga', () => {
    const lista = [
      otimista('temp-1', { content_text: 'primeira' }),
      otimista('temp-2', { content_text: 'segunda' }),
    ];
    const depois = comLinhaDoTempoReal(
      lista,
      minha('real-2', { content_text: 'segunda' }),
      EU
    );
    expect(ids(depois)).toEqual(['temp-1', 'real-2']);
  });

  it('assinatura diferente: cai na MAIS ANTIGA do mesmo tipo', () => {
    const lista = [
      otimista('temp-1', { content_text: '*Leo*:\noi' }),
      otimista('temp-2', { content_type: 'image', content_text: undefined }),
      otimista('temp-3', { content_text: '*Leo*:\ntudo bem?' }),
    ];
    const depois = comLinhaDoTempoReal(
      lista,
      minha('real-1', { content_text: '*Leonardo*:\noi' }),
      EU
    );
    expect(ids(depois)).toEqual(['temp-2', 'temp-3', 'real-1']);
  });

  it('mensagem de COLEGA não tira a minha, nem com o mesmo texto', () => {
    const lista = [otimista('temp-1', { content_text: 'oi' })];
    const depois = comLinhaDoTempoReal(
      lista,
      msg('real-colega', { sender_id: COLEGA, content_text: 'oi' }),
      EU
    );
    expect(ids(depois)).toEqual(['temp-1', 'real-colega']);
  });

  it('robô, eco do celular (sem `sender_id`) e sem login na tela não tiram nada', () => {
    const lista = [otimista('temp-1', { content_text: 'oi' })];
    expect(
      ids(
        comLinhaDoTempoReal(
          lista,
          msg('bot-1', {
            sender_type: 'bot',
            sender_id: EU,
            content_text: 'oi',
          }),
          EU
        )
      )
    ).toEqual(['temp-1', 'bot-1']);
    expect(
      ids(
        comLinhaDoTempoReal(
          lista,
          msg('eco-1', { from_device: true, content_text: 'oi' }),
          EU
        )
      )
    ).toEqual(['temp-1', 'eco-1']);
    expect(
      ids(
        comLinhaDoTempoReal(
          lista,
          minha('real-1', { content_text: 'oi' }),
          null
        )
      )
    ).toEqual(['temp-1', 'real-1']);
  });

  it('a que FALHOU nunca sai por INSERT, nem com o mesmo texto', () => {
    const lista = [
      otimista('temp-1', { status: 'failed', content_text: 'oi' }),
    ];
    const depois = comLinhaDoTempoReal(
      lista,
      minha('real-1', { content_text: 'oi' }),
      EU
    );
    expect(ids(depois)).toEqual(['temp-1', 'real-1']);
  });

  it('outro tipo ou outra conversa não é trocada', () => {
    const lista = [
      otimista('temp-img', { content_type: 'image', content_text: 'oi' }),
      otimista('temp-b', { conversation_id: 'conv-2', content_text: 'oi' }),
    ];
    const depois = comLinhaDoTempoReal(
      lista,
      minha('real-1', { content_text: 'oi' }),
      EU
    );
    expect(ids(depois)).toEqual(['temp-img', 'temp-b', 'real-1']);
  });

  it('a mesma linha duas vezes devolve a MESMA lista', () => {
    const lista = [minha('real-1')];
    expect(comLinhaDoTempoReal(lista, minha('real-1'), EU)).toBe(lista);
  });
});

describe('recargaComFalhadas', () => {
  it('mantém só as FALHADAS da conversa, depois do que veio do banco', () => {
    const naTela = [
      msg('real-1'),
      otimista('temp-falhou', { status: 'failed' }),
      otimista('temp-pendente'),
      otimista('temp-confirmada', { status: 'sent' }),
      otimista('temp-de-outra', {
        status: 'failed',
        conversation_id: 'conv-2',
      }),
    ];
    const carregadas = [msg('real-1'), msg('real-2')];
    expect(ids(recargaComFalhadas(carregadas, naTela, CONVERSA))).toEqual([
      'real-1',
      'real-2',
      'temp-falhou',
    ]);
  });

  it('sem falhada (ou sem conversa) devolve a própria lista carregada', () => {
    const carregadas = [msg('real-1')];
    expect(recargaComFalhadas(carregadas, [otimista('temp-1')], CONVERSA)).toBe(
      carregadas
    );
    expect(
      recargaComFalhadas(
        carregadas,
        [otimista('temp-1', { status: 'failed' })],
        null
      )
    ).toBe(carregadas);
  });

  it('a falhada sobrevive a uma recarga e depois a um INSERT do cliente', () => {
    let lista = [otimista('temp-1', { status: 'failed' })];
    lista = recargaComFalhadas([msg('real-1')], lista, CONVERSA);
    lista = comLinhaDoTempoReal(
      lista,
      msg('in-1', { sender_type: 'customer' }),
      EU
    );
    expect(ids(lista)).toEqual(['real-1', 'temp-1', 'in-1']);
  });
});

describe('comBolhaPublicada', () => {
  it('bolha nova entra no fim', () => {
    expect(ids(comBolhaPublicada([msg('real-1')], otimista('temp-1')))).toEqual(
      ['real-1', 'temp-1']
    );
  });

  it('o 409 republica a MESMA otimista como falhada: ela vira falhada no lugar', () => {
    const lista = [otimista('temp-1', { content_text: 'oi' }), msg('real-1')];
    const depois = comBolhaPublicada(
      lista,
      otimista('temp-1', { content_text: 'oi', status: 'failed' })
    );
    expect(ids(depois)).toEqual(['temp-1', 'real-1']);
    expect(depois[0].status).toBe('failed');
  });

  it('id repetido de outra forma é descartado (a mesma lista)', () => {
    const lista = [msg('real-1'), otimista('temp-1', { status: 'failed' })];
    expect(comBolhaPublicada(lista, msg('real-1', { status: 'failed' }))).toBe(
      lista
    );
    expect(
      comBolhaPublicada(lista, otimista('temp-1', { status: 'failed' }))
    ).toBe(lista);
    expect(comBolhaPublicada(lista, otimista('temp-1'))).toBe(lista);
  });

  it('o 409 e o reenvio: a falhada fica, o reenvio vira uma bolha só', () => {
    // Publica, o servidor responde 409 (o cliente trocou de número) e o
    // atendente reenvia o mesmo texto: o INSERT do reenvio leva a otimista
    // DELE, nunca a do 409.
    let lista = comBolhaPublicada(
      [],
      otimista('temp-1', { content_text: 'oi' })
    );
    lista = comBolhaPublicada(
      lista,
      otimista('temp-1', { content_text: 'oi', status: 'failed' })
    );
    lista = comBolhaPublicada(
      lista,
      otimista('temp-2', { content_text: 'oi' })
    );
    lista = comLinhaDoTempoReal(
      lista,
      minha('real-2', { content_text: 'oi' }),
      EU
    );
    expect(ids(lista)).toEqual(['temp-1', 'real-2']);
    expect(lista[0].status).toBe('failed');
  });
});
