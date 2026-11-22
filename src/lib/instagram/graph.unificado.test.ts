import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  InstagramApiError,
  contaDaConexao,
  criarClienteInstagram,
  doGraphDoFacebook,
  lerContasDoToken,
} from './graph';

// ============================================================
// O login unificado (1153): host graph.facebook.com na v27.0, token do
// usuário do sistema no `Bearer`, e o ID da CONTA no caminho de cada chamada
// (o `/me` dali é o usuário do sistema, não a conta). Valores fictícios.
// ============================================================

const TOKEN = 'EAAFicticioTokenDoUsuarioDoSistema123';
const CONTA = '17841400000000001';

interface Pedido {
  url: string;
  method: string;
  corpo: unknown;
}

function gravando(respostas: unknown[]): { fetchFn: typeof fetch; pedidos: Pedido[] } {
  const pedidos: Pedido[] = [];
  const fila = [...respostas];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).not.toContain(TOKEN);
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    pedidos.push({
      url: String(url),
      method: init?.method ?? 'GET',
      corpo: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = fila.shift();
    const status = (r as { __status?: number })?.__status ?? 200;
    return new Response(JSON.stringify(r), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, pedidos };
}

afterEach(() => vi.restoreAllMocks());

describe('doGraphDoFacebook', () => {
  it('aceita só o host do login unificado, por HTTPS', () => {
    expect(doGraphDoFacebook('https://graph.facebook.com/v27.0/me')).toBe(true);
    expect(doGraphDoFacebook('http://graph.facebook.com/v27.0/me')).toBe(false);
    expect(doGraphDoFacebook('https://graph.instagram.com/v27.0/me')).toBe(false);
    expect(doGraphDoFacebook('https://graph.facebook.com.evil.com/x')).toBe(false);
    expect(doGraphDoFacebook('não é url')).toBe(false);
  });
});

describe('contaDaConexao', () => {
  it('login do Instagram (e linha anterior à 1153) fala como hoje', () => {
    expect(contaDaConexao({ ig_login: 'instagram', ig_user_id: CONTA })).toEqual({ login: 'instagram' });
    expect(contaDaConexao({ ig_login: null, ig_user_id: CONTA })).toEqual({ login: 'instagram' });
  });

  it('unificado e central levam o ID da conta', () => {
    expect(contaDaConexao({ ig_login: 'unificado', ig_user_id: CONTA })).toEqual({
      login: 'unificado',
      igUserId: CONTA,
    });
    expect(contaDaConexao({ ig_login: 'central', ig_user_id: CONTA })).toEqual({
      login: 'unificado',
      igUserId: CONTA,
    });
  });

  it('unificado sem o ID da conta é erro, nunca o host do Instagram', () => {
    expect(() => contaDaConexao({ ig_login: 'unificado', ig_user_id: null })).toThrow(InstagramApiError);
  });
});

describe('criarClienteInstagram no login unificado', () => {
  const conta = { login: 'unificado' as const, igUserId: CONTA };

  it('envia por graph.facebook.com/v27.0/{conta}/messages, com o mesmo corpo', async () => {
    const { fetchFn, pedidos } = gravando([{ recipient_id: '1', message_id: 'mid.novo' }]);
    const r = await criarClienteInstagram(TOKEN, fetchFn, conta).enviarMensagem({
      para: '9988776655443322',
      texto: 'Olá',
    });
    expect(r).toEqual({ messageId: 'mid.novo' });
    expect(pedidos[0].url).toBe(`https://graph.facebook.com/v27.0/${CONTA}/messages`);
    expect(pedidos[0].method).toBe('POST');
    expect(pedidos[0].corpo).toEqual({ recipient: { id: '9988776655443322' }, message: { text: 'Olá' } });
  });

  it('o "quem é a conta" pergunta pelo nó da conta, não pelo /me', async () => {
    const { fetchFn, pedidos } = gravando([{ id: CONTA, username: 'escritorio_ficticio', name: 'Escritório' }]);
    const perfil = await criarClienteInstagram(TOKEN, fetchFn, conta).me();
    expect(perfil).toEqual({ igUserId: CONTA, username: 'escritorio_ficticio', nome: 'Escritório' });
    expect(pedidos[0].url).toBe(`https://graph.facebook.com/v27.0/${CONTA}?fields=id,username,name`);
  });

  it('assina os webhooks na conta', async () => {
    const { fetchFn, pedidos } = gravando([{ success: true }]);
    await criarClienteInstagram(TOKEN, fetchFn, conta).assinarWebhooks(['messages', 'message_edit']);
    expect(pedidos[0].url).toBe(
      `https://graph.facebook.com/v27.0/${CONTA}/subscribed_apps?subscribed_fields=messages%2Cmessage_edit`
    );
    expect(pedidos[0].method).toBe('POST');
  });

  it('tira os webhooks da conta (a conexão pela central que sai, U-3); sem `success`, é erro', async () => {
    const { fetchFn, pedidos } = gravando([{ success: true }, {}]);
    await criarClienteInstagram(TOKEN, fetchFn, conta).tirarWebhooks();
    expect(pedidos[0].url).toBe(`https://graph.facebook.com/v27.0/${CONTA}/subscribed_apps`);
    expect(pedidos[0].method).toBe('DELETE');
    await expect(criarClienteInstagram(TOKEN, fetchFn, conta).tirarWebhooks()).rejects.toBeInstanceOf(
      InstagramApiError
    );
  });

  it('o perfil do cliente sai do mesmo host', async () => {
    const { fetchFn, pedidos } = gravando([{ name: 'Maria', username: 'maria', profile_pic: 'https://x/y.jpg' }]);
    await criarClienteInstagram(TOKEN, fetchFn, conta).perfil('9988776655443322');
    expect(pedidos[0].url).toBe(
      'https://graph.facebook.com/v27.0/9988776655443322?fields=name,username,profile_pic'
    );
  });

  it('sem conta, o cliente segue no login do Instagram (me/messages em graph.instagram.com)', async () => {
    const { fetchFn, pedidos } = gravando([{ message_id: 'mid.1' }]);
    await criarClienteInstagram(TOKEN, fetchFn).enviarMensagem({ para: '1', texto: 'x' });
    expect(pedidos[0].url).toBe('https://graph.instagram.com/v26.0/me/messages');
  });

  it('o 190 da Meta vira token_invalido, sem o token na mensagem', async () => {
    const { fetchFn } = gravando([
      { __status: 401, error: { code: 190, message: `Malformed access token ${TOKEN}` } },
    ]);
    const erro = await criarClienteInstagram(TOKEN, fetchFn, conta)
      .me()
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(InstagramApiError);
    expect((erro as InstagramApiError).codigo).toBe('token_invalido');
    expect((erro as InstagramApiError).message).not.toContain(TOKEN);
  });
});

describe('lerContasDoToken', () => {
  it('lê o portfólio e as contas compartilhadas no login', async () => {
    const { fetchFn, pedidos } = gravando([
      { client_business_id: '100000000000001', id: 'app-scoped' },
      {
        data: [
          { id: CONTA, username: 'escritorio_ficticio' },
          { id: '17841400000000002', username: 'outra_conta_ficticia' },
        ],
      },
    ]);
    const r = await lerContasDoToken(TOKEN, fetchFn);
    expect(r).toEqual({
      clientBusinessId: '100000000000001',
      contas: [
        { igUserId: CONTA, username: 'escritorio_ficticio' },
        { igUserId: '17841400000000002', username: 'outra_conta_ficticia' },
      ],
    });
    expect(pedidos.map((p) => p.url)).toEqual([
      'https://graph.facebook.com/v27.0/me?fields=client_business_id',
      'https://graph.facebook.com/v27.0/me/assigned_instagram_accounts?fields=id,username&limit=100',
    ]);
  });

  it('id que não é texto fica fora (como número JSON perderia dígitos)', async () => {
    const { fetchFn } = gravando([{}, { data: [{ id: 17841400000000001, username: 'x' }, { username: 'sem_id' }] }]);
    const r = await lerContasDoToken(TOKEN, fetchFn);
    expect(r).toEqual({ clientBusinessId: null, contas: [] });
  });

  it('não segue o `next` da paginação (URL vinda da resposta): só registra', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetchFn, pedidos } = gravando([
      { client_business_id: '1' },
      { data: [{ id: CONTA }], paging: { next: 'https://graph.facebook.com.evil.com/pagina2' } },
    ]);
    const r = await lerContasDoToken(TOKEN, fetchFn);
    expect(r.contas).toEqual([{ igUserId: CONTA, username: null }]);
    expect(pedidos).toHaveLength(2);
    expect(aviso).toHaveBeenCalledTimes(1);
  });
});
