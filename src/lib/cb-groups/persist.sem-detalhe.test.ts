import { describe, expect, it, vi } from 'vitest';

// ============================================================
// `grupoSemDetalhe`: o grupo que nasceu pela mensagem (ou cujo detalhamento
// falhou) avisa a rota para buscar nome, participantes e "somos admin?". Só
// pela conexão do PRÓPRIO grupo. Ids e jids fictícios.
// ============================================================

import { criarBanco, type Linha } from '@/lib/whatsapp/sem-telefone/banco.test-helper';
import type { NormalizedGroupInbound } from '@/lib/whatsapp/transport/evolution-group-inbound';

import { persistGroupDeviceMessage, persistGroupMessage } from './persist';

const JID = '120363000000000001@g.us';

const mensagem = (over: Partial<NormalizedGroupInbound> = {}): NormalizedGroupInbound => ({
  accountId: 'conta-1',
  configOwnerUserId: 'dono-1',
  channelId: 'canal-a',
  fromMe: false,
  groupJid: JID,
  senderJid: '5511900000001@s.whatsapp.net',
  senderLid: '111@lid',
  senderName: 'Participante de teste',
  providerMessageId: `3EB0-${Math.random()}`,
  timestamp: 1792980000,
  contentType: 'text',
  text: 'TESTE: oi grupo',
  mentionedJids: [],
  mediaBytes: null,
  ...over,
});

function banco(grupos: Linha[] = []) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return criarBanco({ cb_groups: grupos, conversations: [], messages: [] });
}

describe('grupoSemDetalhe', () => {
  it('grupo que NASCE pela mensagem pede o detalhe', async () => {
    const b = banco();
    const r = await persistGroupMessage({ db: b.db, m: mensagem() });
    expect(r?.grupoSemDetalhe).toBe(true);
    expect(b.tabelas.cb_groups).toHaveLength(1);
  });

  it('grupo que já existe sem contagem de participantes pede o detalhe', async () => {
    // O `synced_at` preenchido NÃO conta: a parte rápida da sincronização o
    // carimba sem participantes.
    const b = banco([
      { id: 'g-1', account_id: 'conta-1', jid: JID, channel_id: 'canal-a', participant_count: null, synced_at: '2026-09-01T12:00:00Z' },
    ]);
    const r = await persistGroupMessage({ db: b.db, m: mensagem() });
    expect(r?.grupoSemDetalhe).toBe(true);
  });

  it('grupo já detalhado não pede de novo', async () => {
    const b = banco([
      { id: 'g-1', account_id: 'conta-1', jid: JID, channel_id: 'canal-a', participant_count: 12 },
    ]);
    const r = await persistGroupMessage({ db: b.db, m: mensagem() });
    expect(r?.grupoSemDetalhe).toBe(false);
  });

  it('mensagem que chega por OUTRO número nosso não pede o detalhe', async () => {
    // O "somos admin?" seria o do número errado: o renomear sai pela
    // `channel_id` do grupo.
    const b = banco([
      { id: 'g-1', account_id: 'conta-1', jid: JID, channel_id: 'canal-a', participant_count: null },
    ]);
    const r = await persistGroupMessage({ db: b.db, m: mensagem({ channelId: 'canal-b' }) });
    expect(r?.grupoSemDetalhe).toBe(false);
  });

  it('grupo sem conexão (a dele foi apagada) não pede o detalhe', async () => {
    const b = banco([
      { id: 'g-1', account_id: 'conta-1', jid: JID, channel_id: null, participant_count: null },
    ]);
    const r = await persistGroupMessage({ db: b.db, m: mensagem() });
    expect(r?.grupoSemDetalhe).toBe(false);
  });

  it('a mensagem do celular pareado também pede o detalhe', async () => {
    const b = banco();
    const r = await persistGroupDeviceMessage({ db: b.db, m: mensagem({ fromMe: true }) });
    expect(r?.grupoSemDetalhe).toBe(true);
  });
});
