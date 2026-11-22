import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (v: string) => `cifrado:${v}`,
  decrypt: (v: string) => v.replace(/^cifrado:/, ''),
}));

import { chaveTemForma, segredoDoRepasse } from './chave';
import {
  CentralError,
  avisarDesconexao,
  estadoDoCliente,
  resgatarNaCentral,
  segredoDasEntregas,
  urlDeEntrar,
  type AmbienteDoCliente,
} from './cliente';
import { desligarDaCentral } from './desligar';

// ============================================================
// O cliente da central do Instagram (U-3): este CRM conecta pelo app da
// Atlas, como instância da central. As três variáveis, a ida à central, o
// resgate de servidor para servidor (a chave só no `Bearer`, sem seguir
// redirecionamento) e a saída da conexão. Valores fictícios.
// ============================================================

/** 43 caracteres base64url, a forma da chave que o cadastro gera. Fictícia. */
const CHAVE = 'ChaveFicticiaDaInstancia0123456789abcdefghi';
const INSTANCIA = '00000000-0000-4000-8000-0000000000a1';
const AMBIENTE: AmbienteDoCliente = {
  INSTAGRAM_CENTRAL_URL: 'https://central.exemplo.com.br',
  INSTAGRAM_CENTRAL_INSTANCIA: INSTANCIA,
  INSTAGRAM_CENTRAL_CHAVE: CHAVE,
};

