import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// O segredo "decifrado" é o próprio texto, menos o que diz ser ilegível.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => {
    if (s === 'cifra-quebrada') throw new Error('Unsupported state or unable to authenticate data');
    return s;
  },
  encrypt: (s: string) => s,
}));

vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async () => true),
}));

import {
  CABECALHO_ASSINATURA,
  CABECALHO_ENDPOINT,
  CABECALHO_EVENTO,
} from './deliver';
import { ehTextual, enviarTeste } from './enviar-teste';
import { DEAL_WEBHOOK_EVENTS, WEBHOOK_EVENTS } from './events';
import { exemploDoEvento } from './exemplos';
import { TETO_DO_TRECHO } from './resultado-do-teste';
import { verifySignatureHeader } from './sign';
import { isDeliverableUrl } from './ssrf';

// ============================================================
// Dados FICTÍCIOS. O `fetch` é falso: nada sai da máquina.
// ============================================================

const CONTA = '00000000-0000-4000-8000-00000000c0a7';
const ENDPOINT = { id: 'ep-1', url: 'https://n8n.exemplo.com.br/webhook/crm', secret: 'segredo-do-endpoint' };

/** Resposta SEM corpo (o status é o que importa nestes casos). */
function respostaFalsa(status: number, extra: Partial<Response> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    body: null,
    ...extra,
  } as Response;
}

/** Uma resposta de verdade (`Response` do runtime), com corpo. */
function respostaCom(
  status: number,
  corpo: BodyInit,
  contentType: string | null = 'text/plain; charset=utf-8'
): Response {
  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  return new Response(corpo, { status, headers });
}

