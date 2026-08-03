import { describe, expect, it } from 'vitest';

import { ordenarParaTela } from './display';
import {
  contarPorSituacao,
  filtrarPorSituacao,
  situacaoDe,
  temMais,
  PAGINA,
} from './tela-global';
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

describe('contarPorSituacao', () => {
  it('conta cada grupo, e `todas` é o total', () => {
    const c = contarPorSituacao([
      agendada('a', 'pending', '2026-08-10T10:00:00Z'),
      agendada('b', 'sending', '2026-08-09T10:00:00Z'),
      agendada('c', 'sent', '2026-08-01T10:00:00Z'),
      agendada('d', 'failed', '2026-08-02T10:00:00Z'),
      agendada('e', 'failed', '2026-08-03T10:00:00Z', { entrega_incerta: true }),
    ]);
    expect(c).toEqual({ todas: 5, fila: 2, enviadas: 1, falhas: 2 });
  });

  it('lista vazia zera tudo em vez de faltar chave', () => {
    // A tela lê `contagem[situacao]` direto para desenhar a aba; chave
    // faltando viraria `undefined` no rótulo.
    expect(contarPorSituacao([])).toEqual({
      todas: 0,
      fila: 0,
      enviadas: 0,
      falhas: 0,
    });
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

  it('filtrar depois de ordenar preserva a ordem', () => {
    const ordenada = ordenarParaTela([
      agendada('b', 'pending', '2026-09-01T10:00:00Z'),
      agendada('a', 'pending', '2026-08-10T10:00:00Z'),
    ]);
    expect(filtrarPorSituacao(ordenada, 'fila').map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('temMais', () => {
  it('só avisa quando a busca encheu o teto', () => {
    expect(temMais(PAGINA, PAGINA)).toBe(true);
    expect(temMais(PAGINA - 1, PAGINA)).toBe(false);
    expect(temMais(0, PAGINA)).toBe(false);
  });

  it('⚠️ voltar EXATAMENTE o teto conta como "pode haver mais"', () => {
    // Com 50 linhas e teto 50 não dá para saber se a 51ª existe. Dizer "é só
    // isso" seria afirmar o que não se sabe; oferecer "carregar mais" custa um
    // clique que devolve zero.
    expect(temMais(50, 50)).toBe(true);
  });
});
