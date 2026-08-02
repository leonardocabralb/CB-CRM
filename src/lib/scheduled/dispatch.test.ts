import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SendMessageError } from '@/lib/whatsapp/send-message';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import { dispararUma, dispararVencidas } from './dispatch';

vi.mock('@/lib/whatsapp/send-message', async () => {
  const real =
    await vi.importActual<typeof import('@/lib/whatsapp/send-message')>(
      '@/lib/whatsapp/send-message',
    );
  return { ...real, sendMessageToConversation: vi.fn() };
});

const enviar = vi.mocked(sendMessageToConversation);

// ------------------------------------------------------------
// Stub do cliente. Guarda TODA escrita, porque o que este módulo faz de
// errado não aparece no retorno: uma linha que fica em `sending` para sempre
// devolve exatamente o mesmo `{enviadas: 0}` de uma que virou `failed`.
// ------------------------------------------------------------
interface Op {
  verb: 'select' | 'update';
  payload: Record<string, unknown> | null;
  eq: Record<string, unknown>;
  in: Record<string, unknown>;
  lt: [string, unknown] | null;
  lte: [string, unknown] | null;
  limit: number | null;
}

interface Cfg {
  /** Linhas devolvidas pela busca do ciclo. */
  vencidas?: Record<string, unknown>[];
  /** Linhas que a recusa em bloco diz ter marcado. */
  atrasadas?: { id: string }[];
  /** Linhas que o recolhedor de travadas diz ter marcado. */
  travadas?: { id: string }[];
  /** Ids que a reivindicação CONSEGUE pegar. Ausente = pega todos. */
  reivindicaveis?: string[];
  /** Linha devolvida pela busca de `dispararUma`. */
  uma?: Record<string, unknown> | null;
}

function makeDb(cfg: Cfg) {
  const updates: Op[] = [];
  const selects: Op[] = [];

  const resolver = (op: Op) => {
    if (op.verb === 'update') {
      updates.push(op);
      const status = op.payload?.status;
      // O recolhedor é o único UPDATE que filtra por `status = 'sending'`.
      if (status === 'failed' && op.eq.status === 'sending') {
        return { data: cfg.travadas ?? [], error: null };
      }
      if (status === 'failed' && op.lt) {
        return { data: cfg.atrasadas ?? [], error: null };
      }
      if (status === 'sending') {
        const id = String(op.eq.id);
        const pode = cfg.reivindicaveis ? cfg.reivindicaveis.includes(id) : true;
        return { data: pode ? { id } : null, error: null };
      }
      return { data: null, error: null };
    }
    selects.push(op);
    if (op.eq.status === 'pending') return { data: cfg.vencidas ?? [], error: null };
    if (op.in.status) return { data: cfg.uma ?? null, error: null };
    // Releitura do motivo, depois da falha.
    return { data: { error: 'motivo relido' }, error: null };
  };

  const make = () => {
    const op: Op = {
      verb: 'select',
      payload: null,
      eq: {},
      in: {},
      lt: null,
      lte: null,
      limit: null,
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (p: Record<string, unknown>) => {
        op.verb = 'update';
        op.payload = p;
        return chain;
      },
      eq: (c: string, v: unknown) => {
        op.eq[c] = v;
        return chain;
      },
      in: (c: string, v: unknown) => {
        op.in[c] = v;
        return chain;
      },
      lt: (c: string, v: unknown) => {
        op.lt = [c, v];
        return chain;
      },
      lte: (c: string, v: unknown) => {
        op.lte = [c, v];
        return chain;
      },
      order: () => chain,
      limit: (n: number) => {
        op.limit = n;
        return chain;
      },
      maybeSingle: () => Promise.resolve(resolver(op)),
      then: (
        ok: (v: unknown) => unknown,
        falhou?: (e: unknown) => unknown,
      ) => Promise.resolve(resolver(op)).then(ok, falhou),
    };
    return chain;
  };

  return {
    db: { from: () => make() } as unknown as SupabaseClient,
    updates,
    selects,
    /** Os `update` que gravaram desfecho (nem reivindicação, nem recusa). */
    desfechos: () =>
      updates.filter(
        (u) => u.payload?.status !== 'sending' && !u.lt,
      ),
  };
}

const LINHA = {
  id: 'ag-1',
  account_id: 'conta-1',
  conversation_id: 'conversa-1',
  channel_id: 'canal-1',
  body: 'Bom dia, Dr.',
  created_by: 'quem-agendou',
};

beforeEach(() => {
  enviar.mockReset();
  enviar.mockResolvedValue({
    messageId: 'msg-1',
    whatsappMessageId: 'wamid-1',
    channelId: 'canal-1',
    contentText: 'Bom dia, Dr.',
  });
});

