import { describe, expect, it } from 'vitest';

import { CAMINHO_DO_CALLBACK } from './conexao';
import { InstagramApiError, MARCA_DE_TOKEN } from './graph';
import {
  PERMISSOES_DO_LOGIN,
  VALIDADE_DO_ESTADO_MS,
  chaveDoEstado,
  criarEstado,
  lerEstado,
  origemDoPedido,
  trocarCodigoPorToken,
  trocarPorTokenLongo,
  urlDeAutorizacao,
  urlDeRedirecionamento,
  vencimentoDoToken,
} from './oauth';

const CHAVE = chaveDoEstado('ab'.repeat(32));
const OUTRA_CHAVE = chaveDoEstado('cd'.repeat(32));
const AGORA = 1_760_000_000_000;
const SEGREDO = 'segredo-do-app-0123456789abcdef';
const CODIGO = 'AQBcodigo-de-uso-unico-do-instagram-xyz';
const TOKEN_CURTO = 'IGAAcurto1234567890';
const TOKEN_LONGO = 'IGAAlongo1234567890';

function pedido(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe('origemDoPedido', () => {
  const SITE = 'https://crm.exemplo.com/';

  it('sem NEXT_PUBLIC_SITE_URL, usa os cabeçalhos x-forwarded-* que o Traefik escreve', () => {
    expect(
      origemDoPedido(
        pedido('http://localhost:3000/api/x', {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'crm.exemplo.com',
        }),
        undefined
      )
    ).toBe('https://crm.exemplo.com');
  });

  it('pedido do host do site vira a URL canônica, mesmo com proto forjado', () => {
    expect(
      origemDoPedido(
        pedido('http://localhost:3000/api/x', {
          'x-forwarded-proto': 'http',
          'x-forwarded-host': 'crm.exemplo.com',
        }),
        SITE
      )
    ).toBe('https://crm.exemplo.com');
  });

  it('host PÚBLICO estranho no cabeçalho é ignorado: cai no site', () => {
    // Sem sessão a rota redireciona antes de qualquer checagem — o Location
    // não pode apontar para o host que veio no cabeçalho (revisão do #189).
    expect(
      origemDoPedido(
        pedido('http://localhost:3000/api/x', {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'evil.example',
        }),
        SITE
      )
    ).toBe('https://crm.exemplo.com');
  });

  it('o preview local passa como veio, mesmo com o site configurado', () => {
    expect(origemDoPedido(pedido('http://localhost:3131/api/x'), SITE)).toBe(
      'http://localhost:3131'
    );
    expect(
      origemDoPedido(pedido('http://x/api', { host: 'localhost:3131' }), SITE)
    ).toBe('http://localhost:3131');
  });

  it('cabeçalho com forma estranha cai na URL do pedido', () => {
    expect(
      origemDoPedido(
        pedido('http://localhost:3131/api/x', {
          'x-forwarded-host': 'evil.com/../?x=',
        }),
        undefined
      )
    ).toBe('http://localhost:3131');
    expect(
      origemDoPedido(
        pedido('http://localhost:3131/api/x', { 'x-forwarded-proto': 'ftp' }),
        undefined
      )
    ).toBe('http://localhost:3131');
  });
});

describe('urlDeAutorizacao', () => {
  it('monta a URL do Instagram com o que a doc exige', () => {
    const url = new URL(
      urlDeAutorizacao({
        appId: '123456789',
        redirectUri: urlDeRedirecionamento('https://crm.exemplo.com/'),
        estado: 'abc.def',
      })
    );
    expect(url.origin + url.pathname).toBe(
      'https://www.instagram.com/oauth/authorize'
    );
    expect(url.searchParams.get('client_id')).toBe('123456789');
    expect(url.searchParams.get('redirect_uri')).toBe(
      `https://crm.exemplo.com${CAMINHO_DO_CALLBACK}`
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')?.split(',')).toEqual([
      ...PERMISSOES_DO_LOGIN,
    ]);
    expect(url.searchParams.get('state')).toBe('abc.def');
    // Mais de uma conta do escritório: o Instagram tem de PERGUNTAR qual.
    expect(url.searchParams.get('force_reauth')).toBe('true');
  });
});

describe('state assinado', () => {
  const conteudo = { accountId: 'conta-1', userId: 'membro-1', nonce: 'n0nce' };

  it('vai e volta com a mesma chave', () => {
    const estado = criarEstado(conteudo, AGORA, CHAVE);
    expect(lerEstado(estado, AGORA + 1000, CHAVE)).toEqual({
      ...conteudo,
      exp: AGORA + VALIDADE_DO_ESTADO_MS,
    });
  });

  it('recusa assinatura de outra chave, conteúdo adulterado e forma estranha', () => {
    const estado = criarEstado(conteudo, AGORA, CHAVE);
    expect(lerEstado(estado, AGORA, OUTRA_CHAVE)).toBeNull();

    const [payload, mac] = estado.split('.');
    const adulterado = Buffer.from(
      JSON.stringify({ ...conteudo, accountId: 'conta-2', exp: AGORA + 1 }),
      'utf8'
    ).toString('base64url');
    expect(lerEstado(`${adulterado}.${mac}`, AGORA, CHAVE)).toBeNull();
    expect(lerEstado(`${payload}.${mac}x`, AGORA, CHAVE)).toBeNull();
    expect(lerEstado(payload, AGORA, CHAVE)).toBeNull();
    expect(lerEstado('', AGORA, CHAVE)).toBeNull();
    expect(lerEstado(null, AGORA, CHAVE)).toBeNull();
  });

  it('vence', () => {
    const estado = criarEstado(conteudo, AGORA, CHAVE);
    expect(
      lerEstado(estado, AGORA + VALIDADE_DO_ESTADO_MS - 1, CHAVE)
    ).not.toBeNull();
    expect(lerEstado(estado, AGORA + VALIDADE_DO_ESTADO_MS, CHAVE)).toBeNull();
  });

  it('exige ENCRYPTION_KEY de verdade para derivar a chave', () => {
    expect(() => chaveDoEstado('')).toThrow();
    expect(() => chaveDoEstado('abcd')).toThrow();
  });
});

