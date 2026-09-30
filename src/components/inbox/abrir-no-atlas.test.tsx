import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';

import { AbrirNoAtlas, hrefDoAtlas } from './abrir-no-atlas';

// ============================================================
// "Abrir no Atlas": o endereço vem de FORA e vira `href` — só `https:`
// válido se desenha (um `javascript:` seria XSS). Aba nova, sem opener.
// ============================================================

const APP = 'https://app.example.com/#/clients/1b4e28ba-2fa1-11d2-883f-0016d3cca427';

function desenhar(appUrl: string | null, variante: 'circulo' | 'botao', messages: unknown = ptBR, locale = 'pt-BR') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages as AbstractIntlMessages} timeZone="America/Sao_Paulo">
      <AbrirNoAtlas appUrl={appUrl} variante={variante} />
    </NextIntlClientProvider>,
  );
}

describe('AbrirNoAtlas', () => {
  it('só https: javascript:, http:, texto solto e vazio não desenham nada', () => {
    for (const ruim of [null, '', 'javascript:alert(1)', 'http://app.example.com/#/clients/x', 'não é url']) {
      expect(hrefDoAtlas(ruim)).toBeNull();
      expect(desenhar(ruim, 'circulo')).toBe('');
      expect(desenhar(ruim, 'botao')).toBe('');
    }
  });

  it('círculo: link externo, aba nova sem opener, title e aria-label iguais', () => {
    const html = desenhar(APP, 'circulo');
    expect(html).toContain(`href="${APP}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('aria-label="Abrir no Atlas"');
    expect(html).toContain('title="Abrir no Atlas"');
    expect(html).toContain('rounded-full');
  });

  it('botão: com o texto, nos dois dicionários', () => {
    expect(desenhar(APP, 'botao')).toMatch(/<a[^>]*>.*Abrir no Atlas<\/a>/);
    expect(desenhar(APP, 'botao', en, 'en')).toMatch(/<a[^>]*>.*Open in Atlas<\/a>/);
  });
});
