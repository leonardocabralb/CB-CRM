import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ARQUIVOS_POR_LOTE,
  drenarArquivosAApagar,
  vencerLixeira,
} from './arquivos-a-apagar';

// ============================================================
// O vencimento e a drenagem com um DUBLÊ do cliente: ele imita a forma
// SUPOSTA do supabase-js (`rpc`, `from().delete().in().eq()`,
// `storage.from().remove()`); a forma real das funções está provada no
// descartável da 1097.
// ============================================================

const CONTA = '00000000-0000-0000-0000-000000000001';
const OUTRA = '00000000-0000-0000-0000-000000000002';
const CARIMBO = '2026-10-23T01:02:03.123456+00:00';

type Resposta = { data: unknown; error: { message: string } | null };

interface Escrita {
  tabela: string;
  tipo: 'delete' | 'update';
  patch?: unknown;
  ids: string[];
  cerca: [string, string];
}

function duble(opcoes: {
  rpc?: Record<string, Resposta[]>;
  remove?: (caminhos: string[]) => Promise<Resposta> | Resposta;
  erroNaFila?: { message: string } | null;
  aoChamar?: (nome: string) => void;
}) {
  const chamadas: { nome: string; args: unknown }[] = [];
  const removidos: string[][] = [];
  const escritas: Escrita[] = [];
  const filas = Object.fromEntries(
    Object.entries(opcoes.rpc ?? {}).map(([k, v]) => [k, [...v]])
  );

  const construtor = (
    tabela: string,
    tipo: 'delete' | 'update',
    patch?: unknown
  ) => ({
    in: (_col: string, ids: string[]) => ({
      eq: async (col: string, valor: string) => {
        escritas.push({ tabela, tipo, patch, ids, cerca: [col, valor] });
        return { error: opcoes.erroNaFila ?? null };
      },
    }),
  });

  const admin = {
    rpc: async (nome: string, args?: unknown) => {
      chamadas.push({ nome, args });
      opcoes.aoChamar?.(nome);
      const r = filas[nome]?.shift();
      return (
        r ?? { data: nome === 'cb_vencer_lixeira' ? null : [], error: null }
      );
    },
    from: (tabela: string) => ({
      delete: () => construtor(tabela, 'delete'),
      update: (patch: unknown) => construtor(tabela, 'update', patch),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (caminhos: string[]) => {
          expect(bucket).toBe('chat-media');
          removidos.push(caminhos);
          return opcoes.remove
            ? opcoes.remove(caminhos)
            : { data: [], error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;

  return { admin, chamadas, removidos, escritas };
}

function linha(
  id: string,
  caminho: string,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    account_id: CONTA,
    bucket: 'chat-media',
    caminho,
    carimbo: CARIMBO,
    ...extra,
  };
}

const LONGE = () => Date.now() + 60_000;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('vencerLixeira', () => {
  it('nada vencido: uma pergunta e para', async () => {
    const { admin, chamadas } = duble({});
    expect(await vencerLixeira(admin, LONGE())).toEqual({
      excluidas: 0,
      arquivos: 0,
      erro: null,
    });
    expect(chamadas.map((c) => c.nome)).toEqual(['cb_vencer_lixeira']);
  });

  it('exclui UM por chamada até o banco dizer que acabou, somando os arquivos', async () => {
    const { admin, chamadas } = duble({
      rpc: {
        cb_vencer_lixeira: [
          {
            data: {
              item_id: 'i1',
              contact_id: 'c1',
              resultado: 'excluida',
              arquivos: 3,
              pedido_exclusao: false,
            },
            error: null,
          },
          {
            data: {
              item_id: 'i2',
              contact_id: 'c2',
              resultado: 'excluida',
              arquivos: 0,
              pedido_exclusao: false,
            },
            error: null,
          },
          { data: null, error: null },
        ],
      },
    });
    expect(await vencerLixeira(admin, LONGE())).toEqual({
      excluidas: 2,
      arquivos: 3,
      erro: null,
    });
    expect(chamadas).toHaveLength(3);
  });

  it('erro do banco: devolve o motivo, nunca lança', async () => {
    const { admin } = duble({
      rpc: {
        cb_vencer_lixeira: [
          { data: null, error: { message: 'permission denied' } },
        ],
      },
    });
    expect(await vencerLixeira(admin, LONGE())).toEqual({
      excluidas: 0,
      arquivos: 0,
      erro: 'permission denied',
    });
  });

  it('forma inesperada (ou item que não saiu) PARA — não gira em falso sobre o mesmo item', async () => {
    for (const data of [
      { resultado: 'sumiu', item_id: 'i1' },
      { item_id: 'i1' },
      'x',
      [1],
    ]) {
      const { admin, chamadas } = duble({
        rpc: {
          cb_vencer_lixeira: [
            { data, error: null },
            { data: { item_id: 'i2', resultado: 'excluida' }, error: null },
          ],
        },
      });
      const r = await vencerLixeira(admin, LONGE());
      expect(r.excluidas).toBe(0);
      expect(r.erro).toMatch(/o vencimento devolveu/);
      expect(chamadas).toHaveLength(1);
    }
  });

  it('prazo já estourado: nem pergunta', async () => {
    const { admin, chamadas } = duble({});
    expect(await vencerLixeira(admin, Date.now() - 1)).toEqual({
      excluidas: 0,
      arquivos: 0,
      erro: null,
    });
    expect(chamadas).toHaveLength(0);
  });

  it('o prazo estoura no meio: para entre um item e o seguinte', async () => {
    let agora = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => agora);
    const vencido = {
      data: { item_id: 'i', resultado: 'excluida', arquivos: 1 },
      error: null,
    };
    const { admin, chamadas } = duble({
      rpc: { cb_vencer_lixeira: [vencido, vencido, vencido] },
      aoChamar: () => {
        agora += 600;
      },
    });
    expect(await vencerLixeira(admin, 2_000)).toEqual({
      excluidas: 2,
      arquivos: 2,
      erro: null,
    });
    expect(chamadas).toHaveLength(2);
  });
});

describe('drenarArquivosAApagar', () => {
  it('fila vazia: uma reivindicação, nada removido', async () => {
    const { admin, chamadas, removidos, escritas } = duble({});
    expect(await drenarArquivosAApagar(admin, LONGE())).toEqual({
      apagados: 0,
      foraDaGuarda: 0,
      falhas: 0,
      erro: null,
    });
    expect(chamadas).toEqual([
      {
        nome: 'cb_reivindicar_arquivos_a_apagar',
        args: { p_limite: ARQUIVOS_POR_LOTE },
      },
    ]);
    expect(removidos).toEqual([]);
    expect(escritas).toEqual([]);
  });

  it('lote removido: UMA chamada ao Storage e as linhas saem da fila COM A CERCA', async () => {
    const a = `account-${CONTA}/1700-a.jpg`;
    const b = `account-${CONTA}/inbound/m.ogg`;
    const { admin, chamadas, removidos, escritas } = duble({
      rpc: {
        cb_reivindicar_arquivos_a_apagar: [
          { data: [linha('f1', a), linha('f2', b)], error: null },
        ],
      },
    });
    expect(await drenarArquivosAApagar(admin, LONGE())).toEqual({
      apagados: 2,
      foraDaGuarda: 0,
      falhas: 0,
      erro: null,
    });
    expect(removidos).toEqual([[a, b]]);
    expect(escritas).toEqual([
      {
        tabela: 'cb_arquivos_a_apagar',
        tipo: 'delete',
        patch: undefined,
        ids: ['f1', 'f2'],
        cerca: ['reivindicado_em', CARIMBO],
      },
    ]);
    // Drena até a fila responder vazia.
    expect(chamadas).toHaveLength(2);
  });

  it('cada carimbo é uma cerca própria', async () => {
    const outro = '2026-10-23T01:12:03.5+00:00';
    const { admin, escritas } = duble({
      rpc: {
        cb_reivindicar_arquivos_a_apagar: [
          {
            data: [
              linha('f1', `account-${CONTA}/a.jpg`),
              linha('f2', `account-${CONTA}/b.jpg`, { carimbo: outro }),
            ],
            error: null,
          },
        ],
      },
    });
    await drenarArquivosAApagar(admin, LONGE());
    expect(escritas.map((e) => [e.ids, e.cerca[1]])).toEqual([
      [['f1'], CARIMBO],
      [['f2'], outro],
    ]);
  });

  it('erro do Storage: anota o motivo (cercado), não tira da fila e PARA o ciclo', async () => {
    const { admin, chamadas, escritas } = duble({
      rpc: {
        cb_reivindicar_arquivos_a_apagar: [
          { data: [linha('f1', `account-${CONTA}/a.jpg`)], error: null },
          { data: [linha('f2', `account-${CONTA}/b.jpg`)], error: null },
        ],
      },
      remove: () => ({
        data: null,
        error: { message: 'Storage indisponível' },
      }),
    });
    const r = await drenarArquivosAApagar(admin, LONGE());
    expect(r).toEqual({
      apagados: 0,
      foraDaGuarda: 0,
      falhas: 1,
      erro: 'o Storage recusou o lote: Storage indisponível',
    });
    expect(escritas).toEqual([
      {
        tabela: 'cb_arquivos_a_apagar',
        tipo: 'update',
        patch: { ultimo_erro: 'Storage indisponível' },
        ids: ['f1'],
        cerca: ['reivindicado_em', CARIMBO],
      },
    ]);
    // O segundo lote não foi reivindicado: queimaria as tentativas dele à toa.
    expect(chamadas).toHaveLength(1);
  });

  it('o Storage LANÇA (rede): mesmo trato, nunca lança para fora', async () => {
    const { admin, escritas } = duble({
      rpc: {
        cb_reivindicar_arquivos_a_apagar: [
          { data: [linha('f1', `account-${CONTA}/a.jpg`)], error: null },
        ],
      },
      remove: () => {
        throw new Error('fetch failed');
      },
    });
    const r = await drenarArquivosAApagar(admin, LONGE());
    expect(r.erro).toBe('o Storage recusou o lote: fetch failed');
    expect(r.falhas).toBe(1);
    expect(escritas.map((e) => e.tipo)).toEqual(['update']);
  });

  it('o motivo gravado tem teto', async () => {
    const { admin, escritas } = duble({
      rpc: {
        cb_reivindicar_arquivos_a_apagar: [
          { data: [linha('f1', `account-${CONTA}/a.jpg`)], error: null },
        ],
      },
      remove: () => ({ data: null, error: { message: 'x'.repeat(5_000) } }),
    });
    await drenarArquivosAApagar(admin, LONGE());
    expect(
      (escritas[0].patch as { ultimo_erro: string }).ultimo_erro
    ).toHaveLength(300);
  });

  it('prazo já estourado: nem reivindica (a tentativa contaria à toa)', async () => {
    const { admin, chamadas } = duble({});
    expect(await drenarArquivosAApagar(admin, Date.now() - 1)).toEqual({
      apagados: 0,
      foraDaGuarda: 0,
      falhas: 0,
      erro: null,
    });
    expect(chamadas).toHaveLength(0);
  });

  it('o prazo estoura no meio: termina o lote em voo e não pega outro', async () => {
    let agora = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => agora);
    const { admin, chamadas, removidos } = duble({
      rpc: {
        cb_reivindicar_arquivos_a_apagar: [
          { data: [linha('f1', `account-${CONTA}/a.jpg`)], error: null },
          { data: [linha('f2', `account-${CONTA}/b.jpg`)], error: null },
        ],
      },
      aoChamar: () => {
        agora += 1_500;
      },
    });
    expect(await drenarArquivosAApagar(admin, 2_000)).toEqual({
      apagados: 1,
      foraDaGuarda: 0,
      falhas: 0,
      erro: null,
    });
    expect(chamadas).toHaveLength(1);
    expect(removidos).toEqual([[`account-${CONTA}/a.jpg`]]);
  });

  it('caminho fora da guarda do espelho: fica no bucket, ganha o motivo; o resto do lote sai', async () => {
    const bom = `account-${CONTA}/a.jpg`;
    const { admin, removidos, escritas } = duble({
      rpc: {
        cb_reivindicar_arquivos_a_apagar: [
          {
            data: [
              linha('f1', bom),
              linha('f2', `account-${CONTA}/acervo/contrato.pdf`),
              linha('f3', `account-${OUTRA}/x.jpg`),
              linha('f4', `account-${CONTA}/../x.jpg`),
              linha('f5', `account-${CONTA}/b.jpg`, { bucket: 'flow-media' }),
            ],
            error: null,
          },
        ],
      },
    });
    const r = await drenarArquivosAApagar(admin, LONGE());
    expect(r).toEqual({ apagados: 1, foraDaGuarda: 4, falhas: 0, erro: null });
    expect(removidos).toEqual([[bom]]);
    expect(escritas).toEqual([
      {
        tabela: 'cb_arquivos_a_apagar',
        tipo: 'update',
        patch: {
          ultimo_erro:
            'fora da guarda (espelho TS de cb_caminho_no_chat_media)',
        },
        ids: ['f2', 'f3', 'f4', 'f5'],
        cerca: ['reivindicado_em', CARIMBO],
      },
      {
        tabela: 'cb_arquivos_a_apagar',
        tipo: 'delete',
        patch: undefined,
        ids: ['f1'],
        cerca: ['reivindicado_em', CARIMBO],
      },
    ]);
  });

  it('lote inteiro fora da guarda: nenhum remove, segue para o próximo lote', async () => {
    const { admin, chamadas, removidos } = duble({
      rpc: {
        cb_reivindicar_arquivos_a_apagar: [
          { data: [linha('f1', `account-${OUTRA}/x.jpg`)], error: null },
          { data: [linha('f2', `account-${CONTA}/a.jpg`)], error: null },
        ],
      },
    });
    const r = await drenarArquivosAApagar(admin, LONGE());
    expect(r).toEqual({ apagados: 1, foraDaGuarda: 1, falhas: 0, erro: null });
    expect(removidos).toEqual([[`account-${CONTA}/a.jpg`]]);
    expect(chamadas).toHaveLength(3);
  });

  it('linha com forma torta fica de fora (não vira caminho apagado)', async () => {
    const { admin, removidos } = duble({
      rpc: {
        cb_reivindicar_arquivos_a_apagar: [
          {
            data: [
              { id: 'f1', caminho: `account-${CONTA}/a.jpg` },
              linha('f2', `account-${CONTA}/b.jpg`),
              null,
              'x',
            ],
            error: null,
          },
        ],
      },
    });
    const r = await drenarArquivosAApagar(admin, LONGE());
    expect(r.apagados).toBe(1);
    expect(removidos).toEqual([[`account-${CONTA}/b.jpg`]]);
  });

  it('erro na reivindicação: devolve o motivo, nunca lança', async () => {
    const { admin, removidos } = duble({
      rpc: {
        cb_reivindicar_arquivos_a_apagar: [
          {
            data: null,
            error: { message: 'canceling statement due to statement timeout' },
          },
        ],
      },
    });
    const r = await drenarArquivosAApagar(admin, LONGE());
    expect(r.erro).toBe('canceling statement due to statement timeout');
    expect(removidos).toEqual([]);
  });

  it('a fila não larga a linha depois do remove: o arquivo conta como apagado e a drenagem segue', async () => {
    const { admin, chamadas } = duble({
      rpc: {
        cb_reivindicar_arquivos_a_apagar: [
          { data: [linha('f1', `account-${CONTA}/a.jpg`)], error: null },
        ],
      },
      erroNaFila: { message: 'deadlock detected' },
    });
    expect(await drenarArquivosAApagar(admin, LONGE())).toEqual({
      apagados: 1,
      foraDaGuarda: 0,
      falhas: 0,
      erro: null,
    });
    expect(chamadas).toHaveLength(2);
  });
});
