import { describe, expect, it } from 'vitest';

import { chaveDeTag } from './chave-de-tag';

describe('chaveDeTag', () => {
  it('casa ignorando maiúscula E acento', () => {
    // Medido em produção: sem tirar o acento, mandar "bancario" num contato
    // que já tinha "Bancário" CRIAVA uma segunda etiqueta, e o catálogo do
    // escritório ficava com as duas — sem erro nenhum.
    expect(chaveDeTag('Bancário')).toBe(chaveDeTag('bancario'));
    expect(chaveDeTag('  AÇÃO  ')).toBe(chaveDeTag('acao'));
  });

  it('não colapsa nomes de fato diferentes', () => {
    expect(chaveDeTag('Bancário')).not.toBe(chaveDeTag('Bancária'));
  });

  it('usa \\p{Mn}, não \\p{Diacritic} — o acento sozinho é caractere', () => {
    // `\p{Diacritic}` apagaria `^`, `´`, `~` isolados e tornaria iguais
    // nomes distintos.
    expect(chaveDeTag('a^b')).toBe('a^b');
    expect(chaveDeTag('a~b')).toBe('a~b');
  });
});
