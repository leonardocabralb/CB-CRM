import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PAUSAS_DO_RECIBO_DA_META_MS } from '@/lib/whatsapp/transport/recibo-da-meta';

// ============================================================
// O recibo (status) da Meta, de ponta a ponta DENTRO da rota: cada webhook
// entra pelo `POST` de verdade e o trabalho do `after()` roda sobre um
// PostgREST de mentira em memória, que aplica os filtros de verdade (`eq`,
// `in`, o `or` do escopo por canal). Os timers são falsos: a espera pela
// linha da mensagem é a REAL. Números e ids são fictícios.
// ============================================================

const h = vi.hoisted(() => {
  type Linha = Record<string, unknown>;
  const estado = {
    tabelas: {} as Record<string, Linha[]>,
    after: [] as (() => Promise<void> | void)[],
    /** Linhas que cada UPDATE em `messages` alcançou, em ordem. */
    updates: [] as number[],
    /** `tabela:operação`, na ordem em que o banco as executou. */
    log: [] as string[],
    disparos: [] as Linha[],
    /** O canal que `resolveInboundMetaChannelId` resolve. */
    canal: 'canal-meta' as string | null,
    /** Faz a busca do canal de ENTRADA estourar (o caminho da mensagem). */
    entradaEstoura: false,
  };

  /** O pedaço do query builder do supabase-js que a rota usa. */
  function consulta(tabela: string) {
    const filtros: ((l: Linha) => boolean)[] = [];
    let op: 'select' | 'update' = 'select';
    let patch: Linha = {};
    let devolve = false;
    let limite = Infinity;
    const executar = () => {
      estado.log.push(`${tabela}:${op}`);
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
      // Só as duas formas que a rota escreve: `col.eq.valor` e `col.is.null`.
      or: (expressao: string) => {
        const termos = expressao.split(',').map((termo) => {
          const [coluna, operador, ...resto] = termo.split('.');
          const valor = resto.join('.');
          if (operador === 'eq') return (l: Linha) => l[coluna] === valor;
          if (operador === 'is' && valor === 'null') return (l: Linha) => l[coluna] == null;
          throw new Error(`or() fora do que a rota usa: ${termo}`);
        });
        filtros.push((l) => termos.some((f) => f(l)));
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

// O resto da rota (a ingestão) não participa: os mesmos dublês do
// `route.test.ts`, para o import não arrastar os motores.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'token',
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({ getMediaUrl: vi.fn(), downloadMedia: vi.fn() }));
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}));
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: () => false,
  handleTemplateWebhookChange: vi.fn(),
}));
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: vi.fn() }));
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: vi.fn() }));
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: vi.fn() }));
vi.mock('@/lib/cb-channels/pipeline-routing', () => ({ routeContactToPipeline: vi.fn() }));
vi.mock('@/lib/cb-channels/resolve-inbound', () => ({
  resolveInboundMetaChannelId: vi.fn(async () => h.estado.canal),
  resolveInboundMetaChannel: vi.fn(async () => {
    if (h.estado.entradaEstoura) throw new Error('a busca do canal de entrada estourou');
    return null;
  }),
}));

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(
    async (_db: unknown, conta: string, evento: string, dados: Record<string, unknown>) => {
      h.estado.disparos.push({ conta, evento, ...dados });
    },
  ),
}));

import { POST } from './route';

const WAMID = 'wamid.TESTE00000000000000000000000001';

/** Uma mensagem que o CRM mandou pelo número oficial. */
function mensagem(extra: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    conversation_id: 'conv-1',
    channel_id: 'canal-meta',
    message_id: WAMID,
    sender_type: 'bot',
    status: 'sent',
    conversations: { account_id: 'conta-1' },
    ...extra,
  };
}

function statusDaMeta(status: string, id = WAMID) {
  return { id, status, timestamp: '1790000000', recipient_id: '5583900000000' };
}

/** O corpo que a Meta manda: uma `change` de `messages` com o recibo. */
function corpo(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '551100000000', phone_number_id: 'pn-1' },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

