import { describe, it, expect, beforeEach, vi } from 'vitest';

// ------------------------------------------------------------
// engineSendInteractive: o canal preferido PRECISA chegar ao destino.
//
// Regressão real: `SendInteractiveArgs` declarava `preferredChannelId`, o
// motor calculava o valor (`stepChannel`) e o passava — mas o corpo da função
// montava o objeto `common` sem esse campo, e como os dois destinos o aceitam
// como OPCIONAL, o TypeScript não reclamava. Botão e lista eram os únicos
// envios que ignoravam tanto o canal escolhido no passo quanto o canal do
// DISPARO, caindo sempre no canal atual da conversa.
//
// Não dá para pegar isso na tela desta conta: os dois números são Evolution,
// e botão/lista só existem na API oficial da Meta. Por isso, teste.
// ------------------------------------------------------------

const h = vi.hoisted(() => ({
  botoes: [] as Record<string, unknown>[],
  listas: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/flows/meta-send', () => ({
  engineSendInteractiveButtons: vi.fn(async (args: Record<string, unknown>) => {
    h.botoes.push(args);
    return { whatsapp_message_id: 'wamid.botoes' };
  }),
  engineSendInteractiveList: vi.fn(async (args: Record<string, unknown>) => {
    h.listas.push(args);
    return { whatsapp_message_id: 'wamid.lista' };
  }),
}));

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => {
    throw new Error('engineSendInteractive não deve tocar o banco: ele delega');
  },
}));

import { engineSendInteractive } from './meta-send';

const COMUM = {
  accountId: 'acc-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
};

const BOTOES = {
  kind: 'buttons' as const,
  body: 'Escolha uma opção',
  buttons: [{ id: 'sim', title: 'Sim' }],
};

const LISTA = {
  kind: 'list' as const,
  body: 'Escolha um assunto',
  button_label: 'Ver',
  sections: [{ rows: [{ id: 'trab', title: 'Trabalhista' }] }],
};

describe('engineSendInteractive', () => {
  beforeEach(() => {
    h.botoes.length = 0;
    h.listas.length = 0;
  });

  it('CRÍTICO: repassa o canal preferido no envio de botões', () => {
    return engineSendInteractive({
      ...COMUM,
      payload: BOTOES,
      preferredChannelId: 'ch-oficial',
    }).then(() => {
      expect(h.botoes).toHaveLength(1);
      expect(h.botoes[0].preferredChannelId).toBe('ch-oficial');
    });
  });

  it('CRÍTICO: repassa o canal preferido no envio de lista', async () => {
    await engineSendInteractive({
      ...COMUM,
      payload: LISTA,
      preferredChannelId: 'ch-oficial',
    });
    expect(h.listas).toHaveLength(1);
    expect(h.listas[0].preferredChannelId).toBe('ch-oficial');
  });

  it('sem canal preferido repassa undefined — o destino cai na conversa', async () => {
    // A herança é o comportamento padrão e precisa continuar existindo: é ela
    // que faz o passo sem "Enviar por" sair pelo número do disparo.
    await engineSendInteractive({ ...COMUM, payload: BOTOES });
    expect(h.botoes[0].preferredChannelId).toBeUndefined();
  });

  it('null é preservado (não vira undefined) para o destino decidir', async () => {
    await engineSendInteractive({
      ...COMUM,
      payload: BOTOES,
      preferredChannelId: null,
    });
    expect(h.botoes[0].preferredChannelId).toBeNull();
  });

  it('o payload continua sendo desmontado nos campos que cada destino espera', async () => {
    await engineSendInteractive({
      ...COMUM,
      payload: { ...BOTOES, header: 'Olá', footer: 'CB Advogados' },
      preferredChannelId: 'ch-oficial',
    });
    expect(h.botoes[0]).toMatchObject({
      accountId: 'acc-1',
      conversationId: 'conv-1',
      bodyText: 'Escolha uma opção',
      headerText: 'Olá',
      footerText: 'CB Advogados',
      buttons: BOTOES.buttons,
    });
  });
});
