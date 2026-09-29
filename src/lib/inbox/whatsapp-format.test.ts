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
      if (no.tipo === 'link') return `link(${no.texto})`;
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
  });

  // A REGRA MAIS CARA DO ARQUIVO: marcador no MEIO DE PALAVRA não formata.
  //
  // Sem ela o interpretador comia caracteres da mensagem do cliente e a tela
  // mostrava um valor diferente do que foi enviado — perda de dado silenciosa,
  // porque o original só existe no WhatsApp. Cada caso abaixo é um formato
  // real que aparece em conversa de escritório.
  it('não formata marcador no meio de palavra (não come caractere)', () => {
    expect(resumo(parseWhatsAppFormat('a_b_c'))).toBe('a_b_c');
    expect(resumo(parseWhatsAppFormat('R$ 1.500_00 por parcela'))).toBe(
      'R$ 1.500_00 por parcela',
    );
    expect(resumo(parseWhatsAppFormat('processo 0001234_56.2026'))).toBe(
      'processo 0001234_56.2026',
    );
    expect(resumo(parseWhatsAppFormat('arquivo_final_v2.pdf'))).toBe('arquivo_final_v2.pdf');
    expect(resumo(parseWhatsAppFormat('2*3*4'))).toBe('2*3*4');
    expect(resumo(parseWhatsAppFormat('a~b~c'))).toBe('a~b~c');
  });

  it('mas formata quando o marcador está na fronteira', () => {
    expect(resumo(parseWhatsAppFormat('valor *R$ 1.500* hoje'))).toBe(
      'valor negrito(R$ 1.500) hoje',
    );
    // Depois de pontuação também abre — é o caso de "(*urgente*)".
    expect(resumo(parseWhatsAppFormat('(*urgente*)'))).toBe('(negrito(urgente))');
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

describe('parseWhatsAppFormat — endereços viram link', () => {
  it('o link sai inteiro, com o texto em volta', () => {
    expect(resumo(parseWhatsAppFormat('Docs: https://x.com/a?b=1. Obrigado'))).toBe(
      'Docs: link(https://x.com/a?b=1). Obrigado',
    );
    expect(parseWhatsAppFormat('www.x.com.br')).toEqual([
      { tipo: 'link', texto: 'www.x.com.br', href: 'https://www.x.com.br' },
    ]);
  });

  it('⚠️ `_` e `~` de dentro da URL não viram itálico nem riscado', () => {
    // Sem a detecção antes, `/_a_/` virava itálico e partia o link em três.
    expect(resumo(parseWhatsAppFormat('https://x.com/_a_/b'))).toBe(
      'link(https://x.com/_a_/b)',
    );
    expect(resumo(parseWhatsAppFormat('https://x.com/~joao~/c'))).toBe(
      'link(https://x.com/~joao~/c)',
    );
  });

  it('link com a forma do SharePoint do print do operador fica um link só', () => {
    const url =
      'https://exemplo-my.sharepoint.com/:f:/g/personal/financeiro_exemplo_com_br/ZxC1vBn2_MaS3-dFg4HjK5lQw6?e=Ef3Gh4';
    expect(parseWhatsAppFormat(url)).toEqual([{ tipo: 'link', texto: url, href: url }]);
  });

  it('formatação EM VOLTA do link continua valendo', () => {
    expect(resumo(parseWhatsAppFormat('*https://x.com*'))).toBe('negrito(link(https://x.com))');
    expect(resumo(parseWhatsAppFormat('_veja www.x.com_ agora'))).toBe(
      'italico(veja link(www.x.com)) agora',
    );
    expect(resumo(parseWhatsAppFormat('*Link:* https://x.com/a_b'))).toBe(
      'negrito(Link:) link(https://x.com/a_b)',
    );
  });

  it('⚠️ `_` no fim do endereço, sem itálico aberto antes, fica NO link (Codex, PR #347)', () => {
    expect(parseWhatsAppFormat('Pasta: https://host/documento_')).toEqual([
      { tipo: 'texto', texto: 'Pasta: ' },
      { tipo: 'link', texto: 'https://host/documento_', href: 'https://host/documento_' },
    ]);
  });

  it('⚠️ itálico que já fechou antes não come o `_` do endereço (Codex, PR #347, 2ª rodada)', () => {
    expect(resumo(parseWhatsAppFormat('_ênfase_ https://host/documento_'))).toBe(
      'italico(ênfase) link(https://host/documento_)',
    );
  });

  it('dentro de monoespaçado o endereço fica literal', () => {
    expect(resumo(parseWhatsAppFormat('`https://x.com`'))).toBe('mono(https://x.com)');
    expect(resumo(parseWhatsAppFormat('```\nhttps://x.com\n``` e https://y.com'))).toBe(
      'mono(\nhttps://x.com\n) e link(https://y.com)',
    );
  });
});

describe('stripWhatsAppFormat', () => {
  it('tira os marcadores para o preview da lista', () => {
    expect(stripWhatsAppFormat('*Novo Agendamento:* às *15:00*')).toBe(
      'Novo Agendamento: às 15:00',
    );
  });

  it('o link volta como texto', () => {
    expect(stripWhatsAppFormat('Veja *https://x.com/a_b*')).toBe('Veja https://x.com/a_b');
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

  // Selecionar tudo e clicar em negrito é o caminho mais natural do mundo,
  // e era exatamente o que corrompia: primeiro e último caractere eram
  // marcadores, mas de PARES DIFERENTES.
  it('selecionar tudo com formatação mista não destrói o que já existe', () => {
    const texto = '*a* e *b*';
    const r = alternarMarcador(texto, 0, texto.length, 'negrito');
    // Tem de ENVOLVER, não desmontar os pares existentes.
    expect(r.texto).toBe('**a* e *b**');
    expect(r.texto).not.toBe('a* e *b');
  });

  it('desfaz apenas quando a seleção inteira é um único trecho do estilo', () => {
    expect(alternarMarcador('*abc*', 0, 5, 'negrito').texto).toBe('abc');
    // Estilo diferente do selecionado → envolve, não desfaz.
    expect(alternarMarcador('*abc*', 0, 5, 'italico').texto).toBe('_*abc*_');
  });

  it('ida e volta devolve o texto original', () => {
    const original = 'reunião amanhã';
    const ida = alternarMarcador(original, 0, 7, 'riscado');
    const volta = alternarMarcador(ida.texto, ida.inicio, ida.fim, 'riscado');
    expect(volta.texto).toBe(original);
  });
});
