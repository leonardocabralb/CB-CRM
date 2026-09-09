import { describe, expect, it } from 'vitest';

import { PREFIXO, assinar, assinaturaCasa } from './assinatura';

const SEGREDO = 'segredo-de-teste';
const CORPO = '{"object":"instagram","entry":[{"id":"17841400000000000"}]}';

describe('assinar', () => {
  it('devolve sha256= seguido de 64 hex', () => {
    expect(assinar(CORPO, SEGREDO)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('muda quando o corpo ou o segredo mudam', () => {
    expect(assinar(CORPO, SEGREDO)).not.toBe(assinar(CORPO + ' ', SEGREDO));
    expect(assinar(CORPO, SEGREDO)).not.toBe(assinar(CORPO, 'outro'));
  });
});

describe('assinaturaCasa', () => {
  it('aceita a assinatura certa', () => {
    expect(assinaturaCasa(assinar(CORPO, SEGREDO), CORPO, SEGREDO)).toBe(true);
  });

  it('tolera espaços e hex em maiúsculas no cabeçalho', () => {
    const header =
      '  ' +
      assinar(CORPO, SEGREDO).toUpperCase().replace('SHA256=', 'sha256=') +
      ' ';
    expect(assinaturaCasa(header, CORPO, SEGREDO)).toBe(true);
  });

  it('recusa segredo errado, corpo adulterado, prefixo ausente e cabeçalho vazio', () => {
    const header = assinar(CORPO, SEGREDO);
    expect(assinaturaCasa(header, CORPO, 'outro')).toBe(false);
    expect(
      assinaturaCasa(header, CORPO.replace('instagram', 'whatsapp'), SEGREDO)
    ).toBe(false);
    expect(assinaturaCasa(header.slice(PREFIXO.length), CORPO, SEGREDO)).toBe(
      false
    );
    expect(assinaturaCasa(null, CORPO, SEGREDO)).toBe(false);
    expect(assinaturaCasa('', CORPO, SEGREDO)).toBe(false);
  });

  it("recusa segredo vazio — nunca 'casa' por falta de configuração", () => {
    expect(assinaturaCasa(assinar(CORPO, ''), CORPO, '')).toBe(false);
  });

  it('o corpo é comparado como TEXTO CRU: reserializar o JSON não casa', () => {
    const corpoComEspacos = JSON.stringify(JSON.parse(CORPO), null, 2);
    expect(
      assinaturaCasa(assinar(CORPO, SEGREDO), corpoComEspacos, SEGREDO)
    ).toBe(false);
  });
});
