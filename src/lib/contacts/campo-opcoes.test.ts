import { describe, expect, it } from 'vitest';

import { OPCAO_RESERVADA, opcoesDoCampo } from './campo-opcoes';
import type { CustomField } from '@/types';

function campo(field_options: unknown): CustomField {
  return {
    id: '1',
    user_id: 'u',
    account_id: 'a',
    field_name: 'Origem',
    field_type: 'select',
    field_key: 'origem',
    categoria: 'geral',
    created_at: '2026-01-01',
    field_options: field_options as CustomField['field_options'],
  };
}

describe('opcoesDoCampo', () => {
  it('lê a forma canônica { opcoes: [...] }', () => {
    expect(opcoesDoCampo(campo({ opcoes: ['CPF', 'CNPJ'] }))).toEqual([
      'CPF',
      'CNPJ',
    ]);
  });

  it('degrada para lista vazia em qualquer forma inesperada', () => {
    // A coluna existe desde a 001 sem validação — lixo não pode quebrar
    // nem a ficha nem a rota v1.
    expect(opcoesDoCampo(campo(null))).toEqual([]);
    expect(opcoesDoCampo(campo(undefined))).toEqual([]);
    expect(opcoesDoCampo(campo({ opcoes: 'CPF, CNPJ' }))).toEqual([]);
    expect(opcoesDoCampo(campo(['CPF', 'CNPJ']))).toEqual([]);
    expect(opcoesDoCampo(campo({ options: ['CPF'] }))).toEqual([]);
  });

  it('filtra entradas que não são texto útil', () => {
    expect(
      opcoesDoCampo(campo({ opcoes: ['CPF', '', '   ', 42, null, 'CNPJ'] }))
    ).toEqual(['CPF', 'CNPJ']);
  });

  it('filtra a opção reservada — é o sentinela do item "limpar" do Select', () => {
    // Escolhê-la seria traduzido para "limpar valor": uma opção que o
    // contato nunca consegue guardar. O editor recusa na gravação; aqui é
    // a segunda metade, para dado que já esteja no banco.
    expect(
      opcoesDoCampo(campo({ opcoes: ['CPF', OPCAO_RESERVADA, 'CNPJ'] }))
    ).toEqual(['CPF', 'CNPJ']);
  });
});
