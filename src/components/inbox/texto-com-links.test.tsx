import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { FormattedText } from './formatted-text';
import { TextoComLinks } from './texto-com-links';

// ============================================================
// Link clicável na bolha do fio e na anotação (pedido do operador,
// 29/09/2026): o endereço era texto morto nas duas.
// ============================================================

/** Mesma forma do link do print do operador (`_`, `-`, `?e=`), com dados de exemplo. */
const URL_DO_PRINT =
  'https://exemplo-my.sharepoint.com/:f:/g/personal/financeiro_exemplo_com_br/AbC1dEf2_GhI3-jKl4MnO5pQr6?e=Xy7Zw8';

/** Os `<a …>` do HTML, sem o conteúdo. */
const ancoras = (html: string) => html.match(/<a [^>]*>/g) ?? [];

describe('TextoComLinks — a anotação', () => {
  it('endereço vira <a> que abre em aba nova, sem mandar o endereço do CRM', () => {
    const html = renderToStaticMarkup(
      <TextoComLinks texto={`Documentos:\n\n${URL_DO_PRINT}\n\nObrigado`} />
    );
    const [a] = ancoras(html);
    expect(ancoras(html)).toHaveLength(1);
    expect(a).toContain(`href="${URL_DO_PRINT}"`);
    expect(a).toContain('target="_blank"');
    expect(a).toContain('rel="noopener noreferrer"');
    // O texto em volta continua lá, quebras de linha inclusive.
    expect(html.startsWith('Documentos:\n\n<a ')).toBe(true);
    expect(html.endsWith('</a>\n\nObrigado')).toBe(true);
  });

  it('www ganha https no href e fica como foi escrito na tela', () => {
    const html = renderToStaticMarkup(<TextoComLinks texto="site www.x.com.br." />);
    expect(html).toBe(
      'site <a href="https://www.x.com.br" target="_blank" rel="noopener noreferrer" title="https://www.x.com.br" data-menu-do-navegador="" class="underline underline-offset-2 hover:opacity-80 [-webkit-touch-callout:default]">www.x.com.br</a>.'
    );
  });

  // O toque longo da linha da mensagem (`message-actions.tsx`) pula quem está
  // dentro de `data-menu-do-navegador`: sem a marca, segurar o link no
  // celular abriria a barra de ações em vez do "copiar endereço".
  it('o link leva a marca que devolve o menu do navegador no toque longo', () => {
    const [a] = ancoras(renderToStaticMarkup(<TextoComLinks texto="https://x.com.br" />));
    expect(a).toContain('data-menu-do-navegador=""');
    expect(a).toContain('[-webkit-touch-callout:default]');
  });

  it('a anotação NÃO ganha a formatação do WhatsApp — asterisco fica asterisco', () => {
    expect(renderToStaticMarkup(<TextoComLinks texto="*urgente* 2 * 3" />)).toBe(
      '*urgente* 2 * 3'
    );
  });

  it('sem endereço, nenhum link; javascript: nunca vira href', () => {
    expect(ancoras(renderToStaticMarkup(<TextoComLinks texto="R$ 1.500,00 e fls.23" />))).toEqual([]);
    expect(ancoras(renderToStaticMarkup(<TextoComLinks texto="javascript:alert(1)" />))).toEqual([]);
  });
});

describe('FormattedText — a bolha do fio', () => {
  it('link dentro do negrito: <strong><a …></a></strong>', () => {
    const html = renderToStaticMarkup(<FormattedText texto="*https://x.com/a_b*" />);
    expect(html).toContain('<strong><a href="https://x.com/a_b"');
    expect(html).toContain('>https://x.com/a_b</a></strong>');
  });

  it('⚠️ o `_` do endereço não vira itálico no meio do link', () => {
    const html = renderToStaticMarkup(<FormattedText texto="https://x.com/_a_/b" />);
    expect(html).not.toContain('<em>');
    expect(ancoras(html)).toHaveLength(1);
    expect(html).toContain('>https://x.com/_a_/b</a>');
  });

  it('dentro de monoespaçado continua literal (sem link)', () => {
    expect(ancoras(renderToStaticMarkup(<FormattedText texto="`https://x.com`" />))).toEqual([]);
  });
});
