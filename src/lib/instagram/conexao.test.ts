import { describe, expect, it } from 'vitest';

import {
  AVISO_DE_VENCIMENTO_DIAS,
  VALIDADE_DO_TOKEN_DIAS,
  diasParaVencer,
  validadeDoToken,
} from './conexao';

describe('validadeDoToken / diasParaVencer', () => {
  const agora = new Date('2026-09-10T12:00:00Z');

  it('a validade é de 60 dias a partir de agora', () => {
    expect(validadeDoToken(agora)).toBe('2026-11-09T12:00:00.000Z');
    expect(diasParaVencer(validadeDoToken(agora), agora)).toBe(
      VALIDADE_DO_TOKEN_DIAS
    );
  });

  it('conta dias inteiros, e vencido é negativo', () => {
    expect(diasParaVencer('2026-09-13T11:00:00Z', agora)).toBe(2);
    expect(diasParaVencer('2026-09-10T13:00:00Z', agora)).toBe(0);
    expect(diasParaVencer('2026-09-09T12:00:00Z', agora)).toBe(-1);
  });

  it('sem validade gravada (WhatsApp, linha antiga) não é "vencido"', () => {
    expect(diasParaVencer(null, agora)).toBeNull();
    expect(diasParaVencer(undefined, agora)).toBeNull();
    expect(diasParaVencer('não é data', agora)).toBeNull();
  });

  it('o aviso da tela fica dentro da validade', () => {
    expect(AVISO_DE_VENCIMENTO_DIAS).toBeLessThan(VALIDADE_DO_TOKEN_DIAS);
  });
});
