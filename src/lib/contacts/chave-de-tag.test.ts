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

  it('⚠️ casa as DUAS formas Unicode do mesmo nome', () => {
    // A decomposta (`a` + U+0301) é o que sai de exportação feita no macOS.
    // O `.normalize('NFD')` é o que faz as duas caírem na mesma chave — e a
    // 984 pôs a mesma coisa no SQL, porque a 983 só via a precomposta e o
    // índice único deixava a decomposta entrar.
    const precomposta = 'Bancário';
    const decomposta = precomposta.normalize('NFD');
    expect(decomposta.length).toBeGreaterThan(precomposta.length);
    expect(chaveDeTag(decomposta)).toBe('bancario');
    expect(chaveDeTag(decomposta)).toBe(chaveDeTag(precomposta));
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

  it('não colapsa o que o NFD não decompõe', () => {
    // `ø` não é `o` + sinal combinante; o SQL também o mantém.
    expect(chaveDeTag('Ø')).toBe('ø');
  });
});
