import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// A sonda inteira com os provedores simulados: o nível 4 (`sem-recibo.ts`)
// lê só as conexões de WhatsApp. O Instagram não manda recibo de entrega —
// todo envio dele fica em `sent` —, e lê-lo acenderia o âmbar para sempre
// em toda conexão do Direct com 5 envios em 3 conversas.
// ============================================================

const lidas: string[] = [];

vi.mock('./sem-recibo', async (importOriginal) => {
  const original = await importOriginal<typeof import('./sem-recibo')>();
  return {
    ...original,
    lerEnviosRecentes: vi.fn(async (_db: unknown, channelId: string, agoraMs: number) => {
      lidas.push(channelId);
      // Cinco envios com mais de 15 min, em 3 conversas, nenhum confirmado.
      return [20, 25, 30, 35, 40].map((min, i) => ({
        criadoEm: new Date(agoraMs - min * 60_000).toISOString(),
        status: 'sent',
        conversaId: ['a', 'b', 'c'][i % 3],
      }));
    }),
  };
});

vi.mock('@/lib/whatsapp/transport/evolution-client', () => ({
  EvolutionClient: class {
    async fetchInstances() {
      return [{ name: 'inst-a', connectionStatus: 'open' }];
    }
    async findWebhook() {
      return { enabled: true, url: 'https://crm.example.com/api/whatsapp/evolution/webhook' };
    }
  },
}));

vi.mock('@/lib/whatsapp/transport/evolution-provision', () => ({
  evolutionGlobalConfig: () => ({ baseUrl: 'https://evo.example.com', apikey: 'chave-de-teste' }),
}));

vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/meta-api')>()),
  verifyPhoneNumber: vi.fn(async () => ({})),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (texto: string) => texto }));

vi.mock('@/lib/instagram/graph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/instagram/graph')>()),
  criarClienteInstagram: () => ({ me: async () => ({}) }),
}));

const { probeChannels, __limparCacheDeSaude } = await import('./health');

const BASE_DA_LINHA = {
  display_phone: null,
  ig_username: null,
  is_default: false,
  status: 'connected',
  connected_at: null,
  last_error: null,
  last_checked_at: null,
  phone_number_id: null,
  server_url: null,
  instance_name: null,
  access_token: null,
  ig_user_id: null,
  entrega_carimbo_em: null,
  entrega_recebida_em: null,
};

const CANAIS = [
  { ...BASE_DA_LINHA, id: 'evo', kind: 'evolution', label: 'QR Code', server_url: 'https://evo.example.com', instance_name: 'inst-a' },
  { ...BASE_DA_LINHA, id: 'meta', kind: 'meta', label: 'Oficial', phone_number_id: '123', access_token: 'tok' },
  { ...BASE_DA_LINHA, id: 'ig', kind: 'instagram', label: 'Direct', ig_user_id: '999', access_token: 'tok' },
];

/** Banco falso: a lista de conexões e o UPDATE do frescor (que não interessa aqui). */
function bancoFalso(canais: unknown[] = CANAIS) {
  const lista = {
    select: () => lista,
    eq: () => lista,
    order: () => lista,
    then: (resolver: (r: unknown) => unknown) => Promise.resolve({ data: canais, error: null }).then(resolver),
  };
  const escrita = {
    update: () => escrita,
    eq: () => escrita,
    then: (resolver: (r: unknown) => unknown) => Promise.resolve({ error: null }).then(resolver),
  };
  return {
    from: () => ({ select: lista.select, update: escrita.update }),
  } as never;
}

describe('probeChannels — envios sem recibo só no WhatsApp', () => {
  beforeEach(() => {
    lidas.length = 0;
    __limparCacheDeSaude();
  });

  it('lê a Evolution e a Meta, e nunca o Instagram', async () => {
    await probeChannels(bancoFalso(), 'conta-1');
    expect(lidas.sort()).toEqual(['evo', 'meta']);
  });

  it('a conexão sem recibo sai âmbar com o `desde`; o Instagram, nunca', async () => {
    const saude = await probeChannels(bancoFalso(), 'conta-1');
    const porId = new Map(saude.map((c) => [c.id, c]));

    expect(porId.get('evo')).toMatchObject({ tone: 'warn', detail: 'sem_recibo' });
    expect(porId.get('evo')?.semReciboDesde).toEqual(expect.any(String));
    expect(porId.get('meta')).toMatchObject({ tone: 'warn', detail: 'sem_recibo' });

    expect(porId.get('ig')?.detail).not.toBe('sem_recibo');
    expect(porId.get('ig')?.semReciboDesde).toBeNull();
  });

  it('⚠️ o `desde` vai também ATRÁS de outro motivo (o botão das conexões o lê direto, E1)', async () => {
    const comErro = { ...CANAIS[0], id: 'evo-erro', last_error: 'falha antiga' };
    const saude = await probeChannels(bancoFalso([comErro]), 'conta-1');
    expect(saude[0]).toMatchObject({ tone: 'warn', detail: 'lastError' });
    expect(saude[0].semReciboDesde).toEqual(expect.any(String));
  });

  it('a leitura vale por 1 min para a conta: duas sondas seguidas leem uma vez', async () => {
    await probeChannels(bancoFalso(), 'conta-1');
    await probeChannels(bancoFalso(), 'conta-1');
    expect(lidas.sort()).toEqual(['evo', 'meta']);
  });
});

