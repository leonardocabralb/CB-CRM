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

  // Revisão do PR #277: no disparo pela TELA o wamid só chega ao destinatário
  // quando o lote de 10 volta ao navegador.
  const gravarDestinatarioEm = (ms: number) =>
    setTimeout(
      () =>
        h.estado.tabelas.broadcast_recipients.push({
          id: 'dest-1',
          whatsapp_message_id: WAMID,
          status: 'sent',
        }),
      ms,
    );

  it('⚠️ o delivered que chega ANTES de o navegador gravar o wamid não se perde', async () => {
    const aplicar = await recibo('delivered');
    gravarDestinatarioEm(2_500);

    const fim = aplicar();
    await vi.advanceTimersByTimeAsync(10_000);
    await fim;

    const destinatario = h.estado.tabelas.broadcast_recipients[0];
    expect(destinatario.status).toBe('delivered');
    expect(destinatario.delivered_at).toBe(new Date(1790000000 * 1000).toISOString());
    // Disparo não tem linha em `messages`: nada a anunciar, e achado o
    // destinatário a espera acaba (sem ir até o fim das pausas).
    expect(h.estado.disparos).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.estado.log.filter((l) => l === 'broadcast_recipients:select')).toHaveLength(3);
  });

  it('⚠️ a falha que chega antes também vale, com o motivo', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const aplicar = await receber(
      corpo({
        statuses: [
          {
            ...statusDaMeta('failed'),
            errors: [{ code: 131049, title: 'Marketing limit', error_data: { details: 'x' } }],
          },
        ],
      }),
    );
    gravarDestinatarioEm(800);

    const fim = aplicar();
    await vi.advanceTimersByTimeAsync(10_000);
    await fim;

    expect(h.estado.tabelas.broadcast_recipients[0]).toMatchObject({
      status: 'failed',
      error_message: '[131049] Marketing limit: x',
    });
  });

  it('o limite escrito: gravado depois do fim da espera (7 s), o recibo ainda se perde', async () => {
    const aplicar = await recibo('delivered');
    gravarDestinatarioEm(PAUSAS_DO_RECIBO_DA_META_MS.reduce((a, b) => a + b, 0) + 1_000);

    const fim = aplicar();
    await vi.advanceTimersByTimeAsync(20_000);
    await fim;

    expect(h.estado.tabelas.broadcast_recipients[0].status).toBe('sent');
  });

  it('sent não espera nem reconfere: o navegador grava o destinatário já como sent', async () => {
    await (await recibo('sent'))();

    expect(h.estado.log.filter((l) => l === 'broadcast_recipients:select')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('o disparo: dois recibos do mesmo destinatário ao mesmo tempo', () => {
  /** Os dois POSTs leram o destinatário antes de qualquer um gravar? */
  const leramAntesDeGravar = () =>
    h.estado.log.filter((l) => l.startsWith('broadcast_recipients')).slice(0, 2);

  beforeEach(() => {
    h.estado.tabelas.broadcast_recipients.push({
      id: 'dest-1',
      whatsapp_message_id: WAMID,
      status: 'sent',
    });
  });

  it('⚠️ read e delivered juntos: fica read, e a contagem de lidas não perde um', async () => {
    const lido = await recibo('read');
    const entregue = await recibo('delivered');

    await Promise.all([lido(), entregue()]);

    // A intercalação que a revisão do PR #277 reproduziu: sem ela, este
    // teste não provaria nada.
    expect(leramAntesDeGravar()).toEqual(['broadcast_recipients:select', 'broadcast_recipients:select']);
    expect(h.estado.tabelas.broadcast_recipients[0].status).toBe('read');
  });

  it('⚠️ failed junto com delivered: o destinatário entregue não vira falha', async () => {
    const entregue = await recibo('delivered');
    const falhou = await recibo('failed');

    await Promise.all([entregue(), falhou()]);

    expect(leramAntesDeGravar()).toEqual(['broadcast_recipients:select', 'broadcast_recipients:select']);
    expect(h.estado.tabelas.broadcast_recipients[0].status).toBe('delivered');
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

// ------------------------------------------------------------
// O motivo da falha (Fase 5 do merge do upstream, #535; colunas da 1039).
// ------------------------------------------------------------

describe('o motivo da falha que a Meta manda no recibo', () => {
  const ERRO = {
    code: 131026,
    title: 'Message undeliverable',
    error_data: { details: 'Unable to deliver message.' },
  };
  const falhaComMotivo = (errors: unknown = [ERRO]) =>
    receber(corpo({ statuses: [{ ...statusDaMeta('failed'), errors }] }));

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('grava código, título e detalhes no MESMO update que marca a falha', async () => {
    h.estado.tabelas.messages.push(mensagem());
    await (await falhaComMotivo())();

    expect(linha()).toMatchObject({
      status: 'failed',
      error_code: 131026,
      error_title: 'Message undeliverable',
      error_details: 'Unable to deliver message.',
    });
    expect(h.estado.updates).toEqual([1]);
    expect(h.estado.disparos.map((d) => d.status)).toEqual(['failed']);
    expect(console.warn).toHaveBeenCalledWith(
      `WhatsApp message ${WAMID} failed: [131026] Message undeliverable: Unable to deliver message.`,
    );
  });

  it('no disparo, o motivo vai para o error_message do destinatário', async () => {
    h.estado.tabelas.broadcast_recipients.push({ id: 'dest-1', whatsapp_message_id: WAMID, status: 'sent' });
    await (await falhaComMotivo())();

    expect(h.estado.tabelas.broadcast_recipients[0]).toMatchObject({
      status: 'failed',
      error_message: '[131026] Message undeliverable: Unable to deliver message.',
    });
  });

  it('failed sem errors grava só a situação', async () => {
    h.estado.tabelas.messages.push(mensagem());
    await (await recibo('failed'))();

    expect(linha()?.status).toBe('failed');
    expect(linha()).not.toHaveProperty('error_code');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('⚠️ a falha que chega depois da entrega não grava motivo (a escada a recusa inteira)', async () => {
    h.estado.tabelas.messages.push(mensagem({ status: 'delivered' }));
    h.estado.tabelas.broadcast_recipients.push({ id: 'dest-1', whatsapp_message_id: WAMID, status: 'delivered' });
    await (await falhaComMotivo())();

    expect(linha()?.status).toBe('delivered');
    expect(linha()).not.toHaveProperty('error_code');
    expect(h.estado.tabelas.broadcast_recipients[0]).not.toHaveProperty('error_message');
  });

  it('⚠️ um recibo depois da falha não apaga o motivo — e a situação continua failed', async () => {
    h.estado.tabelas.messages.push(mensagem());
    await (await falhaComMotivo())();
    await (await recibo('delivered'))();
    await (await recibo('read'))();

    // Sem conferir a situação, este caso passaria sem testar nada: é a escada
    // (a falha é terminal) que impede o recibo seguinte de alcançar a linha.
    expect(linha()).toMatchObject({ status: 'failed', error_code: 131026, error_title: 'Message undeliverable' });
  });

  it('a falha que chega antes da gravação espera a linha e grava o motivo junto', async () => {
    const aplicar = await falhaComMotivo();
    setTimeout(() => h.estado.tabelas.messages.push(mensagem()), 800);

    const fim = aplicar();
    await vi.advanceTimersByTimeAsync(10_000);
    await fim;

    expect(linha()).toMatchObject({ status: 'failed', error_code: 131026 });
  });

  it('⚠️ campo de tipo errado não derruba a gravação da falha', async () => {
    h.estado.tabelas.messages.push(mensagem());
    await (await falhaComMotivo([{ code: 'sem-codigo', title: 'Message undeliverable' }]))();

    expect(linha()).toMatchObject({ status: 'failed', error_code: null, error_title: 'Message undeliverable' });
  });
});
