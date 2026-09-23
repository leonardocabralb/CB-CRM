import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CbAutomationEvent } from '@/types';

// A entrega em si (assinatura, SSRF, contador de falhas) é de `deliver.ts` e
// tem teste próprio. Aqui interessa O QUE chega a ela, e quando.
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(async () => 'tentado'),
}));

import { dispatchWebhookEvent } from './deliver';
import { entregarEventosDeFunil } from './entregar-eventos-de-funil';

// ============================================================
// Banco falso: filtra DE VERDADE por eq/in/overlaps e pagina por range, para
// o recorte pela conta ser testado, não suposto. Dados FICTÍCIOS.
// ============================================================

type Linha = Record<string, unknown>;

interface Consulta {
  tabela: string;
  select: string;
  eq: [string, unknown][];
  in: [string, unknown[]][];
  overlaps: [string, unknown[]][];
  range?: [number, number];
  /** Presente = UPDATE (aplicado de verdade às linhas que casam). */
  update?: Linha;
}

function bancoFalso(
  tabelas: Record<string, Linha[]>,
  falham: string[] = [],
  /** Falha só a consulta que casar — para derrubar UMA escrita da tabela, não todas. */
  falhaSe: (c: Consulta) => boolean = () => false
) {
  const consultas: Consulta[] = [];
  const from = (tabela: string) => {
    const c: Consulta = { tabela, select: '', eq: [], in: [], overlaps: [] };
    consultas.push(c);
    const resultado = () => {
      if (falham.includes(tabela) || falhaSe(c)) return { data: null, error: { message: `${tabela} caiu` } };
      let linhas = (tabelas[tabela] ?? []).filter(
        (l) =>
          c.eq.every(([k, v]) => l[k] === v) &&
          c.in.every(([k, vs]) => vs.includes(l[k])) &&
          c.overlaps.every(
            ([k, vs]) => Array.isArray(l[k]) && (l[k] as unknown[]).some((x) => vs.includes(x))
          )
      );
      if (c.update) {
        // O filtro acima rodou sobre os valores de ANTES: é o compare-and-swap.
        for (const l of linhas) Object.assign(l, c.update);
        // Com `.select(...)`, o PostgREST devolve as linhas que o UPDATE alcançou.
        return { data: c.select ? linhas.map((l) => ({ id: l.id })) : null, error: null };
      }
      if (c.range) linhas = linhas.slice(c.range[0], c.range[1] + 1);
      return { data: linhas, error: null };
    };
    const b = {
      update: (v: Linha) => ((c.update = v), b),
      select: (s: string) => ((c.select = s), b),
      eq: (k: string, v: unknown) => (c.eq.push([k, v]), b),
      in: (k: string, vs: unknown[]) => (c.in.push([k, vs]), b),
      overlaps: (k: string, vs: unknown[]) => (c.overlaps.push([k, vs]), b),
      order: () => b,
      range: (a: number, z: number) => ((c.range = [a, z]), b),
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
        Promise.resolve(resultado()).then(ok, erro),
    };
    return b;
  };
  return {
    db: { from } as unknown as SupabaseClient,
    consultas,
    /** Só as leituras — as escritas da pendência (1040) são conferidas à parte. */
    leituras: () => consultas.filter((c) => !c.update),
    escritas: () => consultas.filter((c) => c.update),
  };
}

const CONTA = '00000000-0000-4000-8000-00000000c0a7';
const OUTRA_CONTA = '00000000-0000-4000-8000-00000000c0a8';
const FUNIL = 'f-comercial';
const LEAD = 'e-lead';
const REUNIAO = 'e-reuniao';
const NEGOCIO = 'd-1';
const CONTATO = 'c-1';
/** O carimbo com que o dreno reivindicou as linhas — a cerca da limpeza. */
const CARIMBO = '2026-09-23T14:10:30.000Z';

/** A entrega como o dreno a chama, com o carimbo da reivindicação. */
const entregar = (db: SupabaseClient, linhas: CbAutomationEvent[]) => entregarEventosDeFunil(db, linhas, CARIMBO);

