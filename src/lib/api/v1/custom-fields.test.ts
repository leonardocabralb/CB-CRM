import { describe, expect, it } from 'vitest';

import {
  prepararEscritaPorChave,
  serializeCustomFields,
} from './custom-fields';
import type { CustomField } from '@/types';

function campo(p: Partial<CustomField>): CustomField {
  return {
    id: 'id-1',
    user_id: 'u',
    account_id: 'a',
    field_name: 'Campo',
    field_type: 'text',
    field_key: 'campo',
    categoria: 'geral',
    created_at: '2026-01-01',
    ...p,
  };
}

describe('serializeCustomFields', () => {
  const fields = [
    campo({ id: '1', field_key: 'utm_source', field_name: 'utm_source', categoria: 'tracking' }),
    campo({
      id: '2',
      field_key: 'origem',
      field_name: 'Origem da dívida',
      field_type: 'select',
      field_options: { opcoes: ['CPF', 'CNPJ'] },
    }),
    campo({ id: '3', field_key: 'data_da_proposta', field_name: 'Data da Proposta' }),
  ];

  it('endereça pela CHAVE, com valor nulo quando o contato não tem', () => {
    const out = serializeCustomFields(fields, { '1': 'facebook' });
    expect(out.values).toEqual({
      utm_source: 'facebook',
      origem: null,
      data_da_proposta: null,
    });
    expect(out.fields[0]).toMatchObject({
      key: 'utm_source',
      category: 'tracking',
      value: 'facebook',
    });
  });

  it('options só aparece em campo select', () => {
    const out = serializeCustomFields(fields, {});
    expect(out.fields.find((f) => f.key === 'origem')?.options).toEqual(['CPF', 'CNPJ']);
    expect(out.fields.find((f) => f.key === 'utm_source')?.options).toBeUndefined();
  });
});

describe('prepararEscritaPorChave', () => {
  const fields = [
    { id: 'id-utm', field_key: 'utm_source' },
    { id: 'id-fb', field_key: 'fbclid' },
  ];

  it('traduz chave→id, apara string e coage número/booleano', () => {
    const r = prepararEscritaPorChave(fields, {
      utm_source: '  facebook  ',
      fbclid: 12345,
    });
    expect(r).toEqual({
      ok: true,
      porId: { 'id-utm': 'facebook', 'id-fb': '12345' },
    });
  });

  it('"" e null LIMPAM (viram \'\' — o upsert compartilhado deleta)', () => {
    const r = prepararEscritaPorChave(fields, { utm_source: '', fbclid: null });
    expect(r).toEqual({ ok: true, porId: { 'id-utm': '', 'id-fb': '' } });
  });

  it('chave desconhecida é ERRO com a lista — typo do n8n aparece na 1ª chamada', () => {
    const r = prepararEscritaPorChave(fields, { utm_sorce: 'x', fbclid: 'y' });
    expect(r).toEqual({ ok: false, desconhecidas: ['utm_sorce'], invalidas: [] });
  });

  it('objeto/array como valor é erro de tipo', () => {
    const r = prepararEscritaPorChave(fields, { utm_source: { a: 1 } });
    expect(r).toEqual({ ok: false, desconhecidas: [], invalidas: ['utm_source'] });
  });
});
