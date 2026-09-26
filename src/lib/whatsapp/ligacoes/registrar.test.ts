import { beforeEach, describe, expect, it, vi } from 'vitest';

import { criarBanco, type Banco } from '../sem-telefone/banco.test-helper';
import type { EventoDeLigacao, SituacaoDaLigacao } from './evento';

// ============================================================
// A ORQUESTRAÇÃO de `registrar.ts` sobre o dublê de banco: o que é gravado,
// em que ordem, e o que acontece quando uma peça falha. As peças de fora
// (ficha/conversa, funil, reabertura, esperas, LID) são espiãs — cada uma tem
// o seu próprio teste.
// ============================================================

const ordem: string[] = [];

const resolverDestinatario = vi.fn();
const cancelarEsperasPorResposta = vi.fn();
const routeContactToPipeline = vi.fn();
const reopenClosedConversation = vi.fn();
const followConversationChannel = vi.fn();
const resolverTelefoneDoLid = vi.fn();

vi.mock('@/lib/automations/destinatario', () => ({
  resolverDestinatario: (...a: unknown[]) => resolverDestinatario(...a),
}));
vi.mock('@/lib/automations/parar-se-responder', () => ({
  cancelarEsperasPorResposta: (...a: unknown[]) => {
    ordem.push('esperas');
    return cancelarEsperasPorResposta(...a);
  },
}));
vi.mock('@/lib/cb-channels/pipeline-routing', () => ({
  routeContactToPipeline: (...a: unknown[]) => {
    ordem.push('funil');
    return routeContactToPipeline(...a);
  },
}));
vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: (...a: unknown[]) => {
    ordem.push('reabre');
    return reopenClosedConversation(...a);
  },
}));
vi.mock('@/lib/cb-channels/stamp', async (original) => ({
  ...(await original<typeof import('@/lib/cb-channels/stamp')>()),
  followConversationChannel: (...a: unknown[]) => {
    ordem.push('segue');
    return followConversationChannel(...a);
  },
}));
vi.mock('@/lib/whatsapp/sem-telefone/resolver-lid', () => ({
  consultarTelefoneDoLid: (...a: unknown[]) => resolverTelefoneDoLid(...a),
}));

const { registrarEventoDeLigacao } = await import('./registrar');
const { PREVIA_DA_LIGACAO } = await import('./previa');

const CONTA = 'conta-1';
const CANAL = 'canal-1';
const LID = '123456789012345@lid';
const TELEFONE = '5583999990000';
const T0 = Date.parse('2026-09-25T15:49:01.000Z');

let banco: Banco;
let relogio: number;

function evento(situacao: SituacaoDaLigacao, extra: Partial<EventoDeLigacao> = {}): EventoDeLigacao {
  const deslocamento: Record<SituacaoDaLigacao, number> = {
    offer: 0,
    accept: 21_000,
    reject: 40_000,
    timeout: 40_000,
    terminate: 40_000,
  };
  return {
    callId: 'CALL-1',
    situacao,
    de: situacao === 'offer' ? LID : 'aparelho-do-escritorio@lid',
    telefoneInformado: null,
    video: false,
    grupo: false,
    em: T0 + deslocamento[situacao],
    ...extra,
  };
}

/** A espera avança o relógio do teste: é o `after()` dormindo. */
function registrar(e: EventoDeLigacao, opcoes: { ownLid?: string | null; esperar?: (ms: number) => Promise<void> } = {}) {
  return registrarEventoDeLigacao({
    db: banco.db,
    rota: { accountId: CONTA, channelId: CANAL, ownLid: opcoes.ownLid ?? null },
    evento: e,
    agora: () => relogio,
    esperar:
      opcoes.esperar ??
      (async (ms) => {
        relogio += ms;
      }),
  });
}

const ligacao = () => banco.tabelas.cb_ligacoes?.[0];
const bolhas = () => (banco.tabelas.messages ?? []).filter((m) => m.content_type === 'call');