function evento(parcial: Partial<CbAutomationEvent> = {}): CbAutomationEvent {
  return {
    id: 'evt-1',
    account_id: CONTA,
    tipo: 'deal_stage_changed',
    deal_id: NEGOCIO,
    contact_id: CONTATO,
    channel_id: 'conexao-1',
    from_pipeline_id: FUNIL,
    to_pipeline_id: FUNIL,
    from_stage_id: LEAD,
    to_stage_id: REUNIAO,
    from_status: null,
    to_status: null,
    origem: 'usuario',
    cadeia: [],
    criado_em: '2026-09-23T14:05:00.000Z',
    processado_em: '2026-09-23T14:05:01.000Z',
    tentativas: 0,
    erro: null,
    webhooks_pendente_desde: CARIMBO,
    webhooks_tentativas: 0,
    ...parcial,
  };
}

const CRIADO = evento({ id: 'evt-criado', from_pipeline_id: null, from_stage_id: null, to_stage_id: LEAD, criado_em: '2026-09-23T14:00:00.000Z' });
const MOVIDO = evento({ id: 'evt-movido', criado_em: '2026-09-23T14:05:00.000Z' });
const GANHO = evento({
  id: 'evt-ganho',
  tipo: 'deal_status_changed',
  from_pipeline_id: null,
  from_stage_id: null,
  from_status: 'open',
  to_status: 'won',
  criado_em: '2026-09-23T14:10:00.000Z',
});

/**
 * Todos os ids de evento que os testes usam: a fila padrão os traz PENDENTES
 * com o carimbo da reivindicação, que é o estado em que o dreno entrega — sem
 * isso a renovação da posse não acharia linha e nada sairia.
 */
const IDS_DE_TESTE = [
  ...new Set([
    'evt-criado',
    'evt-movido',
    'evt-ganho',
    'evt-outra',
    ...Array.from({ length: 11 }, (_, i) => `evt-${i}`),
  ]),
];

function tabelas(parcial: Record<string, Linha[]> = {}): Record<string, Linha[]> {
  return {
    cb_automation_events: fila(IDS_DE_TESTE),
    webhook_endpoints: [
      { account_id: CONTA, is_active: true, events: ['deal.created', 'deal.stage_changed', 'deal.status_changed'] },
    ],
    deals: [
      {
        id: NEGOCIO,
        account_id: CONTA,
        pipeline_id: FUNIL,
        stage_id: REUNIAO,
        contact_id: CONTATO,
        conversation_id: null,
        channel_id: 'conexao-1',
        title: 'Maria Exemplo',
        value: '1500.00',
        currency: 'BRL',
        status: 'won',
        source: 'channel',
        expected_close_date: null,
        created_at: '2026-09-23T14:00:00.000Z',
        updated_at: '2026-09-23T14:10:00.000Z',
        assigned_to: 'perfil-ana',
      },
    ],
    profiles: [{ id: 'perfil-ana', account_id: CONTA, user_id: 'usuario-ana', full_name: 'Ana Atendente' }],
    pipelines: [{ id: FUNIL, account_id: CONTA, name: 'Comercial' }],
    pipeline_stages: [
      { id: LEAD, pipeline_id: FUNIL, name: 'Lead', position: 2 },
      { id: REUNIAO, pipeline_id: FUNIL, name: 'Reunião Agendada', position: 3 },
    ],
    contacts: [
      {
        id: CONTATO,
        account_id: CONTA,
        phone: '5511900000000',
        name: 'Maria Exemplo',
        email: 'maria@exemplo.com.br',
        company: null,
        avatar_url: null,
        instagram_id: null,
        instagram_username: null,
        created_at: '2026-09-20T12:00:00.000Z',
        updated_at: '2026-09-23T14:00:00.000Z',
        contact_tags: [{ tags: { id: 't-1', name: 'Typebot', color: '#3b82f6' } }, { tags: null }],
      },
    ],
    custom_fields: [
      { id: 'cf-divida', account_id: CONTA, field_key: 'tamanho_da_divida', field_name: 'Tamanho da dívida', field_type: 'number', categoria: 'geral' },
      { id: 'cf-utm', account_id: CONTA, field_key: 'utm_source', field_name: 'utm_source', field_type: 'text', categoria: 'tracking' },
      { id: 'cf-vazio', account_id: CONTA, field_key: 'observacao', field_name: 'Observação', field_type: 'text', categoria: 'geral' },
    ],
    contact_custom_values: [
      { contact_id: CONTATO, custom_field_id: 'cf-divida', value: '150000' },
      // '' no banco (automação que gravou variável vazia) sai null, como na v1.
      { contact_id: CONTATO, custom_field_id: 'cf-vazio', value: '' },
    ],
    ...parcial,
  };
}

