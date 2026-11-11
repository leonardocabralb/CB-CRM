import { beforeEach, describe, expect, it, vi } from 'vitest';

import { criarBanco, type Banco } from '../sem-telefone/banco.test-helper';
import { segredoDoComputador } from './computador';

// ============================================================
// Ligar e atender pelo CRM (1134) sobre o dublê de banco, com a máquina
// falsa (`enviar`). As peças de fora — a ficha e a conversa, o funil e a
// régua de hoje — são espiãs; cada uma tem o seu próprio teste. Números e
// nomes fictícios.
// ============================================================

const resolverDestinatario = vi.fn();
const routeContactToPipeline = vi.fn();
const decidirLigacao = vi.fn();

vi.mock('@/lib/automations/destinatario', () => ({
  resolverDestinatario: (...a: unknown[]) => resolverDestinatario(...a),
}));
vi.mock('@/lib/cb-channels/pipeline-routing', () => ({
  routeContactToPipeline: (...a: unknown[]) => routeContactToPipeline(...a),
}));
vi.mock('./registrar', () => ({
  decidirLigacao: (...a: unknown[]) => decidirLigacao(...a),
}));

const { atender, desligar, ligar, lerAviso, receberAviso, receberGravacao } = await import('./pelo-crm');

const CONTA = 'conta-1';
const CANAL = 'canal-1';
const SEGREDO = 'segredo-do-crm-de-teste-com-mais-de-32-caracteres';
const AGORA = Date.parse('2026-11-10T20:00:00.000Z');
const OFERTA = 'v=0 oferta-ficticia';
const RESPOSTA = 'v=0 resposta-ficticia';
const NUMERO = '5500911112222';
const ID = '11111111-2222-4333-8444-555555555555';

let banco: Banco;
let pedidos: { url: string; corpo: Record<string, unknown>; autorizacao: string | null }[];
let maquina: { status: number; corpo: Record<string, unknown> } | 'cai';
let tarefas: (() => Promise<void>)[];

const enviar = (async (url: string, init?: RequestInit) => {
  pedidos.push({
    url,
    corpo: JSON.parse(String(init?.body ?? '{}')),
    autorizacao: new Headers(init?.headers).get('authorization'),
  });
  if (maquina === 'cai') throw new Error('rede fora');
  return new Response(JSON.stringify(maquina.corpo), { status: maquina.status });
}) as typeof fetch;

const base = () => ({ db: banco.db, segredo: SEGREDO, agora: () => AGORA, enviar });
const agendar = (t: () => Promise<void>) => void tarefas.push(t);
const computador = () => banco.tabelas.cb_computadores_de_ligacao[0] as never;
const aoVivo = () => banco.tabelas.cb_ligacoes_ao_vivo ?? [];
const ligacoes = () => banco.tabelas.cb_ligacoes ?? [];
const faixas = () => (banco.tabelas.messages ?? []).filter((m) => m.content_type === 'call');

beforeEach(() => {
  pedidos = [];
  tarefas = [];
  maquina = { status: 200, corpo: { resposta: RESPOSTA } };
  banco = criarBanco({
    conversations: [{ id: 'conversa-1', account_id: CONTA, contact_id: 'contato-1', group_id: null, channel_id: CANAL }],
    contacts: [{ id: 'contato-1', account_id: CONTA, name: 'Cliente Fictício', phone: '5500911112222' }],
    messages: [
      {
        id: 'm-1',
        conversation_id: 'conversa-1',
        remote_jid: `${NUMERO}@s.whatsapp.net`,
        created_at: '2026-11-10T19:00:00.000Z',
        content_type: 'text',
      },
    ],
    profiles: [{ user_id: 'usuario-1', full_name: 'Atendente Fictícia' }],
    cb_computadores_de_ligacao: [
      {
        id: 'comp-1',
        account_id: CONTA,
        channel_id: CANAL,
        nome: 'teste',
        endereco: 'http://ligacoes-teste:8080',
        whatsapp: 'conectado',
        ligacao_em_curso: null,
        ultimo_sinal_em: new Date(AGORA - 30_000).toISOString(),
        ligado_em: '2026-01-01T12:00:00.000Z',
      },
    ],
  });
  for (const f of [resolverDestinatario, routeContactToPipeline, decidirLigacao]) f.mockReset();
  resolverDestinatario.mockResolvedValue({ contactId: 'contato-1', conversationId: 'conversa-1', criouContato: false });
  routeContactToPipeline.mockResolvedValue(undefined);
  decidirLigacao.mockResolvedValue(undefined);
});

