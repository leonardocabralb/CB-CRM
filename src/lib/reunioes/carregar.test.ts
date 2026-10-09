import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { criarBanco, type Banco } from '@/lib/zapsign/duble.test-helper';

import { carregarDadosDaPauta, carregarPassosDosNegocios, instanteDoParametro } from './carregar';
import { montarPauta } from './montar';
import { reunioesDoResumo } from './resumo';

// ============================================================
// A CARGA da pauta (as duas rotas: a pauta e o resumo do Desempenho). O dublê
// imita a forma SUPOSTA do PostgREST — aqui ele prova a paginação pela chave
// (o PostgREST corta em 1000 sem avisar), a cerca de conta e o encanamento até
// o resultado. Dados fictícios.
// ============================================================

const CONTA = 'conta-1';
const OUTRA = 'conta-2';
const COMERCIAL = 'funil-comercial';
const JURIDICO = 'funil-juridico';
const JANELA = { de: new Date('2026-10-01T03:00:00Z'), ate: new Date('2026-10-09T15:00:00Z') };

/** uuid ordenável pelo número (a paginação anda pelo `id`). */
function uuid(n: number, prefixo = '0'): string {
  return `${prefixo.repeat(8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function agendamento(n: number, inicio: string, extra: Record<string, unknown> = {}) {
  return {
    id: uuid(n, 'c'),
    account_id: CONTA,
    evento: 'invitee.created',
    contact_id: null,
    invitee_uri: `https://calendly.example.com/invitees/${n}`,
    event_type_uri: 'https://calendly.example.com/event_types/1',
    event_type_nome: 'Reunião',
    inicio,
    fim: null,
    link: null,
    recebido_em: '2026-09-25T10:00:00Z',
    situacao: null,
    ...extra,
  };
}

function etapasDoFunil() {
  return [
    { id: 'etapa-agendada', pipeline_id: COMERCIAL, name: 'Reunião Agendada', position: 1, degrau: 'reuniao', desfecho_da_reuniao: null, 'pipelines.account_id': CONTA },
    { id: 'etapa-no-show', pipeline_id: COMERCIAL, name: 'No Show', position: 2, degrau: 'reuniao', desfecho_da_reuniao: 'faltou', 'pipelines.account_id': CONTA },
    { id: 'etapa-juridico', pipeline_id: JURIDICO, name: 'Entrada', position: 0, degrau: 'lead', desfecho_da_reuniao: null, 'pipelines.account_id': CONTA },
    // Etapa de OUTRA conta com a mesma marca: não pode entrar.
    { id: 'etapa-alheia', pipeline_id: 'funil-alheio', name: 'No Show', position: 2, degrau: 'reuniao', desfecho_da_reuniao: 'faltou', 'pipelines.account_id': OUTRA },
  ];
}

/** O cliente que conta quantas vezes cada tabela foi lida. */
function contando(banco: Banco): { cliente: SupabaseClient; leituras: Record<string, number> } {
  const leituras: Record<string, number> = {};
  const cliente = {
    from: (tabela: string) => {
      leituras[tabela] = (leituras[tabela] ?? 0) + 1;
      return banco.cliente.from(tabela);
    },
  } as unknown as SupabaseClient;
  return { cliente, leituras };
}

