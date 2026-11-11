import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';

import { minutosDigitados, PausaDaConta } from './pausa-da-conta';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// O cartão "Quando a equipe responde" (1138): a configuração da CONTA.

describe('minutosDigitados', () => {
  it.each<[string, number | null]>([
    ['15', 15],
    [' 0 ', 0],
    ['1440', 1440],
    ['1441', null],
    ['-1', null],
    ['7,5', null],
    ['', null],
    ['quinze', null],
  ])('%j → %s', (texto, esperado) => {
    expect(minutosDigitados(texto)).toBe(esperado);
  });
});

describe('PausaDaConta — antes de ler', () => {
  it('carregando: nem "15" nem "desligado" no campo (o valor só aparece depois de lido)', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pt-BR" messages={ptBR as unknown as AbstractIntlMessages} timeZone="America/Sao_Paulo">
        <PausaDaConta />
      </NextIntlClientProvider>,
    );
    expect(html).toContain(ptBR.IaAgentes.pausaDaConta.titulo);
    expect(html).not.toContain('<input');
    expect(html).not.toContain(ptBR.IaAgentes.pausaDaConta.agoraDesligada);
  });

  it('as chaves do cartão existem nos DOIS dicionários', () => {
    const chaves = Object.keys(ptBR.IaAgentes.pausaDaConta).sort();
    expect(Object.keys(en.IaAgentes.pausaDaConta).sort()).toEqual(chaves);
    expect(typeof en.IaAgentes.erro.minutos_invalidos).toBe('string');
    expect(typeof ptBR.IaAgentes.erro.minutos_invalidos).toBe('string');
  });
});
