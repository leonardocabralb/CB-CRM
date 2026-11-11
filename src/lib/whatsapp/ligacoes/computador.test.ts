import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  computadorDoCabecalho,
  computadorFora,
  computadorPronto,
  pedirAoComputador,
  segredoDoComputador,
  segredoDoCrm,
  veioPeloDominioPublico,
} from './computador';

// O computador de ligações visto do CRM (1134). Valores fictícios.

const SEGREDO = 'segredo-do-crm-de-teste-com-mais-de-32-caracteres';
const AGORA = Date.parse('2026-11-10T20:00:00.000Z');

afterEach(() => vi.unstubAllEnvs());

describe('o segredo é POR computador', () => {
  it('HMAC-SHA256 do segredo do CRM com o nome, em hex (a receita que a VPS repete com openssl)', () => {
    const esperado = createHmac('sha256', SEGREDO).update('previdenciario').digest('hex');
    expect(segredoDoComputador(SEGREDO, 'previdenciario')).toBe(esperado);
    expect(esperado).toMatch(/^[0-9a-f]{64}$/);
    expect(segredoDoComputador(SEGREDO, 'outro')).not.toBe(esperado);
  });

  it('o segredo do CRM curto demais conta como "não configurado"', () => {
    vi.stubEnv('LIGACOES_SEGREDO', 'curto');
    expect(segredoDoCrm()).toBeNull();
    vi.stubEnv('LIGACOES_SEGREDO', `  ${SEGREDO}  `);
    expect(segredoDoCrm()).toBe(SEGREDO);
  });

  it('quem fala com o CRM é o computador cujo segredo está no cabeçalho — e só ele', () => {
    const lista = [{ nome: 'a' }, { nome: 'b' }];
    const deB = `Bearer ${segredoDoComputador(SEGREDO, 'b')}`;
    expect(computadorDoCabecalho(deB, lista, SEGREDO)).toEqual({ nome: 'b' });
    // O segredo do CRM não é o de computador nenhum.
    expect(computadorDoCabecalho(`Bearer ${SEGREDO}`, lista, SEGREDO)).toBeNull();
    expect(computadorDoCabecalho(segredoDoComputador(SEGREDO, 'b'), lista, SEGREDO)).toBeNull();
    expect(computadorDoCabecalho(null, lista, SEGREDO)).toBeNull();
    expect(computadorDoCabecalho(deB, [], SEGREDO)).toBeNull();
  });
});

describe('pronto para ligar', () => {
  it('só com sinal de menos de 3 min E o WhatsApp conectado', () => {
    const recente = new Date(AGORA - 60_000).toISOString();
    const velho = new Date(AGORA - 3 * 60_000 - 1).toISOString();
    expect(computadorPronto({ whatsapp: 'conectado', ultimo_sinal_em: recente }, AGORA)).toBe(true);
    expect(computadorPronto({ whatsapp: 'qr', ultimo_sinal_em: recente }, AGORA)).toBe(false);
    expect(computadorPronto({ whatsapp: 'conectado', ultimo_sinal_em: velho }, AGORA)).toBe(false);
    expect(computadorFora({ ultimo_sinal_em: null }, AGORA)).toBe(true);
  });
});

describe('as rotas da máquina são da rede interna', () => {
  const pedido = (host: string) => new Request('http://qualquer/api/cb/ligacoes/eventos', { headers: { host } });

  it('o pedido pelo domínio público do site é recusado; pelo nome interno, não', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.exemplo.com/');
    expect(veioPeloDominioPublico(pedido('crm.exemplo.com'))).toBe(true);
    expect(veioPeloDominioPublico(pedido('CRM.EXEMPLO.COM'))).toBe(true);
    expect(veioPeloDominioPublico(pedido('crm_crm:3000'))).toBe(false);
  });

  it('sem o endereço do site configurado, não há o que comparar (o segredo segue sendo a tranca)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(veioPeloDominioPublico(pedido('crm.exemplo.com'))).toBe(false);
  });
});

describe('pedirAoComputador', () => {
  const computador = { nome: 'teste', endereco: 'http://ligacoes-teste:8080' };
  const responde = (status: number, corpo: string) =>
    (async () => new Response(corpo, { status })) as unknown as typeof fetch;

  it('2xx devolve o corpo; a recusa traz o código da máquina; corpo estranho vira o status', async () => {
    expect(await pedirAoComputador(computador, SEGREDO, '/ligar', {}, responde(200, '{"resposta":"v=0 x"}'))).toEqual({
      ok: true,
      corpo: { resposta: 'v=0 x' },
    });
    expect(await pedirAoComputador(computador, SEGREDO, '/ligar', {}, responde(409, '{"erro":"ocupada"}'))).toEqual({
      ok: false,
      status: 409,
      erro: 'ocupada',
    });
    expect(await pedirAoComputador(computador, SEGREDO, '/ligar', {}, responde(502, '<html>'))).toEqual({
      ok: false,
      status: 502,
      erro: 'http_502',
    });
    expect(
      await pedirAoComputador(computador, SEGREDO, '/ligar', {}, responde(400, '{"erro":"<script>"}')),
    ).toEqual({ ok: false, status: 400, erro: 'http_400' });
  });

  it('sem resposta (rede, prazo): status nulo, nunca lança', async () => {
    const cai = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await pedirAoComputador(computador, SEGREDO, '/desligar', {}, cai)).toEqual({
      ok: false,
      status: null,
      erro: 'sem_resposta',
    });
  });

  it('não segue redirecionamento e manda o segredo DO computador', async () => {
    let visto: RequestInit | undefined;
    const espia = (async (_url: string, init?: RequestInit) => {
      visto = init;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await pedirAoComputador(computador, SEGREDO, '/atender', { a: 1 }, espia);
    expect(visto?.redirect).toBe('manual');
    expect(new Headers(visto?.headers).get('authorization')).toBe(`Bearer ${segredoDoComputador(SEGREDO, 'teste')}`);
  });
});
