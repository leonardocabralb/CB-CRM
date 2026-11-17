import { describe, expect, it, vi } from 'vitest';

import { BATCH_SEND_ATTEMPTS } from '@/lib/broadcast-retry';
import { enviarLoteComPosse, type InterrupcaoDoEnvio } from './use-broadcast-sending';

// ============================================================
// NOSSO (posse do envio, 1147): o assistente só manda um lote com a POSSE.
// Antes, a tela da campanha oferecia o Retomar enquanto o assistente ainda
// mandava do navegador, e a retomada mandava os mesmos pendentes pelo
// servidor — o modelo PAGO em dobro.
//
// O que este arquivo segura: sem posse, NENHUM envio a mais, nada a gravar
// (o lote fica `pending` para quem assumiu) e nada é repetido.
// ============================================================

function resposta(status: number, corpo: unknown, retryAfter?: string): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: retryAfter ? { 'Retry-After': retryAfter } : {},
  });
}

const OK = { success: true, results: [{ phone: '5583980000016', status: 'sent', recipient_id: 'r1' }] };

function posseQueResponde(...respostas: (InterrupcaoDoEnvio | null)[]) {
  return vi.fn(async () => (respostas.length ? respostas.shift()! : null));
}

const semEspera = vi.fn(async () => undefined);

describe('enviarLoteComPosse', () => {
  it('com a posse: envia uma vez e devolve o que a rota respondeu', async () => {
    const enviar = vi.fn(async () => resposta(200, OK));
    const manterPosse = posseQueResponde(null);

    const lote = await enviarLoteComPosse(enviar, manterPosse, semEspera);

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(manterPosse).toHaveBeenCalledTimes(1);
    expect(lote).toEqual({ desfecho: { resultados: OK.results } });
  });

  it('⚠️⚠️ posse perdida ANTES do lote: nenhum envio, e a parada sobe (nada a gravar)', async () => {
    const enviar = vi.fn(async () => resposta(200, OK));

    const lote = await enviarLoteComPosse(enviar, posseQueResponde('posse_perdida'), semEspera);

    expect(enviar).not.toHaveBeenCalled();
    expect(lote).toEqual({ interrupcao: 'posse_perdida' });
  });

  it('posse incerta (a conexão caiu) também PARA antes de enviar', async () => {
    const enviar = vi.fn(async () => resposta(200, OK));
    const lote = await enviarLoteComPosse(enviar, posseQueResponde('posse_incerta'), semEspera);
    expect(enviar).not.toHaveBeenCalled();
    expect(lote).toEqual({ interrupcao: 'posse_incerta' });
  });

  it('⚠️⚠️ 429 e a posse perdida na espera: o lote (recusado) NÃO é repetido', async () => {
    const enviar = vi.fn(async () => resposta(429, { error: 'Too many requests' }, '30'));
    const esperas: number[] = [];

    const lote = await enviarLoteComPosse(
      enviar,
      posseQueResponde(null, 'posse_perdida'),
      async (ms) => {
        esperas.push(ms);
      },
    );

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(esperas).toEqual([30_000]);
    expect(lote).toEqual({ interrupcao: 'posse_perdida' });
  });

  it('429 com a posse renovada na espera: repete o lote (o 429 garante que nada saiu)', async () => {
    const enviar = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(resposta(429, { error: 'Too many requests' }))
      .mockResolvedValueOnce(resposta(200, OK));
    const manterPosse = posseQueResponde(null, null);

    const lote = await enviarLoteComPosse(enviar, manterPosse, semEspera);

    expect(enviar).toHaveBeenCalledTimes(2);
    expect(manterPosse).toHaveBeenCalledTimes(2);
    expect(lote).toEqual({ desfecho: { resultados: OK.results } });
  });

  it('429 em todas as tentativas: o lote vira erro, sem passar do teto de tentativas', async () => {
    const enviar = vi.fn(async () => resposta(429, { error: 'Too many requests' }));
    const lote = await enviarLoteComPosse(enviar, posseQueResponde(), semEspera);
    expect(enviar).toHaveBeenCalledTimes(BATCH_SEND_ATTEMPTS);
    expect(lote).toEqual({ desfecho: { erro: 'Too many requests' } });
  });

  it('500 (pode ter saído): não repete, vira o erro do lote como antes', async () => {
    const enviar = vi.fn(async () => resposta(500, { error: 'boom' }));
    const lote = await enviarLoteComPosse(enviar, posseQueResponde(null), semEspera);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(lote).toEqual({ desfecho: { erro: 'boom' } });
  });

  it('a conexão caiu no meio do lote: erro do lote (a gravação decide pelo que a rota anotou)', async () => {
    const enviar = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const lote = await enviarLoteComPosse(enviar, posseQueResponde(null), semEspera);
    expect(lote).toEqual({ desfecho: { erro: 'Failed to fetch' } });
  });
});
