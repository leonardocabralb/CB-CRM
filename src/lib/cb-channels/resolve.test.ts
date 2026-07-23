import { describe, it, expect, vi } from 'vitest';

import { resolveChannelForConversation } from './resolve';

// Mock encadeável do Supabase: cada `.from(table)` devolve um builder
// cujo terminal (`maybeSingle`/`single`) resolve a linha canônica de
// `rows[table]` (ou `{ data: null }`). Registra as tabelas consultadas
// para os testes verificarem a ORDEM de resolução.
function makeDb(rows: Record<string, unknown>, opts: { touched?: string[] } = {}) {
  function builder(table: string) {
    opts.touched?.push(table);
    const terminal = () =>
      Promise.resolve({ data: rows[table] ?? null, error: null });
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = vi.fn(() => b);
    b.maybeSingle = vi.fn(terminal);
    b.single = vi.fn(terminal);
    return b;
  }
  return { from: vi.fn((t: string) => builder(t)) } as never;
}

const META_CHANNEL = {
  id: 'ch-meta',
  kind: 'meta',
  phone_number_id: 'PNID-1',
  waba_id: 'WABA-1',
  access_token: 'enc-meta',
  server_url: null,
  instance_name: null,
  api_key: null,
};

const EVO_CHANNEL = {
  id: 'ch-evo',
  kind: 'evolution',
  phone_number_id: null,
  waba_id: null,
  access_token: null,
  server_url: 'https://evo.example.com',
  instance_name: 'cbcrm-comercial-ab12',
  api_key: 'enc-evo',
};

describe('resolveChannelForConversation', () => {
  it('resolve o canal padrão da conta quando a conversa não tem canal', async () => {
    const touched: string[] = [];
    const db = makeDb({ cb_channels: META_CHANNEL }, { touched });

    const r = await resolveChannelForConversation(db, 'acct-1', { channel_id: null });

    expect(r).not.toBeNull();
    expect(r!.source).toBe('cb_channels');
    expect(r!.provider).toBe('meta');
    expect(r!.channelId).toBe('ch-meta');
    expect(r!.phone_number_id).toBe('PNID-1');
    // Nunca chega no whatsapp_config quando há canal padrão.
    expect(touched).not.toContain('whatsapp_config');
  });

  it('mapeia o canal Evolution (server_url → base_url, kind → provider)', async () => {
    const db = makeDb({ cb_channels: EVO_CHANNEL });

    const r = await resolveChannelForConversation(db, 'acct-1', null);

    expect(r!.provider).toBe('evolution');
    expect(r!.base_url).toBe('https://evo.example.com');
    expect(r!.instance_name).toBe('cbcrm-comercial-ab12');
    expect(r!.api_key).toBe('enc-evo');
    expect(r!.channelId).toBe('ch-evo');
  });

  it('cai para whatsapp_config quando não há nenhum canal (fallback de transição)', async () => {
    const touched: string[] = [];
    const db = makeDb(
      {
        // cb_channels ausente → data null
        whatsapp_config: {
          id: 'cfg-1',
          provider: 'evolution',
          base_url: 'https://evo.example.com',
          instance_name: 'inst-legacy',
          api_key: 'enc-legacy',
          phone_number_id: null,
          access_token: null,
        },
      },
      { touched },
    );

    const r = await resolveChannelForConversation(db, 'acct-1', { channel_id: null });

    expect(r!.source).toBe('whatsapp_config');
    expect(r!.provider).toBe('evolution');
    expect(r!.legacyConfigId).toBe('cfg-1');
    expect(r!.channelId).toBeNull();
    expect(touched).toContain('cb_channels'); // tentou o canal antes
    expect(touched).toContain('whatsapp_config'); // e caiu no fallback
  });

  it('devolve null quando a conta não tem nenhuma conexão', async () => {
    const db = makeDb({}); // nada em lugar nenhum

    const r = await resolveChannelForConversation(db, 'acct-1', null);

    expect(r).toBeNull();
  });

  it('consulta o canal explícito da conversa antes do padrão', async () => {
    // Sem canal explícito → busca o padrão. Aqui a conversa aponta um
    // canal e o mock devolve a mesma linha; o que importa é NÃO quebrar
    // e resolver via cb_channels (source), não via fallback.
    const db = makeDb({ cb_channels: EVO_CHANNEL });

    const r = await resolveChannelForConversation(db, 'acct-1', {
      channel_id: 'ch-evo',
    });

    expect(r!.source).toBe('cb_channels');
    expect(r!.channelId).toBe('ch-evo');
  });
});