const chamadas = () => vi.mocked(dispatchWebhookEvent).mock.calls;
/** O `data` da i-ésima entrega, para inspecionar campo a campo. */
const dataDa = (i: number) => chamadas()[i][3] as unknown as Record<string, unknown>;

// `mockReset` devolve a implementação da fábrica — o teste de concorrência troca a dele.
// ⚠️ Em bloco, sem devolver nada: função devolvida pelo `beforeEach` é tratada
// pelo Vitest como LIMPEZA e chamada no fim do teste — e `mockReset()` devolve
// o próprio mock, que era chamado sem argumento nenhum.
beforeEach(() => {
  vi.mocked(dispatchWebhookEvent).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('entregarEventosDeFunil', () => {
  it('conta sem endpoint deal.*: UMA consulta, nenhum catálogo lido, nada entregue', async () => {
    const { db, consultas, leituras } = bancoFalso(
      tabelas({ webhook_endpoints: [{ account_id: CONTA, is_active: true, events: ['message.received'] }] })
    );
    await entregar(db, [CRIADO, MOVIDO, GANHO]);

    expect(leituras().map((c) => c.tabela)).toEqual(['webhook_endpoints']);
    // A pergunta é "alguém assina ALGUM deal.*?", só dos ativos da conta.
    expect(consultas[0].overlaps).toEqual([['events', ['deal.created', 'deal.stage_changed', 'deal.status_changed']]]);
    expect(consultas[0].eq).toEqual(expect.arrayContaining([['account_id', CONTA], ['is_active', true]]));
    expect(chamadas()).toHaveLength(0);
  });

  it('endpoint DESLIGADO não conta', async () => {
    const { db, leituras } = bancoFalso(
      tabelas({ webhook_endpoints: [{ account_id: CONTA, is_active: false, events: ['deal.created'] }] })
    );
    await entregar(db, [CRIADO]);
    expect(leituras()).toHaveLength(1);
    expect(chamadas()).toHaveLength(0);
  });

  it('só as linhas cujo evento alguém assina viram aviso', async () => {
    const { db } = bancoFalso(
      tabelas({ webhook_endpoints: [{ account_id: CONTA, is_active: true, events: ['deal.status_changed'] }] })
    );
    await entregar(db, [CRIADO, MOVIDO, GANHO]);
    expect(chamadas().map((c) => c[2])).toEqual(['deal.status_changed']);
  });

  it('created, stage e status: cada um com o seu evento, id e hora do FATO, em ordem de criado_em', async () => {
    const { db } = bancoFalso(tabelas());
    // Fora de ordem de propósito.
    await entregar(db, [GANHO, CRIADO, MOVIDO]);

    const c = chamadas();
    expect(c.map((x) => x[2])).toEqual(['deal.created', 'deal.stage_changed', 'deal.status_changed']);
    expect(c.map((x) => x[1])).toEqual([CONTA, CONTA, CONTA]);
    expect(c.map((x) => x[4])).toEqual([
      { id: 'evt-criado', occurredAt: '2026-09-23T14:00:00.000Z' },
      { id: 'evt-movido', occurredAt: '2026-09-23T14:05:00.000Z' },
      { id: 'evt-ganho', occurredAt: '2026-09-23T14:10:00.000Z' },
    ]);

    const [criado, movido, ganho] = c.map((_, i) => dataDa(i));
    expect(criado.event_id).toBe('evt-criado');
    expect(criado.stage).toEqual({ id: LEAD, name: 'Lead', position: 2 });
    expect('from_stage' in criado).toBe(false);
    expect(movido.from_stage).toEqual({ id: LEAD, name: 'Lead', position: 2 });
    expect(movido.stage).toEqual({ id: REUNIAO, name: 'Reunião Agendada', position: 3 });
    expect(movido.pipeline).toEqual({ id: FUNIL, name: 'Comercial' });
    expect(ganho).toMatchObject({ from_status: 'open', status: 'won' });
    // O negócio no formato da v1 (value numérico) e o responsável pelo USUÁRIO.
    expect(movido.deal).toMatchObject({ id: NEGOCIO, value: 1500, status: 'won', currency: 'BRL' });
    expect(movido.assignee).toEqual({ user_id: 'usuario-ana', name: 'Ana Atendente' });
  });

  it('contato completo: etiquetas e TODO campo do catálogo (vazio = null)', async () => {
    const { db } = bancoFalso(tabelas());
    await entregar(db, [MOVIDO]);
    const contato = (dataDa(0).contact as Record<string, unknown>);
    expect(contato).toMatchObject({ id: CONTATO, name: 'Maria Exemplo', phone: '5511900000000' });
    expect(contato.tags).toEqual([{ id: 't-1', name: 'Typebot', color: '#3b82f6' }]);
    expect(contato.custom_fields).toEqual({
      tamanho_da_divida: '150000',
      utm_source: null,
      observacao: null,
    });
  });

  it('negócio apagado antes da entrega: deal e assignee null, o resto sai', async () => {
    const { db } = bancoFalso(tabelas({ deals: [] }));
    await entregar(db, [MOVIDO]);
    const data = dataDa(0);
    expect(data.deal_id).toBe(NEGOCIO);
    expect(data.deal).toBeNull();
    expect(data.assignee).toBeNull();
    expect(data.contact).not.toBeNull();
  });

  it('sem responsável: assignee null, sem consultar perfis', async () => {
    const t = tabelas();
    t.deals = [{ ...t.deals[0], assigned_to: null }];
    const { db, consultas } = bancoFalso(t);
    await entregar(db, [MOVIDO]);
    expect(dataDa(0).assignee).toBeNull();
    expect(consultas.some((c) => c.tabela === 'profiles')).toBe(false);
  });

  it.each(['deals', 'profiles', 'pipelines', 'pipeline_stages', 'contacts', 'custom_fields', 'contact_custom_values'])(
    '⚠️ leitura de %s que FALHA não vira aviso com null: nada da conta é entregue',
    async (tabela) => {
      const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { db } = bancoFalso(tabelas(), [tabela]);
      await entregar(db, [CRIADO, MOVIDO, GANHO]);
      expect(chamadas()).toHaveLength(0);
      expect(erro).toHaveBeenCalled();
      // A contagem do que se perdeu vai para o log.
      expect(String(erro.mock.calls[0][0])).toMatch(/3 aviso\(s\)/);
    }
  );

  it('falha na leitura dos ENDPOINTS: nada entregue, com a contagem no log', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = bancoFalso(tabelas(), ['webhook_endpoints']);
    await entregar(db, [CRIADO, MOVIDO]);
    expect(chamadas()).toHaveLength(0);
    expect(String(erro.mock.calls[0][0])).toMatch(/2 aviso\(s\)/);
  });

  it('toda leitura é recortada pela conta (service role ignora RLS)', async () => {
    const { db, consultas } = bancoFalso(tabelas());
    await entregar(db, [MOVIDO]);
    for (const tabela of ['webhook_endpoints', 'deals', 'profiles', 'pipelines', 'contacts', 'custom_fields']) {
      const c = consultas.find((x) => x.tabela === tabela);
      expect(c, tabela).toBeDefined();
      expect(c!.eq, tabela).toContainEqual(['account_id', CONTA]);
    }
    // Sem `account_id` na tabela: o recorte é pelos contatos que a CONTA devolveu.
    const valores = consultas.find((x) => x.tabela === 'contact_custom_values')!;
    expect(valores.in).toEqual([['contact_id', [CONTATO]]]);
  });

  it('etapa de funil de OUTRA conta não empresta o nome', async () => {
    const t = tabelas({
      pipelines: [{ id: FUNIL, account_id: OUTRA_CONTA, name: 'Alheio' }],
    });
    const { db } = bancoFalso(t);
    await entregar(db, [MOVIDO]);
    const data = dataDa(0);
    expect(data.pipeline).toEqual({ id: FUNIL, name: null });
    expect(data.stage).toEqual({ id: REUNIAO, name: null, position: null });
  });

  it('contato de OUTRA conta com o mesmo id não entra no aviso', async () => {
    const t = tabelas();
    t.contacts = [{ ...t.contacts[0], account_id: OUTRA_CONTA }];
    const { db } = bancoFalso(t);
    await entregar(db, [MOVIDO]);
    expect(dataDa(0).contact).toBeNull();
  });

  it('duas contas no mesmo lote: cada uma com os SEUS endpoints e o seu catálogo', async () => {
    const t = tabelas();
    t.webhook_endpoints.push({ account_id: OUTRA_CONTA, is_active: true, events: ['deal.created'] });
    const daOutra = evento({ id: 'evt-outra', account_id: OUTRA_CONTA, from_pipeline_id: null, from_stage_id: null, deal_id: 'd-9', contact_id: null });
    const { db } = bancoFalso(t);
    await entregar(db, [MOVIDO, daOutra]);
    expect(chamadas().map((c) => [c[1], c[2]])).toEqual([
      [CONTA, 'deal.stage_changed'],
      [OUTRA_CONTA, 'deal.created'],
    ]);
  });

  it('linha sem contato (card de grupo): sai com contact null, sem ler contatos', async () => {
    const { db, consultas } = bancoFalso(tabelas());
    await entregar(db, [evento({ contact_id: null })]);
    expect(dataDa(0).contact).toBeNull();
    expect(consultas.some((c) => c.tabela === 'contacts')).toBe(false);
  });

  it('⚠️ pagina os valores de campo além do teto de 1000 linhas do PostgREST', async () => {
    const campos: Linha[] = [];
    const valores: Linha[] = [];
    for (let i = 0; i < 600; i++) {
      campos.push({ id: `cf-${i}`, account_id: CONTA, field_key: `campo_${i}`, field_name: `Campo ${i}`, field_type: 'text', categoria: 'geral' });
      valores.push({ contact_id: CONTATO, custom_field_id: `cf-${i}`, value: `a${i}` });
      valores.push({ contact_id: 'c-2', custom_field_id: `cf-${i}`, value: `b${i}` });
    }
    const t = tabelas({ custom_fields: campos, contact_custom_values: valores });
    t.contacts = [...t.contacts, { ...t.contacts[0], id: 'c-2' }];
    const { db } = bancoFalso(t);
    await entregar(db, [MOVIDO, evento({ id: 'evt-2', contact_id: 'c-2' })]);

    const [primeiro, segundo] = chamadas().map((_, i) => dataDa(i).contact as { custom_fields: Record<string, string> });
    expect(Object.keys(primeiro.custom_fields)).toHaveLength(600);
    // O último valor do SEGUNDO contato está na segunda página — sem paginar, ele sumiria.
    expect(segundo.custom_fields.campo_599).toBe('b599');
    expect(primeiro.custom_fields.campo_599).toBe('a599');
  });

  it('no máximo 4 entregas ao mesmo tempo', async () => {
    let emVoo = 0;
    let pico = 0;
    vi.mocked(dispatchWebhookEvent).mockImplementation(async () => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo--;
      return 'tentado';
    });
    const linhas = Array.from({ length: 11 }, (_, i) =>
      evento({ id: `evt-${i}`, criado_em: `2026-09-23T14:${String(10 + i).padStart(2, '0')}:00.000Z` })
    );
    const { db } = bancoFalso(tabelas());
    await entregar(db, linhas);
    expect(chamadas()).toHaveLength(11);
    expect(pico).toBe(4);
    // Começam em ordem de criado_em.
    expect(chamadas().map((c) => (c[4] as { id: string }).id)).toEqual(linhas.map((l) => l.id));
  });

  it('nunca lança — nem com o banco estourando na primeira chamada', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      from: () => {
        throw new Error('sem conexão');
      },
    } as unknown as SupabaseClient;
    await expect(entregar(db, [MOVIDO])).resolves.toBeUndefined();
    expect(erro).toHaveBeenCalled();
  });

  it('lista vazia: nem consulta', async () => {
    const { db, consultas } = bancoFalso(tabelas());
    await entregar(db, []);
    expect(consultas).toHaveLength(0);
  });
});