/** Entrega um webhook ao `POST` e devolve o trabalho que ele deixou no `after()`. */
async function receber(body: unknown) {
  const antes = h.estado.after.length;
  await POST({
    text: async () => JSON.stringify(body),
    headers: { get: () => 'sha256=teste' },
  } as unknown as Request);
  const novos = h.estado.after.slice(antes);
  expect(novos).toHaveLength(1);
  return novos[0];
}

const recibo = (status: string, id = WAMID) => receber(corpo({ statuses: [statusDaMeta(status, id)] }));

const linha = (id = 'msg-1') => h.estado.tabelas.messages.find((l) => l.id === id);

beforeEach(() => {
  vi.useFakeTimers();
  h.estado.tabelas = { messages: [], broadcast_recipients: [], whatsapp_config: [] };
  h.estado.after = [];
  h.estado.updates = [];
  h.estado.log = [];
  h.estado.disparos = [];
  h.estado.canal = 'canal-meta';
  h.estado.entradaEstoura = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('recibo da Meta fora de ordem', () => {
  it('⚠️ a desordem medida em 23/09/2026: o sent gravado DEPOIS do delivered não rebaixa a bolha', async () => {
    h.estado.tabelas.messages.push(mensagem());
    const entregue = await recibo('delivered');
    const enviado = await recibo('sent');

    await entregue();
    await enviado(); // o que terminou por último na produção

    expect(linha()?.status).toBe('delivered');
    expect(vi.getTimerCount()).toBe(0);
    // Só o avanço é anunciado; o sent atrasado não conta nada ao integrador.
    expect(h.estado.disparos).toEqual([
      expect.objectContaining({
        conta: 'conta-1',
        evento: 'message.status_updated',
        status: 'delivered',
        whatsapp_message_id: WAMID,
        conversation_id: 'conv-1',
        channel_id: 'canal-meta',
      }),
    ]);
  });

  it('os dois no mesmo instante: termina em delivered, e só o delivered é anunciado', async () => {
    // No banco de mentira os UPDATEs rodam na ordem de chegada (aqui, sent
    // antes de delivered): este caso NÃO reproduz a desordem — quem a fixa
    // é o teste de cima. Ele confere a linha e o anúncio sob Promise.all.
    h.estado.tabelas.messages.push(mensagem());
    const enviado = await recibo('sent');
    const entregue = await recibo('delivered');

    await Promise.all([enviado(), entregue()]);

    expect(linha()?.status).toBe('delivered');
    expect(h.estado.disparos.map((d) => d.status)).toEqual(['delivered']);
  });

  it('read é o topo: delivered atrasado depois dele não rebaixa', async () => {
    h.estado.tabelas.messages.push(mensagem({ status: 'read' }));
    await (await recibo('delivered'))();

    expect(linha()?.status).toBe('read');
    expect(h.estado.disparos).toEqual([]);
  });

  it('⚠️ falha atrasada não pinta de vermelho o que já foi entregue', async () => {
    h.estado.tabelas.messages.push(mensagem({ status: 'delivered' }));
    await (await recibo('failed'))();

    expect(linha()?.status).toBe('delivered');
    // A linha existe: uma tentativa extra e nenhuma espera.
    expect(h.estado.updates).toEqual([0, 0]);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.estado.disparos).toEqual([]);
  });

  it('falha que chega a tempo vale, e é anunciada', async () => {
    h.estado.tabelas.messages.push(mensagem());
    await (await recibo('failed'))();

    expect(linha()?.status).toBe('failed');
    expect(h.estado.disparos.map((d) => d.status)).toEqual(['failed']);
  });

  it('played (nota de voz ouvida) grava read e anuncia read', async () => {
    h.estado.tabelas.messages.push(mensagem({ status: 'delivered' }));
    await (await recibo('played'))();

    expect(linha()?.status).toBe('read');
    expect(h.estado.disparos.map((d) => d.status)).toEqual(['read']);
  });

  it('status fora do vocabulário não toca em nada', async () => {
    h.estado.tabelas.messages.push(mensagem());
    await (await recibo('deleted'))();

    expect(linha()?.status).toBe('sent');
    expect(h.estado.log.filter((l) => l.startsWith('messages'))).toEqual([]);
    expect(h.estado.disparos).toEqual([]);
  });
});

describe('recibo da Meta que chega antes da mensagem', () => {
  it('⚠️ o delivered chega antes da gravação e, ainda assim, a bolha vira ✓✓', async () => {
    const aplicar = await recibo('delivered');
    // A linha nasce 1,5 s depois — o envio ainda estava gravando.
    setTimeout(() => h.estado.tabelas.messages.push(mensagem()), 1_500);

    const fim = aplicar();
    await vi.advanceTimersByTimeAsync(10_000);
    await fim;

    expect(linha()?.status).toBe('delivered');
    expect(h.estado.updates).toEqual([0, 0, 1]);
    expect(h.estado.disparos.map((d) => d.status)).toEqual(['delivered']);
  });

  it('⚠️ a falha que chega antes da gravação (ex.: janela de 24 h fechada) também não se perde', async () => {
    const aplicar = await recibo('failed');
    setTimeout(() => h.estado.tabelas.messages.push(mensagem()), 800);

    const fim = aplicar();
    await vi.advanceTimersByTimeAsync(10_000);
    await fim;

    expect(linha()?.status).toBe('failed');
  });

  it('sent não espera: a linha nasce sent, e nada fica agendado', async () => {
    await (await recibo('sent'))();

    expect(h.estado.updates).toEqual([0]);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.estado.disparos).toEqual([]);
  });

  it('mensagem que nunca vira linha (outro sistema no mesmo número): desiste nas pausas da Meta, sem escrever nada', async () => {
    const aplicar = await recibo('delivered');
    const fim = aplicar();
    const total = PAUSAS_DO_RECIBO_DA_META_MS.reduce((a, b) => a + b, 0);
    await vi.advanceTimersByTimeAsync(total);
    await fim;

    expect(h.estado.updates).toEqual(Array(PAUSAS_DO_RECIBO_DA_META_MS.length + 1).fill(0));
    expect(vi.getTimerCount()).toBe(0);
    expect(h.estado.disparos).toEqual([]);
  });
});

