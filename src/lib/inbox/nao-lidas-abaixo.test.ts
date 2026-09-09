import { describe, expect, it } from 'vitest';
import { contarNovasDoCliente } from './nao-lidas-abaixo';

const m = (id: string, sender_type: string) => ({ id, sender_type });

describe('contarNovasDoCliente', () => {
  const fio = [m('a', 'customer'), m('b', 'agent'), m('c', 'customer'), m('d', 'bot'), m('e', 'customer')];

  it('conta só o que o cliente mandou DEPOIS da âncora', () => {
    expect(contarNovasDoCliente(fio, 'b')).toBe(2); // c e e; d é robô
    expect(contarNovasDoCliente(fio, 'a')).toBe(2);
    expect(contarNovasDoCliente(fio, 'e')).toBe(0);
  });

  it('o que NÓS mandamos não conta: o operador sabe o que acabou de enviar', () => {
    expect(contarNovasDoCliente([m('a', 'customer'), m('b', 'agent'), m('c', 'agent')], 'a')).toBe(0);
  });

  it('sem âncora, ou âncora fora da lista, cala (0) em vez de contar tudo', () => {
    expect(contarNovasDoCliente(fio, null)).toBe(0);
    expect(contarNovasDoCliente(fio, 'zzz')).toBe(0);
    expect(contarNovasDoCliente([], 'a')).toBe(0);
  });
});
