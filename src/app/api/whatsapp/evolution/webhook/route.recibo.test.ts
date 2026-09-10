import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// A corrida medida em 10/09/2026, de ponta a ponta DENTRO da rota: os dois
// webhooks que a Evolution despachou no mesmo segundo — a mensagem que saiu
// do celular e o recibo de entrega dela — entram pelo `POST` de verdade, na
// ordem em que chegaram, sobre um PostgREST de mentira em memória. A espera
// de 2 s do `jaGravada` é a REAL (é ela que faz o recibo chegar antes da
// linha); só a gravação da mensagem é simulada, porque aquele caminho não
// mudou. Números e ids são fictícios.
// ============================================================

const h = vi.hoisted(() => {
  type Linha = Record<string, unknown>;
  const estado = {
    tabelas: {} as Record<string, Linha[]>,
    after: [] as (() => Promise<void> | void)[],
    /** Linhas que cada UPDATE em `messages` alcançou, em ordem. */
    updates: [] as number[],
    disparos: [] as Linha[],
  };

  /** O pedaço do query builder do supabase-js que a rota usa. */
  function consulta(tabela: string) {
    const filtros: ((l: Linha) => boolean)[] = [];
    let op: 'select' | 'update' = 'select';
    let patch: Linha = {};
    let devolve = false;
    let limite = Infinity;
    const executar = () => {
      const linhas = (estado.tabelas[tabela] ??= [])
        .filter((l) => filtros.every((f) => f(l)))
        .slice(0, limite);
      if (op === 'update') {
        if (tabela === 'messages') estado.updates.push(linhas.length);
        for (const l of linhas) Object.assign(l, patch);
        return { data: devolve ? linhas.map((l) => ({ ...l })) : null, error: null };
      }
      return { data: linhas.map((l) => ({ ...l })), error: null };
    };
    const q = {
      select: () => {
        if (op === 'update') devolve = true;
        return q;
      },
      update: (p: Linha) => {
        op = 'update';
        patch = p;
        return q;
      },
      eq: (c: string, v: unknown) => {
        filtros.push((l) => l[c] === v);
        return q;
      },
      in: (c: string, vs: unknown[]) => {
        filtros.push((l) => vs.includes(l[c]));
        return q;
      },
      limit: (n: number) => {
        limite = n;
        return q;
      },
      maybeSingle: () => Promise.resolve({ data: executar().data?.[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(ok, falha),
    };
    return q;
  }
  return { estado, consulta };
});

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.estado.after.push(cb);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (tabela: string) => h.consulta(tabela) }),
}));

vi.mock('@/lib/whatsapp/inbound-store', () => ({
  // O caminho real (contato, conversa, INSERT) não mudou neste PR: aqui ele
  // leva o tempo de umas consultas e grava a linha como o real grava.
  persistDeviceMessage: vi.fn(
    async (_db: unknown, m: { providerMessageId: string; channelId?: string | null }) => {
      await new Promise((r) => setTimeout(r, 150));
      h.estado.tabelas.messages.push({
        id: 'msg-1',
        conversation_id: 'conv-1',
        channel_id: m.channelId ?? null,
        message_id: m.providerMessageId,
        sender_type: 'agent',
        from_device: true,
        status: 'sent',
        conversations: { account_id: 'conta-1' },
      });
      return { messageId: 'msg-1', conversationId: 'conv-1', contato: null };
    },
  ),
  persistInboundMessage: vi.fn(async () => null),
}));

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(
    async (_db: unknown, _conta: string, evento: string, dados: Record<string, unknown>) => {
      h.estado.disparos.push({ evento, ...dados });
    },
  ),
}));

import { POST } from './route';

const SEGREDO = 'segredo-de-teste';
const INSTANCIA = 'cbcrm-instancia-de-teste';
const KEY_ID = '3EB0000000000000AB26';

