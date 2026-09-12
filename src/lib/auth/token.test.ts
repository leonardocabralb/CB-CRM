import { describe, expect, it } from 'vitest';
import { sessionIdDoToken } from './token';

function jwtCom(payload: unknown): string {
  const b64url = (s: string) =>
    Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.assinatura`;
}

describe('sessionIdDoToken', () => {
  it('lê a claim session_id de um token válido', () => {
    expect(sessionIdDoToken(jwtCom({ sub: 'u1', session_id: 'sess-123' }))).toBe('sess-123');
  });

  it('decodifica base64url (com - e _ e sem padding) e texto UTF-8 nas outras claims', () => {
    // `user_metadata` com acento força bytes fora do ASCII no payload; a
    // claim que interessa continua legível.
    const token = jwtCom({ session_id: 'abc', user_metadata: { full_name: 'José Antônio ~~?>' } });
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(sessionIdDoToken(token)).toBe('abc');
  });

  it('devolve null sem a claim, com claim vazia ou de outro tipo', () => {
    expect(sessionIdDoToken(jwtCom({ sub: 'u1' }))).toBeNull();
    expect(sessionIdDoToken(jwtCom({ session_id: '' }))).toBeNull();
    expect(sessionIdDoToken(jwtCom({ session_id: 42 }))).toBeNull();
  });

  it('devolve null para lixo, token sem partes, payload que não é JSON e valores ausentes', () => {
    expect(sessionIdDoToken(null)).toBeNull();
    expect(sessionIdDoToken(undefined)).toBeNull();
    expect(sessionIdDoToken('')).toBeNull();
    expect(sessionIdDoToken('so-uma-parte')).toBeNull();
    expect(sessionIdDoToken('a..b')).toBeNull();
    expect(sessionIdDoToken('a.!!!!.b')).toBeNull();
    expect(sessionIdDoToken(`a.${Buffer.from('nao é json').toString('base64')}.b`)).toBeNull();
    expect(sessionIdDoToken(`a.${Buffer.from('"texto"').toString('base64')}.b`)).toBeNull();
  });
});
