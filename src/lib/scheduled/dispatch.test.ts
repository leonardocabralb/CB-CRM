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

    expect(r).toEqual({ enviadas: 1, falhas: 0, atrasadas: 0 });
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
    expect(r).toEqual({ enviadas: 0, falhas: 0, atrasadas: 0 });
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
    const recusa = updates[0];
    expect(recusa.payload!.status).toBe('failed');
    expect(recusa.eq.status).toBe('pending');
    // Uma hora antes do relógio informado. Sem esta linha, o conserto do
    // agendador depois de dias fora do ar despejaria a fila inteira de uma
    // vez — dezenas de "bom dia" às 2 da manhã.
    expect(recusa.lt).toEqual(['scheduled_for', '2026-08-01T11:00:00.000Z']);
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

    expect(r).toEqual({ enviadas: 1, falhas: 1, atrasadas: 0 });
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
