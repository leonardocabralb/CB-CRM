import { describe, expect, it } from 'vitest';

import { celularDigitado, ehMotivoDoCelular, MOTIVOS_DO_CELULAR } from './celular';

describe('celularDigitado — o celular que o membro digita para si', () => {
  it.each([
    ['(11) 91234-5678', '5511912345678'],
    ['11912345678', '5511912345678'],
    ['11 9 1234-5678', '5511912345678'],
    ['+55 11 91234-5678', '5511912345678'],
    ['+55 (83) 9 8000-0016', '5583980000016'],
    ['5583980000016', '5583980000016'],
    ['0055 11 91234-5678', '5511912345678'],
    // Copiado do WhatsApp: marcas de direção invisíveis em volta.
    ['‪+55 11 91234-5678‬', '5511912345678'],
  ])('%s → %s', (texto, digitos) => {
    expect(celularDigitado(texto)).toEqual({ ok: true, digitos });
  });

  it('número de fora do Brasil, escrito com o código do país, passa como veio', () => {
    expect(celularDigitado('+351 912 345 678')).toEqual({ ok: true, digitos: '351912345678' });
    expect(celularDigitado('+1 404 555 1234')).toEqual({ ok: true, digitos: '14045551234' });
  });

  it('vazio, só espaço ou nulo é "vazio"', () => {
    expect(celularDigitado('')).toEqual({ ok: false, motivo: 'vazio' });
    expect(celularDigitado('   ')).toEqual({ ok: false, motivo: 'vazio' });
    expect(celularDigitado(null)).toEqual({ ok: false, motivo: 'vazio' });
  });

  it('sem o DDD é "curto" — nunca vira número de outro país', () => {
    expect(celularDigitado('91234-5678')).toEqual({ ok: false, motivo: 'curto' });
  });

  it('fixo brasileiro não é celular', () => {
    expect(celularDigitado('(11) 3456-7890')).toEqual({ ok: false, motivo: 'nao_e_celular' });
    expect(celularDigitado('+55 11 3456-7890')).toEqual({ ok: false, motivo: 'nao_e_celular' });
  });

  it('o celular antigo, sem o 9, é recusado — tem a mesma forma do fixo', () => {
    expect(celularDigitado('(11) 8765-4321')).toEqual({ ok: false, motivo: 'nao_e_celular' });
    expect(celularDigitado('551187654321')).toEqual({ ok: false, motivo: 'nao_e_celular' });
  });

  it('DDD que não existe é número errado, não "fixo"', () => {
    expect(celularDigitado('(20) 91234-5678')).toEqual({ ok: false, motivo: 'invalido' });
  });

  it('letra, 0 de tronco e 0800 são "invalido"', () => {
    expect(celularDigitado('11 9 1234 ramal 5')).toEqual({ ok: false, motivo: 'invalido' });
    expect(celularDigitado('011 91234-5678')).toEqual({ ok: false, motivo: 'invalido' });
    expect(celularDigitado('0800 123 4567')).toEqual({ ok: false, motivo: 'invalido' });
  });

  it('o que sai é sempre o formato que o CHECK da 1046 aceita', () => {
    const piso = /^[1-9][0-9]{7,14}$/;
    for (const texto of ['(11) 91234-5678', '+351 912 345 678', '+1 404 555 1234']) {
      const r = celularDigitado(texto);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.digitos).toMatch(piso);
    }
  });
});

describe('ehMotivoDoCelular', () => {
  it('reconhece os quatro motivos e nada mais', () => {
    for (const m of MOTIVOS_DO_CELULAR) expect(ehMotivoDoCelular(m)).toBe(true);
    expect(ehMotivoDoCelular('falhou')).toBe(false);
    expect(ehMotivoDoCelular(undefined)).toBe(false);
    expect(ehMotivoDoCelular(1)).toBe(false);
  });
});
