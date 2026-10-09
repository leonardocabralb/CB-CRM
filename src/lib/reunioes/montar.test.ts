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
    datasDaFicha: new Map(),
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
    // Funil sem etapa marcada "Reagendar": o botão fica sem destino.
    expect(funis.banc.reagendar).toBeNull();
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
        negocios: [
          { id: 'd2', contact_id: 'c2', pipeline_id: 'banc', stage_id: 'noshow', value: 0, status: 'open', created_at: '2026-09-01T00:00:00Z' },
        ],
        trilha: new Map([['c2', [{ em: '2026-09-29T12:10:00Z', dealId: 'd2', etapaId: 'noshow', etapa: 'No Show', por: 'Bia' }]]]),
      }),
    );
    expect(reunioes.map((r) => r.reuniaoId)).toEqual(['manha', 'tarde']);
    expect(reunioes[0].resultado?.tipo).toBe('no_show');
    expect(reunioes[1].qualificada?.por).toBe('Leo');
  });

  it('reunião SEM card (o único card nasceu depois dela) não é resolvida pela trilha desse card', () => {
    const { reunioes } = montarPauta(
      dados({
        calendly: [cal({ id: 'antiga', inicio: '2026-09-29T12:00:00Z' })],
        negocios: [
          { id: 'novo', contact_id: 'c1', pipeline_id: 'banc', stage_id: 'noshow', value: 0, status: 'open', created_at: '2026-09-29T15:00:00Z' },
        ],
        trilha: new Map([['c1', [{ em: '2026-09-29T15:05:00Z', dealId: 'novo', etapaId: 'noshow', etapa: 'No Show', por: 'Bia' }]]]),
      }),
    );
    expect(reunioes[0].negocio).toBeNull();
    expect(reunioes[0].resultado).toBeNull();
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

  describe('a reunião com Reagendar pelo marco não é "a próxima" (1081)', () => {
    // O cliente pediu para reagendar a de 02/10 e ANTECIPOU pelo link manual
    // para 30/09; a de 02/10 segue de pé no Calendly (outro tipo de evento,
    // a inferência de convite substituído não a pega).
    const COM_REAGENDAR: EtapaDoFunil[] = [
      ...ETAPAS,
      { id: 'reag', pipelineId: 'banc', nome: 'Reagendar', posicao: 7, degrau: 'reuniao', marca: 'reagendar' },
    ];
    const base = (marcos: DadosDaPauta['marcos']) =>
      dados({
        etapas: COM_REAGENDAR,
        calendly: [
          cal({ id: 'antiga', inicio: '2026-10-02T14:00:00Z', fim: '2026-10-02T14:30:00Z', recebido_em: '2026-09-25T10:00:00Z' }),
          cal({
            id: 'nova',
            event_type_uri: 'outro-tipo',
            inicio: '2026-09-30T14:00:00Z',
            fim: '2026-09-30T14:30:00Z',
            recebido_em: '2026-09-29T10:00:00Z',
          }),
        ],
        negocios: [
          { id: 'd1', contact_id: 'c1', pipeline_id: 'banc', stage_id: 'reag', value: 0, status: 'open', created_at: '2026-09-01T00:00:00Z' },
        ],
        marcos,
      });
    const reagendada = new Map([
      [
        'calendly:antiga',
        [
          {
            origem: 'calendly' as const,
            reuniao_id: 'antiga',
            marco: 'resultado' as const,
            resultado: 'reagendar' as const,
            valor: null,
            registrado_por_nome: 'Bia',
            registrado_em: '2026-09-28T12:00:00Z',
            inicio: '2026-10-02T14:00:00Z',
          },
        ],
      ],
    ]);

    it('sem o marco, a antiga é a próxima da nova e o botão da nova só registra', () => {
      const nova = montarPauta(base(new Map())).reunioes.find((r) => r.reuniaoId === 'nova');
      expect(nova?.proximaEm).toBe('2026-10-02T14:00:00.000Z');
    });

    it('com o Reagendar da antiga, a nova não tem próxima (o card é dela) e a antiga segue resolvida', () => {
      const { reunioes } = montarPauta(base(reagendada));
      const nova = reunioes.find((r) => r.reuniaoId === 'nova');
      const antiga = reunioes.find((r) => r.reuniaoId === 'antiga');
      expect(nova?.proximaEm).toBeNull();
      expect(antiga?.resultado?.tipo).toBe('reagendar');
    });

    it('o Reagendar de OUTRO horário (marco antigo) não tira a reunião da conta', () => {
      const outroHorario = new Map([
        ['calendly:antiga', reagendada.get('calendly:antiga')!.map((m) => ({ ...m, inicio: '2026-10-01T14:00:00Z' }))],
      ]);
      const nova = montarPauta(base(outroHorario)).reunioes.find((r) => r.reuniaoId === 'nova');
      expect(nova?.proximaEm).toBe('2026-10-02T14:00:00.000Z');
    });
  });
});

