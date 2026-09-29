import { describe, expect, it } from 'vitest';

import { acharLinks, partirEmLinks } from './links-no-texto';

/** Só os endereços achados, para o teste ficar legível. */
const enderecos = (texto: string) => acharLinks(texto).map((l) => l.texto);

describe('acharLinks — o que vira link', () => {
  it('http, https e www', () => {
    expect(enderecos('veja https://exemplo.com.br/a?b=1 e http://x.org')).toEqual([
      'https://exemplo.com.br/a?b=1',
      'http://x.org',
    ]);
    expect(enderecos('site: www.exemplo.com.br')).toEqual(['www.exemplo.com.br']);
  });

  it('www ganha https no href; o texto fica como foi escrito', () => {
    expect(acharLinks('www.site.com.br')).toEqual([
      { inicio: 0, fim: 15, texto: 'www.site.com.br', href: 'https://www.site.com.br' },
    ]);
  });

  it('link com a forma do SharePoint do print do operador sai inteiro, com os `_` e o `?e=`', () => {
    const url =
      'https://exemplo-my.sharepoint.com/:f:/g/personal/financeiro_exemplo_com_br/QwE1rTy2_UiO3-pAs4DfG5hJk6?e=Ab1Cd2';
    expect(enderecos(`Links abaixo:\n\n${url}\n\n`)).toEqual([url]);
  });

  it('pontuação da frase fica de fora', () => {
    expect(enderecos('Acesse https://x.com.')).toEqual(['https://x.com']);
    expect(enderecos('https://x.com, https://y.com; https://z.com!')).toEqual([
      'https://x.com',
      'https://y.com',
      'https://z.com',
    ]);
    expect(enderecos('link: https://x.com/a…')).toEqual(['https://x.com/a']);
  });

  it('parêntese: sai o que sobra, fica o que é par do endereço', () => {
    expect(enderecos('(veja https://x.com/a)')).toEqual(['https://x.com/a']);
    expect(enderecos('https://pt.wikipedia.org/wiki/Direito_(Brasil)')).toEqual([
      'https://pt.wikipedia.org/wiki/Direito_(Brasil)',
    ]);
  });

  it('marcador do WhatsApp no fim fica de fora QUANDO algum o abre antes (é formatação)', () => {
    expect(enderecos('*https://x.com*')).toEqual(['https://x.com']);
    expect(enderecos('_www.x.com_')).toEqual(['www.x.com']);
    expect(enderecos('*veja https://x.com/a*')).toEqual(['https://x.com/a']);
    expect(enderecos('~https://x.com~.')).toEqual(['https://x.com']);
  });

  it('⚠️ sem quem o abra antes, o `_`/`~`/`*` do fim é do ENDEREÇO (Codex, PR #347)', () => {
    // Código de compartilhamento termina em `_` uma vez em 64: tirá-lo
    // mandaria o `href` para outra página.
    expect(enderecos('https://host/documento_')).toEqual(['https://host/documento_']);
    expect(enderecos('veja https://host/a~ e https://host/b*')).toEqual([
      'https://host/a~',
      'https://host/b*',
    ]);
    // Marcador solto (com espaço dos dois lados) não abre nada.
    expect(enderecos('2 * 3 https://host/c_')).toEqual(['https://host/c_']);
    // A pontuação da frase continua saindo; o `_` de antes dela fica.
    expect(enderecos('Acesse https://host/doc_.')).toEqual(['https://host/doc_']);
  });

  it('⚠️ formatação que JÁ FECHOU antes não leva o marcador do endereço (Codex, PR #347, 2ª rodada)', () => {
    expect(enderecos('_ênfase_ https://host/documento_')).toEqual(['https://host/documento_']);
    expect(enderecos('*Link:* https://host/b*')).toEqual(['https://host/b*']);
    // O `_` de um endereço ANTERIOR não abre nada (endereço é literal)…
    expect(enderecos('https://a.com/_x e https://b.com/doc_')).toEqual([
      'https://a.com/_x',
      'https://b.com/doc_',
    ]);
    // …nem o de dentro de monoespaçado.
    expect(enderecos('`_` https://host/doc_')).toEqual(['https://host/doc_']);
  });

  it('formatação ainda ABERTA fecha depois do endereço, inclusive aninhada', () => {
    expect(enderecos('_ênfase_ e _veja https://host/doc_')).toEqual(['https://host/doc']);
    expect(enderecos('*_https://x.com_*')).toEqual(['https://x.com']);
  });

  it('caractere invisível e emoji encerram o endereço', () => {
    expect(enderecos('https://x.com\u200e')).toEqual(['https://x.com']);
    expect(enderecos('https://x.com👍 ok')).toEqual(['https://x.com']);
  });

  it('aspas e sinais de menor/maior encerram o endereço', () => {
    expect(enderecos('"https://x.com/a"')).toEqual(['https://x.com/a']);
    expect(enderecos('<https://x.com/a>')).toEqual(['https://x.com/a']);
  });
});

describe('acharLinks — o que NÃO vira link', () => {
  it('número de processo, CNPJ, valor e abreviação', () => {
    for (const texto of [
      'processo 0801234-56.2024.8.15.2001',
      'CNPJ 12.345.678/0001-90',
      'R$ 1.500,00',
      'fls.23 e Art. 5º',
      'e-mail joao@gmail.com',
      'site.com.br sem prefixo',
    ]) {
      expect(enderecos(texto), texto).toEqual([]);
    }
  });

  it('prefixo sem endereço', () => {
    expect(enderecos('https:// e www. soltos')).toEqual([]);
    expect(enderecos('www.semponto')).toEqual([]);
  });

  it('prefixo colado em outra palavra ou e-mail', () => {
    expect(enderecos('abcwww.site.com')).toEqual([]);
    expect(enderecos('contato@www.site.com')).toEqual([]);
  });

  it('⚠️ esquema perigoso nunca vira href', () => {
    expect(enderecos('javascript:alert(1)')).toEqual([]);
    expect(enderecos('data:text/html,oi')).toEqual([]);
    for (const l of acharLinks('https://x.com javascript://y www.z.com')) {
      expect(l.href).toMatch(/^https?:\/\//);
    }
  });
});

describe('partirEmLinks', () => {
  it('alterna texto e link, sem perder caractere', () => {
    const texto = 'Docs: https://a.com/x e www.b.com.br. Fim';
    const trechos = partirEmLinks(texto);
    expect(trechos).toEqual([
      { tipo: 'texto', texto: 'Docs: ' },
      { tipo: 'link', texto: 'https://a.com/x', href: 'https://a.com/x' },
      { tipo: 'texto', texto: ' e ' },
      { tipo: 'link', texto: 'www.b.com.br', href: 'https://www.b.com.br' },
      { tipo: 'texto', texto: '. Fim' },
    ]);
    expect(trechos.map((t) => t.texto).join('')).toBe(texto);
  });

  it('sem link, um trecho só; vazio e nulo, nenhum', () => {
    expect(partirEmLinks('Bom dia')).toEqual([{ tipo: 'texto', texto: 'Bom dia' }]);
    expect(partirEmLinks('')).toEqual([]);
    expect(partirEmLinks(null)).toEqual([]);
  });
});
