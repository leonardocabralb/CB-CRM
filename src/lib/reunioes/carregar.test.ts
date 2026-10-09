import { describe, expect, it } from 'vitest';

import { criarBanco } from '@/lib/zapsign/duble.test-helper';

import { carregarDadosDaPauta, instanteDoParametro } from './carregar';
import { montarPauta } from './montar';

// ============================================================
// A CARGA da pauta (`/api/cb/reunioes`). O dublê imita a forma SUPOSTA do
// PostgREST — aqui ele prova a paginação pela chave (o PostgREST corta em
// 1000 sem avisar), a cerca de conta e o encanamento até o resultado. Dados
// fictícios.
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

  it('mais de 1000 reuniões da AGENDA na janela: todas, sem as canceladas nem as de outra conta', async () => {
    const reuniao = (n: number, extra: Record<string, unknown> = {}) => ({
      id: uuid(n, 'a'),
      account_id: CONTA,
      contact_id: null,
      conversation_id: null,
      titulo: 'Reunião',
      local: null,
      starts_at: new Date(JANELA.de.getTime() + n * 60_000).toISOString(),
      ends_at: null,
      status: 'agendada',
      created_at: '2026-09-25T10:00:00Z',
      ...extra,
    });
    const banco = criarBanco({
      cb_meetings: [
        ...Array.from({ length: 1200 }, (_, i) => reuniao(i + 1)),
        ...Array.from({ length: 5 }, (_, i) => reuniao(5000 + i, { status: 'cancelada' })),
        reuniao(6000, { account_id: OUTRA }),
      ],
      pipeline_stages: etapasDoFunil(),
    });
    const dados = await carregarDadosDaPauta(banco.cliente, CONTA, JANELA);
    expect(dados.agenda).toHaveLength(1200);
    expect(dados.agenda.some((a) => a.status === 'cancelada' || a.id === uuid(6000, 'a'))).toBe(false);
  });

  it('a data da FICHA de mais de 1000 contatos vem inteira (a cerca é pelo contato da conta)', async () => {
    const banco = criarBanco({
      custom_fields: [{ id: 'campo-data', account_id: CONTA, field_key: 'data_e_hora_reuniao' }],
      contact_custom_values: [
        ...Array.from({ length: 1100 }, (_, i) => ({
          id: uuid(i + 1, 'd'),
          contact_id: `contato-${i + 1}`,
          custom_field_id: 'campo-data',
          value: '2026-08-01T13:00:00.000Z',
          'contacts.account_id': CONTA,
        })),
        { id: uuid(9000, 'd'), contact_id: 'contato-alheio', custom_field_id: 'campo-data', value: '2026-08-01T13:00:00.000Z', 'contacts.account_id': OUTRA },
      ],
      pipeline_stages: etapasDoFunil(),
    });
    const dados = await carregarDadosDaPauta(banco.cliente, CONTA, JANELA);
    expect(dados.datasDaFicha.size).toBe(1100);
    expect(dados.datasDaFicha.has('contato-alheio')).toBe(false);
  });

  it('o HISTÓRICO de um lote de contatos com mais de 1000 agendamentos, reuniões e negócios vem inteiro (antes estourava)', async () => {
    const contato = 'contato-1';
    const banco = criarBanco({
      cb_calendly_eventos: Array.from({ length: 1200 }, (_, i) =>
        agendamento(i + 1, new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(), { contact_id: contato }),
      ).concat([agendamento(9000, '2026-10-02T14:00:00Z', { contact_id: contato })]),
      cb_meetings: Array.from({ length: 1100 }, (_, i) => ({
        id: uuid(i + 1, 'a'),
        account_id: CONTA,
        contact_id: contato,
        conversation_id: null,
        titulo: 'Reunião',
        local: null,
        starts_at: new Date(Date.UTC(2025, 0, 1) + i * 3_600_000).toISOString(),
        ends_at: null,
        status: 'agendada',
        created_at: '2024-12-01T10:00:00Z',
      })),
      deals: Array.from({ length: 1050 }, (_, i) => ({
        id: uuid(i + 1, 'b'),
        account_id: CONTA,
        contact_id: contato,
        pipeline_id: COMERCIAL,
        stage_id: 'etapa-agendada',
        value: 0,
        status: 'lost',
        created_at: '2025-01-01T10:00:00Z',
      })),
      pipeline_stages: etapasDoFunil(),
    });
    const dados = await carregarDadosDaPauta(banco.cliente, CONTA, JANELA);
    expect(dados.calendly).toHaveLength(1201);
    expect(dados.agenda).toHaveLength(1100);
    expect(dados.negocios).toHaveLength(1050);
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

describe('carga → pauta', () => {
  it('a carga entrega à pauta a trilha do card: o No Show depois do início resolve a reunião', async () => {
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
    // A pauta mostra o card como está HOJE.
    expect(reunioes[0].negocio?.pipelineId).toBe(JURIDICO);
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
