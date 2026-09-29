import { Compartment } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { comoTexto, decidirSincronia, etiquetasDoEstado, montarEstado, type ResolverDeEtiqueta } from './editor-com-etiquetas';

// ============================================================
// ⚠️⚠️ O editor com etiquetas NUNCA muda o texto sozinho (decisão D3 do
// operador: não quebrar as automações ligadas). O documento É a string
// gravada — nenhuma conversão ida e volta que mexa em espaço, `\r`, quebra de
// linha ou `{{`. O valor que muda por fora entra por `setState` (fora dos
// ouvintes: não volta como `onChange`), e o render atrasado de algo que o
// próprio editor emitiu é ECO, nunca troca. A montagem com DOM foi conferida
// no preview; aqui ficam as peças puras.
// ============================================================

const resolver: ResolverDeEtiqueta = (codigo) => ({
  rotulo: codigo === 'contact.name' ? 'Nome do cliente' : null,
});
const opcoes = (linhaUnica = false) => ({ resolver, compartimento: new Compartment(), linhaUnica });

const TEXTO =
  'Olá, {{vars.cliente_primeiro_nome}}! \n\nPassando para lembrar que {{vars.vencimento_texto}}:\n{{vars.cobranca_detalhe}}\n';

describe('o documento do editor é o texto gravado', () => {
  it('nasce idêntico', () => {
    expect(montarEstado(TEXTO, opcoes()).doc.toString()).toBe(TEXTO);
  });

  it('`\\r` e `\\r\\n` ficam como estão, também depois de uma tecla em outro ponto', () => {
    const texto = 'linha 1\r\nlinha 2\rfim {{ contact.name }}  ';
    const state = montarEstado(texto, opcoes());
    expect(state.doc.toString()).toBe(texto);
    const depois = state.update({ changes: { from: 0, insert: 'x' } }).state;
    expect(depois.doc.toString()).toBe(`x${texto}`);
  });

  it('as etiquetas caem exatamente sobre os códigos que o motor substitui', () => {
    const texto = 'Oi {{contact.name}}, {{ now }} e {{contact.campo.<chave>}} e {{\ncontact.name\n}}';
    const etiquetas = etiquetasDoEstado(montarEstado(texto, opcoes()));
    expect(etiquetas.map(([de, ate, bruto]) => [texto.slice(de, ate), bruto])).toEqual([
      ['{{contact.name}}', '{{contact.name}}'],
      ['{{ now }}', '{{ now }}'],
      ['{{\ncontact.name\n}}', '{{\ncontact.name\n}}'],
    ]);
    expect(etiquetas[0][3]).toBe('Nome do cliente');
    expect(etiquetas[1][3]).toBeNull();
  });
});

describe('campo de uma linha', () => {
  it('recusa a quebra de linha digitada', () => {
    const state = montarEstado('Título {{contact.name}}', opcoes(true));
    const tr = state.update({ changes: { from: 6, insert: '\n' } });
    expect(tr.state.doc.toString()).toBe('Título {{contact.name}}');
  });

  it('valor antigo que já tem quebra continua editável', () => {
    const state = montarEstado('linha 1\nlinha 2', opcoes(true));
    const tr = state.update({ changes: { from: 0, insert: 'x' } });
    expect(tr.state.doc.toString()).toBe('xlinha 1\nlinha 2');
  });

  it('o valor de fora nasce como veio, com quebra e tudo', () => {
    expect(montarEstado('b\nc', opcoes(true)).doc.toString()).toBe('b\nc');
  });
});

describe('decidirSincronia — o valor que chega por props', () => {
  it('igual ao documento: nada, e o emitido fica reconhecido', () => {
    expect(decidirSincronia('ab', 'ab', ['a', 'ab'])).toEqual({ trocar: false, emitidos: [] });
  });

  it('render ATRASADO de algo que o editor emitiu é eco: não reverte a tecla nova', () => {
    expect(decidirSincronia('abc', 'ab', ['a', 'ab', 'abc'])).toEqual({ trocar: false, emitidos: ['abc'] });
  });

  it('valor que o editor nunca emitiu veio de fora e entra', () => {
    expect(decidirSincronia('abc', '', ['abc'])).toEqual({ trocar: true, emitidos: [] });
    expect(decidirSincronia('texto antigo', 'modelo novo', [])).toEqual({ trocar: true, emitidos: [] });
  });
});

describe('comoTexto — valor gravado que não é texto não derruba o construtor', () => {
  it('texto passa idêntico; número vira texto só para exibir; nulo vira vazio', () => {
    expect(comoTexto('  a\r\nb ')).toBe('  a\r\nb ');
    expect(comoTexto(5)).toBe('5');
    expect(comoTexto(null)).toBe('');
    expect(comoTexto(undefined)).toBe('');
  });
});
