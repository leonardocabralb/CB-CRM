import { describe, expect, it } from 'vitest';

import { ehPaginaHtml, urlParaAbrirAnexo } from './abrir-anexo';

const STORAGE = 'https://proj.supabase.co/storage/v1/object/public/chat-media/account-1/123-pagina.html';

describe('ehPaginaHtml', () => {
  it('pelo tipo (com parâmetros) ou pela extensão', () => {
    expect(ehPaginaHtml('text/html; charset=utf-8', null)).toBe(true);
    expect(ehPaginaHtml(null, 'Consulta Processual.HTM')).toBe(true);
    expect(ehPaginaHtml(null, 'pagina.xhtml')).toBe(true);
    expect(ehPaginaHtml('application/pdf', 'contrato.pdf')).toBe(false);
    expect(ehPaginaHtml(null, 'html.pdf')).toBe(false);
  });
});

describe('urlParaAbrirAnexo', () => {
  it('.html do Storage ganha download com o nome', () => {
    expect(urlParaAbrirAnexo(STORAGE, 'text/html', 'Consulta Processual.html')).toBe(
      `${STORAGE}?download=Consulta%20Processual.html`,
    );
  });

  it('não repete o parâmetro nem mexe em URL que já tem query', () => {
    expect(urlParaAbrirAnexo(`${STORAGE}?download=a.html`, 'text/html', 'a.html')).toBe(`${STORAGE}?download=a.html`);
    expect(urlParaAbrirAnexo(`${STORAGE}?v=1`, 'text/html', 'a.html')).toBe(`${STORAGE}?v=1&download=a.html`);
  });

  it('outros tipos e outros endereços ficam como estão', () => {
    const pdf = STORAGE.replace('.html', '.pdf');
    expect(urlParaAbrirAnexo(pdf, 'application/pdf', 'contrato.pdf')).toBe(pdf);
    expect(urlParaAbrirAnexo('https://exemplo.com/a.html', 'text/html', 'a.html')).toBe('https://exemplo.com/a.html');
  });

  it('o proxy da Meta leva o nome do arquivo, de qualquer tipo (vira o nome do download)', () => {
    expect(urlParaAbrirAnexo('/api/whatsapp/media/123', 'application/pdf', 'Contrato Social.pdf')).toBe(
      '/api/whatsapp/media/123?nome=Contrato%20Social.pdf',
    );
    expect(urlParaAbrirAnexo('/api/whatsapp/media/123?channel=c1', 'text/html', 'a.html')).toBe(
      '/api/whatsapp/media/123?channel=c1&nome=a.html',
    );
  });

  it('no proxy, sem nome não acrescenta nada e não repete o parâmetro', () => {
    expect(urlParaAbrirAnexo('/api/whatsapp/media/123', 'application/pdf', '  ')).toBe('/api/whatsapp/media/123');
    expect(urlParaAbrirAnexo('/api/whatsapp/media/123?nome=a.pdf', 'application/pdf', 'b.pdf')).toBe(
      '/api/whatsapp/media/123?nome=a.pdf',
    );
  });

  it('sem nome, um nome genérico', () => {
    expect(urlParaAbrirAnexo(STORAGE, 'text/html', null)).toBe(`${STORAGE}?download=pagina.html`);
  });

  it('1115: o anexo guardado como BINÁRIO (ZIP, RAR, MSG…) baixa com o nome real', () => {
    const zip = STORAGE.replace('123-pagina.html', '1793-endere_o_Leonardo.zip');
    expect(urlParaAbrirAnexo(zip, 'application/x-zip-compressed', 'endereço_Leonardo.zip')).toBe(
      `${zip}?download=endere%C3%A7o_Leonardo.zip`,
    );
    expect(urlParaAbrirAnexo(zip, 'application/vnd.rar', 'docs.rar')).toBe(`${zip}?download=docs.rar`);
    // O binário declarado também — e sem nome, o do objeto (`download=` vazio).
    expect(urlParaAbrirAnexo(zip, 'application/octet-stream', null)).toBe(`${zip}?download=`);
  });

  it('1115: o que o bucket guarda com o tipo verdadeiro abre como antes — e tipo AUSENTE também', () => {
    const pdf = STORAGE.replace('.html', '.pdf');
    expect(urlParaAbrirAnexo(pdf, 'application/pdf; charset=binary', 'contrato.pdf')).toBe(pdf);
    // Linha de antes da 969, sem `media_type`: guardada com o tipo dela.
    expect(urlParaAbrirAnexo(pdf, null, 'contrato.pdf')).toBe(pdf);
    // O proxy da Meta segue o caminho dele (o nome, não o download).
    expect(urlParaAbrirAnexo('/api/whatsapp/media/9', 'application/zip', 'a.zip')).toBe(
      '/api/whatsapp/media/9?nome=a.zip',
    );
  });

  // Roda no render: meio emoji no nome não pode lançar (Codex, #436).
  it('nome com meio emoji não derruba a bolha', () => {
    expect(urlParaAbrirAnexo('/api/whatsapp/media/123', 'application/pdf', 'a\uD83D.pdf')).toBe(
      '/api/whatsapp/media/123?nome=a%EF%BF%BD.pdf',
    );
    expect(urlParaAbrirAnexo(STORAGE, 'text/html', 'b\uD83D.html')).toBe(`${STORAGE}?download=b%EF%BF%BD.html`);
  });
});