describe('dispararVencidas', () => {
  it('envia a vencida e grava o desfecho', async () => {
    const { db, desfechos } = makeDb({ vencidas: [LINHA] });

    const r = await dispararVencidas(db);

    expect(r).toEqual({ enviadas: 1, falhas: 0, atrasadas: 0, travadas: 0 });
    expect(enviar).toHaveBeenCalledTimes(1);
    const gravado = desfechos()[0].payload!;
    expect(gravado.status).toBe('sent');
    expect(gravado.message_id).toBe('msg-1');
    expect(gravado.error).toBeNull();
  });

  it('⚠️ passa o canal FIXADO e não pausa fluxo — é a fase inteira', async () => {
    const { db } = makeDb({ vencidas: [LINHA] });

    await dispararVencidas(db);

    const args = enviar.mock.calls[0][2];
    // Sem isto o núcleo resolveria o canal sozinho e degradaria em silêncio
    // para o padrão da conta: a mensagem sairia pelo número errado, de
    // madrugada, sem ninguém na tela.
    expect(args.channelId).toBe('canal-1');
    // A pausa de fluxo significa "tem gente aqui agora" (P4.5).
    expect(args.pauseFlows).toBe(false);
    // Quem agendou é quem assina (923).
    expect(args.senderUserId).toBe('quem-agendou');
    expect(args.messageType).toBe('text');
  });

  it('falha no envio vira `failed` com o motivo — nunca fica em `sending`', async () => {
    enviar.mockRejectedValue(
      new SendMessageError('channel_unavailable', 'A conexão sumiu.', 409),
    );
    const { db, desfechos } = makeDb({ vencidas: [LINHA] });

    const r = await dispararVencidas(db);

    expect(r.falhas).toBe(1);
    const gravado = desfechos()[0].payload!;
    expect(gravado.status).toBe('failed');
    expect(gravado.error).toBe('A conexão sumiu.');
  });

  it('erro que não é SendMessageError também sai de `sending`', async () => {
    enviar.mockRejectedValue(new Error('rede caiu'));
    const { db, desfechos } = makeDb({ vencidas: [LINHA] });

    await dispararVencidas(db);

    expect(desfechos()[0].payload!.status).toBe('failed');
    expect(desfechos()[0].payload!.error).toBe('rede caiu');
  });

  it('linha que outro ciclo já reivindicou é pulada, sem enviar', async () => {
    const { db, desfechos } = makeDb({
      vencidas: [LINHA],
      reivindicaveis: [],
    });

    const r = await dispararVencidas(db);

    expect(enviar).not.toHaveBeenCalled();
    expect(r).toEqual({ enviadas: 0, falhas: 0, atrasadas: 0, travadas: 0 });
    expect(desfechos()).toHaveLength(0);
  });

  it('a reivindicação é condicionada a `pending` — é o cadeado', async () => {
    const { db, updates } = makeDb({ vencidas: [LINHA] });

    await dispararVencidas(db);

    const claim = updates.find((u) => u.payload?.status === 'sending')!;
    expect(claim.eq.id).toBe('ag-1');
    expect(claim.in.status).toEqual(['pending']);
  });

  it('⚠️ recusa por atraso roda ANTES de qualquer envio, em bloco', async () => {
    const { db, updates } = makeDb({
      vencidas: [LINHA],
      atrasadas: [{ id: 'velha-1' }, { id: 'velha-2' }],
    });

    const r = await dispararVencidas(db, new Date('2026-08-01T12:00:00Z'));

    expect(r.atrasadas).toBe(2);
    // Achado pelo FILTRO, não pela posição: o recolhedor de travadas roda
    // antes, e amarrar no índice quebra o teste sem nada ter quebrado.
    const recusa = updates.find(
      (u) => u.payload?.status === 'failed' && u.eq.status === 'pending',
    )!;
    expect(recusa).toBeDefined();
    expect(recusa.payload!.status).toBe('failed');
    // Uma hora antes do relógio informado. Sem esta linha, o conserto do
    // agendador depois de dias fora do ar despejaria a fila inteira de uma
    // vez — dezenas de "bom dia" às 2 da manhã.
    expect(recusa.lt).toEqual(['scheduled_for', '2026-08-01T11:00:00.000Z']);
  });

  it('⚠️ recolhe o que travou em `sending` — o único caminho de duplicata', async () => {
    const { db, updates } = makeDb({
      vencidas: [],
      travadas: [{ id: 'presa-1' }],
    });

    const r = await dispararVencidas(db, new Date('2026-08-02T12:00:00Z'));

    expect(r.travadas).toBe(1);
    const recolher = updates.find((u) => u.eq.status === 'sending')!;
    expect(recolher).toBeDefined();
    expect(recolher.payload!.status).toBe('failed');
    // ⚠️ SEMPRE incerta: o processo morreu depois de reivindicar, e ninguém
    // sabe se foi antes ou depois de o WhatsApp aceitar. Sem isto, a tela
    // ofereceria "Tentar de novo" e o cliente receberia duas vezes.
    expect(recolher.payload!.entrega_incerta).toBe(true);
    expect(String(recolher.payload!.error)).toMatch(/PODE ter chegado/);
  });

  it('⚠️ o recolhimento mede pelo CARIMBO da reivindicação, não por outra coluna', async () => {
    const { db, updates } = makeDb({ travadas: [] });

    await dispararVencidas(db, new Date('2026-08-02T12:00:00Z'));

    const recolher = updates.find((u) => u.eq.status === 'sending')!;
    // ⚠️ `sending_desde` (928), e nenhuma outra. As duas colunas que eu tinha
    // usado antes erram para lados opostos: `created_at` recolheria um envio
    // EM CURSO, e `scheduled_for` deixaria a linha de "Executar agora"
    // travada até a data marcada — que pode ser daqui a 30 dias.
    expect(recolher.lt).toEqual(['sending_desde', '2026-08-02T11:50:00.000Z']);
  });

  it('⚠️ reivindicar CARIMBA a hora — sem isso o recolhimento fica cego', async () => {
    const { db, updates } = makeDb({ vencidas: [LINHA] });

    await dispararVencidas(db);

    const claim = updates.find((u) => u.payload?.status === 'sending')!;
    expect(typeof claim.payload!.sending_desde).toBe('string');
  });

  it('a linha reivindicada por "Executar agora" também é carimbada', async () => {
    // Era o buraco: `dispararUma` reivindica sem olhar `scheduled_for`, então
    // a linha marcada para daqui a 30 dias ficava fora de qualquer janela de
    // recolhimento baseada naquela coluna.
    const { db, updates } = makeDb({ uma: LINHA });

    await dispararUma(db, 'conta-1', 'ag-1');

    const claim = updates.find((u) => u.payload?.status === 'sending')!;
    expect(typeof claim.payload!.sending_desde).toBe('string');
  });

  it('recolher travadas roda ANTES da recusa por atraso', async () => {
    // Ordem load-bearing: quanto antes a travada virar `failed` visível,
    // menor a janela em que alguém tenta consertar mexendo no banco.
    const { db, updates } = makeDb({ travadas: [], atrasadas: [] });

    await dispararVencidas(db);

    const iRecolher = updates.findIndex((u) => u.eq.status === 'sending');
    const iRecusa = updates.findIndex(
      (u) => u.payload?.status === 'failed' && u.eq.status === 'pending',
    );
    expect(iRecolher).toBeGreaterThanOrEqual(0);
    expect(iRecusa).toBeGreaterThan(iRecolher);
  });

  it('a busca do ciclo é limitada e ordenada pela hora marcada', async () => {
    const { db, selects } = makeDb({ vencidas: [] });

    await dispararVencidas(db, new Date('2026-08-01T12:00:00Z'));

    const busca = selects[0];
    expect(busca.eq.status).toBe('pending');
    expect(busca.lte).toEqual(['scheduled_for', '2026-08-01T12:00:00.000Z']);
    expect(busca.limit).toBe(20);
  });

  it('uma falha não interrompe as outras do mesmo ciclo', async () => {
    enviar
      .mockRejectedValueOnce(new Error('primeira falhou'))
      .mockResolvedValueOnce({
        messageId: 'msg-2',
        whatsappMessageId: 'wamid-2',
        channelId: 'canal-1',
        contentText: 'ok',
      });
    const { db } = makeDb({
      vencidas: [LINHA, { ...LINHA, id: 'ag-2' }],
    });

    const r = await dispararVencidas(db);

    expect(r).toEqual({ enviadas: 1, falhas: 1, atrasadas: 0, travadas: 0 });
  });
});