beforeEach(() => {
  ordem.length = 0;
  relogio = T0 + 41_000;
  banco = criarBanco({
    cb_channels: [{ id: CANAL, account_id: CONTA, display_phone: '5583988880000' }],
    contacts: [{ id: 'contato-1', name: 'Cliente Teste' }],
  });
  const rpc = banco.db.rpc.bind(banco.db);
  (banco.db as unknown as { rpc: unknown }).rpc = (nome: string, args: Record<string, unknown>) => {
    ordem.push(`rpc:${nome}`);
    return rpc(nome, args);
  };
  resolverDestinatario.mockReset().mockResolvedValue({
    contactId: 'contato-1',
    conversationId: 'conversa-1',
    criouContato: false,
  });
  resolverTelefoneDoLid.mockReset().mockResolvedValue({
    telefoneJid: `${TELEFONE}@s.whatsapp.net`,
    conversationId: 'conversa-1',
  });
  for (const f of [cancelarEsperasPorResposta, routeContactToPipeline, reopenClosedConversation, followConversationChannel]) {
    f.mockReset().mockResolvedValue(undefined);
  }
});

describe('ligação PERDIDA: tocou e ninguém atendeu', () => {
  it('grava a bolha do cliente, sobe a conversa com não lida e roda os efeitos na ordem', async () => {
    await registrar(evento('offer'));
    await registrar(evento('terminate'));

    expect(bolhas()).toHaveLength(1);
    const bolha = bolhas()[0];
    expect(bolha).toMatchObject({
      conversation_id: 'conversa-1',
      sender_type: 'customer',
      content_type: 'call',
      content_text: null,
      message_id: 'call:CALL-1',
      from_me: false,
      from_device: false,
      channel_id: CANAL,
    });
    expect(bolha.ligacao).toEqual({
      desfecho: 'perdida',
      video: false,
      inicio: new Date(T0).toISOString(),
      fim: new Date(T0 + 40_000).toISOString(),
      tocou_seg: 40,
      encerramento: 'terminate',
    });

    // A prévia no formato de todo tipo sem texto, pela RPC atômica da não lida.
    expect(PREVIA_DA_LIGACAO).toBe('[call]');
    expect(banco.rpcs).toEqual([
      { nome: 'bump_conversation_on_inbound', args: { p_conversation_id: 'conversa-1', p_last_message_text: '[call]' } },
    ]);
    // Reabre LOGO DEPOIS de gravar; depois a posição, o canal, as esperas e o funil.
    expect(ordem).toEqual(['reabre', 'rpc:bump_conversation_on_inbound', 'segue', 'esperas', 'funil']);
    expect(reopenClosedConversation).toHaveBeenCalledWith(banco.db, { id: 'conversa-1' });
    expect(followConversationChannel).toHaveBeenCalledWith(banco.db, 'conversa-1', CANAL);
    expect(cancelarEsperasPorResposta).toHaveBeenCalledWith({ db: banco.db, accountId: CONTA, contactId: 'contato-1' });
    expect(routeContactToPipeline).toHaveBeenCalledWith({
      db: banco.db,
      accountId: CONTA,
      channelId: CANAL,
      contactId: 'contato-1',
      contactName: 'Cliente Teste',
      conversationId: 'conversa-1',
    });
    expect(resolverDestinatario).toHaveBeenCalledWith(banco.db, CONTA, TELEFONE);

    expect(ligacao()).toMatchObject({
      desfecho: 'perdida',
      telefone: TELEFONE,
      conversation_id: 'conversa-1',
      message_id: bolha.id,
    });
  });

  it('dentro da folga depois do fim não conclui nada — o accept pode estar a caminho', async () => {
    await registrar(evento('offer'));
    await registrar(evento('terminate'), { esperar: async () => {} });

    expect(bolhas()).toHaveLength(0);
    expect(ligacao()?.desfecho ?? null).toBeNull();
  });

  it('o fim que chegou ANTES do offer: quem decide é a espera do offer', async () => {
    await registrar(evento('terminate'));
    expect(bolhas()).toHaveLength(0); // não sabia quem ligou

    await registrar(evento('offer'));
    expect(bolhas()).toHaveLength(1);
    expect(ligacao()?.desfecho).toBe('perdida');
  });

  it('aviso repetido (a Evolution reentrega) não grava a bolha duas vezes', async () => {
    await registrar(evento('offer'));
    await registrar(evento('terminate'));
    await registrar(evento('terminate'));
    await registrar(evento('offer'));

    expect(bolhas()).toHaveLength(1);
    expect(resolverDestinatario).toHaveBeenCalledTimes(1);
  });

  it('sem o offer, nunca decide: não se sabe quem ligou', async () => {
    await registrar(evento('terminate'));
    relogio += 60_000;
    await registrar(evento('reject'));

    expect(bolhas()).toHaveLength(0);
    expect(ligacao()?.desfecho ?? null).toBeNull();
  });
});

