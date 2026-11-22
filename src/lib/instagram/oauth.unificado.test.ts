import { describe, expect, it } from 'vitest';

import { InstagramApiError } from './graph';
import { trocarCodigoUnificado, urlDeAutorizacaoUnificada } from './oauth';

// ============================================================
// O login unificado (1153). A URL espelha a que o PRÓPRIO painel da Meta
// gera (medida em 22/11/2026); a troca é uma só, com o App ID e o App Secret
// principais. Valores fictícios.
// ============================================================

const SEGREDO = 'segredoPrincipalFicticio0123456789';
const CODIGO = 'codigoFicticioDoLogin';

describe('urlDeAutorizacaoUnificada', () => {
  it('monta a URL do login unificado como o painel da Meta a gera', () => {
    const url = new URL(
      urlDeAutorizacaoUnificada({
        appId: '1000000000000001',
        configId: '2000000000000002',
        redirectUri: 'https://crm.exemplo.com/api/cb/instagram/oauth/callback',
        estado: 'estado.assinado',
      })
    );
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/dialog/oauth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '1000000000000001',
      config_id: '2000000000000002',
      redirect_uri: 'https://crm.exemplo.com/api/cb/instagram/oauth/callback',
      response_type: 'code',
      override_default_response_type: 'true',
      state: 'estado.assinado',
      prompt: 'login',
    });
    // As permissões são as da configuração: nada de `scope`.
    expect(url.searchParams.has('scope')).toBe(false);
  });
});

describe('trocarCodigoUnificado', () => {
  function respondendo(status: number, corpo: unknown, visto: { url?: string }): typeof fetch {
    return (async (url: string | URL | Request) => {
      visto.url = String(url);
      return new Response(JSON.stringify(corpo), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  }

  const args = {
    appId: '1000000000000001',
    appSecret: SEGREDO,
    redirectUri: 'https://crm.exemplo.com/api/cb/instagram/oauth/callback',
    code: CODIGO,
  };

  it('troca em graph.facebook.com/v27.0 com o App ID, o segredo, o retorno e o código', async () => {
    const visto: { url?: string } = {};
    const r = await trocarCodigoUnificado(
      args,
      respondendo(200, { access_token: 'EAAtokenFicticio', token_type: 'bearer' }, visto)
    );
    expect(r).toEqual({ token: 'EAAtokenFicticio', expiraEmSeg: null });
    const u = new URL(visto.url!);
    expect(u.origin + u.pathname).toBe('https://graph.facebook.com/v27.0/oauth/access_token');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: '1000000000000001',
      client_secret: SEGREDO,
      redirect_uri: args.redirectUri,
      code: CODIGO,
    });
  });

  it('prazo que a Meta manda é guardado; zero ou ausente é "não vence"', async () => {
    const visto = {};
    expect(
      await trocarCodigoUnificado(args, respondendo(200, { access_token: 'EAAx', expires_in: 5183944 }, visto))
    ).toEqual({ token: 'EAAx', expiraEmSeg: 5183944 });
    expect(
      await trocarCodigoUnificado(args, respondendo(200, { access_token: 'EAAx', expires_in: 0 }, visto))
    ).toEqual({ token: 'EAAx', expiraEmSeg: null });
  });

  it('erro da Meta sai sem o segredo e sem o código', async () => {
    const erro = await trocarCodigoUnificado(
      args,
      respondendo(
        400,
        { error: { code: 100, message: `Invalid code ${CODIGO} for client_secret=${SEGREDO}` } },
        {}
      )
    ).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(InstagramApiError);
    expect((erro as Error).message).not.toContain(SEGREDO);
    expect((erro as Error).message).not.toContain(CODIGO);
  });

  it('sem token, o erro lista os NOMES dos campos, nunca os valores', async () => {
    const erro = await trocarCodigoUnificado(
      args,
      respondendo(200, { token_type: 'bearer', outra_coisa: 'valor-secreto' }, {})
    ).catch((e: unknown) => e);
    expect((erro as Error).message).toContain('token_type, outra_coisa');
    expect((erro as Error).message).not.toContain('valor-secreto');
  });
});