describe('ligar', () => {
  const pedir = () =>
    ligar({ ...base(), accountId: CONTA, userId: 'usuario-1', conversationId: 'conversa-1', oferta: OFERTA });

  it('cria a ligação e a linha ao vivo, pede à máquina com o segredo DELA e devolve a resposta', async () => {
    const r = await pedir();
    expect(r).toEqual({ ok: true, ligacao: expect.any(String), resposta: RESPOSTA });
    const id = (r as { ligacao: string }).ligacao;
    expect(ligacoes()).toEqual([
      expect.objectContaining({
        id,
        call_id: `crm:${id}`,
        direcao: 'feita',
        pelo_crm: true,
        atendente_id: 'usuario-1',
        telefone: NUMERO,
        channel_id: CANAL,
        conversation_id: 'conversa-1',
      }),
    ]);
    expect(aoVivo()).toEqual([
      expect.objectContaining({ id, estado: 'conectando', direcao: 'feita', atendente_id: 'usuario-1' }),
    ]);
    expect(pedidos).toEqual([
      {
        url: 'http://ligacoes-teste:8080/ligar',
        corpo: { ligacao: id, numero: NUMERO, oferta: OFERTA },
        autorizacao: `Bearer ${segredoDoComputador(SEGREDO, 'teste')}`,
      },
    ]);
  });

  it('o número é o do JID da conversa (o nono dígito como o WhatsApp o conhece), não o da ficha', async () => {
    banco.tabelas.messages[0].remote_jid = '550011112222@s.whatsapp.net';
    await pedir();
    expect(pedidos[0].corpo.numero).toBe('550011112222');
  });

  it('grupo, conversa sem número, sem computador, computador fora, sem telefone: recusa sem pedir à máquina', async () => {
    banco.tabelas.conversations[0].group_id = 'grupo-1';
    expect(await pedir()).toEqual({ ok: false, status: 400, codigo: 'grupo' });
    banco.tabelas.conversations[0].group_id = null;
    banco.tabelas.conversations[0].channel_id = null;
    expect(await pedir()).toEqual({ ok: false, status: 409, codigo: 'conversa_sem_numero' });
    banco.tabelas.conversations[0].channel_id = 'outro-canal';
    expect(await pedir()).toEqual({ ok: false, status: 409, codigo: 'sem_computador' });
    banco.tabelas.conversations[0].channel_id = CANAL;
    banco.tabelas.cb_computadores_de_ligacao[0].ultimo_sinal_em = new Date(AGORA - 4 * 60_000).toISOString();
    expect(await pedir()).toEqual({ ok: false, status: 409, codigo: 'computador_fora' });
    banco.tabelas.cb_computadores_de_ligacao[0].ultimo_sinal_em = new Date(AGORA).toISOString();
    banco.tabelas.messages = [];
    banco.tabelas.contacts[0].phone = null;
    expect(await pedir()).toEqual({ ok: false, status: 409, codigo: 'sem_telefone' });
    expect(pedidos).toEqual([]);
    expect(ligacoes()).toEqual([]);
  });

  it('D13: a 21ª ligação feita na hora pelo mesmo número é 429', async () => {
    banco.tabelas.cb_ligacoes = Array.from({ length: 20 }, (_, i) => ({
      id: `l-${i}`,
      account_id: CONTA,
      channel_id: CANAL,
      direcao: 'feita',
      criada_em: new Date(AGORA - 10 * 60_000).toISOString(),
    }));
    expect(await pedir()).toEqual({ ok: false, status: 429, codigo: 'limite_por_hora' });
  });

  it('com uma recebida TOCANDO no número, não disca', async () => {
    banco.tabelas.cb_ligacoes_ao_vivo = [
      { id: 'toque-1', account_id: CONTA, channel_id: CANAL, estado: 'tocando', desde: new Date(AGORA - 5_000).toISOString() },
    ];
    expect(await pedir()).toEqual({ ok: false, status: 409, codigo: 'tocando_agora' });
  });

  it('a linha já ocupada (o índice único de uma por número): 409, sem pedir à máquina', async () => {
    // O INSERT da trava bate no índice único (só ele: as leituras da tabela seguem).
    const from = banco.db.from.bind(banco.db);
    (banco.db as unknown as { from: unknown }).from = (tabela: string) => {
      const q = from(tabela);
      if (tabela !== 'cb_ligacoes_ao_vivo') return q;
      return {
        ...q,
        insert: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } }),
      };
    };
    expect(await pedir()).toEqual({ ok: false, status: 409, codigo: 'ocupada' });
    expect(pedidos).toEqual([]);
  });

  it('a máquina recusa ou não responde: a ligação fica como falha, sem faixa, e a linha solta', async () => {
    maquina = { status: 409, corpo: { erro: 'ocupada' } };
    expect(await pedir()).toEqual({ ok: false, status: 409, codigo: 'ocupada' });
    expect(ligacoes()[0]).toMatchObject({ desfecho: 'falhou' });
    expect(aoVivo()).toEqual([]);

    maquina = 'cai';
    expect(await pedir()).toEqual({ ok: false, status: 504, codigo: 'sem_resposta' });
    expect(faixas()).toEqual([]);
  });
});

