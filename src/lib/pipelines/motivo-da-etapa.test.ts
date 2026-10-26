import { describe, expect, it } from 'vitest';

import type { CustomField } from '@/types';

import {
  campoDoMotivo,
  camposDeMotivo,
  ehOutro,
  escolhaInicial,
  etapasDePerda,
  motivoDaEtapa,
  opcoesDaJanela,
  serveParaMotivo,
  valorDaEscolha,
} from './motivo-da-etapa';

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

describe('etapasDePerda (o botão "Perdido")', () => {
  const etapa = (id: string, pipeline_id: string, position: number, resultado: string | null) => ({
    id,
    pipeline_id,
    position,
    resultado,
  });

  it('só as de resultado perdido DESTE funil, na ordem do funil', () => {
    const etapas = [
      etapa('perdido', 'f1', 11, 'perdido'),
      etapa('ganho', 'f1', 10, 'ganho'),
      etapa('desq', 'f1', 1, 'perdido'),
      etapa('neutra', 'f1', 2, null),
      etapa('outro-funil', 'f2', 0, 'perdido'),
    ];
    expect(etapasDePerda(etapas, 'f1').map((e) => e.id)).toEqual(['desq', 'perdido']);
  });

  it('funil sem etapa de perda devolve vazio (o botão segue como antes)', () => {
    expect(etapasDePerda([etapa('a', 'f1', 0, null)], 'f1')).toEqual([]);
  });
});

describe('a escolha da janela', () => {
  const motivo = campo({
    id: 'm',
    field_options: { opcoes: ['Desistiu', 'Fechou com outro escritório', 'Outro'] },
  });

  it('"Outro" é reconhecido pelo rótulo, sem caixa nem acento', () => {
    expect(ehOutro('Outro')).toBe(true);
    expect(ehOutro(' OUTRO ')).toBe(true);
    expect(ehOutro('Outros')).toBe(false);
    expect(opcoesDaJanela(motivo)).toEqual({
      fixas: ['Desistiu', 'Fechou com outro escritório'],
      outro: 'Outro',
    });
  });

  it('lista sem "Outro" não oferece texto livre', () => {
    expect(opcoesDaJanela(campo({ id: 'x', field_options: { opcoes: ['A', 'B'] } })).outro).toBeNull();
  });

  it('abre marcada com o que a ficha já tem', () => {
    expect(escolhaInicial(motivo, null)).toEqual({ tipo: 'nenhuma' });
    expect(escolhaInicial(motivo, '  ')).toEqual({ tipo: 'nenhuma' });
    expect(escolhaInicial(motivo, 'Desistiu')).toEqual({ tipo: 'fixa', opcao: 'Desistiu' });
    // Texto fora da lista (o "Outro" escrito antes) volta como "Outro".
    expect(escolhaInicial(motivo, 'Mudou de cidade')).toEqual({ tipo: 'outro', texto: 'Mudou de cidade' });
    // O "Outro" literal (a IA, uma automação) pede o texto.
    expect(escolhaInicial(motivo, 'Outro')).toEqual({ tipo: 'outro', texto: '' });
    // Sem "Outro" na lista, valor fora dela não marca nada.
    expect(escolhaInicial(campo({ id: 'y', field_options: { opcoes: ['A'] } }), 'Z')).toEqual({ tipo: 'nenhuma' });
  });

  it('o motivo é obrigatório: nada marcado ou "Outro" vazio não grava', () => {
    expect(valorDaEscolha({ tipo: 'nenhuma' })).toBeNull();
    expect(valorDaEscolha({ tipo: 'outro', texto: '   ' })).toBeNull();
    expect(valorDaEscolha({ tipo: 'outro', texto: ' Mudou de cidade ' })).toBe('Mudou de cidade');
    expect(valorDaEscolha({ tipo: 'fixa', opcao: 'Desistiu' })).toBe('Desistiu');
  });
});
