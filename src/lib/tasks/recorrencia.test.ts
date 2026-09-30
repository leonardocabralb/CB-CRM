import { describe, expect, it } from 'vitest';

import { ehAtivaDaSerie } from './recorrencia';

describe('ehAtivaDaSerie', () => {
  it('repete e ainda não gerou a próxima: é a ativa', () => {
    expect(ehAtivaDaSerie({ repetir_a_cada_dias: 7, proxima_gerada_em: null })).toBe(true);
  });

  it('já gerou a próxima: é uma anterior da série', () => {
    expect(
      ehAtivaDaSerie({ repetir_a_cada_dias: 7, proxima_gerada_em: '2026-03-09T03:00:00Z' }),
    ).toBe(false);
  });

  it('não repete: não é ativa de nada', () => {
    expect(ehAtivaDaSerie({ repetir_a_cada_dias: null, proxima_gerada_em: null })).toBe(false);
  });

  it('linha lida sem as colunas da 1074 (undefined) não passa por ativa', () => {
    expect(ehAtivaDaSerie({} as Parameters<typeof ehAtivaDaSerie>[0])).toBe(false);
  });
});
