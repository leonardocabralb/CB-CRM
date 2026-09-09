import { describe, expect, it } from 'vitest';

import {
  InstagramApiError,
  MARCA_DE_TOKEN,
  codigoDoErro,
  criarClienteInstagram,
  doGraphDoInstagram,
  semSegredo,
} from './graph';

const TOKEN = 'IGAAQ1234567890abcdefTOKEN';

function respondendo(status: number, corpo: unknown): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    // O token viaja no CABEÇALHO, nunca na URL.
    expect(String(url)).not.toContain(TOKEN);
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`
    );
    return new Response(JSON.stringify(corpo), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('doGraphDoInstagram', () => {
  it('aceita só o host da API do Instagram, por HTTPS', () => {
    expect(doGraphDoInstagram('https://graph.instagram.com/v26.0/me')).toBe(
      true
    );
    expect(doGraphDoInstagram('http://graph.instagram.com/v26.0/me')).toBe(
      false
    );
    expect(doGraphDoInstagram('https://graph.facebook.com/v26.0/me')).toBe(
      false
    );
    expect(doGraphDoInstagram('https://graph.instagram.com.evil.com/x')).toBe(
      false
    );
    expect(doGraphDoInstagram('não é url')).toBe(false);
  });
});

describe('semSegredo', () => {
  it('troca o token pela marca, no texto e na query string', () => {
    // A frase real que a Meta devolve para token malformado ecoa o token.
    expect(semSegredo(`Malformed access token ${TOKEN}`, TOKEN)).toBe(
      `Malformed access token ${MARCA_DE_TOKEN}`
    );
    expect(semSegredo('https://x/?access_token=abc123&fields=id', TOKEN)).toBe(
      `https://x/?access_token=${MARCA_DE_TOKEN}&fields=id`
    );
  });

  it('não mexe em token curto demais para ser um token', () => {
    // Trocar "abc" em todo texto apagaria pedaços de frases inocentes.
    expect(semSegredo('abc abc', 'abc')).toBe('abc abc');
  });
});

describe('codigoDoErro', () => {
  it('mapeia os códigos que decidem o que a tela faz', () => {
    expect(codigoDoErro(400, { code: 190 })).toBe('token_invalido');
    expect(codigoDoErro(401, null)).toBe('token_invalido');
    expect(codigoDoErro(400, { code: 10, error_subcode: 2534022 })).toBe(
      'janela_fechada'
    );
    expect(codigoDoErro(400, { code: 10 })).toBe('sem_permissao');
    expect(codigoDoErro(400, { code: 4 })).toBe('limite');
    expect(codigoDoErro(429, null)).toBe('limite');
    expect(codigoDoErro(500, { code: 1 })).toBe('meta_error');
  });
});

describe('criarClienteInstagram().me', () => {
  it('descobre o IG user id e o @ a partir do token', async () => {
    const cliente = criarClienteInstagram(
      TOKEN,
      respondendo(200, {
        user_id: '17841457826920658',
        username: 'cbadv.bancario',
        name: 'CB',
      })
    );
    await expect(cliente.me()).resolves.toEqual({
      igUserId: '17841457826920658',
      username: 'cbadv.bancario',
      nome: 'CB',
    });
  });

  it('aceita user_id numérico e nome ausente', async () => {
    const cliente = criarClienteInstagram(
      TOKEN,
      respondendo(200, { user_id: 17841457826920658, username: 'x' })
    );
    const r = await cliente.me();
    expect(r.igUserId).toBe('17841457826920658');
    expect(r.nome).toBeNull();
  });

  it('erro da Meta vira código + mensagem SEM o token', async () => {
    const cliente = criarClienteInstagram(
      TOKEN,
      respondendo(400, {
        error: {
          message: `Invalid OAuth access token - ${TOKEN}`,
          code: 190,
          type: 'OAuthException',
        },
      })
    );
    const erro = await cliente.me().catch((e) => e);
    expect(erro).toBeInstanceOf(InstagramApiError);
    expect(erro.codigo).toBe('token_invalido');
    expect(erro.status).toBe(400);
    expect(erro.codigoDaMeta).toBe(190);
    expect(erro.message).not.toContain(TOKEN);
    expect(erro.message).toContain(MARCA_DE_TOKEN);
  });

  it('resposta sem user_id é erro, não um canal com id vazio', async () => {
    const cliente = criarClienteInstagram(
      TOKEN,
      respondendo(200, { username: 'x' })
    );
    await expect(cliente.me()).rejects.toMatchObject({ codigo: 'meta_error' });
  });

  it('falha de rede vira `rede`, com a mensagem limpa', async () => {
    const cliente = criarClienteInstagram(TOKEN, (async () => {
      throw new Error(`fetch failed for ${TOKEN}`);
    }) as unknown as typeof fetch);
    const erro = await cliente.me().catch((e) => e);
    expect(erro.codigo).toBe('rede');
    expect(erro.message).not.toContain(TOKEN);
  });
});