beforeEach(() => {
  vi.mocked(isDeliverableUrl).mockResolvedValue(true);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('enviarTeste', () => {
  it('2xx: ok, com o status e o tempo (sem corpo = trecho vazio)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaFalsa(204)));
    const r = await enviarTeste(ENDPOINT, 'deal.stage_changed', CONTA);
    expect(r).toEqual({
      ok: true,
      status: 204,
      ms: expect.any(Number),
      resposta: { corpo: '', cortado: false },
    });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('o corpo é o envelope de EXEMPLO, marcado como teste, da conta de quem clicou', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFalsa(200));
    vi.stubGlobal('fetch', fetchMock);
    await enviarTeste(ENDPOINT, 'deal.stage_changed', CONTA);

    const [url, pedido] = fetchMock.mock.calls[0];
    expect(url).toBe(ENDPOINT.url);
    const corpo = JSON.parse(pedido.body);
    expect(corpo).toMatchObject({
      event: 'deal.stage_changed',
      account_id: CONTA,
      test: true,
      // O exemplo inteiro, MENOS o fato (id e hora), que é deste envelope —
      // ver o teste da invariante abaixo.
      data: { ...exemploDoEvento('deal.stage_changed'), event_id: corpo.id, occurred_at: corpo.occurred_at },
    });
    expect(corpo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(corpo.occurred_at))).toBe(false);
  });

  // ⚠️ A invariante que a entrega real cumpre (o id e o `criado_em` da linha
  // da fila vão aos dois lados) e que o teste quebrava: `id` novo no envelope
  // e o `event_id` FIXO do exemplo no `data`. Quem deduplica por
  // `data.event_id` engolia todo teste depois do primeiro.
  it.each(DEAL_WEBHOOK_EVENTS)(
    '%s: id e hora do envelope são os MESMOS do `data` (event_id / occurred_at)',
    async (evento) => {
      const fetchMock = vi.fn().mockResolvedValue(respostaFalsa(200));
      vi.stubGlobal('fetch', fetchMock);
      await enviarTeste(ENDPOINT, evento, CONTA);
      await enviarTeste(ENDPOINT, evento, CONTA);

      const [a, b] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
      for (const corpo of [a, b]) {
        expect(corpo.data.event_id).toBe(corpo.id);
        expect(corpo.data.occurred_at).toBe(corpo.occurred_at);
      }
      // …e o `event_id` muda a cada clique, junto com o `id`.
      expect(a.data.event_id).not.toBe(b.data.event_id);
    }
  );

  it('evento de mensagem (sem event_id no data) sai com o exemplo intacto', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFalsa(200));
    vi.stubGlobal('fetch', fetchMock);
    await enviarTeste(ENDPOINT, 'message.received', CONTA);
    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corpo.data).toEqual(exemploDoEvento('message.received'));
    expect(corpo.data).not.toHaveProperty('event_id');
  });

  it('id NOVO a cada clique — quem deduplica não engole o segundo teste', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFalsa(200));
    vi.stubGlobal('fetch', fetchMock);
    await enviarTeste(ENDPOINT, 'deal.created', CONTA);
    await enviarTeste(ENDPOINT, 'deal.created', CONTA);
    const [a, b] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).id);
    expect(a).not.toBe(b);
  });

  it('a assinatura confere sobre o corpo ENVIADO, com os cabeçalhos da entrega real', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFalsa(200));
    vi.stubGlobal('fetch', fetchMock);
    await enviarTeste(ENDPOINT, 'message.received', CONTA);

    const pedido = fetchMock.mock.calls[0][1];
    expect(pedido.method).toBe('POST');
    expect(pedido.redirect).toBe('manual');
    expect(pedido.signal).toBeInstanceOf(AbortSignal);
    expect(pedido.headers[CABECALHO_EVENTO]).toBe('message.received');
    expect(pedido.headers[CABECALHO_ENDPOINT]).toBe('ep-1');
    expect(
      verifySignatureHeader(
        pedido.headers[CABECALHO_ASSINATURA],
        pedido.body,
        ENDPOINT.secret,
        Math.floor(Date.now() / 1000)
      )
    ).toBe(true);
    // E NÃO confere com outro segredo — a assinatura prova alguma coisa.
    expect(
      verifySignatureHeader(pedido.headers[CABECALHO_ASSINATURA], pedido.body, 'outro', Math.floor(Date.now() / 1000))
    ).toBe(false);
  });

  it('4xx/5xx: motivo http, com o status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaFalsa(404)));
    expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).toMatchObject({
      ok: false,
      status: 404,
      motivo: 'http',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaFalsa(502)));
    expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).toMatchObject({
      ok: false,
      status: 502,
      motivo: 'http',
    });
  });

  it('3xx: redirecionamento — a entrega não segue redirecionamento, o teste também não aprova', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaFalsa(301)));
    expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).toMatchObject({
      ok: false,
      status: 301,
      motivo: 'redirecionamento',
    });
  });

  it('3xx opaco (status 0, forma do navegador): redirecionamento com status null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaFalsa(0, { type: 'opaqueredirect' })));
    expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).toMatchObject({
      ok: false,
      status: null,
      motivo: 'redirecionamento',
    });
  });

  it('sem resposta no prazo: motivo tempo', async () => {
    const estouro = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(estouro));
    expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).toMatchObject({
      ok: false,
      status: null,
      motivo: 'tempo',
    });
  });

  it('falha de conexão: motivo rede', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).toMatchObject({
      ok: false,
      status: null,
      motivo: 'rede',
    });
  });

  it('endereço que o guarda de SSRF recusa: nem tenta', async () => {
    vi.mocked(isDeliverableUrl).mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await enviarTeste({ ...ENDPOINT, url: 'https://10.0.0.5/hook' }, 'deal.created', CONTA)
    ).toMatchObject({ ok: false, status: null, motivo: 'endereco_bloqueado' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('segredo que não decifra: nem tenta — nenhuma entrega real sairia assinada', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await enviarTeste({ ...ENDPOINT, secret: 'cifra-quebrada' }, 'deal.created', CONTA)
    ).toMatchObject({ ok: false, status: null, motivo: 'segredo_ilegivel' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('o que o endereço respondeu (o trecho do corpo)', () => {
    it('⚠️ 404 com corpo de texto: motivo http E o corpo exato — é ele que diz o porquê', async () => {
      const corpo =
        '{"code":404,"message":"The requested webhook \\"POST crm\\" is not registered.","hint":"Click the \'Execute workflow\' button"}';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaCom(404, corpo, 'application/json')));
      expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).toEqual({
        ok: false,
        status: 404,
        motivo: 'http',
        ms: expect.any(Number),
        resposta: { corpo, cortado: false },
      });
    });

    it('2xx com JSON: o corpo sai junto do "entregue"', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(respostaCom(200, '{"message":"Workflow was started"}', 'application/json; charset=utf-8'))
      );
      expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).toMatchObject({
        ok: true,
        status: 200,
        resposta: { corpo: '{"message":"Workflow was started"}', cortado: false },
      });
    });

    it('3xx também leva o trecho (a página para onde ele mandaria)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaCom(302, 'Found. Redirecting to /login', 'text/html')));
      expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).toMatchObject({
        ok: false,
        status: 302,
        motivo: 'redirecionamento',
        resposta: { corpo: 'Found. Redirecting to /login', cortado: false },
      });
    });

    it('sem content-type conta como texto (é o caso comum)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaCom(200, 'ok', null)));
      expect((await enviarTeste(ENDPOINT, 'deal.created', CONTA)).resposta).toEqual({
        corpo: 'ok',
        cortado: false,
      });
    });

    it('⚠️ corpo de 10 KB: só os primeiros 2048 bytes, "cortado", e o resto é SOLTO (cancel)', async () => {
      let entregues = 0;
      let cancelado = false;
      const fluxo = new ReadableStream<Uint8Array>({
        pull(c) {
          if (entregues < 10) {
            entregues++;
            c.enqueue(new Uint8Array(1024).fill(0x61)); // "a"
          } else {
            c.close();
          }
        },
        cancel() {
          cancelado = true;
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaCom(500, fluxo)));
      const r = await enviarTeste(ENDPOINT, 'deal.created', CONTA);
      expect(r).toMatchObject({ ok: false, status: 500, motivo: 'http' });
      expect(r.resposta).toEqual({ corpo: 'a'.repeat(TETO_DO_TRECHO), cortado: true });
      expect(cancelado).toBe(true);
      // Leu UM pedaço além do teto (para saber que passava), nunca os dez.
      expect(entregues).toBeLessThan(10);
    });

    it('corpo de EXATAMENTE o teto não é "cortado"', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaCom(200, 'b'.repeat(TETO_DO_TRECHO))));
      expect((await enviarTeste(ENDPOINT, 'deal.created', CONTA)).resposta).toEqual({
        corpo: 'b'.repeat(TETO_DO_TRECHO),
        cortado: false,
      });
    });

    it('o caractere multibyte partido no teto fica de fora, sem "�" no fim', async () => {
      // 2047 "a" + "é" (2 bytes): o teto cai no meio do "é".
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaCom(200, 'a'.repeat(TETO_DO_TRECHO - 1) + 'é' + 'z'.repeat(50))));
      const r = await enviarTeste(ENDPOINT, 'deal.created', CONTA);
      expect(r.resposta).toEqual({ corpo: 'a'.repeat(TETO_DO_TRECHO - 1), cortado: true });
    });

    it('⚠️ corpo que quebra DEPOIS dos cabeçalhos: vale o status, sem trecho', async () => {
      const fluxo = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('começo'));
        },
        pull(c) {
          c.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaCom(200, fluxo)));
      // O 2xx continua "entregue" — nunca "tempo": quem decide é o status,
      // como na entrega real.
      expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).toEqual({
        ok: true,
        status: 200,
        ms: expect.any(Number),
        resposta: null,
      });
    });

    it('content-type binário: nada é decodificado, e o corpo é solto', async () => {
      let cancelado = false;
      const fluxo = new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
        },
        cancel() {
          cancelado = true;
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respostaCom(200, fluxo, 'application/pdf')));
      expect((await enviarTeste(ENDPOINT, 'deal.created', CONTA)).resposta).toEqual({
        corpo: null,
        cortado: false,
        binario: true,
      });
      expect(cancelado).toBe(true);
    });

    it('⚠️ planilha (xlsx) tem "xml" no content-type e é binário: omitida, nunca decodificada', async () => {
      const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(respostaCom(200, new Uint8Array([0x50, 0x4b, 0x03, 0x04]), xlsx))
      );
      expect((await enviarTeste(ENDPOINT, 'deal.created', CONTA)).resposta).toEqual({
        corpo: null,
        cortado: false,
        binario: true,
      });
    });

    it.each([
      ['text/plain; charset=utf-8', true],
      ['text/html', true],
      ['application/json', true],
      ['application/problem+json', true],
      ['application/xml', true],
      ['application/xhtml+xml', true],
      ['TEXT/CSV', true],
      [null, true],
      ['', true],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', false],
      ['application/pdf', false],
      ['application/octet-stream', false],
      ['image/png', false],
      ['application/jsonp-archive', false],
    ])('ehTextual(%j) = %s', (tipo, esperado) => {
      expect(ehTextual(tipo)).toBe(esperado);
    });

    it('caracteres de controle saem; quebra de linha e tabulação ficam', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(respostaCom(400, 'linha 1\r\n\tlinha 2\u0000\u001b[31m\u0007fim\u009b'))
      );
      expect((await enviarTeste(ENDPOINT, 'deal.created', CONTA)).resposta).toEqual({
        corpo: 'linha 1\n\tlinha 2[31mfim',
        cortado: false,
      });
    });

    it('tempo, rede, endereço bloqueado e segredo ilegível não levam trecho', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
      expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).not.toHaveProperty('resposta');
      vi.mocked(isDeliverableUrl).mockResolvedValue(false);
      expect(await enviarTeste(ENDPOINT, 'deal.created', CONTA)).not.toHaveProperty('resposta');
    });
  });

  it.each(WEBHOOK_EVENTS)('tem exemplo para %s (todo evento assinável é testável)', async (evento) => {
    const fetchMock = vi.fn().mockResolvedValue(respostaFalsa(200));
    vi.stubGlobal('fetch', fetchMock);
    expect((await enviarTeste(ENDPOINT, evento, CONTA)).ok).toBe(true);
    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(corpo.event).toBe(evento);
    expect(corpo.data).toBeTruthy();
  });
});