describe('atender', () => {
  beforeEach(() => {
    banco.tabelas.cb_ligacoes = [
      { id: ID, account_id: CONTA, channel_id: CANAL, call_id: 'CALL-WA-1', direcao: 'recebida', pelo_crm: false, desfecho: null },
    ];
    banco.tabelas.cb_ligacoes_ao_vivo = [
      { id: ID, account_id: CONTA, channel_id: CANAL, direcao: 'recebida', estado: 'tocando', telefone: NUMERO, atendente_id: null },
    ];
  });
  const pedir = () => atender({ ...base(), accountId: CONTA, userId: 'usuario-1', ligacaoId: ID, oferta: OFERTA, agendar });

  it('reivindica o toque, grava a marca e pede à máquina o aceite daquele número', async () => {
    expect(await pedir()).toEqual({ ok: true, resposta: RESPOSTA });
    expect(aoVivo()[0]).toMatchObject({ estado: 'conectando', atendente_id: 'usuario-1' });
    expect(ligacoes()[0]).toMatchObject({
      pelo_crm: true,
      atendente_id: 'usuario-1',
      telefone: NUMERO,
      atendimento_pelo_crm_desde: new Date(AGORA).toISOString(),
    });
    expect(pedidos[0]).toMatchObject({
      url: 'http://ligacoes-teste:8080/atender',
      corpo: { ligacao: ID, numero: NUMERO, oferta: OFERTA },
    });
  });

  it('o segundo "Atender" recebe 409 (o primeiro levou)', async () => {
    await pedir();
    expect(await pedir()).toEqual({ ok: false, status: 409, codigo: 'ja_atendida' });
    expect(pedidos).toHaveLength(1);
  });

  it('a ligação que já tem desfecho: 409, e o toque sai', async () => {
    banco.tabelas.cb_ligacoes[0].desfecho = 'perdida';
    expect(await pedir()).toEqual({ ok: false, status: 409, codigo: 'ja_encerrada' });
    expect(aoVivo()).toEqual([]);
    expect(pedidos).toEqual([]);
  });

  it('a máquina não atende (o cliente desistiu): a marca sai, e a régua de hoje decide DEPOIS da folga', async () => {
    maquina = { status: 409, corpo: { erro: 'nada_tocando' } };
    expect(await pedir()).toEqual({ ok: false, status: 409, codigo: 'nada_tocando' });
    expect(ligacoes()[0]).toMatchObject({ pelo_crm: false, atendente_id: null, atendimento_pelo_crm_desde: null });
    expect(aoVivo()).toEqual([]);
    expect(decidirLigacao).not.toHaveBeenCalled();
    expect(tarefas).toHaveLength(1);
    vi.useFakeTimers();
    try {
      const rodando = tarefas[0]();
      await vi.advanceTimersByTimeAsync(11_000);
      await rodando;
    } finally {
      vi.useRealTimers();
    }
    expect(decidirLigacao).toHaveBeenCalledWith(
      banco.db,
      { accountId: CONTA, channelId: CANAL, ownLid: null },
      'CALL-WA-1',
    );
  });
});