describe('ligação ATENDIDA no celular do escritório', () => {
  it('grava a bolha como resposta de gente, sem não lida', async () => {
    await registrar(evento('offer'));
    await registrar(evento('accept'));

    expect(bolhas()).toHaveLength(1);
    expect(bolhas()[0]).toMatchObject({
      sender_type: 'agent',
      from_me: true,
      from_device: true,
      status: 'sent',
    });
    expect(bolhas()[0].ligacao).toMatchObject({ desfecho: 'atendida', tocou_seg: 21 });
    // Sem a RPC da não lida: a prévia e a posição vão num UPDATE comum.
    expect(banco.rpcs).toEqual([]);
    const previa = banco.escritas.find(
      (e) => e.tabela === 'conversations' && (e.payload as Record<string, unknown>).last_message_text === '[call]',
    );
    expect(previa).toBeDefined();
    expect(ordem).toEqual(['reabre', 'segue', 'esperas', 'funil']);
  });

  it('⚠️ o terminate e o accept do MESMO segundo, em POSTs que se cruzam: vence o atendimento', async () => {
    await registrar(evento('offer'));
    let atendeu = false;
    // O accept chega enquanto a espera do terminate ainda dorme.
    await registrar(evento('terminate'), {
      esperar: async (ms) => {
        if (!atendeu) {
          atendeu = true;
          await registrar(evento('accept'));
        }
        relogio += ms;
      },
    });

    expect(bolhas()).toHaveLength(1);
    expect(bolhas()[0].sender_type).toBe('agent');
    expect(ligacao()?.desfecho).toBe('atendida');
  });
});