function respondendo(
  status: number,
  corpo: unknown,
  conferir?: (url: string, init?: RequestInit) => void
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    conferir?.(String(url), init);
    return new Response(JSON.stringify(corpo), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('trocarCodigoPorToken', () => {
  const args = {
    appId: '123456789',
    appSecret: SEGREDO,
    redirectUri: 'https://crm.exemplo.com/api/cb/instagram/oauth/callback',
    code: CODIGO,
  };

  it('manda o formulário documentado e lê `data[0]`', async () => {
    let visto: RequestInit | undefined;
    const r = await trocarCodigoPorToken(
      args,
      respondendo(
        200,
        {
          data: [
            {
              access_token: TOKEN_CURTO,
              user_id: 17841400000000000,
              permissions:
                'instagram_business_basic,instagram_business_manage_messages',
            },
          ],
        },
        (url, init) => {
          expect(url).toBe('https://api.instagram.com/oauth/access_token');
          visto = init;
        }
      )
    );
    expect(visto?.method).toBe('POST');
    const corpo = new URLSearchParams(String(visto?.body));
    expect(corpo.get('client_id')).toBe('123456789');
    expect(corpo.get('client_secret')).toBe(SEGREDO);
    expect(corpo.get('grant_type')).toBe('authorization_code');
    expect(corpo.get('redirect_uri')).toBe(args.redirectUri);
    expect(corpo.get('code')).toBe(CODIGO);
    expect(r).toEqual({
      token: TOKEN_CURTO,
      igUserId: '17841400000000000',
      permissoes: [
        'instagram_business_basic',
        'instagram_business_manage_messages',
      ],
    });
  });

  it('só a forma documentada (`data[0]`) é aceita', async () => {
    await expect(
      trocarCodigoPorToken(
        args,
        respondendo(200, { access_token: TOKEN_CURTO, user_id: '1', permissions: 'a' })
      )
    ).rejects.toBeInstanceOf(InstagramApiError);
  });

  it('a mensagem de erro do api.instagram.com sai sem o segredo e sem o código', async () => {
    await expect(
      trocarCodigoPorToken(
        args,
        respondendo(400, {
          error_type: 'OAuthException',
          code: 400,
          error_message: `Invalid platform app ${SEGREDO} code=${CODIGO}`,
        })
      )
    ).rejects.toMatchObject({
      codigo: 'meta_error',
      message: `Invalid platform app ${MARCA_DE_TOKEN} code=${MARCA_DE_TOKEN}`,
      status: 400,
    });
  });

  it('sem o campo `permissions` a resposta é "não sei", não "não concedeu"', async () => {
    const r = await trocarCodigoPorToken(
      args,
      respondendo(200, { data: [{ access_token: TOKEN_CURTO, user_id: '1' }] })
    );
    expect(r.permissoes).toBeNull();
  });

  it('resposta sem token é erro, não canal mudo', async () => {
    await expect(
      trocarCodigoPorToken(args, respondendo(200, { data: [{}] }))
    ).rejects.toBeInstanceOf(InstagramApiError);
  });
});

describe('trocarPorTokenLongo', () => {
  it('troca pelo endpoint documentado e lê o expires_in medido', async () => {
    const r = await trocarPorTokenLongo(
      { appSecret: SEGREDO, token: TOKEN_CURTO },
      respondendo(
        200,
        { access_token: TOKEN_LONGO, token_type: 'bearer', expires_in: 5183944 },
        (url) => {
          const u = new URL(url);
          expect(u.origin + u.pathname).toBe(
            'https://graph.instagram.com/access_token'
          );
          expect(u.searchParams.get('grant_type')).toBe('ig_exchange_token');
          expect(u.searchParams.get('client_secret')).toBe(SEGREDO);
          expect(u.searchParams.get('access_token')).toBe(TOKEN_CURTO);
        }
      )
    );
    expect(r).toEqual({ token: TOKEN_LONGO, expiraEmSeg: 5183944 });
  });

  it('erro da Meta volta pelo código de sempre, sem segredo nem token', async () => {
    await expect(
      trocarPorTokenLongo(
        { appSecret: SEGREDO, token: TOKEN_CURTO },
        respondendo(400, {
          error: {
            message: `Invalid OAuth access token ${TOKEN_CURTO} client_secret=${SEGREDO}`,
            code: 190,
          },
        })
      )
    ).rejects.toMatchObject({
      codigo: 'token_invalido',
      message: `Invalid OAuth access token ${MARCA_DE_TOKEN} client_secret=${MARCA_DE_TOKEN}`,
    });
  });

  it('sem expires_in é erro: a validade gravada não pode ser inventada', async () => {
    await expect(
      trocarPorTokenLongo(
        { appSecret: SEGREDO, token: TOKEN_CURTO },
        respondendo(200, { access_token: TOKEN_LONGO })
      )
    ).rejects.toBeInstanceOf(InstagramApiError);
  });
});

describe('vencimentoDoToken', () => {
  it('soma os segundos medidos ao instante', () => {
    expect(vencimentoDoToken(3600, new Date('2026-09-09T12:00:00Z'))).toBe(
      '2026-09-09T13:00:00.000Z'
    );
  });
});