describe('os avisos da máquina', () => {
  const aviso = (a: Record<string, unknown>) => {
    const lido = lerAviso({ computador: 'teste', em: '2026-11-10T20:05:00.000Z', ...a }, 'teste');
    if (!lido) throw new Error('aviso inválido no teste');
    return receberAviso({ db: banco.db, computador: computador(), aviso: lido, agendar });
  };

  function feitaEmCurso(extra: Record<string, unknown> = {}) {
    banco.tabelas.cb_ligacoes = [
      {
        id: ID,
        account_id: CONTA,
        channel_id: CANAL,
        call_id: `crm:${ID}`,
        direcao: 'feita',
        pelo_crm: true,
        atendente_id: 'usuario-1',
        telefone: NUMERO,
        conversation_id: 'conversa-1',
        criada_em: '2026-11-10T20:00:00.000Z',
        desfecho: null,
        gravacao_recebida_em: null,
        ...extra,
      },
    ];
    banco.tabelas.cb_ligacoes_ao_vivo = [
      { id: ID, account_id: CONTA, channel_id: CANAL, direcao: 'feita', estado: 'conectando', atendente_id: 'usuario-1' },
    ];
  }

  it('chamando e atendida andam a linha ao vivo; a atendida grava a hora uma vez só', async () => {
    feitaEmCurso();
    expect(await aviso({ tipo: 'chamando', ligacao: ID })).toBe('ok');
    expect(aoVivo()[0].estado).toBe('chamando');
    expect(await aviso({ tipo: 'atendida', ligacao: ID, atendida_em: '2026-11-10T20:00:20.000Z' })).toBe('ok');
    expect(await aviso({ tipo: 'atendida', ligacao: ID, atendida_em: '2026-11-10T20:00:59.000Z' })).toBe('ok');
    expect(aoVivo()[0].estado).toBe('em_ligacao');
    expect(ligacoes()[0].atendida_pelo_crm_em).toBe('2026-11-10T20:00:20.000Z');
  });

  it('⚠️ o fim da feita atendida grava a faixa de REGISTRO: agent sem autor, fora do celular, sem mexer na conversa', async () => {
    feitaEmCurso({ atendida_pelo_crm_em: '2026-11-10T20:00:20.000Z' });
    const r = await aviso({
      tipo: 'encerrada',
      ligacao: ID,
      motivo: 'cliente_desligou',
      atendida_em: '2026-11-10T20:00:20.000Z',
      duracao_seg: 280,
    });
    expect(r).toBe('ok');
    expect(ligacoes()[0]).toMatchObject({
      desfecho: 'atendida',
      motivo_do_fim: 'cliente_desligou',
      duracao_seg: 280,
      encerrada_em: '2026-11-10T20:05:00.000Z',
      conversation_id: 'conversa-1',
    });
    expect(faixas()).toEqual([
      expect.objectContaining({
        conversation_id: 'conversa-1',
        sender_type: 'agent',
        sender_id: null,
        from_device: false,
        content_type: 'call',
        content_text: null,
        message_id: `call:crm:${ID}`,
        channel_id: CANAL,
        created_at: '2026-11-10T20:00:20.000Z',
        ligacao: expect.objectContaining({
          desfecho: 'atendida',
          pelo_crm: true,
          direcao: 'feita',
          atendente: { id: 'usuario-1', nome: 'Atendente Fictícia' },
          duracao_seg: 280,
          motivo: 'cliente_desligou',
          gravacao: false,
        }),
      }),
    ]);
    expect(ligacoes()[0].message_id).toBe(faixas()[0].id);
    expect(aoVivo()).toEqual([]);
    // Só registro: nada de reabrir, subir a conversa ou mexer nas não lidas —
    // a única RPC é a da própria faixa refletindo a ligação (1136).
    expect(banco.rpcs).toEqual([{ nome: 'cb_ligacao_sincronizar_faixa', args: { p_ligacao: ligacoes()[0].id } }]);
    expect(banco.escritas.filter((e) => e.tabela === 'conversations')).toEqual([
      // o preencher do número: a cerca `channel_id IS NULL` (a conversa já tem)
      expect.objectContaining({ op: 'update', payload: { channel_id: CANAL } }),
    ]);
    expect(banco.tabelas.conversations[0].channel_id).toBe(CANAL);
    expect(resolverDestinatario).not.toHaveBeenCalled();
    expect(routeContactToPipeline).not.toHaveBeenCalled();
  });

  it('a feita que o cliente não atendeu: "nao_atendida"; o fim repetido não grava outra faixa', async () => {
    feitaEmCurso();
    const fim = { tipo: 'encerrada', ligacao: ID, motivo: 'nao_atendida', atendida_em: null, duracao_seg: null };
    expect(await aviso(fim)).toBe('ok');
    expect(await aviso(fim)).toBe('ok');
    expect(ligacoes()[0]).toMatchObject({ desfecho: 'nao_atendida', motivo_do_fim: 'nao_atendida' });
    expect(faixas()).toHaveLength(1);
    expect(faixas()[0].ligacao).toMatchObject({ desfecho: 'nao_atendida', atendida_em: null });
  });

  it('a recebida que a máquina não chegou a atender volta à régua de hoje (sem faixa)', async () => {
    banco.tabelas.cb_ligacoes = [
      {
        id: ID,
        account_id: CONTA,
        channel_id: CANAL,
        call_id: 'CALL-WA-1',
        direcao: 'recebida',
        pelo_crm: true,
        atendimento_pelo_crm_desde: '2026-11-10T20:04:50.000Z',
        telefone: NUMERO,
        desfecho: null,
      },
    ];
    expect(
      await aviso({ tipo: 'encerrada', ligacao: ID, motivo: 'cliente_desligou', atendida_em: null, duracao_seg: null }),
    ).toBe('ok');
    expect(ligacoes()[0]).toMatchObject({ pelo_crm: false, atendimento_pelo_crm_desde: null, desfecho: null });
    expect(faixas()).toEqual([]);
    expect(tarefas).toHaveLength(1);
  });

  it('a recebida atendida pelo CRM: a faixa vai à conversa do número (criada se preciso) e o card segue a regra de toda ligação', async () => {
    banco.tabelas.cb_ligacoes = [
      {
        id: ID,
        account_id: CONTA,
        channel_id: CANAL,
        call_id: 'CALL-WA-1',
        direcao: 'recebida',
        pelo_crm: true,
        atendente_id: 'usuario-1',
        telefone: NUMERO,
        oferta_em: '2026-11-10T20:04:30.000Z',
        atendida_pelo_crm_em: '2026-11-10T20:04:40.000Z',
        desfecho: null,
        gravacao_recebida_em: null,
      },
    ];
    expect(
      await aviso({ tipo: 'encerrada', ligacao: ID, motivo: 'atendente_desligou', atendida_em: '2026-11-10T20:04:40.000Z', duracao_seg: 20 }),
    ).toBe('ok');
    expect(resolverDestinatario).toHaveBeenCalledWith(banco.db, CONTA, NUMERO, undefined, { origem: { via: 'ligacao' } });
    expect(routeContactToPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: CONTA, channelId: CANAL, contactId: 'contato-1', conversationId: 'conversa-1' }),
    );
    expect(faixas()).toEqual([
      expect.objectContaining({
        message_id: 'call:CALL-WA-1',
        sender_type: 'agent',
        sender_id: null,
        from_device: false,
        ligacao: expect.objectContaining({ direcao: 'recebida', desfecho: 'atendida', inicio: '2026-11-10T20:04:30.000Z' }),
      }),
    ]);
    // A recebida guarda o fim do TOQUE (o terminate da Evolution), não o da ligação.
    expect(ligacoes()[0].encerrada_em).toBeUndefined();
  });

  it('⚠️ a faixa que falha depois do desfecho devolve 500, e o aviso REPETIDO a grava (Codex, #497)', async () => {
    feitaEmCurso({ atendida_pelo_crm_em: '2026-11-10T20:00:20.000Z' });
    const fim = {
      tipo: 'encerrada',
      ligacao: ID,
      motivo: 'cliente_desligou',
      atendida_em: '2026-11-10T20:00:20.000Z',
      duracao_seg: 30,
    };
    banco.falhas.messages = { code: 'XX000', message: 'o banco não respondeu' };
    expect(await aviso(fim)).toBe('falhou');
    expect(ligacoes()[0].desfecho).toBe('atendida');
    expect(ligacoes()[0].message_id ?? null).toBeNull();
    delete banco.falhas.messages;
    expect(await aviso(fim)).toBe('ok');
    expect(faixas()).toHaveLength(1);
    expect(ligacoes()[0].message_id).toBe(faixas()[0].id);
    expect(faixas()[0].ligacao).toMatchObject({ motivo: 'cliente_desligou', duracao_seg: 30 });
    // O ▶ da faixa (4c) acha a gravação pelo id da ligação.
    expect(faixas()[0].ligacao).toMatchObject({ ligacao_id: ID });
  });

  it('a faixa que entrou sem o vínculo é LIGADA na repetição, sem duplicar', async () => {
    feitaEmCurso({ desfecho: 'nao_atendida', motivo_do_fim: 'nao_atendida' });
    banco.tabelas.messages.push({
      id: 'faixa-antiga',
      conversation_id: 'conversa-1',
      content_type: 'call',
      message_id: `call:crm:${ID}`,
    });
    // O dublê aplica o UNIQUE (conversa, message_id) da tabela de verdade.
    const from = banco.db.from.bind(banco.db);
    (banco.db as unknown as { from: unknown }).from = (tabela: string) => {
      const q = from(tabela);
      if (tabela !== 'messages') return q;
      return {
        ...q,
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } }),
          }),
        }),
      };
    };
    expect(
      await aviso({ tipo: 'encerrada', ligacao: ID, motivo: 'nao_atendida', atendida_em: null, duracao_seg: null }),
    ).toBe('ok');
    expect(ligacoes()[0].message_id).toBe('faixa-antiga');
  });

  it('o sinal retoma a faixa que faltou num fim que a máquina não vai repetir (o "sumiu")', async () => {
    feitaEmCurso({ desfecho: 'nao_atendida', motivo_do_fim: 'sumiu', criada_em: '2026-11-10T19:58:00.000Z' });
    expect(await aviso({ tipo: 'sinal', whatsapp: 'conectado', ligacao: null, chrome: '157.0' })).toBe('ok');
    expect(faixas()).toHaveLength(1);
    expect(faixas()[0].ligacao).toMatchObject({ desfecho: 'nao_atendida', motivo: 'sumiu' });
    expect(ligacoes()[0].message_id).toBe(faixas()[0].id);
  });

  it('ligação que o CRM não conhece: 404 para a máquina largar o aviso', async () => {
    expect(
      await aviso({ tipo: 'encerrada', ligacao: ID, motivo: 'falhou', atendida_em: null, duracao_seg: null }),
    ).toBe('desconhecida');
  });

  it('o sinal grava o estado do computador e fecha como "sumiu" a ligação que a máquina não tem mais', async () => {
    feitaEmCurso({ criada_em: '2026-11-10T19:58:00.000Z' });
    banco.tabelas.cb_ligacoes.push({
      id: 'recente',
      account_id: CONTA,
      channel_id: CANAL,
      call_id: 'crm:recente',
      direcao: 'feita',
      pelo_crm: true,
      conversation_id: 'conversa-1',
      criada_em: '2026-11-10T20:04:30.000Z',
      desfecho: null,
    });
    expect(await aviso({ tipo: 'sinal', whatsapp: 'conectado', ligacao: null, chrome: '157.0' })).toBe('ok');
    expect(banco.tabelas.cb_computadores_de_ligacao[0]).toMatchObject({
      whatsapp: 'conectado',
      ligacao_em_curso: null,
      chrome: '157.0',
    });
    const [velha, recente] = ligacoes();
    expect(velha).toMatchObject({ desfecho: 'nao_atendida', motivo_do_fim: 'sumiu' });
    // Dentro da margem (o pedido pode estar a caminho da máquina): fica.
    expect(recente.desfecho ?? null).toBeNull();
    expect(faixas()).toHaveLength(1);
  });

  it('o sinal NÃO fecha a ligação que a máquina diz ter em curso', async () => {
    feitaEmCurso({ criada_em: '2026-11-10T19:50:00.000Z' });
    expect(await aviso({ tipo: 'sinal', whatsapp: 'conectado', ligacao: ID, chrome: '157.0' })).toBe('ok');
    expect(ligacoes()[0].desfecho ?? null).toBeNull();
  });
});