describe('a bolha entra na hora REAL da ligação (teste real de 26/09/2026)', () => {
  it('a perdida que é a última da conversa: hora do FIM, e o caminho de sempre', async () => {
    await registrar(evento('offer'));
    await registrar(evento('terminate'));

    expect(bolhas()[0].created_at).toBe(new Date(T0 + 40_000).toISOString());
    expect(ordem).toEqual(['reabre', 'rpc:bump_conversation_on_inbound', 'segue', 'esperas', 'funil']);
  });

  it('⚠️ a perdida decidida DEPOIS da atendida que veio em seguida entra ANTES dela, como história', async () => {
    // A ligação seguinte foi atendida no celular 9 s depois do fim desta, e a
    // bolha dela (decidida em 2 s) já está no fio.
    banco.tabelas.messages = [
      {
        id: 'atendida-seguinte',
        conversation_id: 'conversa-1',
        sender_type: 'agent',
        from_device: true,
        sender_id: null,
        deleted_at: null,
        content_type: 'call',
        created_at: new Date(T0 + 49_000).toISOString(),
      },
    ];
    (banco.tabelas.conversations ??= []).push({ id: 'conversa-1', aguardando_desde: null });
    await registrar(evento('offer'));
    await registrar(evento('terminate'));

    const bolha = bolhas().find((m) => m.message_id === 'call:CALL-1');
    expect(bolha?.created_at).toBe(new Date(T0 + 40_000).toISOString());
    // Não reabre, não sobe a conversa, não segue o canal: a última é outra.
    expect(ordem).toEqual(['rpc:cb_assentar_mensagem_historica', 'esperas', 'funil']);
    expect(banco.rpcs).toEqual([
      {
        nome: 'cb_assentar_mensagem_historica',
        args: {
          p_conversation_id: 'conversa-1',
          p_carimbo: new Date(T0 + 40_000).toISOString(),
          p_da_equipe: false,
          p_espera_antes: null,
          // A equipe atendeu a ligação seguinte: não é não lida.
          p_conta_nao_lida: false,
        },
      },
    ]);
    expect(reopenClosedConversation).not.toHaveBeenCalled();
    expect(followConversationChannel).not.toHaveBeenCalled();
  });

  it('⚠️ a resposta gravada ENTRE a pergunta e o insert: a 2ª pergunta a vê (Codex, PR #304)', async () => {
    // A reabertura roda colada no insert; é nela que a resposta "chega".
    reopenClosedConversation.mockImplementation(async () => {
      banco.tabelas.messages.push({
        id: 'resposta-no-meio',
        conversation_id: 'conversa-1',
        sender_type: 'agent',
        from_device: true,
        sender_id: null,
        deleted_at: null,
        content_type: 'text',
        created_at: new Date(T0 + 45_000).toISOString(),
      });
    });
    await registrar(evento('offer'));
    await registrar(evento('terminate'));

    expect(ordem).toEqual(['reabre', 'rpc:cb_assentar_mensagem_historica', 'esperas', 'funil']);
    expect(banco.rpcs[0]).toMatchObject({ args: { p_conta_nao_lida: false } });
    expect(followConversationChannel).not.toHaveBeenCalled();
  });

  it('a perdida histórica sem resposta de gente depois dela conta como não lida', async () => {
    banco.tabelas.messages = [
      {
        id: 'texto-do-cliente',
        conversation_id: 'conversa-1',
        sender_type: 'customer',
        from_device: false,
        sender_id: null,
        deleted_at: null,
        content_type: 'text',
        created_at: new Date(T0 + 45_000).toISOString(),
      },
    ];
    await registrar(evento('offer'));
    await registrar(evento('terminate'));

    expect(banco.rpcs[0]).toMatchObject({
      nome: 'cb_assentar_mensagem_historica',
      args: { p_da_equipe: false, p_conta_nao_lida: true },
    });
  });

  it('a atendida histórica assenta como resposta da equipe', async () => {
    banco.tabelas.messages = [
      {
        id: 'texto-do-cliente',
        conversation_id: 'conversa-1',
        sender_type: 'customer',
        from_device: false,
        sender_id: null,
        deleted_at: null,
        content_type: 'text',
        created_at: new Date(T0 + 30_000).toISOString(),
      },
    ];
    await registrar(evento('offer'));
    await registrar(evento('accept'));

    const bolha = bolhas()[0];
    expect(bolha.created_at).toBe(new Date(T0 + 21_000).toISOString());
    expect(banco.rpcs[0]).toMatchObject({
      nome: 'cb_assentar_mensagem_historica',
      args: { p_da_equipe: true, p_conta_nao_lida: false },
    });
  });
});

describe('o que NÃO vira bolha', () => {
  it('chamada de grupo não é gravada em lugar nenhum', async () => {
    await registrar(evento('offer', { grupo: true }));
    await registrar(evento('terminate', { grupo: true }));

    expect(banco.tabelas.cb_ligacoes ?? []).toHaveLength(0);
    expect(bolhas()).toHaveLength(0);
  });

  it('LID sem telefone no acervo e sem callerPn: sem_telefone, sem ficha', async () => {
    resolverTelefoneDoLid.mockResolvedValue(null);
    await registrar(evento('offer'));
    await registrar(evento('terminate'));

    expect(bolhas()).toHaveLength(0);
    expect(resolverDestinatario).not.toHaveBeenCalled();
    expect(ligacao()).toMatchObject({ desfecho: 'sem_telefone' });
  });

  it('o callerPn entra quando o acervo não conhece o LID (número que nunca escreveu)', async () => {
    resolverTelefoneDoLid.mockResolvedValue(null);
    await registrar(evento('offer', { telefoneInformado: '5583977770001@s.whatsapp.net' }));
    await registrar(evento('terminate'));

    expect(resolverDestinatario).toHaveBeenCalledWith(banco.db, CONTA, '5583977770001');
    expect(ligacao()).toMatchObject({ desfecho: 'perdida', detalhe: 'telefone pelo whatsapp' });
  });

  it('⚠️ callerPn com o zero a mais do fixo não cria ficha com número errado', async () => {
    resolverTelefoneDoLid.mockResolvedValue(null);
    await registrar(evento('offer', { telefoneInformado: '5583322212340' }));
    await registrar(evento('terminate'));

    expect(resolverDestinatario).not.toHaveBeenCalled();
    expect(ligacao()).toMatchObject({ desfecho: 'sem_telefone' });
  });

  it('LID com o `:aparelho` é procurado no acervo pela forma sem aparelho', async () => {
    await registrar(evento('offer', { de: '123456789012345:7@lid' }));
    await registrar(evento('terminate'));

    expect(resolverTelefoneDoLid).toHaveBeenCalledWith(banco.db, CONTA, LID);
    expect(ligacao()).toMatchObject({ desfecho: 'perdida', detalhe: 'telefone pelo acervo' });
  });

  it('o próprio aparelho com o `:aparelho` também é do_escritorio', async () => {
    await registrar(evento('offer', { de: '123456789012345:3@lid' }), { ownLid: LID });
    await registrar(evento('terminate'), { ownLid: LID });

    expect(bolhas()).toHaveLength(0);
    expect(ligacao()).toMatchObject({ desfecho: 'do_escritorio' });
  });

  it('o aparelho da própria conexão como quem ligou: do_escritorio', async () => {
    await registrar(evento('offer'), { ownLid: LID });
    await registrar(evento('terminate'), { ownLid: LID });

    expect(bolhas()).toHaveLength(0);
    expect(ligacao()).toMatchObject({ desfecho: 'do_escritorio' });
  });

  it('número de uma conexão da conta (com ou sem o nono dígito): do_escritorio', async () => {
    resolverTelefoneDoLid.mockResolvedValue({ telefoneJid: '558388880000@s.whatsapp.net', conversationId: 'x' });
    await registrar(evento('offer'));
    await registrar(evento('terminate'));

    expect(bolhas()).toHaveLength(0);
    expect(resolverDestinatario).not.toHaveBeenCalled();
    expect(ligacao()).toMatchObject({ desfecho: 'do_escritorio' });
  });
});

