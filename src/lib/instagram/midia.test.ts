import { describe, expect, it } from 'vitest';

import { chaveCurta, nomeDoContentDisposition } from './midia';

describe('nomeDoContentDisposition', () => {
  it('lê o nome que o CDN da Meta manda (medido na Fase 0)', () => {
    expect(
      nomeDoContentDisposition('inline;filename=audioclip-1757460907000-3.mp4')
    ).toBe('audioclip-1757460907000-3.mp4');
    expect(
      nomeDoContentDisposition('attachment; filename="contrato.pdf"')
    ).toBe('contrato.pdf');
    expect(
      nomeDoContentDisposition(
        "attachment; filename*=UTF-8''a%C3%A7%C3%A3o.pdf"
      )
    ).toBe('ação.pdf');
  });

  it('sem cabeçalho ou sem nome, null', () => {
    expect(nomeDoContentDisposition(null)).toBeNull();
    expect(nomeDoContentDisposition('inline')).toBeNull();
  });
});

describe('chaveCurta', () => {
  it('é estável e curta para um mid de 120 caracteres', () => {
    const mid = 'a'.repeat(120);
    expect(chaveCurta(mid)).toBe(chaveCurta(mid));
    expect(chaveCurta(mid)).toMatch(/^[0-9a-f]{12}$/);
    expect(chaveCurta(mid)).not.toBe(chaveCurta(mid + 'b'));
  });
});
