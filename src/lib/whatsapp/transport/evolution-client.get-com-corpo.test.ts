import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ============================================================
// `findGroupInfos` manda o GET COM CORPO (29/10/2026): a Evolution 2.4 roda no
// Express 5, que deixa `req.body` indefinido num pedido sem corpo, e a rota de
// grupo faz `Object.assign(body, …)` em cima dele — sem corpo, todo grupo
// respondia "Cannot convert undefined or null to object". Servidor local,
// jid e chave fictícios.
// ============================================================

import { EvolutionApiError, EvolutionClient } from './evolution-client';

const h = {
  pedido: null as null | { metodo?: string; url?: string; headers: http.IncomingHttpHeaders; corpo: string },
  resposta: { status: 200, corpo: '{"id":"1@g.us","participants":[]}' },
};

let servidor: http.Server;
let base = '';

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      h.pedido = { metodo: req.method, url: req.url, headers: req.headers, corpo };
      res.statusCode = h.resposta.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(h.resposta.corpo);
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));
beforeEach(() => {
  h.pedido = null;
  h.resposta = { status: 200, corpo: '{"id":"1@g.us","participants":[]}' };
});

const cliente = () => new EvolutionClient({ baseUrl: base, instance: 'cbcrm-teste', apikey: 'chave-de-teste' });

describe('findGroupInfos: GET com corpo', () => {
  it('manda GET com o groupJid no CORPO (e na query), com a chave no cabeçalho', async () => {
    const r = await cliente().findGroupInfos('120363000000000001@g.us');
    expect(r).toEqual({ id: '1@g.us', participants: [] });
    expect(h.pedido?.metodo).toBe('GET');
    expect(h.pedido?.url).toBe('/group/findGroupInfos/cbcrm-teste?groupJid=120363000000000001%40g.us');
    expect(JSON.parse(h.pedido?.corpo ?? 'null')).toEqual({ groupJid: '120363000000000001@g.us' });
    expect(h.pedido?.headers['content-type']).toBe('application/json');
    expect(h.pedido?.headers['content-length']).toBe(String(h.pedido?.corpo.length));
    expect(h.pedido?.headers.apikey).toBe('chave-de-teste');
  });

  it('erro da Evolution vira EvolutionApiError com o status e a mensagem dela', async () => {
    h.resposta = {
      status: 404,
      corpo: JSON.stringify({ status: 404, error: 'Not Found', response: { message: ['Error fetching group'] } }),
    };
    const erro = await cliente().findGroupInfos('120363000000000001@g.us').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(EvolutionApiError);
    expect((erro as EvolutionApiError).message).toContain('Error fetching group');
  });
});