describe('lerAviso', () => {
  const em = '2026-11-10T20:05:00.000Z';
  it('confere o computador, o tipo e cada campo', () => {
    expect(lerAviso({ computador: 'outro', em, tipo: 'chamando', ligacao: ID }, 'teste')).toBeNull();
    expect(lerAviso({ computador: 'teste', em: 'ontem', tipo: 'chamando', ligacao: ID }, 'teste')).toBeNull();
    expect(lerAviso({ computador: 'teste', em, tipo: 'chamando', ligacao: 'lig-1' }, 'teste')).toBeNull();
    expect(
      lerAviso({ computador: 'teste', em, tipo: 'encerrada', ligacao: ID, motivo: 'qualquer', atendida_em: null, duracao_seg: null }, 'teste'),
    ).toBeNull();
    expect(
      lerAviso({ computador: 'teste', em, tipo: 'encerrada', ligacao: ID, motivo: 'falhou', atendida_em: null, duracao_seg: -1 }, 'teste'),
    ).toBeNull();
    expect(lerAviso({ computador: 'teste', em, tipo: 'sinal', whatsapp: 'aberto', ligacao: null, chrome: '' }, 'teste')).toBeNull();
    expect(lerAviso({ computador: 'teste', em, tipo: 'sinal', whatsapp: 'qr', ligacao: null, chrome: '157' }, 'teste')).toEqual({
      tipo: 'sinal',
      em,
      whatsapp: 'qr',
      ligacao: null,
      chrome: '157',
    });
  });
});

