import { describe, expect, it } from 'vitest';

import { novoVerifyToken } from './verify-token';

describe('novoVerifyToken', () => {
  it('é aleatório, longo e sem caractere que a Meta possa mastigar', () => {
    const a = novoVerifyToken();
    const b = novoVerifyToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^ig-[0-9a-f]{32}$/);
  });
});
