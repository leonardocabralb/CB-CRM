import { describe, expect, it } from 'vitest';

import {
  InstagramApiError,
  MARCA_DE_TOKEN,
  codigoDoErro,
  corpoDaMensagem,
  criarClienteInstagram,
  envioRecusado,
  renovarTokenLongo,
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

describe('semSegredo — client_secret', () => {
  it('apaga o segredo do app quando ele viaja na query documentada', () => {
    expect(
      semSegredo('https://x/?client_secret=abc123def&access_token=zzz', TOKEN)
    ).toBe(
      `https://x/?client_secret=${MARCA_DE_TOKEN}&access_token=${MARCA_DE_TOKEN}`
    );
  });
});

describe('assinarWebhooks', () => {
  it('faz POST em /me/subscribed_apps com os campos, o token no cabeçalho', async () => {
    let metodo: string | undefined;
    let urlVista = '';
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      urlVista = String(url);
      metodo = init?.method;
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${TOKEN}`
      );
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await criarClienteInstagram(TOKEN, fetchFn).assinarWebhooks([
      'messages',
      'message_edit',
    ]);
    expect(metodo).toBe('POST');
    expect(urlVista).toBe(
      'https://graph.instagram.com/v26.0/me/subscribed_apps?subscribed_fields=messages%2Cmessage_edit'
    );
    expect(urlVista).not.toContain(TOKEN);
  });

  it('sem `success: true` é erro — canal que não recebe não pode nascer calado', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    await expect(
      criarClienteInstagram(TOKEN, fetchFn).assinarWebhooks(['messages'])
    ).rejects.toBeInstanceOf(InstagramApiError);
  });
});

describe('enviarMensagem (Fase 4)', () => {
  function capturando(status: number, corpo: unknown) {
    const visto: { url?: string; init?: RequestInit } = {};
    const fetchFn = (async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      visto.url = String(url);
      visto.init = init;
      return new Response(JSON.stringify(corpo), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return { visto, fetchFn };
  }

  it('POST em /me/messages, token no cabeçalho, corpo JSON com recipient e texto', async () => {
    const { visto, fetchFn } = capturando(200, {
      recipient_id: '1',
      message_id: 'mid-1',
    });
    const r = await criarClienteInstagram(TOKEN, fetchFn).enviarMensagem({
      para: 'igsid-1',
      texto: 'oi',
    });
    expect(r).toEqual({ messageId: 'mid-1' });
    expect(visto.url).toBe('https://graph.instagram.com/v26.0/me/messages');
    expect(visto.url).not.toContain(TOKEN);
    expect(visto.init?.method).toBe('POST');
    const headers = visto.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(visto.init?.body))).toEqual({
      recipient: { id: 'igsid-1' },
      message: { text: 'oi' },
    });
  });

  it('anexo vai em `attachment` com a URL; a citação em `reply_to.mid`', () => {
    expect(
      corpoDaMensagem({
        para: 'igsid-1',
        citando: 'mid-antiga',
        anexo: { tipo: 'file', url: 'https://x/contrato.pdf' },
      })
    ).toEqual({
      recipient: { id: 'igsid-1' },
      message: {
        attachment: {
          type: 'file',
          payload: { url: 'https://x/contrato.pdf' },
        },
      },
      reply_to: { mid: 'mid-antiga' },
    });
  });

  it('⚠️ 2xx sem `message_id` é "não sei" (status 200), nunca recusa', async () => {
    const { fetchFn } = capturando(200, { recipient_id: '1' });
    const erro = await criarClienteInstagram(TOKEN, fetchFn)
      .enviarMensagem({ para: 'x', texto: 'oi' })
      .catch((e) => e);
    expect(erro).toBeInstanceOf(InstagramApiError);
    expect(erro.status).toBe(200);
    expect(envioRecusado(erro)).toBe(false);
  });

  it('só o 4xx é recusa comprovada; rede e 5xx são "pode ter saído"', async () => {
    const recusa = await criarClienteInstagram(
      TOKEN,
      respondendo(400, { error: { message: 'bad', code: 100 } })
    )
      .enviarMensagem({ para: 'x', texto: 'oi' })
      .catch((e) => e);
    expect(envioRecusado(recusa)).toBe(true);
    const cincoxx = await criarClienteInstagram(TOKEN, respondendo(503, {}))
      .enviarMensagem({ para: 'x', texto: 'oi' })
      .catch((e) => e);
    expect(envioRecusado(cincoxx)).toBe(false);
    const rede = await criarClienteInstagram(TOKEN, (async () => {
      throw new Error('timeout');
    }) as unknown as typeof fetch)
      .enviarMensagem({ para: 'x', texto: 'oi' })
      .catch((e) => e);
    expect(rede.codigo).toBe('rede');
    expect(envioRecusado(rede)).toBe(false);
  });

  it('fora da janela (subcódigo 2534022) vira `janela_fechada`', async () => {
    const erro = await criarClienteInstagram(
      TOKEN,
      respondendo(400, {
        error: { message: 'outside', code: 10, error_subcode: 2534022 },
      })
    )
      .enviarMensagem({ para: 'x', texto: 'oi' })
      .catch((e) => e);
    expect(erro.codigo).toBe('janela_fechada');
  });
});

describe('renovarTokenLongo (Fase 6)', () => {
  it('GET em /refresh_access_token com o grant da doc; devolve o token novo e o prazo', async () => {
    let urlVista = '';
    let headers: Record<string, string> = {};
    const fetchFn = (async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      urlVista = String(url);
      headers = (init?.headers as Record<string, string>) ?? {};
      return new Response(
        JSON.stringify({
          access_token: 'IGAAnovo1234567890',
          token_type: 'bearer',
          expires_in: 5183944,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as unknown as typeof fetch;
    await expect(renovarTokenLongo(TOKEN, fetchFn)).resolves.toEqual({
      token: 'IGAAnovo1234567890',
      expiraEmSeg: 5183944,
    });
    const u = new URL(urlVista);
    expect(u.origin + u.pathname).toBe(
      'https://graph.instagram.com/refresh_access_token'
    );
    expect(u.searchParams.get('grant_type')).toBe('ig_refresh_token');
    // A exceção documentada: o token viaja na query (como a troca do login).
    expect(u.searchParams.get('access_token')).toBe(TOKEN);
    expect(headers.Authorization).toBeUndefined();
  });

  it('erro da Meta sai sem o token; resposta sem expires_in é erro', async () => {
    const erro = await renovarTokenLongo(
      TOKEN,
      respondendo200ComErro(400, {
        error: { message: `bad token ${TOKEN}`, code: 190 },
      })
    ).catch((e) => e);
    expect(erro.codigo).toBe('token_invalido');
    expect(erro.message).not.toContain(TOKEN);
    await expect(
      renovarTokenLongo(
        TOKEN,
        respondendo200ComErro(200, { access_token: 'x' })
      )
    ).rejects.toMatchObject({ codigo: 'meta_error' });
  });
});

/** Como `respondendo`, sem exigir o cabeçalho (a renovação vai pela query). */
function respondendo200ComErro(status: number, corpo: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}
