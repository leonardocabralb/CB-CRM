import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { codigosDoTexto, FONTE_DO_CODIGO, pedacosDoTexto, textoDoCodigo, trocarCodigos } from './codigos';

// ============================================================
// A etiqueta do editor aparece EXATAMENTE onde o motor substitui. Se as duas
// réguas divergirem, a tela mostra etiqueta sobre texto que sai cru para o
// cliente (ou o contrário) — por isso o pino lê o fonte do motor.
// ============================================================

describe('a régua dos códigos', () => {
  it('é a MESMA expressão do RE_VARIAVEL do motor', () => {
    const fonte = readFileSync(join(__dirname, '..', 'engine.ts'), 'utf8');
    const m = /const RE_VARIAVEL = \/(.+)\/g;/.exec(fonte);
    expect(m, 'RE_VARIAVEL sumiu do engine.ts: a régua do seletor precisa de dono').not.toBeNull();
    expect(new RegExp(m![1], 'g').source).toBe(new RegExp(FONTE_DO_CODIGO, 'g').source);
  });

  it('reparte o texto em pedaços e mantém o código como está escrito', () => {
    expect(pedacosDoTexto('Olá, {{ contact.name }}! Vence {{vars.vencimento_texto}}.')).toEqual([
      { tipo: 'texto', texto: 'Olá, ' },
      { tipo: 'codigo', bruto: '{{ contact.name }}', codigo: 'contact.name' },
      { tipo: 'texto', texto: '! Vence ' },
      { tipo: 'codigo', bruto: '{{vars.vencimento_texto}}', codigo: 'vars.vencimento_texto' },
      { tipo: 'texto', texto: '.' },
    ]);
  });

  it('o que o motor não substitui continua texto (a dica antiga com <chave>)', () => {
    expect(pedacosDoTexto('{{contact.campo.<chave_do_campo>}}')).toEqual([
      { tipo: 'texto', texto: '{{contact.campo.<chave_do_campo>}}' },
    ]);
    expect(pedacosDoTexto('{{}} e {{ }} e {contact.name}')).toEqual([
      { tipo: 'texto', texto: '{{}} e {{ }} e {contact.name}' },
    ]);
  });

  it('juntar os pedaços devolve o texto idêntico, byte a byte', () => {
    const textos = [
      '',
      'sem variável nenhuma',
      '{{now}}',
      'a\n\n{{contact.name}}\r\n  {{ deal.value }}  fim\n',
      '{{contact.name}}{{contact.name}}',
      '{{{contact.name}}}',
      '{{\ncontact.name\n}}',
      'emoji 😀 {{vars.cliente_primeiro_nome}} acentuação é à',
    ];
    for (const t of textos) {
      const junto = pedacosDoTexto(t)
        .map((p) => (p.tipo === 'texto' ? p.texto : p.bruto))
        .join('');
      expect(junto).toBe(t);
    }
  });

  it('troca cada código para LEITURA (o resumo do cartão), e o que não é código fica', () => {
    expect(
      trocarCodigos('Olá, {{ contact.name }}! {{contact.campo.<x>}} {{x.y}}', (codigo, bruto) =>
        codigo === 'contact.name' ? '[Nome]' : bruto,
      ),
    ).toBe('Olá, [Nome]! {{contact.campo.<x>}} {{x.y}}');
  });

  it('lista os códigos sem repetir, na ordem', () => {
    expect(codigosDoTexto('{{now}} {{contact.name}} {{ now }}')).toEqual(['now', 'contact.name']);
    expect(textoDoCodigo('contact.campo.link_reuniao')).toBe('{{contact.campo.link_reuniao}}');
  });
});