describe('montarPauta — remarcada pela ficha ("Data e Hora Reunião")', () => {
  // A reunião do Calendly passou (no show), o operador a moveu no Google
  // Agenda — o Calendly não remarca reunião passada — e acertou a ficha.
  const calendly = [
    cal({ id: 'r1', inicio: '2026-10-01T19:45:00Z', fim: '2026-10-01T20:15:00Z', recebido_em: '2026-09-29T10:00:00Z' }),
  ];
  const ficha = new Map([['c1', '2026-10-02T19:00:00.000Z']]);
  // O dia em Brasília: 03:00 UTC até 02:59:59.999 do dia seguinte.
  const diaDe = (iso: string) => {
    const de = new Date(`${iso}T03:00:00Z`);
    return { de, ate: new Date(de.getTime() + 24 * 60 * 60_000 - 1) };
  };

  it('a reunião vai para o dia da ficha, com a mesma chave, a duração e o horário do Calendly à vista', () => {
    const { reunioes } = montarPauta(dados({ janela: diaDe('2026-10-02'), calendly, datasDaFicha: ficha }));
    expect(reunioes).toHaveLength(1);
    expect(reunioes[0]).toMatchObject({
      chave: 'calendly:r1',
      origem: 'calendly',
      reuniaoId: 'r1',
      inicio: '2026-10-02T19:00:00.000Z',
      fim: '2026-10-02T19:30:00.000Z',
      remarcadaDe: '2026-10-01T19:45:00.000Z',
      reagendamento: true,
      proximaEm: null,
    });
  });

  it('e sai do dia do Calendly', () => {
    const { reunioes } = montarPauta(dados({ janela: diaDe('2026-10-01'), calendly, datasDaFicha: ficha }));
    expect(reunioes).toEqual([]);
  });

  it('ficha IGUAL ao agendamento (o caso de todo dia) não remarca', () => {
    const { reunioes } = montarPauta(
      dados({ janela: diaDe('2026-10-01'), calendly, datasDaFicha: new Map([['c1', '2026-10-01T19:45:00.000Z']]) }),
    );
    expect(reunioes.map((r) => [r.inicio, r.remarcadaDe])).toEqual([['2026-10-01T19:45:00.000Z', null]]);
  });

  it('ficha MAIS ANTIGA que o último agendamento não remarca', () => {
    const { reunioes } = montarPauta(
      dados({ janela: diaDe('2026-10-01'), calendly, datasDaFicha: new Map([['c1', '2026-09-20T13:00:00.000Z']]) }),
    );
    expect(reunioes.map((r) => r.remarcadaDe)).toEqual([null]);
  });

  it('a data de um agendamento CANCELADO (o cancelamento não apaga a ficha) não arrasta a reunião anterior', () => {
    const { reunioes } = montarPauta(
      dados({
        janela: diaDe('2026-10-01'),
        calendly: [
          ...calendly,
          // Agendado depois e cancelado pelo cliente: a ficha ficou com a data dele.
          cal({ id: 'desistiu', inicio: '2026-10-05T13:00:00Z', recebido_em: '2026-10-01T21:00:00Z' }),
        ],
        cancelados: new Set(['uri-desistiu']),
        datasDaFicha: new Map([['c1', '2026-10-05T13:00:00.000Z']]),
      }),
    );
    expect(reunioes.map((r) => [r.reuniaoId, r.inicio, r.remarcadaDe])).toEqual([['r1', '2026-10-01T19:45:00.000Z', null]]);
  });

  it('reunião da agenda do CRM depois da data da ficha: não remarca', () => {
    const { reunioes } = montarPauta(
      dados({
        janela: diaDe('2026-10-01'),
        calendly,
        datasDaFicha: ficha,
        agenda: [
          {
            id: 'm1',
            contact_id: 'c1',
            conversation_id: null,
            titulo: 'Retorno',
            local: null,
            starts_at: '2026-10-03T17:00:00+00:00',
            ends_at: null,
            status: 'agendada',
            created_at: '2026-10-01T09:00:00Z',
          },
        ],
      }),
    );
    expect(reunioes.map((r) => [r.reuniaoId, r.remarcadaDe])).toEqual([['r1', null]]);
  });

  it('contato sem reunião do Calendly não ganha reunião só pela ficha', () => {
    const { reunioes } = montarPauta(
      dados({ janela: diaDe('2026-10-02'), calendly: [], datasDaFicha: new Map([['c2', '2026-10-02T19:00:00.000Z']]) }),
    );
    expect(reunioes).toEqual([]);
  });

  it('só a ÚLTIMA reunião do contato anda; a anterior tem como próxima a da FICHA, e a trilha dela para no horário do Calendly', () => {
    const { reunioes } = montarPauta(
      dados({
        janela: { de: new Date('2026-09-20T03:00:00Z'), ate: new Date('2026-10-04T02:59:00Z') },
        calendly: [
          cal({ id: 'antes', inicio: '2026-09-22T14:00:00Z', fim: null, recebido_em: '2026-09-20T10:00:00Z' }),
          ...calendly,
        ],
        datasDaFicha: ficha,
        negocios: [
          { id: 'd1', contact_id: 'c1', pipeline_id: 'banc', stage_id: 'noshow', value: 0, status: 'open', created_at: '2026-09-01T00:00:00Z' },
        ],
        // O no show do horário do Calendly (01/10), antes da data da ficha.
        trilha: new Map([['c1', [{ em: '2026-10-01T20:05:00Z', dealId: 'd1', etapaId: 'noshow', etapa: 'No Show', por: 'Bia' }]]]),
      }),
    );
    // A tela cita a reunião de 02/10 como a próxima (Codex, PR #377), nunca o
    // horário de 01/10 que a ficha remarcou…
    expect(reunioes.map((r) => [r.reuniaoId, r.inicio, r.proximaEm])).toEqual([
      ['antes', '2026-09-22T14:00:00.000Z', '2026-10-02T19:00:00.000Z'],
      ['r1', '2026-10-02T19:00:00.000Z', null],
    ]);
    // …mas o no show daquele horário não resolve a reunião anterior.
    expect(reunioes[0].resultado).toBeNull();
  });

  it('o resultado marcado ou movido ANTES do horário novo não resolve a remarcada; o depois, sim', () => {
    const negocios = [
      { id: 'd1', contact_id: 'c1', pipeline_id: 'banc', stage_id: 'noshow', value: 0, status: 'open', created_at: '2026-09-01T00:00:00Z' },
    ];
    const marcoAntigo = {
      origem: 'calendly' as const,
      reuniao_id: 'r1',
      marco: 'resultado' as const,
      resultado: 'no_show' as const,
      valor: null,
      registrado_por_nome: 'Leo',
      registrado_em: '2026-10-01T20:00:00Z',
    };
    // O no show do horário do Calendly (pelo quadro e pela tela).
    const noShowDoCalendly = { em: '2026-10-01T20:05:00Z', dealId: 'd1', etapaId: 'noshow', etapa: 'No Show', por: 'Bia' };
    const antes = montarPauta(
      dados({
        janela: diaDe('2026-10-02'),
        calendly,
        datasDaFicha: ficha,
        negocios,
        marcos: new Map([['calendly:r1', [marcoAntigo]]]),
        trilha: new Map([['c1', [noShowDoCalendly]]]),
      }),
    ).reunioes[0];
    expect(antes.resultado).toBeNull();
    expect(antes.faltouAntes?.em).toBe('2026-10-01T20:05:00Z');

    const depois = montarPauta(
      dados({
        janela: diaDe('2026-10-02'),
        calendly,
        datasDaFicha: ficha,
        negocios,
        marcos: new Map([['calendly:r1', [{ ...marcoAntigo, resultado: 'sem_proposta' as const, registrado_em: '2026-10-02T19:40:00Z' }]]]),
        trilha: new Map([['c1', [noShowDoCalendly]]]),
      }),
    ).reunioes[0];
    expect(depois.resultado).toMatchObject({ tipo: 'sem_proposta', fonte: 'tela' });
  });

  // O Reagendar (1081) vale ANTES do horário, mas só para o horário em que foi
  // gravado: a remarcação pela ficha reaproveita a MESMA chave, e o Reagendar
  // do horário do Calendly não pode resolver o horário novo.
  describe('Reagendar (1081)', () => {
    const etapas: EtapaDoFunil[] = [
      ...ETAPAS,
      { id: 'reag', pipelineId: 'banc', nome: 'Reagendar', posicao: 7, degrau: 'reuniao', marca: 'reagendar' },
    ];
    const negocios = [
      { id: 'd1', contact_id: 'c1', pipeline_id: 'banc', stage_id: 'reag', value: 0, status: 'open', created_at: '2026-09-01T00:00:00Z' },
    ];
    const reagendou = (inicio: string, registrado_em: string) => ({
      origem: 'calendly' as const,
      reuniao_id: 'r1',
      marco: 'resultado' as const,
      resultado: 'reagendar' as const,
      valor: null,
      registrado_por_nome: 'Leo',
      registrado_em,
      inicio,
    });
    // O clique levou o card para a etapa Reagendar antes do horário do Calendly.
    const entrouNaReagendar = { em: '2026-10-01T15:00:05Z', dealId: 'd1', etapaId: 'reag', etapa: 'Reagendar', por: 'Leo' };

    it('Reagendar gravado para o horário do CALENDLY: a reunião no horário da ficha fica SEM resultado', () => {
      for (const registrado_em of [
        // O cliente avisou antes do horário do Calendly…
        '2026-10-01T15:00:00Z',
        // …ou depois dele e antes do horário da ficha.
        '2026-10-01T20:00:00Z',
      ]) {
        const [r] = montarPauta(
          dados({
            janela: diaDe('2026-10-02'),
            calendly,
            datasDaFicha: ficha,
            etapas,
            negocios,
            // Como o PostgREST devolve o timestamptz.
            marcos: new Map([['calendly:r1', [reagendou('2026-10-01T19:45:00+00:00', registrado_em)]]]),
            trilha: new Map([['c1', [entrouNaReagendar]]]),
          }),
        ).reunioes;
        expect(r.inicio).toBe('2026-10-02T19:00:00.000Z');
        expect(r.remarcadaDe).toBe('2026-10-01T19:45:00.000Z');
        expect(r.resultado).toBeNull();
      }
    });

    it('Reagendar gravado para o horário da FICHA (antes dele): a reunião remarcada fica "reagendar"', () => {
      const [r] = montarPauta(
        dados({
          janela: diaDe('2026-10-02'),
          calendly,
          datasDaFicha: ficha,
          etapas,
          negocios,
          marcos: new Map([['calendly:r1', [reagendou('2026-10-02T19:00:00+00:00', '2026-10-02T12:00:00Z')]]]),
          trilha: new Map([['c1', [entrouNaReagendar]]]),
        }),
      ).reunioes;
      expect(r.inicio).toBe('2026-10-02T19:00:00.000Z');
      expect(r.resultado).toEqual({
        tipo: 'reagendar',
        em: '2026-10-02T12:00:00Z',
        por: 'Leo',
        fonte: 'tela',
        etapa: null,
        valor: null,
      });
    });

    it('a passagem pela etapa Reagendar não acende "Já faltou" no horário novo', () => {
      const [r] = montarPauta(
        dados({
          janela: diaDe('2026-10-02'),
          calendly,
          datasDaFicha: ficha,
          etapas,
          negocios,
          trilha: new Map([['c1', [entrouNaReagendar]]]),
        }),
      ).reunioes;
      expect(r.faltouAntes).toBeNull();
    });
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

  it('só o card que JÁ existia no início da reunião; o criado depois não é dela', () => {
    const cards = [n('da-reuniao', 'open', '2026-09-01T10:00:00Z'), n('criado-depois', 'open', '2026-09-20T10:00:00Z')];
    expect(negocioDoContato(cards, '2026-09-10T14:00:00Z')?.id).toBe('da-reuniao');
    // Nenhum existia: a reunião fica sem card (só registra).
    expect(negocioDoContato([n('criado-depois', 'open', '2026-09-20T10:00:00Z')], '2026-09-10T14:00:00Z')).toBeNull();
    // Criado no mesmo instante (o Calendly cria o card ao agendar, antes do início): conta.
    expect(negocioDoContato([n('mesmo', 'open', '2026-09-10T14:00:00Z')], '2026-09-10T14:00:00Z')?.id).toBe('mesmo');
    // Sem data de criação: conta como existente.
    expect(negocioDoContato([{ ...n('sem-data', 'open', ''), created_at: null }], '2026-09-10T14:00:00Z')?.id).toBe('sem-data');
  });
});