describe('instanteDoParametro', () => {
  it('só aceita instante com fuso escrito', () => {
    expect(instanteDoParametro('2026-10-01T03:00:00Z')?.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(instanteDoParametro('2026-10-01T00:00:00-03:00')?.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(instanteDoParametro('2026-10-01T03:00:00')).toBeNull();
    expect(instanteDoParametro(null)).toBeNull();
    expect(instanteDoParametro('lixoZ')).toBeNull();
  });
});

describe('carregarDadosDaPauta — paginação pela CHAVE', () => {
  it('mais de 1000 agendamentos na janela: lê TODOS, sem repetir, em páginas (antes estourava)', async () => {
    const muitos = Array.from({ length: 1500 }, (_, i) =>
      agendamento(i + 1, new Date(JANELA.de.getTime() + (i + 1) * 60_000).toISOString()),
    );
    const banco = criarBanco({
      cb_calendly_eventos: [...muitos, { ...agendamento(9999, '2026-10-02T14:00:00Z'), account_id: OUTRA }],
      pipeline_stages: etapasDoFunil(),
    });
    const dados = await carregarDadosDaPauta(banco.cliente, CONTA, JANELA);
    expect(dados.calendly).toHaveLength(1500);
    expect(new Set(dados.calendly.map((l) => l.id)).size).toBe(1500);
    expect(dados.calendly.some((l) => l.id === uuid(9999, 'c'))).toBe(false);
  });

  it('a trilha de um contato com mais de 1000 entradas vem inteira', async () => {
    const contato = 'contato-1';
    const entradas = Array.from({ length: 1200 }, (_, i) => ({
      id: uuid(i + 1, 'e'),
      account_id: CONTA,
      contact_id: contato,
      deal_id: 'negocio-1',
      event_type: 'stage_changed',
      occurred_at: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
      to_stage_id: 'etapa-no-show',
      to_stage_label: 'No Show',
      actor_label: 'Ana',
    }));
    const banco = criarBanco({
      cb_calendly_eventos: [agendamento(1, '2026-10-02T14:00:00Z', { contact_id: contato })],
      contacts: [{ id: contato, account_id: CONTA, name: 'Cliente Fictício', phone: null, wa_username: null, instagram_username: null }],
      deals: [{ id: 'negocio-1', account_id: CONTA, contact_id: contato, pipeline_id: COMERCIAL, stage_id: 'etapa-agendada', value: 0, status: 'open', created_at: '2026-08-01T10:00:00Z' }],
      pipeline_stages: etapasDoFunil(),
      cb_lead_events: entradas,
    });
    const dados = await carregarDadosDaPauta(banco.cliente, CONTA, JANELA);
    expect(dados.trilha.get(contato)).toHaveLength(1200);
  });

  it('a etapa de outra conta não entra (cerca pelo funil)', async () => {
    const banco = criarBanco({ pipeline_stages: etapasDoFunil() });
    const dados = await carregarDadosDaPauta(banco.cliente, CONTA, JANELA);
    expect(dados.etapas.map((e) => e.id).sort()).toEqual(['etapa-agendada', 'etapa-juridico', 'etapa-no-show']);
  });

  it('erro de leitura LANÇA com o rótulo (a rota responde 500, nunca lista vazia)', async () => {
    const banco = criarBanco({});
    banco.falhar.add('cb_calendly_eventos:select');
    await expect(carregarDadosDaPauta(banco.cliente, CONTA, JANELA)).rejects.toThrow(/^calendly: falha simulada/);
  });
});

describe('carregarPassosDosNegocios', () => {
  it('as entradas de cada negócio com o funil de destino, paginadas, sem status_changed nem outra conta', async () => {
    const muitos = Array.from({ length: 1100 }, (_, i) => ({
      id: uuid(i + 1, 'f'),
      account_id: CONTA,
      deal_id: 'negocio-1',
      event_type: 'stage_changed',
      occurred_at: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
      to_pipeline_id: COMERCIAL,
    }));
    const banco = criarBanco({
      cb_lead_events: [
        ...muitos,
        { id: uuid(5000, 'f'), account_id: CONTA, deal_id: 'negocio-1', event_type: 'pipeline_changed', occurred_at: '2026-10-05T10:00:00Z', to_pipeline_id: JURIDICO },
        { id: uuid(5001, 'f'), account_id: CONTA, deal_id: 'negocio-1', event_type: 'status_changed', occurred_at: '2026-10-06T10:00:00Z', to_pipeline_id: JURIDICO },
        { id: uuid(5002, 'f'), account_id: OUTRA, deal_id: 'negocio-1', event_type: 'stage_changed', occurred_at: '2026-10-06T10:00:00Z', to_pipeline_id: 'funil-alheio' },
        { id: uuid(5003, 'f'), account_id: CONTA, deal_id: 'negocio-2', event_type: 'deal_created', occurred_at: '2026-09-02T10:00:00Z', to_pipeline_id: COMERCIAL },
      ],
    });
    const passos = await carregarPassosDosNegocios(banco.cliente, CONTA, ['negocio-1', 'negocio-2', 'negocio-1']);
    expect(passos.get('negocio-1')).toHaveLength(1101);
    expect(passos.get('negocio-1')?.some((p) => p.funil === 'funil-alheio')).toBe(false);
    expect(passos.get('negocio-2')).toEqual([{ id: uuid(5003, 'f'), em: '2026-09-02T10:00:00Z', funil: COMERCIAL }]);
  });

  it('sem negócio, nenhuma leitura', async () => {
    const banco = criarBanco({});
    const { cliente, leituras } = contando(banco);
    expect((await carregarPassosDosNegocios(cliente, CONTA, [])).size).toBe(0);
    expect(leituras.cb_lead_events).toBeUndefined();
  });
});

describe('carga → pauta → resumo: a MESMA régua da pauta', () => {
  it('o no show pela trilha conta no funil do DIA (o card foi para o Jurídico depois)', async () => {
    const contato = 'contato-1';
    const banco = criarBanco({
      cb_calendly_eventos: [agendamento(1, '2026-10-02T14:00:00Z', { contact_id: contato })],
      contacts: [{ id: contato, account_id: CONTA, name: 'Cliente Fictício', phone: null, wa_username: null, instagram_username: null }],
      // O card HOJE está no Jurídico.
      deals: [{ id: 'negocio-1', account_id: CONTA, contact_id: contato, pipeline_id: JURIDICO, stage_id: 'etapa-juridico', value: 0, status: 'open', created_at: '2026-09-20T10:00:00Z' }],
      pipeline_stages: etapasDoFunil(),
      cb_lead_events: [
        { id: uuid(1, 'e'), account_id: CONTA, contact_id: contato, deal_id: 'negocio-1', event_type: 'deal_created', occurred_at: '2026-09-20T10:00:00Z', to_stage_id: 'etapa-agendada', to_stage_label: 'Reunião Agendada', to_pipeline_id: COMERCIAL, actor_label: null },
        { id: uuid(2, 'e'), account_id: CONTA, contact_id: contato, deal_id: 'negocio-1', event_type: 'stage_changed', occurred_at: '2026-10-02T14:40:00Z', to_stage_id: 'etapa-no-show', to_stage_label: 'No Show', to_pipeline_id: COMERCIAL, actor_label: 'Ana' },
        { id: uuid(3, 'e'), account_id: CONTA, contact_id: contato, deal_id: 'negocio-1', event_type: 'pipeline_changed', occurred_at: '2026-10-05T10:00:00Z', to_stage_id: 'etapa-juridico', to_stage_label: 'Entrada', to_pipeline_id: JURIDICO, actor_label: 'Ana' },
      ],
    });
    const dados = await carregarDadosDaPauta(banco.cliente, CONTA, JANELA);
    const { reunioes } = montarPauta(dados);
    expect(reunioes).toHaveLength(1);
    expect(reunioes[0].resultado?.tipo).toBe('no_show');
    // A pauta mostra o card como está HOJE…
    expect(reunioes[0].negocio?.pipelineId).toBe(JURIDICO);

    const passos = await carregarPassosDosNegocios(banco.cliente, CONTA, ['negocio-1']);
    // …e o resumo conta no funil em que ele estava NA REUNIÃO.
    expect(reunioesDoResumo(reunioes, passos, new Date('2026-10-09T15:00:00Z'))).toEqual([
      { inicio: '2026-10-02T14:00:00.000Z', funil: COMERCIAL, resultado: 'no_show' },
    ]);
  });

  it('o marco de outra conta para a mesma reunião não conta', async () => {
    const banco = criarBanco({
      cb_calendly_eventos: [agendamento(1, '2026-10-02T14:00:00Z')],
      pipeline_stages: etapasDoFunil(),
      cb_reunioes_marcos: [
        { account_id: OUTRA, origem: 'calendly', reuniao_id: uuid(1, 'c'), marco: 'resultado', resultado: 'no_show', valor: null, registrado_por_nome: 'X', registrado_em: '2026-10-02T14:30:00Z', inicio: null },
      ],
    });
    const { reunioes } = montarPauta(await carregarDadosDaPauta(banco.cliente, CONTA, JANELA));
    expect(reunioes[0].resultado).toBeNull();
  });
});
