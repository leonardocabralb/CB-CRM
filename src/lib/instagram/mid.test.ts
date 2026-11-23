import { describe, expect, it } from 'vitest';

import { chaveDoMid } from './mid';

// ============================================================
// As duas grafias do mesmo mid (medidas em 23/11/2026, ids FICTÍCIOS): o envio
// pela central volta `new_ig_dm_item:…` e o eco chega `ig_dm_item:…`.
// ============================================================

/** O base64 com os escapes da Meta: `Z` vira `ZA` e `=` vira `ZD`. */
function naGrafiaDaMeta(texto: string): string {
  return Buffer.from(texto, 'latin1')
    .toString('base64')
    .replace(/[Z=]/g, (c) => (c === 'Z' ? 'ZA' : 'ZD'));
}

const ID = '11111111111111111:222222222222222222222222222222222222222:3333333333333333333333333333333333';
const DO_ECO = naGrafiaDaMeta(`ig_dm_item:1:IGMessageID:${ID}`);
const DO_ENVIO = naGrafiaDaMeta(`new_ig_dm_item:1:IGMessageID:${ID}`);

describe('chaveDoMid', () => {
  it('o eco e o envio pela central dão a MESMA chave', () => {
    expect(DO_ECO).not.toBe(DO_ENVIO);
    expect(chaveDoMid(DO_ECO)).toBe(`IGMessageID:${ID}`);
    expect(chaveDoMid(DO_ENVIO)).toBe(`IGMessageID:${ID}`);
  });

  it('desfaz os dois escapes da Meta (`ZA` e `ZD`)', () => {
    expect(DO_ECO).toContain('ZA');
    expect(DO_ENVIO).toMatch(/ZD$/);
    expect(chaveDoMid(DO_ENVIO)).not.toBeNull();
  });

  it('outra mensagem, outra chave', () => {
    const outra = naGrafiaDaMeta(`ig_dm_item:1:IGMessageID:${ID.replace(/3$/, '4')}`);
    expect(chaveDoMid(outra)).not.toBe(chaveDoMid(DO_ECO));
  });

  it('mid sem a forma conhecida fica só na comparação exata (null)', () => {
    expect(chaveDoMid('mid-de-teste')).toBeNull();
    expect(chaveDoMid('')).toBeNull();
    // A linha irmã de anexo extra: o Node ignoraria o `#2` e daria a chave da principal.
    expect(chaveDoMid(`${DO_ECO}#2`)).toBeNull();
    expect(chaveDoMid(naGrafiaDaMeta('postback:200:1700000000000'))).toBeNull();
  });
});
