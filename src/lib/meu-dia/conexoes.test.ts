import { describe, expect, it } from 'vitest';

import { contarPorConexao, type ConversaDaConexao } from './conexoes';

const AGORA = Date.parse('2026-09-29T15:00:00Z');
const haMin = (min: number) => new Date(AGORA - min * 60_000).toISOString();

const A = 'canal-a';
const B = 'canal-b';

let seq = 0;
function conversa(extra: Partial<ConversaDaConexao>): ConversaDaConexao {
  seq++;
  return {
    id: `c${seq}`,
    channel_id: A,
    status: 'open',
    group_id: null,
    unread_count: 0,
    aguardando_desde: null,
    ...extra,
  };
}

describe('contarPorConexao', () => {
  it('toda conexão pedida aparece, inclusive a zerada', () => {
    const { porConexao } = contarPorConexao([], [A, B], AGORA);
    expect(porConexao.get(A)).toEqual({ naoLidos: 0, emAtraso: 0, criticos: 0 });
    expect(porConexao.get(B)).toEqual({ naoLidos: 0, emAtraso: 0, criticos: 0 });
  });

  it('não lido é unread_count > 0; atraso segue a régua do selo (10 e 30 min)', () => {
    const { porConexao } = contarPorConexao(
      [
        conversa({ unread_count: 3 }),
        conversa({ unread_count: 0, aguardando_desde: haMin(9) }), // ainda não é atraso
        conversa({ unread_count: 1, aguardando_desde: haMin(12) }), // âmbar
        conversa({ unread_count: 0, aguardando_desde: haMin(45) }), // vermelho
        conversa({ channel_id: B, unread_count: 2, aguardando_desde: haMin(200) }),
      ],
      [A, B],
      AGORA,
    );
    expect(porConexao.get(A)).toEqual({ naoLidos: 2, emAtraso: 2, criticos: 1 });
    expect(porConexao.get(B)).toEqual({ naoLidos: 1, emAtraso: 1, criticos: 1 });
  });

  it('encerrada e grupo ficam de fora', () => {
    const { porConexao, semConexao } = contarPorConexao(
      [
        conversa({ status: 'closed', unread_count: 5, aguardando_desde: haMin(60) }),
        conversa({ channel_id: null, group_id: 'g1', unread_count: 4 }),
      ],
      [A],
      AGORA,
    );
    expect(porConexao.get(A)).toEqual({ naoLidos: 0, emAtraso: 0, criticos: 0 });
    expect(semConexao).toEqual({ naoLidos: 0, emAtraso: 0, criticos: 0 });
  });

  it('pendente conta — "ativas" é aberta E pendente', () => {
    const { porConexao } = contarPorConexao(
      [conversa({ status: 'pending', unread_count: 1 })],
      [A],
      AGORA,
    );
    expect(porConexao.get(A)?.naoLidos).toBe(1);
  });

  it('conversa sem conexão vai para a conta própria; de conexão fora do perfil, para lugar nenhum', () => {
    const { porConexao, semConexao } = contarPorConexao(
      [
        conversa({ channel_id: null, unread_count: 1, aguardando_desde: haMin(15) }),
        conversa({ channel_id: 'canal-de-outra-area', unread_count: 7 }),
      ],
      [A],
      AGORA,
    );
    expect(semConexao).toEqual({ naoLidos: 1, emAtraso: 1, criticos: 0 });
    expect(porConexao.get(A)).toEqual({ naoLidos: 0, emAtraso: 0, criticos: 0 });
    expect(porConexao.has('canal-de-outra-area')).toBe(false);
  });
});