describe('o disparo (campanha)', () => {
  it('o destinatário avança na hora e o recibo NÃO espera a linha que o disparo não grava', async () => {
    h.estado.tabelas.broadcast_recipients.push({
      id: 'dest-1',
      whatsapp_message_id: WAMID,
      status: 'sent',
    });
    await (await recibo('delivered'))();

    const destinatario = h.estado.tabelas.broadcast_recipients[0];
    expect(destinatario.status).toBe('delivered');
    expect(destinatario.delivered_at).toBe(new Date(1790000000 * 1000).toISOString());
    expect(h.estado.updates).toEqual([0]);
    expect(vi.getTimerCount()).toBe(0);
    // O destinatário é gravado ANTES de qualquer consulta a `messages`.
    expect(h.estado.log.indexOf('broadcast_recipients:update')).toBeLessThan(
      h.estado.log.indexOf('messages:update'),
    );
  });
});

describe('o que o UPDATE alcança', () => {
  it('escopo por canal: a homônima de OUTRO número fica intacta; a sem carimbo (anterior à Fase 3) avança', async () => {
    h.estado.tabelas.messages.push(
      mensagem({ id: 'outro-numero', channel_id: 'canal-outro' }),
      mensagem({ id: 'sem-carimbo', channel_id: null }),
    );
    await (await recibo('delivered'))();

    expect(linha('outro-numero')?.status).toBe('sent');
    expect(linha('sem-carimbo')?.status).toBe('delivered');
  });

  it('a homônima de outro número não conta como "a linha já existe": o recibo continua esperando a DELE', async () => {
    h.estado.tabelas.messages.push(mensagem({ id: 'outro-numero', channel_id: 'canal-outro' }));
    const aplicar = await recibo('delivered');
    setTimeout(() => h.estado.tabelas.messages.push(mensagem()), 1_500);

    const fim = aplicar();
    await vi.advanceTimersByTimeAsync(10_000);
    await fim;

    expect(linha('outro-numero')?.status).toBe('sent');
    expect(linha()?.status).toBe('delivered');
  });

  it('sem canal resolvido (conta de um número só), o UPDATE não escopa', async () => {
    h.estado.canal = null;
    h.estado.tabelas.messages.push(mensagem({ channel_id: 'qualquer' }));
    await (await recibo('delivered'))();

    expect(linha()?.status).toBe('delivered');
  });

  it('linha de CLIENTE com o mesmo id não é tocada nem conta como "a linha já existe"', async () => {
    // Recibo é de mensagem que nós mandamos: o filtro de saída vale no
    // UPDATE e na pergunta "a linha já existe?", senão a espera pela nossa
    // terminaria na hora.
    h.estado.tabelas.messages.push(mensagem({ id: 'do-cliente', sender_type: 'customer' }));
    const aplicar = await recibo('delivered');
    setTimeout(() => h.estado.tabelas.messages.push(mensagem()), 1_500);

    const fim = aplicar();
    await vi.advanceTimersByTimeAsync(10_000);
    await fim;

    expect(linha('do-cliente')?.status).toBe('sent');
    expect(linha()?.status).toBe('delivered');
  });

  it('o anúncio sai com a conversa da linha que AVANÇOU, não da primeira com o mesmo id', async () => {
    h.estado.tabelas.messages.push(
      mensagem({ id: 'outro-numero', channel_id: 'canal-outro', conversation_id: 'conv-outra', conversations: { account_id: 'conta-outra' } }),
      mensagem(),
    );
    await (await recibo('delivered'))();

    expect(h.estado.disparos).toEqual([
      expect.objectContaining({ conta: 'conta-1', conversation_id: 'conv-1' }),
    ]);
  });
});