// ============================================================
// E1 (Fase 3): a sonda leva os episódios do sino ainda abertos, lidos com a
// service role e cercados pela conta.
// ============================================================

const MIN = 60_000;

interface LinhaDoEstadoFalsa {
  channel_id: string;
  tipo: 'sem_recibo' | 'atraso';
  desde: string;
  avisado_em?: string | null;
  normalizou_em?: string | null;
  devido_em?: string | null;
}

/** A service role: só a leitura do estado, com a conta conferida. */
function adminFalso(resposta: { linhas: LinhaDoEstadoFalsa[] } | { erro: string }) {
  const contas: string[] = [];
  const consulta = {
    select: () => consulta,
    eq: (coluna: string, valor: string) => {
      if (coluna === 'account_id') contas.push(valor);
      return consulta;
    },
    order: () => consulta,
    range: async () =>
      'erro' in resposta
        ? { data: null, error: { message: resposta.erro } }
        : {
            data: resposta.linhas.map((l) => ({
              avisado_em: null,
              normalizou_em: null,
              devido_em: null,
              detalhe: null,
              ...l,
            })),
            error: null,
          },
  };
  return { db: { from: () => consulta } as never, contas };
}

describe('probeChannels — os episódios abertos do sino (E1)', () => {
  beforeEach(() => {
    lidas.length = 0;
    __limparCacheDeSaude();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('sem a service role (a régua do Asaas), `episodios` sai null', async () => {
    const saude = await probeChannels(bancoFalso(), 'conta-1');
    expect(saude.every((c) => c.episodios === null)).toBe(true);
  });

  it('com ela, cada conexão leva os dela, e a leitura é cercada pela conta', async () => {
    const agora = Date.now();
    const admin = adminFalso({
      linhas: [
        { channel_id: 'evo', tipo: 'sem_recibo', desde: new Date(agora - 120 * MIN).toISOString() },
        { channel_id: 'meta', tipo: 'atraso', desde: new Date(agora - 40 * MIN).toISOString() },
      ],
    });
    const saude = await probeChannels(bancoFalso(), 'conta-1', admin.db);
    const porId = new Map(saude.map((c) => [c.id, c]));

    expect(admin.contas).toEqual(['conta-1']);
    // O (c) aceso e ainda não avisado acompanha a sequência de agora (40 min).
    expect(porId.get('evo')?.episodios).toEqual([
      { tipo: 'sem_recibo', desdeIso: expect.any(String) },
    ]);
    expect(Date.parse(porId.get('evo')!.episodios![0].desdeIso)).toBeGreaterThan(agora - 41 * MIN);
    // O (b) sem medição ("não sei") com 40 min de episódio continua aberto.
    expect(porId.get('meta')?.episodios).toEqual([
      { tipo: 'atraso', desdeIso: new Date(agora - 40 * MIN).toISOString() },
    ]);
    expect(porId.get('ig')?.episodios).toEqual([]);
  });

  it('⚠️ a leitura que falha é "não sei" (null), nunca "nenhum", e não fica no cache', async () => {
    const quebrado = adminFalso({ erro: 'tempo esgotado' });
    const antes = await probeChannels(bancoFalso(), 'conta-1', quebrado.db);
    expect(antes.every((c) => c.episodios === null)).toBe(true);

    const bom = adminFalso({
      linhas: [{ channel_id: 'meta', tipo: 'atraso', desde: new Date(Date.now() - 45 * MIN).toISOString() }],
    });
    const depois = await probeChannels(bancoFalso(), 'conta-1', bom.db);
    expect(bom.contas).toEqual(['conta-1']);
    expect(depois.find((c) => c.id === 'meta')?.episodios).toHaveLength(1);
  });

  it('a prova já guardada (`normalizou_em`) fecha o episódio na tela antes de o ciclo apagar a linha', async () => {
    const admin = adminFalso({
      linhas: [
        {
          channel_id: 'meta',
          tipo: 'atraso',
          desde: new Date(Date.now() - 50 * MIN).toISOString(),
          normalizou_em: new Date(Date.now() - 2 * MIN).toISOString(),
        },
      ],
    });
    const saude = await probeChannels(bancoFalso(), 'conta-1', admin.db);
    expect(saude.find((c) => c.id === 'meta')?.episodios).toEqual([]);
  });
});
