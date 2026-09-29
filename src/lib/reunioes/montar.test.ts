import { describe, expect, it } from 'vitest';

import { montarPauta, negocioDoContato, type DadosDaPauta, type LinhaDoCalendlyDaPauta } from './montar';
import type { EtapaDoFunil } from './pauta';

const ETAPAS: EtapaDoFunil[] = [
  { id: 'agendada', pipelineId: 'banc', nome: 'Reunião Agendada', posicao: 4, degrau: 'reuniao', marca: null },
  { id: 'mql2', pipelineId: 'banc', nome: 'MQL 2', posicao: 5, degrau: 'reuniao', marca: 'qualificada' },
  { id: 'noshow', pipelineId: 'banc', nome: 'No Show', posicao: 6, degrau: 'reuniao', marca: 'faltou' },
];

const cal = (p: Partial<LinhaDoCalendlyDaPauta> & { id: string }): LinhaDoCalendlyDaPauta => ({
  contact_id: 'c1',
  invitee_uri: `uri-${p.id}`,
  event_type_uri: 'tipo',
  event_type_nome: 'Reunião com Advogado',
  inicio: '2026-09-29T14:00:00Z',
  fim: '2026-09-29T14:30:00Z',
  link: 'https://meet.google.com/abc',
  situacao: null,
  recebido_em: '2026-09-28T10:00:00Z',
  ...p,
});

function dados(p: Partial<DadosDaPauta>): DadosDaPauta {
  return {
    janela: { de: new Date('2026-09-27T03:00:00Z'), ate: new Date('2026-10-04T02:59:00Z') },
    calendly: [],
    cancelados: new Set(),
    agenda: [],
    contatos: new Map([
      ['c1', 'Ana'],
      ['c2', 'Bruno'],
    ]),
    conversas: new Map([['c1', { id: 'v1', aguardando_desde: null }]]),
    negocios: [],
    pipelines: new Map([['banc', 'Bancário - Comercial']]),
    etapas: ETAPAS,
    campos: new Map([['c1', { divida: 'Maior que 500 mil reais', atraso: null, origem: 'Apenas CPF' }]]),
    trilha: new Map(),
    marcos: new Map(),
    ...p,
  };
}