// ============================================================
// O aviso pendente (1040): a linha chega com `webhooks_pendente_desde =
// CARIMBO` (gravado pelo dreno na reivindicação) e só deixa de estar
// pendente quando a tentativa ACONTECEU — sempre com a cerca do carimbo.
// ============================================================

/** A fila, no banco falso: as linhas pendentes com o carimbo dado. */
function fila(ids: string[], carimbo: string = CARIMBO): Linha[] {
  return ids.map((id) => ({ id, webhooks_pendente_desde: carimbo }));
}
const pendentes = (t: Record<string, Linha[]>) =>
  t.cb_automation_events.filter((l) => l.webhooks_pendente_desde !== null).map((l) => l.id);

describe('entregarEventosDeFunil — a pendência do aviso (1040)', () => {
  it('conta sem endpoint deal.*: encerra a pendência de TODAS as linhas numa escrita, com a cerca', async () => {
    const t = tabelas({
      webhook_endpoints: [{ account_id: CONTA, is_active: true, events: ['message.received'] }],
      cb_automation_events: fila(['evt-criado', 'evt-movido', 'evt-ganho']),
    });
    const { db, escritas } = bancoFalso(t);
    await entregar(db, [CRIADO, MOVIDO, GANHO]);

    expect(escritas()).toHaveLength(1);
    expect(escritas()[0]).toMatchObject({
      tabela: 'cb_automation_events',
      update: { webhooks_pendente_desde: null },
      in: [['id', ['evt-criado', 'evt-movido', 'evt-ganho']]],
      eq: [['webhooks_pendente_desde', CARIMBO]],
    });
    expect(pendentes(t)).toEqual([]);
  });

  it('evento que ninguém assina sai da pendência em lote; o assinado, depois do SEU disparo', async () => {
    const t = tabelas({
      webhook_endpoints: [{ account_id: CONTA, is_active: true, events: ['deal.status_changed'] }],
      cb_automation_events: fila(['evt-criado', 'evt-movido', 'evt-ganho']),
    });
    const ordem: string[] = [];
    vi.mocked(dispatchWebhookEvent).mockImplementation(async (_db, _conta, _ev, _data, opcoes) => {
      ordem.push(`disparo:${opcoes?.id}`);
      // Durante o disparo, a linha ainda está pendente.
      ordem.push(`pendente:${pendentes(t).includes(opcoes!.id!)}`);
      return 'tentado';
    });
    const { db, escritas } = bancoFalso(t);
    await entregar(db, [CRIADO, MOVIDO, GANHO]);

    // Encerra o que ninguém assina (cerca da reivindicação), renova a posse do
    // assinado e só depois do disparo o encerra (cerca RENOVADA).
    expect(escritas().map((e) => [e.in, e.eq])).toEqual([
      [[['id', ['evt-criado', 'evt-movido']]], [['webhooks_pendente_desde', CARIMBO]]],
      [[['id', ['evt-ganho']]], [['webhooks_pendente_desde', CARIMBO]]],
      [[['id', ['evt-ganho']]], [['webhooks_pendente_desde', escritas()[1].update!.webhooks_pendente_desde]]],
    ]);
    expect(ordem).toEqual(['disparo:evt-ganho', 'pendente:true']);
    expect(pendentes(t)).toEqual([]);
  });

  it.each(['tentado', 'sem_destino'] as const)(
    'disparo %s (houve tentativa, ou ninguém mais assina) encerra a pendência',
    async (resultado) => {
      vi.mocked(dispatchWebhookEvent).mockResolvedValue(resultado);
      const t = tabelas({ cb_automation_events: fila(['evt-movido']) });
      const { db } = bancoFalso(t);
      await entregar(db, [MOVIDO]);
      expect(pendentes(t)).toEqual([]);
    }
  );

  it('⚠️ disparo falhou_antes (nenhum POST saiu): a linha FICA pendente para a reentrega', async () => {
    vi.mocked(dispatchWebhookEvent).mockImplementation(async (_db, _conta, _ev, _data, opcoes) =>
      opcoes?.id === 'evt-movido' ? 'falhou_antes' : 'tentado'
    );
    const t = tabelas({ cb_automation_events: fila(['evt-criado', 'evt-movido', 'evt-ganho']) });
    const { db } = bancoFalso(t);
    await entregar(db, [CRIADO, MOVIDO, GANHO]);
    expect(pendentes(t)).toEqual(['evt-movido']);
  });

  it('⚠️ linha que ESTOURA fica pendente, e as outras seguem sendo entregues e encerradas', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(dispatchWebhookEvent).mockImplementation(async (_db, _conta, _ev, _data, opcoes) => {
      if (opcoes?.id === 'evt-criado') throw new Error('dado estranho');
      return 'tentado';
    });
    const t = tabelas({ cb_automation_events: fila(['evt-criado', 'evt-movido', 'evt-ganho']) });
    const { db } = bancoFalso(t);
    await entregar(db, [CRIADO, MOVIDO, GANHO]);
    expect(chamadas()).toHaveLength(3);
    expect(pendentes(t)).toEqual(['evt-criado']);
    expect(String(erro.mock.calls[0][0])).toMatch(/evt-criado.*pendente/);
  });

  it.each(['webhook_endpoints', 'deals', 'contacts', 'contact_custom_values'])(
    '⚠️ leitura de %s que FALHA: nada sai e NADA deixa de estar pendente',
    async (tabela) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const t = tabelas({ cb_automation_events: fila(['evt-criado', 'evt-movido']) });
      const { db, escritas } = bancoFalso(t, [tabela]);
      await entregar(db, [CRIADO, MOVIDO]);
      expect(chamadas()).toHaveLength(0);
      // Nenhuma escrita ENCERRA (a renovação da posse, se houve, mantém pendente).
      expect(escritas().filter((e) => e.update!.webhooks_pendente_desde === null)).toHaveLength(0);
      expect(pendentes(t)).toEqual(['evt-criado', 'evt-movido']);
    }
  );

  it('⚠️ a cerca: linha que a REENTREGA tomou (outro carimbo) não é entregue nem limpa por esta entrega', async () => {
    const t = tabelas({
      cb_automation_events: [
        ...fila(['evt-criado']),
        // A reentrega recarimbou esta enquanto o ciclo desta entrega ainda corria.
        ...fila(['evt-movido'], '2026-09-23T14:25:00.000Z'),
      ],
    });
    const { db } = bancoFalso(t);
    await entregar(db, [CRIADO, MOVIDO]);
    // Sem a renovação da posse, as DUAS saíam daqui — e a reentrega mandava
    // `evt-movido` de novo: o aviso em dobro sem ninguém ter morrido.
    expect(chamadas().map((c) => (c[4] as { id: string }).id)).toEqual(['evt-criado']);
    expect(pendentes(t)).toEqual(['evt-movido']);
    expect(t.cb_automation_events.find((l) => l.id === 'evt-movido')!.webhooks_pendente_desde).toBe(
      '2026-09-23T14:25:00.000Z'
    );
  });

  it('⚠️ renova a posse ANTES do catálogo e dos disparos: compare-and-swap no carimbo recebido', async () => {
    const t = tabelas({ cb_automation_events: fila(['evt-criado', 'evt-movido']) });
    const { db, consultas } = bancoFalso(t);
    let consultasNoPrimeiroDisparo = -1;
    vi.mocked(dispatchWebhookEvent).mockImplementation(async () => {
      if (consultasNoPrimeiroDisparo < 0) consultasNoPrimeiroDisparo = consultas.length;
      return 'tentado';
    });
    await entregar(db, [CRIADO, MOVIDO]);

    const renovacao = consultas.findIndex((c) => c.update && c.update.webhooks_pendente_desde !== null);
    expect(renovacao).toBeGreaterThan(consultas.findIndex((c) => c.tabela === 'webhook_endpoints'));
    expect(renovacao).toBeLessThan(consultas.findIndex((c) => c.tabela === 'deals'));
    expect(renovacao).toBeLessThan(consultasNoPrimeiroDisparo);
    const r = consultas[renovacao];
    expect(r).toMatchObject({
      tabela: 'cb_automation_events',
      in: [['id', ['evt-criado', 'evt-movido']]],
      eq: [['webhooks_pendente_desde', CARIMBO]],
      select: 'id',
    });
    const renovado = r.update!.webhooks_pendente_desde as string;
    expect(renovado).not.toBe(CARIMBO);
    expect(Number.isFinite(Date.parse(renovado))).toBe(true);
    // A limpeza usa o carimbo RENOVADO.
    const limpezas = consultas.filter((c) => c.update && c.update.webhooks_pendente_desde === null);
    expect(limpezas).toHaveLength(2);
    for (const l of limpezas) expect(l.eq).toEqual([['webhooks_pendente_desde', renovado]]);
    expect(pendentes(t)).toEqual([]);
  });

  it('duas contas no lote: cada uma renova a SUA posse logo antes da sua entrega', async () => {
    const t = tabelas();
    t.webhook_endpoints.push({ account_id: OUTRA_CONTA, is_active: true, events: ['deal.created'] });
    const daOutra = evento({ id: 'evt-outra', account_id: OUTRA_CONTA, from_pipeline_id: null, from_stage_id: null, deal_id: 'd-9', contact_id: null });
    const { db, consultas } = bancoFalso(t);
    const consultasAoDisparar: number[] = [];
    vi.mocked(dispatchWebhookEvent).mockImplementation(async () => {
      consultasAoDisparar.push(consultas.length);
      return 'tentado';
    });
    await entregar(db, [MOVIDO, daOutra]);

    const renovacoes = consultas
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.update && c.update.webhooks_pendente_desde !== null);
    expect(renovacoes.map(({ c }) => c.in)).toEqual([[['id', ['evt-movido']]], [['id', ['evt-outra']]]]);
    // A posse da segunda conta é renovada DEPOIS do disparo da primeira — não
    // no começo do lote, senão a entrega lenta da primeira a envelheceria.
    expect(renovacoes[1].i).toBeGreaterThanOrEqual(consultasAoDisparar[0]);
    expect(pendentes(t).filter((id) => id === 'evt-movido' || id === 'evt-outra')).toEqual([]);
  });

  it('⚠️ a renovação da posse que FALHA: nada sai, e as linhas ficam pendentes com o carimbo da reivindicação', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = tabelas({ cb_automation_events: fila(['evt-criado', 'evt-movido']) });
    const { db } = bancoFalso(t, [], (c) => !!c.update && c.update.webhooks_pendente_desde !== null);
    await entregar(db, [CRIADO, MOVIDO]);
    expect(chamadas()).toHaveLength(0);
    expect(pendentes(t)).toEqual(['evt-criado', 'evt-movido']);
    expect(t.cb_automation_events.every((l) => l.webhooks_pendente_desde === CARIMBO)).toBe(true);
    expect(String(erro.mock.calls[0][0])).toMatch(/renovação da posse falhou — 2 aviso\(s\)/);
  });

  it('a escrita da limpeza que falha não lança nem impede a entrega (a linha só fica pendente)', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = tabelas();
    const { db } = bancoFalso(t, [], (c) => !!c.update && c.update.webhooks_pendente_desde === null);
    await expect(entregar(db, [MOVIDO])).resolves.toBeUndefined();
    expect(chamadas()).toHaveLength(1);
    expect(pendentes(t)).toContain('evt-movido');
    expect(String(erro.mock.calls[0][0])).toMatch(/continuam marcados como pendentes/);
  });
});
