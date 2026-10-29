import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Grupo que chega sem detalhe (29/10/2026): a rota junta os grupos cuja
// gravação disse `grupoSemDetalhe` e os detalha UMA vez por grupo, DEPOIS de
// todos os itens gravados — nunca no meio do laço, onde a consulta de ~0,8 s
// à Evolution atrasaria as mensagens seguintes. Ids e jids fictícios.
// ============================================================

import type { Banco, Linha } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

const h = vi.hoisted(() => ({
  banco: null as unknown as Banco,
  after: [] as (() => Promise<void> | void)[],
  semDetalhe: true,
}));

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.after.push(cb);
  },
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, init }) },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => h.banco.db.from(t),
    rpc: (n: string, a: Record<string, unknown>) =>
      (h.banco.db as unknown as { rpc: (n: string, a: unknown) => unknown }).rpc(n, a),
  }),
}));

vi.mock('@/lib/cb-groups/persist', async (original) => ({
  ...(await original<typeof import('@/lib/cb-groups/persist')>()),
  persistGroupMessage: vi.fn(async () => ({
    messageId: 'msg-grupo',
    conversationId: 'conv-grupo',
    groupId: 'g-1',
    grupoSemDetalhe: h.semDetalhe,
  })),
  persistGroupDeviceMessage: vi.fn(async () => ({
    messageId: 'msg-grupo-aparelho',
    conversationId: 'conv-grupo',
    groupId: 'g-1',
    grupoSemDetalhe: h.semDetalhe,
  })),
}));

vi.mock('@/lib/cb-groups/detalhar-na-chegada', () => ({
  detalharGruposSemDetalhe: vi.fn(async () => {}),
}));

vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: vi.fn(async () => {}) }));

import { persistGroupMessage } from '@/lib/cb-groups/persist';
import { detalharGruposSemDetalhe } from '@/lib/cb-groups/detalhar-na-chegada';
import { criarBanco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

import { POST } from './route';

const SEGREDO = 'segredo-de-teste';
const INSTANCIA = 'cbcrm-numero-a';
const GRUPO = '120363000000000001@g.us';
const OUTRO_GRUPO = '120363000000000002@g.us';
const AGORA = 1792980000;

const conta: Linha = { id: 'conta-1', owner_user_id: 'dono-1' };
const canal: Linha = {
  id: 'canal-a',
  account_id: 'conta-1',
  created_by: 'membro',
  groups_enabled: true,
  own_lid: null,
  instance_name: INSTANCIA,
  kind: 'evolution',
};

let serie = 0;
const item = (grupo = GRUPO) => ({
  key: {
    remoteJid: grupo,
    fromMe: false,
    id: `3EB0-GRUPO-${++serie}`,
    participant: '111@lid',
  },
  pushName: 'Participante de teste',
  message: { conversation: 'TESTE: oi grupo' },
  messageType: 'conversation',
  messageTimestamp: AGORA,
});

async function entregar(data: unknown) {
  const antes = h.after.length;
  await POST(
    new Request('http://localhost/api/whatsapp/evolution/webhook', {
      method: 'POST',
      headers: { authorization: `Bearer ${SEGREDO}`, 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'messages.upsert', instance: INSTANCIA, data }),
    }),
  );
  for (const cb of h.after.slice(antes)) {
    const rodando = cb();
    await vi.advanceTimersByTimeAsync(3_000);
    await rodando;
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: (AGORA + 5) * 1000, toFake: ['Date', 'setTimeout'] });
  process.env.EVOLUTION_WEBHOOK_SECRET = SEGREDO;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://banco.de.teste';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-teste';
  h.banco = criarBanco({ accounts: [conta], cb_channels: [canal], messages: [] });
  h.after = [];
  h.semDetalhe = true;
  vi.mocked(persistGroupMessage).mockClear();
  vi.mocked(detalharGruposSemDetalhe).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('grupo que chega sem detalhe', () => {
  it('é detalhado pela conexão do webhook, depois de gravar a mensagem', async () => {
    await entregar(item());
    expect(detalharGruposSemDetalhe).toHaveBeenCalledTimes(1);
    expect(vi.mocked(detalharGruposSemDetalhe).mock.calls[0][0]).toMatchObject({
      accountId: 'conta-1',
      channelId: 'canal-a',
      jids: [GRUPO],
      agora: (AGORA + 5) * 1000,
    });
    expect(vi.mocked(detalharGruposSemDetalhe).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(persistGroupMessage).mock.invocationCallOrder[0],
    );
  });

  it('várias mensagens do mesmo grupo no lote: UMA consulta, depois de TODAS gravadas', async () => {
    await entregar([item(), item(), item(OUTRO_GRUPO)]);
    expect(persistGroupMessage).toHaveBeenCalledTimes(3);
    expect(detalharGruposSemDetalhe).toHaveBeenCalledTimes(1);
    expect(vi.mocked(detalharGruposSemDetalhe).mock.calls[0][0].jids).toEqual([GRUPO, OUTRO_GRUPO]);
    const ultimaGravacao = Math.max(...vi.mocked(persistGroupMessage).mock.invocationCallOrder);
    expect(vi.mocked(detalharGruposSemDetalhe).mock.invocationCallOrder[0]).toBeGreaterThan(
      ultimaGravacao,
    );
  });

  it('grupo já detalhado não consulta nada', async () => {
    h.semDetalhe = false;
    await entregar(item());
    expect(persistGroupMessage).toHaveBeenCalledTimes(1);
    expect(detalharGruposSemDetalhe).not.toHaveBeenCalled();
  });
});