describe('montarPauta', () => {
  it('monta a reunião do Calendly com contato, conversa, card, campos e destinos do funil', () => {
    const { reunioes, funis } = montarPauta(
      dados({
        calendly: [cal({ id: 'r1' })],
        negocios: [
          { id: 'd1', contact_id: 'c1', pipeline_id: 'banc', stage_id: 'agendada', value: '0', status: 'open', created_at: '2026-09-01T00:00:00Z' },
        ],
      }),
    );
    expect(reunioes).toHaveLength(1);
    expect(reunioes[0]).toMatchObject({
      chave: 'calendly:r1',
      contato: { id: 'c1', nome: 'Ana' },
      conversaId: 'v1',
      negocio: { id: 'd1', pipelineId: 'banc', etapaId: 'agendada', etapaNome: 'Reunião Agendada', valor: 0, status: 'open' },
      qualificacao: { divida: 'Maior que 500 mil reais', atraso: null, origem: 'Apenas CPF' },
      link: 'https://meet.google.com/abc',
    });
    expect(funis.banc.qualificada).toEqual({ id: 'mql2', nome: 'MQL 2' });
  });

  it('cancelado e convite substituído por reagendamento NÃO entram; o reagendamento sim', () => {
    const { reunioes } = montarPauta(
      dados({
        calendly: [
          // Cancelada DEPOIS do reagendamento chegar: não é candidata a convite
          // substituído (a inferência só olha o que chegou antes).
          cal({ id: 'cancelada', inicio: '2026-09-29T15:00:00Z', recebido_em: '2026-09-28T13:00:00Z' }),
          cal({ id: 'antigo', inicio: '2026-09-30T14:00:00Z', recebido_em: '2026-09-27T10:00:00Z' }),
          cal({
            id: 'novo',
            inicio: '2026-10-01T14:00:00Z',
            recebido_em: '2026-09-28T12:00:00Z',
            situacao: 'Reagendamento',
          }),
        ],
        cancelados: new Set(['uri-cancelada']),
      }),
    );
    expect(reunioes.map((r) => r.reuniaoId)).toEqual(['novo']);
    expect(reunioes[0].reagendamento).toBe(true);
  });

  it('a inferência de reagendamento é POR CONTATO: o reagendamento de um não apaga a reunião de outro', () => {
    const { reunioes } = montarPauta(
      dados({
        calendly: [
          cal({ id: 'de-bruno', contact_id: 'c2', inicio: '2026-09-30T14:00:00Z', recebido_em: '2026-09-27T10:00:00Z' }),
          cal({ id: 'reag-ana', contact_id: 'c1', inicio: '2026-10-01T14:00:00Z', situacao: 'Reagendamento' }),
        ],
      }),
    );
    expect(reunioes.map((r) => r.reuniaoId).sort()).toEqual(['de-bruno', 'reag-ana']);
  });

  it('fora da janela não entra (o histórico do contato serve só para a inferência)', () => {
    const { reunioes } = montarPauta(dados({ calendly: [cal({ id: 'velha', inicio: '2026-08-01T14:00:00Z' })] }));
    expect(reunioes).toEqual([]);
  });

  it('agenda do CRM: cancelada fica de fora; a conversa da linha serve quando o contato não tem outra', () => {
    const { reunioes } = montarPauta(
      dados({
        agenda: [
          {
            id: 'm1',
            contact_id: 'c2',
            conversation_id: 'v2',
            titulo: 'Reunião',
            local: 'Sala 2',
            starts_at: '2026-09-29T17:00:00+00:00',
            ends_at: '2026-09-29T18:00:00+00:00',
            status: 'agendada',
            created_at: '2026-09-28T09:00:00Z',
          },
          {
            id: 'm2',
            contact_id: 'c2',
            conversation_id: null,
            titulo: null,
            local: null,
            starts_at: '2026-09-29T19:00:00+00:00',
            ends_at: '2026-09-29T20:00:00+00:00',
            status: 'cancelada',
            created_at: '2026-09-28T09:00:00Z',
          },
        ],
      }),
    );
    expect(reunioes).toHaveLength(1);
    expect(reunioes[0]).toMatchObject({ chave: 'agenda:m1', conversaId: 'v2', inicio: '2026-09-29T17:00:00.000Z' });
  });

  it('o marco gravado e a trilha chegam à reunião; ordena por horário', () => {
    const { reunioes } = montarPauta(
      dados({
        calendly: [cal({ id: 'tarde', inicio: '2026-09-29T18:00:00Z' }), cal({ id: 'manha', contact_id: 'c2', inicio: '2026-09-29T12:00:00Z' })],
        marcos: new Map([
          [
            'calendly:tarde',
            [
              {
                origem: 'calendly',
                reuniao_id: 'tarde',
                marco: 'qualificada',
                resultado: null,
                valor: null,
                registrado_por_nome: 'Leo',
                registrado_em: '2026-09-29T11:00:00Z',
              },
            ],
          ],
        ]),
        trilha: new Map([['c2', [{ em: '2026-09-29T12:10:00Z', dealId: null, etapaId: 'noshow', etapa: 'No Show', por: 'Bia' }]]]),
      }),
    );
    expect(reunioes.map((r) => r.reuniaoId)).toEqual(['manha', 'tarde']);
    expect(reunioes[0].resultado?.tipo).toBe('no_show');
    expect(reunioes[1].qualificada?.por).toBe('Leo');
  });
});