describe('timestamp ilegível', () => {
  it('não impede a gravação da mensagem: o timestamp só serve à contagem da campanha', async () => {
    h.estado.tabelas.messages.push(mensagem());
    await (await receber(corpo({ statuses: [{ ...statusDaMeta('delivered'), timestamp: 'x' }] })))();

    expect(linha()?.status).toBe('delivered');
  });

  it('o recibo de disparo que estoura não leva junto o seguinte do mesmo POST', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.estado.tabelas.broadcast_recipients.push({
      id: 'dest-1',
      whatsapp_message_id: 'wamid.DISPARO',
      status: 'sent',
    });
    h.estado.tabelas.messages.push(mensagem());
    const body = corpo({
      statuses: [{ ...statusDaMeta('delivered', 'wamid.DISPARO'), timestamp: 'x' }, statusDaMeta('delivered')],
    });
    await (await receber(body))();

    expect(linha()?.status).toBe('delivered');
    expect(erro).toHaveBeenCalledWith('Error applying status update:', expect.any(RangeError));
  });
});

describe('o recibo não segura a mensagem do cliente', () => {
  const recebida = {
    contacts: [{ wa_id: '5583900000000', profile: { name: 'Cliente de Teste' } }],
    messages: [
      { id: 'wamid.RECEBIDA0001', from: '5583900000000', timestamp: '1790000001', type: 'text', text: { body: 'oi' } },
    ],
  };

  it('⚠️ no mesmo POST, a mensagem entra primeiro e o recibo espera depois', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fim = (await receber(corpo({ statuses: [statusDaMeta('delivered')], ...recebida })))();
    await vi.advanceTimersByTimeAsync(10_000);
    await fim;

    // O caminho da mensagem começa pela config do número; o recibo, pela campanha.
    expect(h.estado.log.indexOf('whatsapp_config:select')).toBeGreaterThanOrEqual(0);
    expect(h.estado.log.indexOf('whatsapp_config:select')).toBeLessThan(
      h.estado.log.indexOf('broadcast_recipients:select'),
    );
  });

  it('a mensagem que estoura não leva o recibo junto', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.estado.entradaEstoura = true;
    h.estado.tabelas.messages.push(mensagem());

    await (await receber(corpo({ statuses: [statusDaMeta('delivered')], ...recebida })))();

    expect(linha()?.status).toBe('delivered');
    expect(erro).toHaveBeenCalledWith('Error processing webhook:', expect.any(Error));
  });
});
