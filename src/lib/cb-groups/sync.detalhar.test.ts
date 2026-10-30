import { describe, expect, it, vi } from 'vitest';

// ============================================================
// `detalharGrupos` (o "Sincronizar" e a chegada): a mesma leitura que grava o
// espelho refaz o vínculo do grupo com as fichas (1117). Ids, jids e
// telefones fictícios.
// ============================================================

import { criarBanco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';
import type { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';

import { detalharGrupos } from './sync';

const JID = '120363000000000001@g.us';

function cenario(participants: unknown[]) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const b = criarBanco({
    cb_groups: [{ id: 'g-1', account_id: 'conta-1', jid: JID, channel_id: 'canal-a', participant_count: null }],
    contacts: [{ id: 'ficha-ana', account_id: 'conta-1', name: 'Ana Teste', telefone_canonico: '5583980000016' }],
    cb_channels: [{ id: 'canal-a', account_id: 'conta-1', display_phone: '5583980000099' }],
  });
  b.respostasDeRpc.cb_gravar_fichas_do_grupo = true;
  const client = {
    findGroupInfos: async () => ({ id: JID, subject: 'Grupo de teste', size: participants.length, participants }),
  } as unknown as EvolutionClient;
  const rodar = () =>
    detalharGrupos(b.db, {
      accountId: 'conta-1',
      channelId: 'canal-a',
      client,
      displayPhone: '5583980000099',
      jids: [JID],
    });
  return { b, rodar };
}

describe('detalharGrupos — o vínculo com as fichas', () => {
  const conferencias = (b: ReturnType<typeof cenario>['b']) =>
    b.rpcs.filter((r) => r.nome === 'cb_gravar_fichas_do_grupo').map((r) => r.args);

  it('grava o espelho E refaz o vínculo com as fichas de quem está', async () => {
    const { b, rodar } = cenario([
      { id: '111@lid', phoneNumber: '558380000016@s.whatsapp.net', admin: null },
      { id: '999@lid', phoneNumber: '5583980000099@s.whatsapp.net', admin: 'admin' },
    ]);
    expect(await rodar()).toMatchObject({ detalhados: 1, falhas: 0 });
    expect(b.tabelas.cb_groups[0]).toMatchObject({ participant_count: 2, subject: 'Grupo de teste' });
    expect(conferencias(b)).toEqual([{ p_account_id: 'conta-1', p_group_id: 'g-1', p_contact_ids: ['ficha-ana'] }]);
  });

  it('⚠️ lista vazia detalha o que veio, mas não confere o vínculo', async () => {
    const { b, rodar } = cenario([]);
    await rodar();
    expect(conferencias(b)).toEqual([]);
  });
});
