import { describe, expect, it } from 'vitest';

import { porCanal } from './queries';

// ------------------------------------------------------------
// O ESCOPO DE CANAL DO PAINEL.
//
// `porCanal` é uma linha, mas é a linha que separa "este número" de "o
// escritório inteiro" em nove consultas. Um `.eq` a menos e o painel passa a
// contar a conta toda sob um filtro de canal — o próprio arquivo chama isso
// de "a mentira mais cara que um painel pode contar".
//
// A blindagem aqui é a FORMA: que ele aplique `channel_id` e SÓ isso, e que
// devolva a consulta intacta quando não há filtro. Sem isto, "não filtrei"
// e "filtrei por undefined" são indistinguíveis no resultado.
// ------------------------------------------------------------

function queryFalsa() {
  const chamadas: { coluna: string; valor: string }[] = [];
  const q = {
    chamadas,
    eq(coluna: string, valor: string) {
      chamadas.push({ coluna, valor });
      return q;
    },
  };
  return q;
}

describe('porCanal', () => {
  it('sem filtro, devolve a consulta INTACTA', () => {
    // A mesma referência, não uma cópia: o chamador encadeia `.order()`,
    // `.limit()` etc. em cima do retorno.
    const q = queryFalsa();
    expect(porCanal(q, null)).toBe(q);
    expect(q.chamadas).toHaveLength(0);
  });

  it('string vazia conta como "sem filtro"', () => {
    // O estado do seletor é `string | null`; um '' vindo de um reset não
    // pode virar `channel_id = ''`, que não casaria com nada e zeraria os
    // cartões silenciosamente.
    const q = queryFalsa();
    expect(porCanal(q, '')).toBe(q);
    expect(q.chamadas).toHaveLength(0);
  });

  it('undefined conta como "sem filtro"', () => {
    const q = queryFalsa();
    porCanal(q, undefined);
    expect(q.chamadas).toHaveLength(0);
  });

  it('com filtro, aplica channel_id e nada além disso', () => {
    const q = queryFalsa();
    porCanal(q, 'canal-1');
    expect(q.chamadas).toEqual([{ coluna: 'channel_id', valor: 'canal-1' }]);
  });

  it('devolve a consulta encadeável depois de filtrar', () => {
    const q = queryFalsa();
    expect(porCanal(q, 'canal-1')).toBe(q);
  });
});