describe('desligar', () => {
  const pedir = () => desligar({ ...base(), accountId: CONTA, ligacaoId: ID, agendar });

  it('a que já acabou: 200 sem pedir nada; a que ainda TOCA não se recusa (D12)', async () => {
    expect(await pedir()).toEqual({ ok: true });
    banco.tabelas.cb_ligacoes_ao_vivo = [{ id: ID, account_id: CONTA, channel_id: CANAL, estado: 'tocando' }];
    expect(await pedir()).toEqual({ ok: false, status: 409, codigo: 'ainda_tocando' });
    expect(pedidos).toEqual([]);
  });

  it('pede à máquina; se ela não tem a ligação (reiniciou), o CRM a fecha como "sumiu"', async () => {
    banco.tabelas.cb_ligacoes = [
      { id: ID, account_id: CONTA, channel_id: CANAL, call_id: `crm:${ID}`, direcao: 'feita', pelo_crm: true, conversation_id: 'conversa-1', criada_em: '2026-11-10T20:00:00.000Z', desfecho: null },
    ];
    banco.tabelas.cb_ligacoes_ao_vivo = [{ id: ID, account_id: CONTA, channel_id: CANAL, estado: 'em_ligacao' }];
    maquina = { status: 404, corpo: { erro: 'nao_encontrada' } };
    expect(await pedir()).toEqual({ ok: true });
    expect(pedidos[0]).toMatchObject({ url: 'http://ligacoes-teste:8080/desligar', corpo: { ligacao: ID } });
    expect(ligacoes()[0]).toMatchObject({ motivo_do_fim: 'sumiu' });
    expect(aoVivo()).toEqual([]);
  });
});

