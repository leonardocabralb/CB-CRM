import { describe, expect, it } from 'vitest';

import type { CustomField } from '@/types';

import { campoDoMotivo, camposDeMotivo, motivoDaEtapa, serveParaMotivo } from './motivo-da-etapa';

function campo(parcial: Partial<CustomField> & { id: string }): CustomField {
  return {
    user_id: 'u1',
    account_id: 'a1',
    field_name: `Campo ${parcial.id}`,
    field_type: 'select',
    field_key: `campo_${parcial.id}`,
    field_options: { opcoes: ['Desistiu', 'Outro'] },
    created_at: '2026-10-26T00:00:00Z',
    ...parcial,
  } as CustomField;
}

const lista = campo({ id: 'lista' });
const texto = campo({ id: 'texto', field_type: 'text', field_options: undefined });
const listaVazia = campo({ id: 'vazia', field_options: { opcoes: [] } });
const listaSoComReservada = campo({ id: 'reservada', field_options: { opcoes: ['__limpar__', '  '] } });

describe('serveParaMotivo', () => {
  it('só Lista com ao menos uma opção de verdade', () => {
    expect(serveParaMotivo(lista)).toBe(true);
    expect(serveParaMotivo(texto)).toBe(false);
    expect(serveParaMotivo(listaVazia)).toBe(false);
    expect(serveParaMotivo(listaSoComReservada)).toBe(false);
  });
});

describe('camposDeMotivo', () => {
  it('filtra o catálogo mantendo a ordem recebida', () => {
    const outra = campo({ id: 'outra' });
    expect(camposDeMotivo([texto, outra, listaVazia, lista]).map((c) => c.id)).toEqual(['outra', 'lista']);
  });
});

describe('motivoDaEtapa', () => {
  const catalogo = [lista, texto];

  it('coluna nula = a etapa não pergunta', () => {
    expect(motivoDaEtapa({ campo_do_motivo_id: null }, catalogo)).toEqual({ estado: 'nenhum' });
    expect(motivoDaEtapa({}, catalogo)).toEqual({ estado: 'nenhum' });
  });

  it('campo Lista com opções serve', () => {
    expect(motivoDaEtapa({ campo_do_motivo_id: 'lista' }, catalogo)).toEqual({ estado: 'ok', campo: lista });
    expect(campoDoMotivo({ campo_do_motivo_id: 'lista' }, catalogo)).toBe(lista);
  });

  it('campo que deixou de ser Lista NÃO serve, e não vira "não pergunta"', () => {
    expect(motivoDaEtapa({ campo_do_motivo_id: 'texto' }, catalogo)).toEqual({ estado: 'nao_serve', campo: texto });
    expect(campoDoMotivo({ campo_do_motivo_id: 'texto' }, catalogo)).toBeNull();
  });

  it('id fora do catálogo é "sumiu", nunca "nenhum" (catálogo velho ou que falhou)', () => {
    expect(motivoDaEtapa({ campo_do_motivo_id: 'x' }, catalogo)).toEqual({ estado: 'sumiu', campoId: 'x' });
    expect(motivoDaEtapa({ campo_do_motivo_id: 'x' }, [])).toEqual({ estado: 'sumiu', campoId: 'x' });
  });
});
