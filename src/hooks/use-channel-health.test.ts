import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// UMA sonda por aba (05/10/2026). Com o cabeçalho e o fio lendo a saúde ao
// mesmo tempo, uma instância por leitor fazia cada UPDATE em `cb_channels`
// virar uma busca POR LEITOR — e a sonda grava uma linha por conexão, então
// cada rajada multiplicava de novo. Medido no preview: 18 buscas em 23 s,
// perto do teto de 40/min da rota; no teto, o 429 apagava a faixa vermelha
// e destravava o compositor no meio da queda.
// ============================================================

const realtime = vi.hoisted(() => ({
  avisos: [] as Array<() => void>,
  nomes: [] as string[],
  removidos: [] as string[],
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: (nome: string) => {
      realtime.nomes.push(nome);
      const canal = {
        nome,
        on: (_tipo: string, _filtro: unknown, aviso: () => void) => {
          realtime.avisos.push(aviso);
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: async (c: { nome: string }) => {
      realtime.removidos.push(c.nome);
    },
  }),
}));

import {
  AGRUPAR_REALTIME_MS,
  assinarSaudeDosCanais,
  lerSaudeDosCanais,
} from './use-channel-health';

const CANAL = { id: 'c1', label: 'Bancário - Comercial', tone: 'down' };

function resposta(corpo: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

let fetchMock: ReturnType<typeof vi.fn>;
let sair: Array<() => void> = [];
const doc = { visibilityState: 'visible' as 'visible' | 'hidden' };

function assinar() {
  const fim = assinarSaudeDosCanais(() => {});
  sair.push(fim);
  return fim;
}

beforeEach(() => {
  vi.useFakeTimers();
  realtime.avisos.length = 0;
  realtime.nomes.length = 0;
  realtime.removidos.length = 0;
  doc.visibilityState = 'visible';
  fetchMock = vi.fn(async () => resposta({ channels: [CANAL] }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('document', {
    get visibilityState() {
      return doc.visibilityState;
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

afterEach(() => {
  for (const fim of sair) fim();
  sair = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useChannelHealth — uma sonda por aba', () => {
  it('dois leitores (cabeçalho e fio) dividem UMA busca e UM canal realtime', async () => {
    assinar();
    assinar();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(realtime.nomes).toHaveLength(1);
    expect(lerSaudeDosCanais()).toMatchObject({ loading: false, falhou: false, channels: [CANAL] });
  });

  it('a RAJADA do realtime (uma linha por conexão) vira UMA busca', async () => {
    assinar();
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockClear();

    for (let i = 0; i < 6; i++) realtime.avisos[0]!();
    await vi.advanceTimersByTimeAsync(AGRUPAR_REALTIME_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aba oculta: o realtime não busca', async () => {
    assinar();
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockClear();

    doc.visibilityState = 'hidden';
    realtime.avisos[0]!();
    await vi.advanceTimersByTimeAsync(AGRUPAR_REALTIME_MS);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('o último leitor a sair desliga o canal e zera (quem voltar não vê lista velha)', async () => {
    const a = assinar();
    const b = assinar();
    await vi.advanceTimersByTimeAsync(0);

    a();
    expect(realtime.removidos).toHaveLength(0);
    b();
    expect(realtime.removidos).toEqual(realtime.nomes);
    expect(lerSaudeDosCanais()).toEqual({ channels: [], loading: true, falhou: false });

    // Nada mais roda depois de desligado.
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('religar usa um canal de NOME novo (o StrictMode desmonta e remonta)', async () => {
    assinar()();
    assinar();
    expect(new Set(realtime.nomes).size).toBe(2);
  });

  it('resposta atrasada de uma ligação anterior é descartada', async () => {
    let soltar!: (r: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => (soltar = r)));
    assinar()();
    assinar();
    await vi.advanceTimersByTimeAsync(0);
    expect(lerSaudeDosCanais().channels).toEqual([CANAL]);

    soltar(resposta({ channels: [] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(lerSaudeDosCanais().channels).toEqual([CANAL]);
  });

  it('leitor novo com a última sonda FALHADA pergunta de novo (o Meu dia ao abrir)', async () => {
    fetchMock.mockResolvedValueOnce(resposta({ error: 'x' }, 500));
    assinar();
    await vi.advanceTimersByTimeAsync(0);
    expect(lerSaudeDosCanais().falhou).toBe(true);

    assinar();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lerSaudeDosCanais()).toMatchObject({ falhou: false, channels: [CANAL] });

    // Leitor novo com a sonda em dia NÃO busca (o cabeçalho já mantém).
    assinar();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429 (teto da rota) sobe `falhou` e mantém a última lista boa', async () => {
    assinar();
    await vi.advanceTimersByTimeAsync(0);

    fetchMock.mockResolvedValueOnce(resposta({ error: 'rate' }, 429));
    realtime.avisos[0]!();
    await vi.advanceTimersByTimeAsync(AGRUPAR_REALTIME_MS);

    expect(lerSaudeDosCanais()).toMatchObject({ falhou: true, channels: [CANAL] });
  });
});
