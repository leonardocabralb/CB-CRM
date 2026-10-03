import { describe, expect, it } from 'vitest';

import { trocouDeNumero } from './troca-de-numero';

// ============================================================
// O "Reparear" leu o QR com OUTRO chip? (03/10/2026) — se sim, a rota
// `/connect` zera o `own_lid` para o CRM reaprender o do aparelho novo.
// ============================================================

describe('trocouDeNumero', () => {
  it('outro número: trocou', () => {
    expect(trocouDeNumero('559690000016', '559690000017')).toBe(true);
  });

  it('o mesmo número, com ou sem formatação: não trocou', () => {
    expect(trocouDeNumero('559690000016', '559690000016')).toBe(false);
    expect(trocouDeNumero('+55 (96) 9000-0016', '559690000016')).toBe(false);
  });

  it('sem o número agora (a Evolution não informou): não afirma troca', () => {
    expect(trocouDeNumero('559690000016', undefined)).toBe(false);
    expect(trocouDeNumero('559690000016', '')).toBe(false);
  });

  it('sem número antes: conta como troca (zerar um LID que já é nulo não custa nada)', () => {
    expect(trocouDeNumero(null, '559690000016')).toBe(true);
  });
});