describe('montarPauta — a próxima reunião do contato', () => {
  it('proximaEm vem de QUALQUER data (inclusive fora da janela) e só de reunião de pé', () => {
    const { reunioes } = montarPauta(
      dados({
        calendly: [
          cal({ id: 'a', inicio: '2026-09-29T14:00:00Z', recebido_em: '2026-09-20T10:00:00Z' }),
          cal({ id: 'cancelada', inicio: '2026-09-30T14:00:00Z', recebido_em: '2026-09-29T20:00:00Z' }),
          cal({ id: 'fora', inicio: '2026-10-20T14:00:00Z', recebido_em: '2026-09-29T21:00:00Z' }),
        ],
        cancelados: new Set(['uri-cancelada']),
      }),
    );
    expect(reunioes.map((r) => [r.reuniaoId, r.proximaEm])).toEqual([['a', '2026-10-20T14:00:00.000Z']]);
  });

  it('a reunião antiga não herda o resultado da seguinte (P2 da revisão do PR #339)', () => {
    const { reunioes } = montarPauta(
      dados({
        janela: { de: new Date('2026-09-20T03:00:00Z'), ate: new Date('2026-10-04T02:59:00Z') },
        calendly: [
          cal({ id: 'a', inicio: '2026-09-22T14:00:00Z', recebido_em: '2026-09-20T10:00:00Z' }),
          cal({ id: 'b', inicio: '2026-09-29T14:00:00Z', recebido_em: '2026-09-23T10:00:00Z', situacao: null }),
        ],
        negocios: [
          { id: 'd1', contact_id: 'c1', pipeline_id: 'banc', stage_id: 'agendada', value: 0, status: 'open', created_at: '2026-09-01T00:00:00Z' },
        ],
        trilha: new Map([['c1', [{ em: '2026-09-29T14:40:00Z', dealId: 'd1', etapaId: 'noshow', etapa: 'No Show', por: 'Bia' }]]]),
      }),
    );
    const [a, b] = reunioes;
    expect(a.reuniaoId).toBe('a');
    expect(a.proximaEm).toBe('2026-09-29T14:00:00.000Z');
    expect(a.resultado).toBeNull();
    expect(b.resultado?.tipo).toBe('no_show');
  });

  it('a agenda do CRM também conta como próxima reunião', () => {
    const { reunioes } = montarPauta(
      dados({
        calendly: [cal({ id: 'a' })],
        agenda: [
          {
            id: 'm1',
            contact_id: 'c1',
            conversation_id: null,
            titulo: 'Retorno',
            local: null,
            starts_at: '2026-11-10T17:00:00+00:00',
            ends_at: '2026-11-10T18:00:00+00:00',
            status: 'agendada',
            created_at: '2026-09-28T09:00:00Z',
          },
        ],
      }),
    );
    expect(reunioes.map((r) => r.reuniaoId)).toEqual(['a']);
    expect(reunioes[0].proximaEm).toBe('2026-11-10T17:00:00.000Z');
  });
});

describe('negocioDoContato', () => {
  const n = (id: string, status: string, created_at: string) => ({
    id,
    contact_id: 'c1',
    pipeline_id: 'banc',
    stage_id: 'agendada',
    value: 0,
    status,
    created_at,
  });
  it('o aberto mais recente; sem aberto, o GANHO (é cliente); só então o perdido', () => {
    expect(
      negocioDoContato([n('velho-aberto', 'open', '2026-01-01'), n('novo-perdido', 'lost', '2026-09-01'), n('novo-aberto', 'open', '2026-08-01')])?.id,
    ).toBe('novo-aberto');
    expect(negocioDoContato([n('ganho-velho', 'won', '2026-01-01'), n('perdido-novo', 'lost', '2026-09-01')])?.id).toBe('ganho-velho');
    expect(negocioDoContato([n('a', 'lost', '2026-01-01'), n('b', 'lost', '2026-09-01')])?.id).toBe('b');
    expect(negocioDoContato([])).toBeNull();
  });
});
