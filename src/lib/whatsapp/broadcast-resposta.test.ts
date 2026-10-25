import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  JANELA_DA_RESPOSTA_AO_DISPARO_MS,
  marcarRespostaAoDisparo,
  respostaContaParaODisparo,
} from './broadcast-resposta';

// ============================================================
// A resposta do cliente conta para o disparo CERTO (porte do #671). O dublê
// guarda os destinatários do contato do mais novo para o mais antigo (a
// ordem do `created_at desc`), devolve só o `limit`, e o UPDATE só pega a
// linha cuja situação está na lista do WHERE — como o banco.
// ============================================================

interface Linha {
  id: string;
  status: string;
  sent_at: string | null;
}

function banco(
  linhas: Linha[],
  opcoes: { erroNaLeitura?: boolean; erroNoUpdate?: boolean; lanca?: boolean } = {},
) {
  const leitura: Record<string, unknown> = {};
  const updates: { patch: Record<string, unknown>; id: unknown; aceitas: string[] }[] = [];
  const db = {
    from: (tabela: string) => {
      expect(tabela).toBe('broadcast_recipients');
      return {
        select: (colunas: string) => {
          if (opcoes.lanca) throw new Error('rede caiu');
          leitura.colunas = colunas;
          const cadeia = {
            eq: (coluna: string, valor: unknown) => {
              leitura[coluna] = valor;
              return cadeia;
            },
            in: (coluna: string, valores: unknown) => {
              leitura[`in:${coluna}`] = valores;
              return cadeia;
            },
            order: (coluna: string, o: { ascending: boolean }) => {
              leitura.order = [coluna, o.ascending];
              return cadeia;
            },
            // Uma FOTO da linha (cópia): a leitura não enxerga o que outra
            // requisição gravou depois dela — é o que o UPDATE condicional cobre.
            limit: async (n: number) =>
              opcoes.erroNaLeitura
                ? { data: null, error: { message: 'timeout' } }
                : { data: linhas.slice(0, n).map((l) => ({ ...l })), error: null },
          };
          return cadeia;
        },
        update: (patch: Record<string, unknown>) => ({
          eq: (_coluna: string, id: unknown) => ({
            in: (_status: string, aceitas: string[]) => ({
              select: async () => {
                updates.push({ patch, id, aceitas });
                if (opcoes.erroNoUpdate) return { data: null, error: { message: 'boom' } };
                const casadas = linhas.filter((l) => l.id === id && aceitas.includes(l.status));
                for (const l of casadas) l.status = String(patch.status);
                return { data: casadas.map((l) => ({ id: l.id })), error: null };
              },
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { db, leitura, updates };
}

const AGORA = new Date('2026-10-25T12:00:00.000Z');
const horasAntes = (h: number) => new Date(AGORA.getTime() - h * 3_600_000).toISOString();

describe('respostaContaParaODisparo', () => {
  it('enviado, entregue ou lido dentro da janela: conta', () => {
    for (const status of ['sent', 'delivered', 'read']) {
      expect(respostaContaParaODisparo({ status, sent_at: horasAntes(2) }, AGORA)).toBe(true);
    }
  });

  it('já respondido, com falha, pendente ou sem `sent_at`: não conta', () => {
    expect(respostaContaParaODisparo({ status: 'replied', sent_at: horasAntes(2) }, AGORA)).toBe(false);
    expect(respostaContaParaODisparo({ status: 'failed', sent_at: horasAntes(2) }, AGORA)).toBe(false);
    expect(respostaContaParaODisparo({ status: 'pending', sent_at: null }, AGORA)).toBe(false);
    expect(respostaContaParaODisparo({ status: 'read', sent_at: null }, AGORA)).toBe(false);
    expect(respostaContaParaODisparo({ status: 'read', sent_at: 'não é data' }, AGORA)).toBe(false);
  });

  it('a janela é de 7 dias, contada do ENVIO: na borda conta, um milissegundo depois não', () => {
    const naBorda = new Date(AGORA.getTime() - JANELA_DA_RESPOSTA_AO_DISPARO_MS).toISOString();
    const foraDela = new Date(AGORA.getTime() - JANELA_DA_RESPOSTA_AO_DISPARO_MS - 1).toISOString();
    expect(JANELA_DA_RESPOSTA_AO_DISPARO_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(respostaContaParaODisparo({ status: 'read', sent_at: naBorda }, AGORA)).toBe(true);
    expect(respostaContaParaODisparo({ status: 'read', sent_at: foraDela }, AGORA)).toBe(false);
  });
});

describe('marcarRespostaAoDisparo', () => {
  it('lê só a linha MAIS RECENTE do contato na conta, em qualquer situação', async () => {
    const { db, leitura, updates } = banco([{ id: 'r1', status: 'read', sent_at: horasAntes(1) }]);

    await expect(marcarRespostaAoDisparo(db, 'conta-1', 'contato-1', AGORA)).resolves.toBe('marcou');
    expect(leitura).toEqual({
      colunas: 'id, status, sent_at, broadcasts!inner(account_id)',
      contact_id: 'contato-1',
      'broadcasts.account_id': 'conta-1',
      order: ['created_at', false],
    });
    // Sem `.in('status', …)` na LEITURA: filtrar ali fazia a busca pular para
    // a campanha anterior quando a mais nova já estava respondida ou falhou.
    expect(updates).toEqual([
      {
        patch: { status: 'replied', replied_at: AGORA.toISOString() },
        id: 'r1',
        aceitas: ['sent', 'delivered', 'read'],
      },
    ]);
  });

  it('a 2ª mensagem do cliente não volta para uma campanha mais velha', async () => {
    const linhas = [
      { id: 'mais-nova', status: 'read', sent_at: horasAntes(1) },
      { id: 'mais-velha', status: 'read', sent_at: horasAntes(30) },
    ];
    const { db } = banco(linhas);

    await marcarRespostaAoDisparo(db, 'conta-1', 'contato-1', AGORA);
    await expect(marcarRespostaAoDisparo(db, 'conta-1', 'contato-1', AGORA)).resolves.toBe('pulou');
    expect(linhas.map((l) => l.status)).toEqual(['replied', 'read']);
  });

  it('a campanha mais nova FALHOU para o contato: a anterior não leva o crédito', async () => {
    const linhas = [
      { id: 'mais-nova', status: 'failed', sent_at: null },
      { id: 'mais-velha', status: 'delivered', sent_at: horasAntes(30) },
    ];
    const { db, updates } = banco(linhas);

    await expect(marcarRespostaAoDisparo(db, 'conta-1', 'contato-1', AGORA)).resolves.toBe('pulou');
    expect(updates).toEqual([]);
    expect(linhas[1].status).toBe('delivered');
  });

  it('a resposta chega 8 dias depois do envio: não conta para a campanha', async () => {
    const { db, updates } = banco([{ id: 'r1', status: 'delivered', sent_at: horasAntes(24 * 8) }]);

    await expect(marcarRespostaAoDisparo(db, 'conta-1', 'contato-1', AGORA)).resolves.toBe('pulou');
    expect(updates).toEqual([]);
  });

  it('contato sem disparo nenhum: nada a marcar', async () => {
    const { db, updates } = banco([]);

    await expect(marcarRespostaAoDisparo(db, 'conta-1', 'contato-1', AGORA)).resolves.toBe('pulou');
    expect(updates).toEqual([]);
  });

  it('o UPDATE é condicional: um webhook concorrente que já marcou ganha, e nada se regrava', async () => {
    const linhas = [{ id: 'r1', status: 'sent', sent_at: horasAntes(1) }];
    const { db, updates } = banco(linhas);
    // As duas leem `sent` e as duas tentam; a segunda já acha a linha
    // `replied` no WHERE e não grava nada.
    const [a, b] = await Promise.all([
      marcarRespostaAoDisparo(db, 'conta-1', 'contato-1', AGORA),
      marcarRespostaAoDisparo(db, 'conta-1', 'contato-1', AGORA),
    ]);

    expect(updates).toHaveLength(2);
    expect([a, b].sort()).toEqual(['marcou', 'pulou']);
    expect(linhas[0].status).toBe('replied');
  });

  it('leitura com erro, UPDATE com erro ou exceção: `erro`, com log, e nunca lança', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const linha = () => [{ id: 'r1', status: 'read', sent_at: horasAntes(1) }];

    await expect(
      marcarRespostaAoDisparo(banco(linha(), { erroNaLeitura: true }).db, 'conta-1', 'contato-1', AGORA),
    ).resolves.toBe('erro');
    await expect(
      marcarRespostaAoDisparo(banco(linha(), { erroNoUpdate: true }).db, 'conta-1', 'contato-1', AGORA),
    ).resolves.toBe('erro');
    await expect(
      marcarRespostaAoDisparo(banco(linha(), { lanca: true }).db, 'conta-1', 'contato-1', AGORA),
    ).resolves.toBe('erro');
    expect(log).toHaveBeenCalledTimes(3);
    log.mockRestore();
  });
});
