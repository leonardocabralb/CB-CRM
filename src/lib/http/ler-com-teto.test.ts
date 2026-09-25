import { describe, expect, it, vi } from 'vitest';

import { TetoExcedido, lerComTeto } from './ler-com-teto';

/** Uma resposta que entrega o corpo nos pedaços dados. */
function resposta(pedacos: number[][], declarado?: number): Response {
  const corpo = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pedacos) c.enqueue(Uint8Array.from(p));
      c.close();
    },
  });
  const headers = new Headers();
  if (declarado !== undefined) headers.set('content-length', String(declarado));
  return new Response(corpo, { headers });
}

const seq = (de: number, n: number) => Array.from({ length: n }, (_, i) => (de + i) % 256);

describe('lerComTeto', () => {
  it('com o tamanho declarado, lê num buffer SÓ — sem a cópia do fim (revisão do PR #284)', async () => {
    const pedacos = [seq(0, 4000), seq(4000, 4000), seq(8000, 2000)];
    // Nenhum `Buffer.concat` no fim, que seguraria pedaços e cópia ao mesmo
    // tempo.
    const concat = vi.spyOn(Buffer, 'concat');
    try {
      const lido = await lerComTeto(resposta(pedacos, 10_000), 1_000_000);
      expect([...lido]).toEqual(pedacos.flat());
      expect(concat).not.toHaveBeenCalled();
    } finally {
      concat.mockRestore();
    }
  });

  it('corpo MAIOR que o declarado (resposta comprimida) chega inteiro e na ordem', async () => {
    const pedacos = [seq(0, 3000), seq(3000, 3000), seq(6000, 3000)];
    const lido = await lerComTeto(resposta(pedacos, 5000), 1_000_000);
    expect([...lido]).toEqual(pedacos.flat());
  });

  it('corpo MENOR que o declarado devolve só o que chegou', async () => {
    const lido = await lerComTeto(resposta([seq(0, 100)], 5000), 1_000_000);
    expect([...lido]).toEqual(seq(0, 100));
  });

  it('sem tamanho declarado, junta os pedaços', async () => {
    const pedacos = [seq(0, 10), seq(10, 20)];
    const lido = await lerComTeto(resposta(pedacos), 1_000_000);
    expect([...lido]).toEqual(pedacos.flat());
  });

  it('o teto vale durante a leitura, com e sem o declarado', async () => {
    const pedacos = [seq(0, 600), seq(600, 600)];
    await expect(lerComTeto(resposta(pedacos, 1000), 1000)).rejects.toBeInstanceOf(TetoExcedido);
    await expect(lerComTeto(resposta(pedacos), 1000)).rejects.toBeInstanceOf(TetoExcedido);
  });

  it('o declarado acima do teto recusa sem ler', async () => {
    await expect(lerComTeto(resposta([seq(0, 10)], 5000), 1000)).rejects.toBeInstanceOf(TetoExcedido);
  });
});
