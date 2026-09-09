import { describe, expect, it } from 'vitest';

import { casaComContato, filtrarContatos } from './filtrar-contatos';

const ana = { name: 'Ana Lúcia Corrêa', phone: '5527928340132' };
const jose = { name: 'José', phone: '551131784851' };
const semNome = { name: null, phone: '5511987654321' };

describe('casaComContato', () => {
  it('nome sem acento e sem caixa — "lucia" acha "Lúcia"', () => {
    expect(casaComContato(ana, 'lucia')).toBe(true);
    expect(casaComContato(ana, 'CORREA')).toBe(true);
    expect(casaComContato(jose, 'jose')).toBe(true);
  });

  it('telefone casa por DÍGITOS, ignorando máscara nas duas pontas', () => {
    expect(casaComContato(jose, '11 3178')).toBe(true);
    expect(casaComContato(jose, '(11) 3178-4851')).toBe(true);
    expect(casaComContato(ana, '2792834')).toBe(true);
    expect(casaComContato(semNome, '98765')).toBe(true);
  });

  it('termo SEM dígito nunca casa pelo telefone (armadilha da agulha vazia)', () => {
    // "ana" → soDigitos("") — sem a guarda, includes("") casaria todo mundo.
    expect(casaComContato(semNome, 'ana')).toBe(false);
    expect(casaComContato(jose, 'xyz')).toBe(false);
  });

  it('termo vazio ou só espaço devolve tudo — escopo vazio = todos', () => {
    expect(filtrarContatos([ana, jose, semNome], '')).toHaveLength(3);
    expect(filtrarContatos([ana, jose, semNome], '   ')).toHaveLength(3);
  });

  it('recorta a lista', () => {
    expect(filtrarContatos([ana, jose, semNome], '3178')).toEqual([jose]);
    expect(filtrarContatos([ana, jose, semNome], 'ana')).toEqual([ana]);
  });
});

describe('ficha só do Instagram (989)', () => {
  it('telefone nulo não estoura, e o @ conta como nome', async () => {
    const { casaComContato } = await import('./filtrar-contatos');
    const ig = { name: null, phone: null, instagram_username: 'cbadv.bancario' };
    expect(casaComContato(ig, 'bancario')).toBe(true);
    expect(casaComContato(ig, '@cbadv')).toBe(true);
    expect(casaComContato(ig, '9887')).toBe(false);
    expect(casaComContato({ name: 'Ana', phone: null }, '11')).toBe(false);
  });
});
