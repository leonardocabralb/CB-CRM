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
function bancoFalso() {
  const lista = {
    select: () => lista,
    eq: () => lista,
    order: () => lista,
    then: (resolver: (r: unknown) => unknown) => Promise.resolve({ data: CANAIS, error: null }).then(resolver),
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

  it('a leitura vale por 1 min para a conta: duas sondas seguidas leem uma vez', async () => {
    await probeChannels(bancoFalso(), 'conta-1');
    await probeChannels(bancoFalso(), 'conta-1');
    expect(lidas.sort()).toEqual(['evo', 'meta']);
  });
});
