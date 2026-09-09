import { describe, expect, it } from 'vitest';
import { contarNovasDoCliente } from './nao-lidas-abaixo';

const m = (id: string, sender_type: string, created_at: string, content_type = 'text') => ({
  id,
  sender_type,
  content_type,
  created_at,
});
const T = (s: number) => `2026-09-09T20:00:${String(s).padStart(2, '0')}.000Z`;

describe('contarNovasDoCliente', () => {
  const fio = [
    m('a', 'customer', T(1)),
    m('b', 'agent', T(2)),
    m('c', 'customer', T(3)),
    m('d', 'bot', T(4)),
    m('e', 'customer', T(5)),
  ];

  it('conta só o que o cliente mandou DEPOIS da âncora', () => {
    expect(contarNovasDoCliente(fio, { id: 'b', createdAt: T(2) })).toBe(2); // c e e; d é robô
    expect(contarNovasDoCliente(fio, { id: 'a', createdAt: T(1) })).toBe(2);
    expect(contarNovasDoCliente(fio, { id: 'e', createdAt: T(5) })).toBe(0);
  });

  it('o que NÓS mandamos não conta: o operador sabe o que acabou de enviar', () => {
    expect(
      contarNovasDoCliente(
        [m('a', 'customer', T(1)), m('b', 'agent', T(2)), m('c', 'agent', T(3))],
        { id: 'a', createdAt: T(1) },
      ),
    ).toBe(0);
  });

  it('⚠️ aviso de sistema do grupo ("Fulano entrou") vem como customer + system e NÃO conta', () => {
    const grupo = [m('a', 'customer', T(1)), m('s', 'customer', T(2), 'system'), m('c', 'customer', T(3))];
    expect(contarNovasDoCliente(grupo, { id: 'a', createdAt: T(1) })).toBe(1);
    expect(contarNovasDoCliente(grupo, { id: 'zzz', createdAt: T(1) })).toBe(1);
  });

  it('⚠️ âncora que virou órfã (a otimista trocada pela linha gravada) cai para o tempo', () => {
    // O operador enviou (temp-1), o fio rolou ao fim, a âncora ficou temp-1;
    // o realtime trocou temp-1 por "g" com outro id; depois o cliente escreveu.
    const depois = [m('a', 'customer', T(1)), m('g', 'agent', T(2)), m('c', 'customer', T(3)), m('e', 'customer', T(4))];
    expect(contarNovasDoCliente(depois, { id: 'temp-1', createdAt: T(2) })).toBe(2);
    // Sem nada depois do corte, cala.
    expect(contarNovasDoCliente(depois, { id: 'temp-1', createdAt: T(4) })).toBe(0);
  });

  it('sem âncora nenhuma, cala (0) em vez de contar tudo', () => {
    expect(contarNovasDoCliente(fio, { id: null, createdAt: null })).toBe(0);
    expect(contarNovasDoCliente([], { id: 'a', createdAt: T(1) })).toBe(0);
  });
});
