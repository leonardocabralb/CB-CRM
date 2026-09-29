import { describe, expect, it } from 'vitest';

import { retornoDoRegistro, urlDaPautaValida, URL_DA_PAUTA } from './retorno';

describe('urlDaPautaValida', () => {
  it('só a própria pauta, com ou sem parâmetros', () => {
    expect(urlDaPautaValida('/reunioes')).toBe(true);
    expect(urlDaPautaValida('/reunioes?dia=2026-09-29')).toBe(true);
  });
  it('recusa qualquer outro destino, inclusive disfarçado', () => {
    for (const url of [
      '/reunioesx',
      '/reunioes/../inbox',
      'https://evil.com/reunioes',
      '//evil.com',
      '/reunioes?x=//evil.com',
      '/reunioes?x=\\evil',
      '/reunioes#x',
      '/inbox',
      42,
      null,
    ]) {
      expect(urlDaPautaValida(url)).toBe(false);
    }
  });
});

describe('retornoDoRegistro', () => {
  const agora = Date.parse('2026-09-29T15:00:00Z');
  const reg = (url: unknown, em: unknown) => JSON.stringify({ url, em });

  it('devolve a URL guardada dentro da validade', () => {
    expect(retornoDoRegistro(reg('/reunioes?dia=2026-09-30', agora - 60_000), agora)).toBe('/reunioes?dia=2026-09-30');
  });
  it('vencido, no futuro, ilegível ou fora da pauta: a pauta de hoje', () => {
    expect(retornoDoRegistro(reg('/reunioes?dia=2026-09-30', agora - 3 * 60 * 60_000), agora)).toBe(URL_DA_PAUTA);
    expect(retornoDoRegistro(reg('/reunioes?dia=2026-09-30', agora + 60_000), agora)).toBe(URL_DA_PAUTA);
    expect(retornoDoRegistro('{', agora)).toBe(URL_DA_PAUTA);
    expect(retornoDoRegistro(null, agora)).toBe(URL_DA_PAUTA);
    expect(retornoDoRegistro(reg('/inbox', agora), agora)).toBe(URL_DA_PAUTA);
    expect(retornoDoRegistro(reg('/reunioes', 'ontem'), agora)).toBe(URL_DA_PAUTA);
  });
});