describe('dispararUma', () => {
  it('aceita `pending` e `failed`, e reivindica dos dois', async () => {
    const { db, updates } = makeDb({ uma: LINHA });

    const r = await dispararUma(db, 'conta-1', 'ag-1');

    expect(r).toEqual({ enviada: true, erro: null });
    const claim = updates.find((u) => u.payload?.status === 'sending')!;
    expect(claim.in.status).toEqual(['pending', 'failed']);
  });

  it('⚠️ NÃO alcança linha em `sending` — reenviar dali manda duas vezes', async () => {
    // O stub devolve `null` porque o `.in(['pending','failed'])` não casaria.
    const { db } = makeDb({ uma: null });

    const r = await dispararUma(db, 'conta-1', 'ag-1');

    expect(r).toBeNull();
    expect(enviar).not.toHaveBeenCalled();
  });

  it('a busca é escopada pela conta', async () => {
    const { db, selects } = makeDb({ uma: LINHA });

    await dispararUma(db, 'conta-1', 'ag-1');

    expect(selects[0].eq.account_id).toBe('conta-1');
    expect(selects[0].eq.id).toBe('ag-1');
  });

  it('devolve o motivo quando o envio falha', async () => {
    enviar.mockRejectedValue(new Error('sem conexão'));
    const { db } = makeDb({ uma: LINHA });

    const r = await dispararUma(db, 'conta-1', 'ag-1');

    expect(r).toEqual({ enviada: false, erro: 'motivo relido' });
  });

  it('perder a corrida pela reivindicação devolve null, sem enviar', async () => {
    const { db } = makeDb({ uma: LINHA, reivindicaveis: [] });

    const r = await dispararUma(db, 'conta-1', 'ag-1');

    expect(r).toBeNull();
    expect(enviar).not.toHaveBeenCalled();
  });
});