function cliente() {
  const e = estadoDoCliente(AMBIENTE);
  if (!e.ligado || e.incompleto !== null) throw new Error('ambiente de teste incompleto');
  return e.cliente;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('as variáveis do cliente', () => {
  it('sem INSTAGRAM_CENTRAL_URL, desligado; com as três, ligado', () => {
    expect(estadoDoCliente({})).toEqual({ ligado: false });
    expect(cliente()).toEqual({ url: 'https://central.exemplo.com.br', instancia: INSTANCIA, chave: CHAVE });
  });

  it('sem argumento, lê as três do ambiente do processo', () => {
    vi.stubEnv('INSTAGRAM_CENTRAL_URL', '');
    expect(estadoDoCliente()).toEqual({ ligado: false });
    vi.stubEnv('INSTAGRAM_CENTRAL_URL', 'https://central.exemplo.com.br/');
    vi.stubEnv('INSTAGRAM_CENTRAL_INSTANCIA', INSTANCIA);
    vi.stubEnv('INSTAGRAM_CENTRAL_CHAVE', CHAVE);
    expect(estadoDoCliente()).toMatchObject({ ligado: true, incompleto: null });
  });

  it('pela metade: incompleto, nunca ligado — chave curta, instância que não é UUID, URL com caminho', () => {
    expect(estadoDoCliente({ ...AMBIENTE, INSTAGRAM_CENTRAL_CHAVE: CHAVE.slice(0, 10) })).toEqual({
      ligado: true,
      incompleto: ['INSTAGRAM_CENTRAL_CHAVE'],
    });
    expect(estadoDoCliente({ ...AMBIENTE, INSTAGRAM_CENTRAL_INSTANCIA: 'escritorio-1' })).toEqual({
      ligado: true,
      incompleto: ['INSTAGRAM_CENTRAL_INSTANCIA'],
    });
    expect(estadoDoCliente({ ...AMBIENTE, INSTAGRAM_CENTRAL_URL: 'https://central.exemplo.com.br/api' })).toEqual({
      ligado: true,
      incompleto: ['INSTAGRAM_CENTRAL_URL (https://host, sem caminho)'],
    });
    expect(estadoDoCliente({ ...AMBIENTE, INSTAGRAM_CENTRAL_URL: 'http://central.exemplo.com.br' })).toMatchObject({
      incompleto: ['INSTAGRAM_CENTRAL_URL (https://host, sem caminho)'],
    });
    expect(chaveTemForma(`${CHAVE}=`)).toBe(false);
  });

  it('o segredo das entregas é o HKDF da chave, igual ao da central (valor conhecido)', () => {
    // Calculado à parte pela RFC 5869 (HKDF-SHA256, salt vazio, info
    // `cb-ig-central-repasse`, 32 bytes). Mudar a derivação aqui sem mudar a
    // da central deixa toda entrega repassada em 401.
    expect(segredoDoRepasse(CHAVE)).toBe('d907aa3c7fe5376a5da61807de7217313fc7395b0db05c545046dea22e79c3fd');
    expect(segredoDasEntregas(cliente())).toBe(segredoDoRepasse(CHAVE));
    // Nunca a chave crua: a central não a guarda, só o hash.
    expect(segredoDasEntregas(cliente())).not.toContain(CHAVE);
  });
});

describe('a ida e a volta', () => {
  it('a URL de entrar leva a instância, o retorno e o state, e nunca a chave', () => {
    const u = new URL(
      urlDeEntrar(cliente(), {
        retorno: 'https://escritorio.exemplo.com.br/api/cb/instagram/oauth/callback',
        estado: 'estado.assinado',
      })
    );
    expect(u.origin + u.pathname).toBe('https://central.exemplo.com.br/api/cb/instagram/central/entrar');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      instancia: INSTANCIA,
      retorno: 'https://escritorio.exemplo.com.br/api/cb/instagram/oauth/callback',
      estado: 'estado.assinado',
    });
    expect(u.toString()).not.toContain(CHAVE);
  });

  function central(status: number, corpo: unknown) {
    const pedidos: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      return new Response(JSON.stringify(corpo), { status });
    }) as unknown as typeof fetch;
    return { fetchFn, pedidos };
  }

  it('o resgate: POST com a chave no Bearer, sem seguir redirecionamento; a resposta é conferida', async () => {
    const { fetchFn, pedidos } = central(200, {
      versao: 1,
      token: 'EAAtokenFicticio',
      expiraEmSeg: null,
      clientBusinessId: '300000000000003',
      contas: [{ igUserId: '17841400000000001', username: 'conta' }, { igUserId: 'nao-numerico' }],
      recusadas: ['@alheia'],
      falharam: [],
    });
    const r = await resgatarNaCentral(cliente(), 'a'.repeat(43), fetchFn);
    expect(pedidos[0].url).toBe('https://central.exemplo.com.br/api/cb/instagram/central/resgatar');
    expect(pedidos[0].init.method).toBe('POST');
    expect(pedidos[0].init.redirect).toBe('manual');
    expect((pedidos[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CHAVE}`);
    expect(JSON.parse(String(pedidos[0].init.body))).toEqual({ instancia: INSTANCIA, versao: 1, tiquete: 'a'.repeat(43) });
    // A chave nunca na URL (raiz, 8e).
    expect(pedidos[0].url).not.toContain(CHAVE);
    expect(r).toEqual({
      versao: 1,
      token: 'EAAtokenFicticio',
      expiraEmSeg: null,
      clientBusinessId: '300000000000003',
      contas: [{ igUserId: '17841400000000001', username: 'conta' }],
      recusadas: ['@alheia'],
      falharam: [],
    });
  });

  it('401, 404 e o resto viram CentralError com o código certo', async () => {
    for (const [status, codigo] of [
      [401, 'sem_acesso'],
      [404, 'tiquete_invalido'],
      [503, 'indisponivel'],
      [302, 'indisponivel'],
    ] as const) {
      const erro = await resgatarNaCentral(cliente(), 'x', central(status, {}).fetchFn).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(CentralError);
      expect((erro as CentralError).codigo).toBe(codigo);
    }
    const semToken = await resgatarNaCentral(cliente(), 'x', central(200, { contas: [] }).fetchFn).catch((e: unknown) => e);
    expect((semToken as CentralError).codigo).toBe('indisponivel');
    const quebrado = (async () => {
      throw new Error('rede caiu');
    }) as unknown as typeof fetch;
    const semRede = await resgatarNaCentral(cliente(), 'x', quebrado).catch((e: unknown) => e);
    expect((semRede as CentralError).codigo).toBe('indisponivel');
  });

  it('o aviso de desconexão nunca lança', async () => {
    const quebrado = (async () => {
      throw new Error('rede caiu');
    }) as unknown as typeof fetch;
    await expect(avisarDesconexao(cliente(), '17841400000000001', quebrado)).resolves.toBe(false);
    await expect(avisarDesconexao(cliente(), '17841400000000001', central(500, {}).fetchFn)).resolves.toBe(false);
    await expect(avisarDesconexao(cliente(), '17841400000000001', central(200, { removida: true }).fetchFn)).resolves.toBe(true);
  });
});

describe('a conexão pela central que sai do CRM', () => {
  it('tira a assinatura da conta com o token do escritório e avisa a central', async () => {
    const pedidos: { url: string; method: string; bearer: string; corpo: unknown }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      pedidos.push({
        url,
        method: init.method ?? 'GET',
        bearer: (init.headers as Record<string, string>).Authorization,
        corpo: init.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify(url.includes('graph.facebook.com') ? { success: true } : { removida: true }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    await desligarDaCentral(
      { access_token: 'cifrado:EAAtokenFicticio', ig_user_id: '17841400000000001' },
      { fetchFn, env: AMBIENTE }
    );
    expect(pedidos).toEqual([
      {
        url: 'https://graph.facebook.com/v27.0/17841400000000001/subscribed_apps',
        method: 'DELETE',
        bearer: 'Bearer EAAtokenFicticio',
        corpo: null,
      },
      {
        url: 'https://central.exemplo.com.br/api/cb/instagram/central/desconectar',
        method: 'POST',
        bearer: `Bearer ${CHAVE}`,
        corpo: { instancia: INSTANCIA, versao: 1, ig_user_id: '17841400000000001' },
      },
    ]);
  });

  it('a Meta que recusa não impede o aviso à central', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return url.includes('graph.facebook.com')
        ? new Response(JSON.stringify({ error: { code: 190, message: 'token' } }), { status: 401 })
        : new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await desligarDaCentral({ access_token: 'cifrado:x', ig_user_id: '17841400000000001' }, { fetchFn, env: AMBIENTE });
    expect(urls).toHaveLength(2);
  });

  it('sem a central no ambiente, só a assinatura sai (a rota fica lá, com aviso no log)', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as unknown as typeof fetch;
    await desligarDaCentral({ access_token: 'cifrado:x', ig_user_id: '17841400000000001' }, { fetchFn, env: {} });
    expect(urls).toEqual(['https://graph.facebook.com/v27.0/17841400000000001/subscribed_apps']);
  });
});
