import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { CAPACIDADE_INICIAL, TetoExcedido, lerComTeto } from './ler-com-teto';

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
      // Com o declarado honesto, o último buffer tem o tamanho exato.
      expect(lido.buffer.byteLength).toBe(10_000);
    } finally {
      concat.mockRestore();
    }
  });

  it('corpo MAIOR que o declarado (resposta comprimida) chega inteiro e na ordem', async () => {
    const pedacos = [seq(0, 3000), seq(3000, 3000), seq(6000, 3000)];
    const lido = await lerComTeto(resposta(pedacos, 5000), 1_000_000);
    expect([...lido]).toEqual(pedacos.flat());
  });

  it('⚠️ declarado perto do teto e corpo pequeno: a reserva segue o que CHEGOU, não o cabeçalho (Codex, PR #299)', async () => {
    const lido = await lerComTeto(resposta([seq(0, 100)], 50_000_000), 60_000_000);
    expect([...lido]).toEqual(seq(0, 100));
    expect(lido.buffer.byteLength).toBeLessThanOrEqual(CAPACIDADE_INICIAL);
  });

  it('a reserva cresce dobrando e nunca passa do dobro do que chegou', async () => {
    const pedacos = Array.from({ length: 5 }, (_, i) => seq(i * 100_000, 100_000));
    const lido = await lerComTeto(resposta(pedacos, 40_000_000), 50_000_000);
    expect([...lido]).toEqual(pedacos.flat());
    expect(lido.buffer.byteLength).toBeLessThanOrEqual(2 * lido.length);
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

describe('lerComTeto contra um servidor HTTP de verdade (fetch do Node)', () => {
  // 3 MB com conteúdo que não se repete: qualquer byte fora do lugar muda o hash.
  const arquivo = Buffer.alloc(3 * 1024 * 1024);
  for (let i = 0; i < arquivo.length; i++) arquivo[i] = (i * 31 + (i >> 11)) % 251;
  const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

  async function servir(
    tratar: (res: import('node:http').ServerResponse) => void,
    corpo: (url: string) => Promise<void>,
  ) {
    const servidor = createServer((_req, res) => tratar(res));
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const { port } = servidor.address() as import('node:net').AddressInfo;
    try {
      await corpo(`http://127.0.0.1:${port}/`);
    } finally {
      await new Promise<void>((ok) => servidor.close(() => ok()));
    }
  }

  it('com content-length: chega inteiro, e num buffer só', async () => {
    await servir(
      (res) => {
        res.writeHead(200, { 'content-length': String(arquivo.length) });
        res.end(arquivo);
      },
      async (url) => {
        const concat = vi.spyOn(Buffer, 'concat');
        try {
          const lido = await lerComTeto(await fetch(url), 10 * 1024 * 1024);
          expect(hash(lido)).toBe(hash(arquivo));
          expect(concat).not.toHaveBeenCalled();
          expect(lido.buffer.byteLength).toBe(arquivo.length);
        } finally {
          concat.mockRestore();
        }
      },
    );
  });

  it('sem content-length (chunked): chega inteiro', async () => {
    await servir(
      (res) => {
        res.writeHead(200);
        for (let i = 0; i < arquivo.length; i += 100_000) res.write(arquivo.subarray(i, i + 100_000));
        res.end();
      },
      async (url) => {
        const lido = await lerComTeto(await fetch(url), 10 * 1024 * 1024);
        expect(hash(lido)).toBe(hash(arquivo));
      },
    );
  });

  it('gzip: o content-length é o COMPRIMIDO e o fetch entrega descomprimido — chega inteiro', async () => {
    const comprimido = gzipSync(arquivo);
    expect(comprimido.length).toBeLessThan(arquivo.length);
    await servir(
      (res) => {
        res.writeHead(200, {
          'content-encoding': 'gzip',
          'content-length': String(comprimido.length),
        });
        res.end(comprimido);
      },
      async (url) => {
        const lido = await lerComTeto(await fetch(url), 10 * 1024 * 1024);
        expect(hash(lido)).toBe(hash(arquivo));
      },
    );
  });

  it('⚠️ servidor que anuncia 40 MB e trava depois de 1 KB não faz reservar os 40 MB', async () => {
    let conexao: import('node:http').ServerResponse | null = null;
    await servir(
      (res) => {
        conexao = res;
        res.writeHead(200, { 'content-length': String(40 * 1024 * 1024) });
        res.write(arquivo.subarray(0, 1024));
      },
      async (url) => {
        const alloc = vi.spyOn(Buffer, 'alloc');
        try {
          const leitura = lerComTeto(await fetch(url), 50 * 1024 * 1024);
          leitura.catch(() => {});
          await new Promise((ok) => setTimeout(ok, 300));
          const maior = Math.max(0, ...alloc.mock.calls.map(([n]) => Number(n)));
          expect(maior).toBeLessThanOrEqual(CAPACIDADE_INICIAL);
          conexao!.destroy();
          await expect(leitura).rejects.toBeTruthy();
        } finally {
          alloc.mockRestore();
        }
      },
    );
  });

  it('o teto vale sobre o DESCOMPRIMIDO (uma bomba de gzip não passa)', async () => {
    const comprimido = gzipSync(arquivo);
    await servir(
      (res) => {
        res.writeHead(200, {
          'content-encoding': 'gzip',
          'content-length': String(comprimido.length),
        });
        res.end(comprimido);
      },
      async (url) => {
        await expect(lerComTeto(await fetch(url), 1024 * 1024)).rejects.toBeInstanceOf(TetoExcedido);
      },
    );
  });
});
