import { describe, expect, it } from 'vitest';

import { ordenarParaTela } from './display';
import { filtrarPorSituacao, situacaoDe } from './tela-global';
import type { ScheduledMessage, ScheduledMessageStatus } from '@/types';

function agendada(
  id: string,
  status: ScheduledMessageStatus,
  scheduled_for: string,
  extra: Partial<ScheduledMessage> = {},
): ScheduledMessage {
  return {
    id,
    account_id: 'conta',
    conversation_id: 'conversa',
    channel_id: 'canal',
    body: 'texto',
    scheduled_for,
    status,
    error: null,
    entrega_incerta: false,
    message_id: null,
    created_by: null,
    autor_nome: 'Fulano',
    created_at: '2026-08-01T10:00:00Z',
    sent_at: null,
    // Anexo e citação (932). Nulos aqui: estes testes são sobre ordem e
    // situação, que não mudam com o anexo.
    media_url: null,
    media_path: null,
    media_kind: null,
    media_filename: null,
    reply_to_message_id: null,
    citacao_perdida: false,
    ...extra,
  };
}

describe('situacaoDe', () => {
  it('`pending` e `sending` são a mesma coisa para quem olha: fila', () => {
    expect(situacaoDe(agendada('a', 'pending', '2026-08-10T10:00:00Z'))).toBe('fila');
    expect(situacaoDe(agendada('b', 'sending', '2026-08-10T10:00:00Z'))).toBe('fila');
  });

  it('`sent` é acervo, `failed` é problema', () => {
    expect(situacaoDe(agendada('c', 'sent', '2026-08-01T10:00:00Z'))).toBe('enviadas');
    expect(situacaoDe(agendada('d', 'failed', '2026-08-01T10:00:00Z'))).toBe('falhas');
  });

  it('⚠️ entrega incerta cai em FALHAS, não num grupo próprio', () => {
    // Ela é o caso que mais precisa de gente. Num quarto grupo, quem procura
    // "o que deu errado" não a encontraria.
    const incerta = agendada('e', 'failed', '2026-08-01T10:00:00Z', {
      entrega_incerta: true,
      error: 'tempo esgotado na Evolution',
    });
    expect(situacaoDe(incerta)).toBe('falhas');
  });
});

describe('filtrarPorSituacao', () => {
  const lista = [
    agendada('fila1', 'pending', '2026-08-10T10:00:00Z'),
    agendada('fila2', 'sending', '2026-08-09T10:00:00Z'),
    agendada('env1', 'sent', '2026-08-01T10:00:00Z'),
    agendada('falha1', 'failed', '2026-08-02T10:00:00Z'),
  ];

  it('`todas` não recorta nada', () => {
    expect(filtrarPorSituacao(lista, 'todas')).toHaveLength(4);
  });

  it('cada grupo devolve só o seu', () => {
    expect(filtrarPorSituacao(lista, 'fila').map((a) => a.id)).toEqual([
      'fila1',
      'fila2',
    ]);
    expect(filtrarPorSituacao(lista, 'enviadas').map((a) => a.id)).toEqual(['env1']);
    expect(filtrarPorSituacao(lista, 'falhas').map((a) => a.id)).toEqual(['falha1']);
  });

  it('não muta a lista de origem', () => {
    const copia = [...lista];
    filtrarPorSituacao(lista, 'fila');
    expect(lista).toEqual(copia);
  });

  it('lista vazia devolve vazio em qualquer grupo', () => {
    for (const s of ['todas', 'fila', 'enviadas', 'falhas'] as const) {
      expect(filtrarPorSituacao([], s)).toEqual([]);
    }
  });
});

describe('ordenarParaTela + filtrarPorSituacao juntos', () => {
  it('⚠️ a fila fica em cima e cresce para o futuro; o acervo desce do mais recente', () => {
    // É a razão de a tela global existir: "o que sai primeiro" e "o que saiu
    // por último" são perguntas diferentes, e uma ordem só responde mal a uma
    // delas.
    const ordenada = ordenarParaTela([
      agendada('enviada-velha', 'sent', '2026-07-01T10:00:00Z'),
      agendada('fila-longe', 'pending', '2026-09-01T10:00:00Z'),
      agendada('enviada-nova', 'sent', '2026-08-01T10:00:00Z'),
      agendada('fila-perto', 'pending', '2026-08-10T10:00:00Z'),
    ]);
    expect(ordenada.map((a) => a.id)).toEqual([
      'fila-perto',
      'fila-longe',
      'enviada-nova',
      'enviada-velha',
    ]);
  });

  it('⚠️ no acervo vale a hora em que SAIU, não a hora para que estava marcada', () => {
    // O caso que separa as duas: uma mensagem marcada para daqui a um mês e
    // ANTECIPADA hoje pelo "Executar agora". Ordenando pela marcação, ela iria
    // parar no topo do acervo com data futura, acima de coisas que saíram
    // depois dela — e a pergunta do acervo é "o que saiu por último".
    const ordenada = ordenarParaTela([
      agendada('antecipada', 'sent', '2026-09-30T10:00:00Z', {
        sent_at: '2026-08-01T09:00:00Z',
      }),
      agendada('saiu-ontem', 'sent', '2026-08-02T10:00:00Z', {
        sent_at: '2026-08-02T10:01:00Z',
      }),
    ]);
    expect(ordenada.map((a) => a.id)).toEqual(['saiu-ontem', 'antecipada']);
  });

  it('linha que FALHOU não tem `sent_at`, e cai de volta na hora marcada', () => {
    const ordenada = ordenarParaTela([
      agendada('falha-velha', 'failed', '2026-03-01T10:00:00Z'),
      agendada('falha-nova', 'failed', '2026-07-01T10:00:00Z'),
    ]);
    expect(ordenada.map((a) => a.id)).toEqual(['falha-nova', 'falha-velha']);
  });

  it('filtrar depois de ordenar preserva a ordem', () => {
    const ordenada = ordenarParaTela([
      agendada('b', 'pending', '2026-09-01T10:00:00Z'),
      agendada('a', 'pending', '2026-08-10T10:00:00Z'),
    ]);
    expect(filtrarPorSituacao(ordenada, 'fila').map((a) => a.id)).toEqual(['a', 'b']);
  });
});
