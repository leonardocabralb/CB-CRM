import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/cb/channels, ramo Meta (Fase 7 do plano do merge do upstream,
// #505): a falha da Meta volta como `{ error, falha }`, com o MOTIVO que o
// painel traduz; id colado errado (telefone, nome, URL) é recusado ANTES de
// qualquer chamada à Meta; e nada é gravado quando a conexão falha.
// ============================================================

const estado = vi.hoisted(() => ({
  inserts: [] as { tabela: string; linha: Record<string, unknown> }[],
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(),
  requireRole: async () => ({
    accountId: 'conta-1',
    userId: 'u1',
    supabase: {
      from(tabela: string) {
        const b = {
          insert(linha: Record<string, unknown>) {
            estado.inserts.push({ tabela, linha });
            return b;
          },
          upsert: () => Promise.resolve({ error: null }),
          select: () => b,
          single: () => Promise.resolve({ data: { id: 'canal-novo' }, error: null }),
        };
        return b;
      },
    },
  }),
  toErrorResponse: () => new Response(JSON.stringify({ error: 'interno' }), { status: 500 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => null,
}));

vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (s: string) => `enc(${s.length})` }));

vi.mock('@/lib/cb-channels/repo', () => ({
  listChannels: vi.fn(),
  countChannels: async () => 1,
  CB_CHANNEL_SAFE_COLUMNS: 'id',
}));

vi.mock('@/lib/cb-channels/evolution-admin', () => ({
  buildChannelInstanceName: vi.fn(),
  deleteChannelInstance: vi.fn(),
  evolutionWebhookConfig: vi.fn(),
  provisionChannelInstance: vi.fn(),
}));

vi.mock('@/lib/instagram/graph', () => ({ criarClienteInstagram: vi.fn() }));
vi.mock('@/lib/instagram/conexao', () => ({ validadeDoToken: vi.fn() }));
vi.mock('@/lib/instagram/canal', () => ({ gravarCanalDoInstagram: vi.fn() }));
vi.mock('@/lib/instagram/app', () => ({ lerAppDoInstagram: vi.fn() }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: vi.fn() }));

vi.mock('@/lib/cb-channels/meta-admin', async (original) => ({
  ...(await original<typeof import('@/lib/cb-channels/meta-admin')>()),
  provisionMetaChannel: vi.fn(),
}));

import { ErroNaConexaoMeta, provisionMetaChannel } from '@/lib/cb-channels/meta-admin';
import type { FalhaDaMeta } from '@/lib/cb-channels/falha-da-meta';
import { POST } from './route';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const provisionar = provisionMetaChannel as any;

function pedido(corpo: Record<string, unknown>) {
  return new Request('http://localhost/api/cb/channels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'meta',
      label: 'Oficial',
      phone_number_id: '111222333',
      waba_id: '999888777',
      access_token: 'tok-de-teste',
      ...corpo,
    }),
  });
}

function falha(parcial: Partial<FalhaDaMeta>): FalhaDaMeta {
  return {
    motivo: 'outro',
    campo: null,
    lado: 'meta',
    etapa: 'subscribe_waba',
    codigo: 1,
    subcodigo: null,
    fbtraceId: 'T',
    mensagemDaMeta: 'x',
    id: '999888777',
    ...parcial,
  };
}

beforeEach(() => {
  estado.inserts.length = 0;
  vi.clearAllMocks();
});

describe('POST /api/cb/channels — conexão Meta', () => {
  it.each([
    ['o telefone no lugar do Phone Number ID', { phone_number_id: '+55 51 99999-8229' }, 'phone_number_id'],
    ['uma URL no lugar da WABA', { waba_id: 'https://business.facebook.com/wa/manage' }, 'waba_id'],
  ])('%s → 400 que nomeia o campo, sem chamar a Meta nem gravar', async (_caso, corpo, campo) => {
    const res = await POST(pedido(corpo));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.falha).toMatchObject({ motivo: 'id_nao_numerico', campo, lado: 'user' });
    expect(json.error).toMatch(/só dígitos/);
    expect(provisionar).not.toHaveBeenCalled();
    expect(estado.inserts).toEqual([]);
  });

  it('WABA em branco continua opcional (não é "não numérica")', async () => {
    provisionar.mockResolvedValue({
      phoneInfo: { display_phone_number: '+55 51 9999-8229' },
      registeredAt: null,
      registrationError: null,
      registrationFalha: null,
      registrationSkipped: true,
      subscribedAppsAt: null,
    });
    const res = await POST(pedido({ waba_id: '' }));
    expect(res.status).toBe(201);
    expect(provisionar).toHaveBeenCalledWith(expect.objectContaining({ wabaId: null }));
  });

  it.each([
    ['a Meta tem de mudar algo', 'meta', 502],
    ['quem preenche resolve', 'user', 400],
  ] as const)('falha que %s → %s, com o motivo, e nada gravado', async (_c, lado, status) => {
    provisionar.mockRejectedValue(new ErroNaConexaoMeta(falha({ lado, motivo: 'sem_permissao' })));
    const res = await POST(pedido({}));
    expect(res.status).toBe(status);
    const json = await res.json();
    expect(json.falha.motivo).toBe('sem_permissao');
    expect(json.error).toBe('Erro da Meta: x');
    expect(estado.inserts).toEqual([]);
  });

  it('erro que NÃO é da conexão (defeito nosso) não vira "Erro da Meta" 400', async () => {
    provisionar.mockRejectedValue(new TypeError('boom'));
    const res = await POST(pedido({}));
    expect(res.status).toBe(500);
    expect(estado.inserts).toEqual([]);
  });

  it('register que falha: a conexão é salva e a falha classificada volta para a tela', async () => {
    const doRegistro = falha({ motivo: 'pin_errado', campo: 'pin', lado: 'user', etapa: 'register' });
    provisionar.mockResolvedValue({
      phoneInfo: { display_phone_number: '+55 51 9999-8229' },
      registeredAt: null,
      registrationError: 'Two step verification PIN Mismatch',
      registrationFalha: doRegistro,
      registrationSkipped: false,
      subscribedAppsAt: '2026-09-24T13:00:00.000Z',
    });
    const res = await POST(pedido({ pin: '123456' }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.registration).toMatchObject({ registered: false, error: 'Two step verification PIN Mismatch' });
    expect(json.registration.falha).toEqual(doRegistro);
    const canal = estado.inserts.find((i) => i.tabela === 'cb_channels');
    expect(canal?.linha).toMatchObject({
      status: 'disconnected',
      last_error: 'Two step verification PIN Mismatch',
    });
  });
});
