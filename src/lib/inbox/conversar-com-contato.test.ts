import { describe, expect, it } from 'vitest';

import { EVENTO_CONVERSAR_COM_CONTATO, lerPedidoDeConversa } from './conversar-com-contato';

function evento(detail: unknown): Event {
  return new CustomEvent(EVENTO_CONVERSAR_COM_CONTATO, { detail });
}

describe('lerPedidoDeConversa', () => {
  it('lê telefone e nome', () => {
    expect(lerPedidoDeConversa(evento({ telefone: ' +5585900000013 ', nome: 'Assessoria' }))).toEqual({
      telefone: '+5585900000013',
      nome: 'Assessoria',
    });
    expect(lerPedidoDeConversa(evento({ telefone: '+5585900000013', nome: '  ' }))).toEqual({
      telefone: '+5585900000013',
      nome: null,
    });
  });

  it('pedido sem telefone, ou de outra forma, é ignorado', () => {
    expect(lerPedidoDeConversa(evento({ nome: 'x' }))).toBeNull();
    expect(lerPedidoDeConversa(evento('x'))).toBeNull();
    expect(lerPedidoDeConversa(new Event(EVENTO_CONVERSAR_COM_CONTATO))).toBeNull();
  });
});
