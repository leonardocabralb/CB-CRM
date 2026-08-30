import { describe, expect, it } from 'vitest';

import {
  categoriasDe,
  filtrarAcervo,
  tamanhoLegivel,
  type ItemFiltravel,
} from './filtro';
import {
  ACCEPT_DO_SELETOR,
  caminhoEhDoAcervo,
  MIMES_POR_TIPO,
  prefixoDoAcervo,
  tipoPeloMime,
} from './tipos';

const CONTA = '11111111-1111-1111-1111-111111111111';

function item(over: Partial<ItemFiltravel> = {}): ItemFiltravel {
  return {
    titulo: 'Contrato de honorários',
    categoria: 'Contratos',
    filename: 'contrato-padrao.pdf',
    tipo: 'document',
    ...over,
  };
}

describe('tipoPeloMime', () => {
  it('classifica os quatro tipos', () => {
    expect(tipoPeloMime('image/png')).toBe('image');
    expect(tipoPeloMime('video/mp4')).toBe('video');
    expect(tipoPeloMime('application/pdf')).toBe('document');
    expect(tipoPeloMime('audio/ogg')).toBe('audio');
  });

  it('ignora os parâmetros do mime', () => {
    // O navegador manda isto para .txt — a comparação crua rejeitaria um
    // arquivo que o bucket aceita.
    expect(tipoPeloMime('text/plain; charset=utf-8')).toBe('document');
  });

  it('ignora a caixa', () => {
    expect(tipoPeloMime('IMAGE/JPEG')).toBe('image');
  });

  it('recusa o que o bucket não aceita', () => {
    // WebM é o que o navegador grava por padrão, e o bucket da 023 não o
    // aceita na saída — recusar aqui é o ponto.
    expect(tipoPeloMime('audio/webm')).toBeNull();
    expect(tipoPeloMime('image/gif')).toBeNull();
    expect(tipoPeloMime('application/zip')).toBeNull();
    expect(tipoPeloMime('')).toBeNull();
    expect(tipoPeloMime(null)).toBeNull();
    expect(tipoPeloMime(undefined)).toBeNull();
  });

  it('todo mime da lista se classifica de volta no próprio tipo', () => {
    for (const [tipo, mimes] of Object.entries(MIMES_POR_TIPO)) {
      for (const mime of mimes) expect(tipoPeloMime(mime)).toBe(tipo);
    }
  });

  it('o accept do seletor lista todos os mimes aceitos', () => {
    const partes = ACCEPT_DO_SELETOR.split(',');
    expect(partes).toContain('application/pdf');
    expect(partes).toContain('audio/ogg');
    expect(new Set(partes).size).toBe(partes.length); // sem repetidos
  });
});

describe('caminhoEhDoAcervo', () => {
  it('aceita o caminho da própria conta, na subpasta', () => {
    expect(caminhoEhDoAcervo(`${prefixoDoAcervo(CONTA)}123-contrato.pdf`, CONTA)).toBe(true);
  });

  it('recusa anexo de mensagem da própria conta', () => {
    // É a guarda que impede a linha do acervo apontar para um objeto que o
    // compositor apaga quando o envio falha.
    expect(caminhoEhDoAcervo(`account-${CONTA}/123-foto.png`, CONTA)).toBe(false);
  });

  it('recusa caminho de outra conta', () => {
    const outra = '22222222-2222-2222-2222-222222222222';
    expect(caminhoEhDoAcervo(`${prefixoDoAcervo(outra)}x.pdf`, CONTA)).toBe(false);
  });

  it('recusa caminho que só CONTÉM o prefixo', () => {
    expect(caminhoEhDoAcervo(`outra/${prefixoDoAcervo(CONTA)}x.pdf`, CONTA)).toBe(false);
  });
});

describe('categoriasDe', () => {
  it('devolve as categorias em uso, em ordem', () => {
    const itens = [
      item({ categoria: 'Institucional' }),
      item({ categoria: 'Contratos' }),
      item({ categoria: 'Áudios' }),
    ];
    expect(categoriasDe(itens)).toEqual(['Áudios', 'Contratos', 'Institucional']);
  });

  it('não repete e mantém o primeiro rótulo quando só muda a caixa', () => {
    const itens = [item({ categoria: 'Contratos' }), item({ categoria: 'contratos' })];
    expect(categoriasDe(itens)).toEqual(['Contratos']);
  });

  it('ignora item sem categoria', () => {
    expect(categoriasDe([item({ categoria: null }), item({ categoria: '  ' })])).toEqual([]);
  });
});

describe('filtrarAcervo', () => {
  const acervo = [
    item({ titulo: 'Contrato de honorários', categoria: 'Contratos', filename: 'contrato.pdf' }),
    item({ titulo: 'Apresentação do escritório', categoria: 'Institucional', filename: 'deck.pdf' }),
    item({
      titulo: 'Áudio de abertura',
      categoria: 'Áudios',
      filename: 'abertura.ogg',
      tipo: 'audio',
    }),
    item({ titulo: 'Logo', categoria: null, filename: 'logo.png', tipo: 'image' }),
  ];

  it('filtro vazio devolve tudo — a convenção do projeto', () => {
    expect(filtrarAcervo(acervo)).toHaveLength(4);
    expect(filtrarAcervo(acervo, { termo: '  ' })).toHaveLength(4);
  });

  it('acha ignorando acento e caixa', () => {
    expect(filtrarAcervo(acervo, { termo: 'HONORARIOS' })).toHaveLength(1);
    expect(filtrarAcervo(acervo, { termo: 'audio de abertura' })).toHaveLength(1);
  });

  it('acha pelo NOME DO ARQUIVO, não só pelo título', () => {
    // Quem subiu lembra do nome do PDF; não achar faz subir uma segunda cópia.
    expect(filtrarAcervo(acervo, { termo: 'deck' })[0]!.titulo).toBe(
      'Apresentação do escritório'
    );
  });

  it('filtra por categoria, ignorando acento e caixa', () => {
    expect(filtrarAcervo(acervo, { categoria: 'audios' })).toHaveLength(1);
    expect(filtrarAcervo(acervo, { categoria: 'CONTRATOS' })).toHaveLength(1);
  });

  it('item sem categoria some quando há categoria escolhida', () => {
    expect(filtrarAcervo(acervo, { categoria: 'Contratos' }).map((i) => i.titulo)).toEqual([
      'Contrato de honorários',
    ]);
  });

  it('filtra por tipo', () => {
    expect(filtrarAcervo(acervo, { tipo: 'audio' })).toHaveLength(1);
    expect(filtrarAcervo(acervo, { tipo: 'video' })).toHaveLength(0);
  });

  it('soma os três filtros', () => {
    expect(filtrarAcervo(acervo, { termo: 'contrato', categoria: 'Institucional' })).toEqual([]);
    expect(
      filtrarAcervo(acervo, { termo: 'contrato', categoria: 'Contratos', tipo: 'document' })
    ).toHaveLength(1);
  });

  it('acento sozinho no termo não acende a lista inteira', () => {
    // Regressão da armadilha do `\p{Diacritic}`: `^^^` normalizado viraria
    // agulha vazia e `includes("")` casaria com tudo.
    expect(filtrarAcervo(acervo, { termo: '^^^' })).toEqual([]);
  });
});

describe('tamanhoLegivel', () => {
  it('escala de B a MB', () => {
    expect(tamanhoLegivel(512)).toBe('512 B');
    expect(tamanhoLegivel(2048)).toBe('2 KB');
    expect(tamanhoLegivel(1_500_000)).toBe('1,4 MB');
  });
});
