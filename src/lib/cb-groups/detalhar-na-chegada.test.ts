import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// O detalhamento na chegada: chama `detalharGrupos` com o telefone e o LID do
// canal, segura a repetição por 15 min por grupo e nunca lança. Ids, jids e
// telefones fictícios.
// ============================================================

const h = vi.hoisted(() => ({
  canal: null as Record<string, unknown> | null,
  falhaDoCanal: null as Error | null,
}));

vi.mock('@/lib/cb-channels/repo', () => ({
  getChannelWithSecrets: vi.fn(async () => {
    if (h.falhaDoCanal) throw h.falhaDoCanal;
    return h.canal;
  }),
}));
vi.mock('@/lib/cb-groups/sync', () => ({
  detalharGrupos: vi.fn(async () => ({ detalhados: 1, falhas: 0, ourLid: null })),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => `claro:${s}` }));

import { detalharGrupos } from '@/lib/cb-groups/sync';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ESPERA_ENTRE_TENTATIVAS_MS, detalharGruposDaChegada } from './detalhar-na-chegada';

const db = {} as SupabaseClient;
const AGORA = 1_792_980_000_000;
let serie = 0;
/** Jid novo a cada caso: o freio é do processo e sobrevive entre os testes. */
const jidNovo = () => `1203630000000${String(++serie).padStart(5, '0')}@g.us`;

const canalEvolution = {
  id: 'canal-a',
  kind: 'evolution',
  server_url: 'http://evolution.de.teste',
  instance_name: 'cbcrm-teste',
  api_key: 'cifrada',
  display_phone: '5511900000009',
  own_lid: '999@lid',
};

beforeEach(() => {
  h.canal = { ...canalEvolution };
  h.falhaDoCanal = null;
  vi.mocked(detalharGrupos).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const chamar = (jids: string[], agora = AGORA) =>
  detalharGruposDaChegada({ db, accountId: 'conta-1', channelId: 'canal-a', jids, agora });

describe('detalharGruposDaChegada', () => {
  it('detalha os grupos com o telefone e o LID do canal', async () => {
    const jid = jidNovo();
    await chamar([jid]);
    expect(detalharGrupos).toHaveBeenCalledTimes(1);
    expect(vi.mocked(detalharGrupos).mock.calls[0][1]).toMatchObject({
      accountId: 'conta-1',
      channelId: 'canal-a',
      displayPhone: '5511900000009',
      ownLidConhecido: '999@lid',
      jids: [jid],
    });
  });

  it('não tenta o mesmo grupo de novo antes de 15 min', async () => {
    const jid = jidNovo();
    await chamar([jid]);
    await chamar([jid], AGORA + ESPERA_ENTRE_TENTATIVAS_MS - 1);
    expect(detalharGrupos).toHaveBeenCalledTimes(1);
    await chamar([jid], AGORA + ESPERA_ENTRE_TENTATIVAS_MS);
    expect(detalharGrupos).toHaveBeenCalledTimes(2);
  });

  it('o freio de um grupo não segura outro grupo da mesma entrega', async () => {
    const freado = jidNovo();
    const novo = jidNovo();
    await chamar([freado]);
    await chamar([freado, novo], AGORA + 1_000);
    expect(vi.mocked(detalharGrupos).mock.calls[1][1].jids).toEqual([novo]);
  });

  it('o freio vale mesmo quando a tentativa falhou', async () => {
    // A Evolution fora do ar é o caso que o freio existe para segurar.
    const jid = jidNovo();
    h.falhaDoCanal = new Error('banco fora');
    await chamar([jid]);
    h.falhaDoCanal = null;
    await chamar([jid], AGORA + 1_000);
    expect(detalharGrupos).not.toHaveBeenCalled();
  });

  it('conexão que não é da Evolution não chama nada', async () => {
    h.canal = { ...canalEvolution, kind: 'meta' };
    await chamar([jidNovo()]);
    expect(detalharGrupos).not.toHaveBeenCalled();
  });

  it('conexão sem credencial ou apagada não chama nada', async () => {
    h.canal = { ...canalEvolution, api_key: null };
    await chamar([jidNovo()]);
    h.canal = null;
    await chamar([jidNovo()]);
    expect(detalharGrupos).not.toHaveBeenCalled();
  });

  it('nunca lança: a mensagem já está gravada', async () => {
    h.falhaDoCanal = new Error('banco fora');
    await expect(chamar([jidNovo()])).resolves.toBeUndefined();
    vi.mocked(detalharGrupos).mockRejectedValueOnce(new Error('evolution fora'));
    await expect(chamar([jidNovo()])).resolves.toBeUndefined();
  });
});