const upsert = {
  event: 'messages.upsert',
  instance: INSTANCIA,
  data: {
    key: {
      remoteJid: '5583900000000@s.whatsapp.net',
      remoteJidAlt: '100000000000000@lid',
      fromMe: true,
      id: KEY_ID,
    },
    pushName: 'Você',
    status: 'SERVER_ACK',
    message: { conversation: 'O advogado entra no link em 10 minutos.' },
    messageType: 'conversation',
    messageTimestamp: 1789044688,
    source: 'unknown',
  },
};

const recibo = (status: string, fromMe = true) => ({
  event: 'messages.update',
  instance: INSTANCIA,
  data: { keyId: KEY_ID, remoteJid: '100000000000000@lid', fromMe, status },
});

/** Entrega um webhook ao `POST` e devolve o trabalho que ele deixou no `after()`. */
async function receber(corpo: unknown) {
  const antes = h.estado.after.length;
  await POST(
    new Request('http://localhost/api/whatsapp/evolution/webhook', {
      method: 'POST',
      headers: { authorization: `Bearer ${SEGREDO}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  );
  const novos = h.estado.after.slice(antes);
  expect(novos).toHaveLength(1);
  return novos[0];
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.EVOLUTION_WEBHOOK_SECRET = SEGREDO;
  h.estado.tabelas = {
    cb_channels: [
      {
        id: 'canal-1',
        account_id: 'conta-1',
        created_by: 'dono-1',
        groups_enabled: false,
        own_lid: null,
        instance_name: INSTANCIA,
        kind: 'evolution',
      },
    ],
    messages: [],
  };
  h.estado.after = [];
  h.estado.updates = [];
  h.estado.disparos = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recibo que chega antes da mensagem — a rota inteira', () => {
  it('⚠️ a corrida de 10/09/2026: o recibo entra antes da mensagem e, ainda assim, a bolha vira ✓✓', async () => {
    const gravar = await receber(upsert); // chegou primeiro
    const aplicar = await receber(recibo('DELIVERY_ACK')); // milissegundos depois

    const fim = Promise.all([gravar(), aplicar()]);
    await vi.advanceTimersByTimeAsync(40_000);
    await fim;

    expect(h.estado.tabelas.messages).toHaveLength(1);
    expect(h.estado.tabelas.messages[0].status).toBe('delivered');
    // Os dois primeiros UPDATEs acharam ZERO linhas: a mensagem ainda estava
    // na espera do `jaGravada`. Antes deste PR o recibo morria no primeiro.
    expect(h.estado.updates).toEqual([0, 0, 1]);
    expect(h.estado.disparos).toEqual([
      expect.objectContaining({
        evento: 'message.status_updated',
        status: 'delivered',
        whatsapp_message_id: KEY_ID,
      }),
    ]);
  });

  it('recibo de mensagem RECEBIDA (fromMe false) não espera: uma tentativa, nenhum timer pendente', async () => {
    const aplicar = await receber(recibo('READ', false));
    await aplicar();

    expect(h.estado.updates).toEqual([0]);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.estado.disparos).toEqual([]);
  });

  it('SERVER_ACK atrasado sobre mensagem já entregue: não rebaixa, não anuncia, não fica esperando', async () => {
    h.estado.tabelas.messages.push({
      id: 'msg-1',
      conversation_id: 'conv-1',
      message_id: KEY_ID,
      sender_type: 'agent',
      status: 'delivered',
      conversations: { account_id: 'conta-1' },
    });
    const aplicar = await receber(recibo('SERVER_ACK'));
    await aplicar();

    expect(h.estado.tabelas.messages[0].status).toBe('delivered');
    // O UPDATE e a tentativa extra depois de achar a linha: a escada recusou os dois.
    expect(h.estado.updates).toEqual([0, 0]);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.estado.disparos).toEqual([]);
  });

  it('mensagem que nunca vira linha: o recibo desiste no fim das pausas, sem escrever nada', async () => {
    const aplicar = await receber(recibo('DELIVERY_ACK'));
    const fim = aplicar();
    await vi.advanceTimersByTimeAsync(40_000);
    await fim;

    expect(h.estado.updates).toEqual([0, 0, 0, 0, 0, 0]);
    expect(h.estado.disparos).toEqual([]);
  });
});