describe('a gravação', () => {
  let enviados: { caminho: string; opcoes: unknown }[];
  beforeEach(() => {
    enviados = [];
    (banco.db as unknown as { storage: unknown }).storage = {
      from: (bucket: string) => ({
        upload: async (caminho: string, _corpo: Buffer, opcoes: unknown) => {
          enviados.push({ caminho: `${bucket}/${caminho}`, opcoes });
          return { error: null };
        },
      }),
    };
  });
  const receber = (arquivo: string) =>
    receberGravacao({ db: banco.db, computador: computador(), ligacaoId: ID, arquivo, corpo: Buffer.from('ogg') });

  it('vai ao bucket PRIVADO pelo caminho da conta; o estéreo marca a ligação e a faixa', async () => {
    banco.tabelas.cb_ligacoes = [
      {
        id: ID,
        account_id: CONTA,
        channel_id: CANAL,
        pelo_crm: true,
        message_id: 'faixa-1',
        gravacao_recebida_em: null,
        desfecho: 'atendida',
        atendida_pelo_crm_em: '2026-11-10T20:00:20.000Z',
      },
    ];
    banco.tabelas.messages.push({ id: 'faixa-1', content_type: 'call', ligacao: { desfecho: 'atendida', gravacao: false } });
    expect(await receber('cliente.ogg')).toBe('ok');
    expect(ligacoes()[0].gravacao_recebida_em).toBeNull();
    expect(await receber('estereo.ogg')).toBe('ok');
    expect(enviados.map((e) => e.caminho)).toEqual([
      `ligacoes/account-${CONTA}/ligacoes/${ID}/cliente.ogg`,
      `ligacoes/account-${CONTA}/ligacoes/${ID}/estereo.ogg`,
    ]);
    expect(enviados[1].opcoes).toEqual({ contentType: 'audio/ogg', upsert: true });
    expect(ligacoes()[0].gravacao_recebida_em).toEqual(expect.any(String));
    // A faixa passa a refletir a ligação numa escrita só, sob a trava da linha
    // (1136): a marca da transcrição chega por outro pedido.
    expect(banco.rpcs).toEqual([{ nome: 'cb_ligacao_sincronizar_faixa', args: { p_ligacao: ID } }]);
  });

  it('⚠️ de ligação NUNCA atendida não guarda nada (Codex, #500): descartada com o desfecho, cedo sem ele', async () => {
    banco.tabelas.cb_ligacoes = [
      { id: ID, account_id: CONTA, channel_id: CANAL, pelo_crm: true, desfecho: 'nao_atendida', atendida_pelo_crm_em: null },
    ];
    expect(await receber('estereo.ogg')).toBe('descartada');
    banco.tabelas.cb_ligacoes[0].desfecho = null;
    expect(await receber('cliente.ogg')).toBe('cedo');
    expect(enviados).toEqual([]);
    expect(ligacoes()[0].gravacao_recebida_em ?? null).toBeNull();
  });

  it('o reenvio do que já saiu volta DESCARTADO (revisão da 4d): a podada ou excluída, e o lado de uma transcrição pronta', async () => {
    const atendida = { id: ID, account_id: CONTA, channel_id: CANAL, pelo_crm: true, desfecho: 'atendida', atendida_pelo_crm_em: '2026-11-10T20:00:20.000Z' };
    banco.tabelas.cb_ligacoes = [{ ...atendida, gravacao_expirada_em: '2026-11-11T00:00:00.000Z' }];
    expect(await receber('estereo.ogg')).toBe('descartada');
    banco.tabelas.cb_ligacoes = [{ ...atendida, transcricao_status: 'pronta', gravacao_recebida_em: null }];
    expect(await receber('cliente.ogg')).toBe('descartada');
    expect(enviados).toEqual([]);
    // O estéreo de uma transcrição pronta ainda entra (é o que se ouve).
    expect(await receber('estereo.ogg')).toBe('ok');
    expect(enviados.map((e) => e.caminho)).toEqual([`ligacoes/account-${CONTA}/ligacoes/${ID}/estereo.ogg`]);
  });

  it('de ligação que não é deste computador (ou não é pelo CRM): desconhecida', async () => {
    banco.tabelas.cb_ligacoes = [{ id: ID, account_id: CONTA, channel_id: 'outro', pelo_crm: true }];
    expect(await receber('estereo.ogg')).toBe('desconhecida');
    expect(enviados).toEqual([]);
  });
});