describe('falhas', () => {
  it('ficha ou conversa que não nasce: falhou, com o motivo, e nada no fio', async () => {
    resolverDestinatario.mockRejectedValue(new Error('destinatário: dono da conta não resolvido'));
    await registrar(evento('offer'));
    await registrar(evento('terminate'));

    expect(bolhas()).toHaveLength(0);
    expect(ligacao()).toMatchObject({ desfecho: 'falhou' });
    expect(String(ligacao()?.detalhe)).toContain('dono da conta');
    expect(ordem).toEqual([]);
  });

  it('⚠️ o acervo que NÃO RESPONDE não vira "sem telefone": falhou, com o motivo', async () => {
    resolverTelefoneDoLid.mockResolvedValue('falhou');
    await registrar(evento('offer'));
    await registrar(evento('terminate'));

    expect(bolhas()).toHaveLength(0);
    expect(ligacao()).toMatchObject({ desfecho: 'falhou' });
    expect(String(ligacao()?.detalhe)).toContain('acervo');
  });

  it('o acervo não respondeu, mas o callerPn serve: a ligação entra', async () => {
    resolverTelefoneDoLid.mockResolvedValue('falhou');
    await registrar(evento('offer', { telefoneInformado: '5583977770001' }));
    await registrar(evento('terminate'));

    expect(ligacao()).toMatchObject({ desfecho: 'perdida', detalhe: 'telefone pelo whatsapp' });
  });

  it('dois avisos decidindo AO MESMO TEMPO gravam UMA bolha (a reivindicação é condicional)', async () => {
    await registrar(evento('offer'), { esperar: async () => {} });
    await Promise.all([registrar(evento('terminate')), registrar(evento('terminate'))]);

    expect(bolhas()).toHaveLength(1);
    expect(resolverDestinatario).toHaveBeenCalledTimes(1);
    expect(banco.rpcs).toHaveLength(1);
  });

  it('bolha recusada pelo banco: falhou, e nenhum efeito roda', async () => {
    banco.falhas.messages = { code: '23514', message: 'violates check constraint' };
    await registrar(evento('offer'));
    await registrar(evento('terminate'));

    expect(ligacao()).toMatchObject({ desfecho: 'falhou' });
    expect(ordem).toEqual([]);
  });

  it('nunca lança, nem com o banco fora do ar', async () => {
    banco.falhas.cb_ligacoes = { message: 'fetch failed' };
    await expect(registrar(evento('offer'))).resolves.toBeUndefined();
    await expect(registrar(evento('terminate'))).resolves.toBeUndefined();
    expect(bolhas()).toHaveLength(0);
  });
});
