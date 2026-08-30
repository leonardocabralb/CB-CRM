import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CURRENCY,
  formatCompactNumber,
  formatCurrency,
  formatCurrencyShort,
} from './currency';

/**
 * ⚠️ O separador entre `R$` e o número é NBSP (U+00A0), não espaço comum —
 * é o que o ICU produz em pt-BR. Escrito aqui como escape para o teste não
 * depender de um caractere invisível colado no arquivo.
 */
const NBSP = ' ';

describe('formatCurrency', () => {
  it('formata em real, com ponto de milhar e vírgula de centavos', () => {
    expect(formatCurrency(40000)).toBe(`R$${NBSP}40.000,00`);
    expect(formatCurrency(1234.5)).toBe(`R$${NBSP}1.234,50`);
    expect(formatCurrency(1234567.89)).toBe(`R$${NBSP}1.234.567,89`);
  });

  it('mostra os centavos mesmo em valor redondo', () => {
    // A vírgula é metade do pedido do operador — `R$ 40.000` seco não a tem.
    expect(formatCurrency(7)).toBe(`R$${NBSP}7,00`);
  });

  it('nunca quebra o render com valor ausente ou inválido', () => {
    // Um card do Kanban com `value` nulo não pode derrubar o quadro inteiro.
    expect(formatCurrency(0)).toBe(`R$${NBSP}0,00`);
    expect(formatCurrency(null)).toBe(`R$${NBSP}0,00`);
    expect(formatCurrency(undefined)).toBe(`R$${NBSP}0,00`);
    expect(formatCurrency(Number.NaN)).toBe(`R$${NBSP}0,00`);
  });

  it('grava real como moeda padrão de negócio novo', () => {
    expect(DEFAULT_CURRENCY).toBe('BRL');
  });
});

describe('formatCurrencyShort', () => {
  it('abrevia com os sufixos em português', () => {
    // "128.5k" no meio de uma tela em português seria localização pela
    // metade — os sufixos vêm do próprio ICU.
    // ⚠️ O espaço antes do sufixo TAMBÉM é NBSP — medido, não suposto.
    expect(formatCurrencyShort(128_500)).toBe(`R$${NBSP}128,5${NBSP}mil`);
    expect(formatCurrencyShort(2_500_000)).toBe(`R$${NBSP}2,5${NBSP}mi`);
    expect(formatCurrencyShort(900)).toBe(`R$${NBSP}900`);
  });

  it('também aguenta valor ausente', () => {
    expect(formatCurrencyShort(null)).toBe(`R$${NBSP}0`);
    expect(formatCurrencyShort(Number.NaN)).toBe(`R$${NBSP}0`);
  });
});

describe('formatCompactNumber', () => {
  it('continua em notação técnica — é contagem de token, não dinheiro', () => {
    // Fixado de propósito: o único consumidor é o painel de uso de IA, onde
    // "1.2k" aparece ao lado de nomes de modelo em inglês.
    expect(formatCompactNumber(1_234)).toBe('1.2k');
    expect(formatCompactNumber(1_200_000)).toBe('1.2M');
    expect(formatCompactNumber(900)).toBe('900');
  });
});
