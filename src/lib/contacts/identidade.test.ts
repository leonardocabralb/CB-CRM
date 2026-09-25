import { describe, expect, it } from 'vitest';

import { identidadeDoContato, nomeDoContato, podeFicarSemTelefone } from './identidade';

describe('identidadeDoContato', () => {
  it('telefone primeiro, @ do Instagram depois', () => {
    expect(identidadeDoContato({ phone: '+5583980000016' })).toBe(
      '+5583980000016'
    );
    expect(
      identidadeDoContato({ phone: null, instagram_username: 'cbadv.bancario' })
    ).toBe('@cbadv.bancario');
    // Ficha unificada (Fase 5): tem os dois — o telefone continua sendo a
    // identidade principal, porque é por ele que o resto do CRM casa.
    expect(
      identidadeDoContato({ phone: '+5583980000016', instagram_username: 'x' })
    ).toBe('+5583980000016');
  });

  it('Instagram sem @ lido ainda NÃO vira o IGSID na tela', () => {
    expect(
      identidadeDoContato({ phone: null, instagram_id: '1234567890123456' })
    ).toBeNull();
    expect(identidadeDoContato({})).toBeNull();
  });
});

describe('identidadeDoContato — o @ do WhatsApp (Fase 11.4)', () => {
  // Decisão do operador (24/09/2026): telefone, senão o @ do WhatsApp, senão
  // o do Instagram — o @ puro, sem dizer de onde veio.
  it('ficha só-BSUID com @: o @ do WhatsApp', () => {
    expect(
      identidadeDoContato({ phone: null, wa_username: 'ana.silva' })
    ).toBe('@ana.silva');
  });

  it('ficha só-BSUID sem @: nula — o BSUID nunca aparece', () => {
    expect(
      identidadeDoContato({ phone: null, wa_username: null, wa_user_id: 'BR.1349120865530274' } as never)
    ).toBeNull();
  });

  it('com telefone, o telefone vence os dois @', () => {
    expect(
      identidadeDoContato({ phone: '+5583980000016', wa_username: 'ana', instagram_username: 'ana.ig' })
    ).toBe('+5583980000016');
  });

  it('os dois @: o do WhatsApp primeiro', () => {
    expect(
      identidadeDoContato({ phone: null, wa_username: 'ana', instagram_username: 'ana.ig' })
    ).toBe('@ana');
  });

  it('nomeDoContato cai no @ do WhatsApp quando não há nome', () => {
    expect(nomeDoContato({ name: null, phone: null, wa_username: 'ana' }, '?')).toBe('@ana');
  });
});

describe('nomeDoContato', () => {
  it('nome, senão identidade, senão o fallback da tela', () => {
    expect(nomeDoContato({ name: 'Ana', phone: '+55' }, '?')).toBe('Ana');
    expect(nomeDoContato({ name: '  ', phone: '+55' }, '?')).toBe('+55');
    expect(nomeDoContato({ name: null, instagram_username: 'ana' }, '?')).toBe(
      '@ana'
    );
    expect(nomeDoContato({ name: null, phone: null }, 'Cliente')).toBe(
      'Cliente'
    );
  });

  it('contato ausente cai no fallback, sem estourar', () => {
    expect(nomeDoContato(null, 'Sem contato')).toBe('Sem contato');
    expect(nomeDoContato(undefined, 'Sem contato')).toBe('Sem contato');
  });
});

describe('podeFicarSemTelefone — o CHECK de identidade (1041)', () => {
  it('Instagram ou BSUID: pode ficar sem telefone', () => {
    expect(podeFicarSemTelefone({ instagram_id: '1234567890123456' })).toBe(true);
    expect(podeFicarSemTelefone({ wa_user_id: 'BR.1349120865530274' })).toBe(true);
  });

  it('sem outra identidade: não pode (o banco recusaria o UPDATE)', () => {
    expect(podeFicarSemTelefone({ instagram_id: null, wa_user_id: null })).toBe(false);
    expect(podeFicarSemTelefone({})).toBe(false);
    expect(podeFicarSemTelefone(null)).toBe(false);
  });
});
