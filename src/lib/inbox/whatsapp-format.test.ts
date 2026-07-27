import { describe, expect, it } from 'vitest';

import {
  alternarMarcador,
  parseWhatsAppFormat,
  stripWhatsAppFormat,
  type NoFormatado,
} from './whatsapp-format';

/** Achata a árvore numa notação curta, para o teste ficar legível. */
function resumo(nos: NoFormatado[]): string {
  return nos
    .map((no) => {
      if (no.tipo === 'texto') return no.texto;
      if (no.tipo === 'mono') return `mono(${no.texto})`;
      return `${no.tipo}(${resumo(no.filhos)})`;
    })
    .join('');
}

describe('parseWhatsAppFormat', () => {
  it('texto sem marcador vira um nó só', () => {
    expect(parseWhatsAppFormat('Bom dia')).toEqual([{ tipo: 'texto', texto: 'Bom dia' }]);
  });

  it('nulo e vazio devolvem lista vazia', () => {
    expect(parseWhatsAppFormat(null)).toEqual([]);
    expect(parseWhatsAppFormat('')).toEqual([]);
  });

  it('reconhece os quatro estilos', () => {
    expect(resumo(parseWhatsAppFormat('*n*'))).toBe('negrito(n)');
    expect(resumo(parseWhatsAppFormat('_i_'))).toBe('italico(i)');
    expect(resumo(parseWhatsAppFormat('~r~'))).toBe('riscado(r)');
    expect(resumo(parseWhatsAppFormat('`m`'))).toBe('mono(m)');
  });

  it('a mensagem real que motivou isto', () => {
    // Da captura do operador: o horário aparecia com os asteriscos crus.
    const texto =
      'Sua videoconferência está agendada para *15:00* do dia 27/07/2026.';
    expect(resumo(parseWhatsAppFormat(texto))).toBe(
      'Sua videoconferência está agendada para negrito(15:00) do dia 27/07/2026.',
    );
  });

  it('aninha negrito com itálico', () => {
    expect(resumo(parseWhatsAppFormat('*_os dois_*'))).toBe('negrito(italico(os dois))');
  });

  // A REGRA que evita o pior modo de falha: um asterisco solto não pode
  // formatar o resto da mensagem inteira.
  it('marcador sem par fica literal', () => {
    expect(resumo(parseWhatsAppFormat('2 * 3 = 6'))).toBe('2 * 3 = 6');
    expect(resumo(parseWhatsAppFormat('*sozinho'))).toBe('*sozinho');
    expect(resumo(parseWhatsAppFormat('fim*'))).toBe('fim*');
  });

  it('marcador colado a espaço não formata', () => {
    expect(resumo(parseWhatsAppFormat('* nao *'))).toBe('* nao *');
    expect(resumo(parseWhatsAppFormat('a_b_c'))).toBe('a' + 'italico(b)' + 'c');
  });

  it('bloco e monoespaçado são literais por dentro', () => {
    // Sem isto, um trecho de código com underline viraria itálico.
    expect(resumo(parseWhatsAppFormat('`a_b_c`'))).toBe('mono(a_b_c)');
    expect(resumo(parseWhatsAppFormat('```*nao*```'))).toBe('mono(*nao*)');
  });

  it('bloco preserva quebra de linha', () => {
    expect(resumo(parseWhatsAppFormat('```linha1\nlinha2```'))).toBe('mono(linha1\nlinha2)');
  });

  it('crase sem par fica literal', () => {
    expect(resumo(parseWhatsAppFormat('preço R$ 5 ` unidade'))).toBe('preço R$ 5 ` unidade');
  });

  it('nenhum caractere se perde', () => {
    const entradas = [
      '*a* _b_ ~c~ `d`',
      'sem formatação nenhuma',
      '*',
      '**',
      '___',
      'misto *a* e _b_ e texto solto',
      '*Novo Agendamento:*\n*Tipo*: Reunião\n*Nome*: Joao',
    ];
    for (const e of entradas) {
      const plano = stripWhatsAppFormat(e);
      // O texto plano é o original menos os marcadores CASADOS — nunca pode
      // ficar maior, e nunca pode perder conteúdo que não seja marcador.
      expect(plano.length).toBeLessThanOrEqual(e.length);
      expect(e.replace(/[*_~`]/g, '')).toBe(plano.replace(/[*_~`]/g, ''));
    }
  });

  it('várias marcações na mesma mensagem', () => {
    expect(resumo(parseWhatsAppFormat('*Tipo*: Reunião com _Advogado_'))).toBe(
      'negrito(Tipo): Reunião com italico(Advogado)',
    );
  });
});

describe('stripWhatsAppFormat', () => {
  it('tira os marcadores para o preview da lista', () => {
    expect(stripWhatsAppFormat('*Novo Agendamento:* às *15:00*')).toBe(
      'Novo Agendamento: às 15:00',
    );
  });

  it('deixa o marcador solto em paz', () => {
    expect(stripWhatsAppFormat('2 * 3')).toBe('2 * 3');
  });
});

describe('alternarMarcador', () => {
  it('envolve a seleção e mantém o trecho selecionado', () => {
    const r = alternarMarcador('bom dia', 0, 3, 'negrito');
    expect(r.texto).toBe('*bom* dia');
    expect(r.texto.slice(r.inicio, r.fim)).toBe('bom');
  });

  it('sem seleção, insere o par e põe o cursor no meio', () => {
    const r = alternarMarcador('oi ', 3, 3, 'italico');
    expect(r.texto).toBe('oi __');
    expect(r.inicio).toBe(4);
    expect(r.fim).toBe(4);
  });

  it('clicar de novo desfaz, com os marcadores dentro da seleção', () => {
    const r = alternarMarcador('*bom* dia', 0, 5, 'negrito');
    expect(r.texto).toBe('bom dia');
    expect(r.texto.slice(r.inicio, r.fim)).toBe('bom');
  });

  it('desfaz também quando só o miolo está selecionado', () => {
    // O operador seleciona a palavra, não os asteriscos — é o caso comum.
    const r = alternarMarcador('*bom* dia', 1, 4, 'negrito');
    expect(r.texto).toBe('bom dia');
    expect(r.texto.slice(r.inicio, r.fim)).toBe('bom');
  });

  it('ida e volta devolve o texto original', () => {
    const original = 'reunião amanhã';
    const ida = alternarMarcador(original, 0, 7, 'riscado');
    const volta = alternarMarcador(ida.texto, ida.inicio, ida.fim, 'riscado');
    expect(volta.texto).toBe(original);
  });
});
