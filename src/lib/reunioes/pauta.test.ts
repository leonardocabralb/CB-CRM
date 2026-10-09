import { describe, expect, it } from 'vitest';

import {
  RESULTADOS,
  alvosDoFunil,
  comoMarcar,
  ehResultado,
  faltouAntes,
  faseDaReuniao,
  lerPauta,
  linkDeReuniao,
  marcoValeParaAReuniao,
  pendentes,
  qualificacaoDaReuniao,
  resultadoDaEtapa,
  resultadoDaReuniao,
  type EntradaDaTrilha,
  type EtapaDoFunil,
  type LinhaDoMarco,
  type ReuniaoDaPauta,
} from './pauta';

// O Bancário - Comercial como está em produção (28/09/2026), com a MQL 2
// marcada "qualificada" pela 1063.
const ETAPAS: EtapaDoFunil[] = [
  { id: 'avulso', pipelineId: 'banc', nome: 'Contato Avulso', posicao: 0, degrau: 'lead', marca: null },
  { id: 'agendada', pipelineId: 'banc', nome: 'Reunião Agendada', posicao: 4, degrau: 'reuniao', marca: null },
  { id: 'mql2', pipelineId: 'banc', nome: 'MQL 2 - Reunião Qualificada', posicao: 5, degrau: 'reuniao', marca: 'qualificada' },
  { id: 'noshow', pipelineId: 'banc', nome: 'No Show', posicao: 6, degrau: 'reuniao', marca: 'faltou' },
  { id: 'semprop', pipelineId: 'banc', nome: 'Reunião Sem Proposta', posicao: 7, degrau: 'reuniao', marca: 'compareceu' },
  { id: 'prop', pipelineId: 'banc', nome: 'Proposta Realizada', posicao: 8, degrau: 'proposta', marca: null },
  { id: 'contrato', pipelineId: 'banc', nome: 'Contrato Fechado', posicao: 9, degrau: 'contrato', marca: null },
  { id: 'outro-prop', pipelineId: 'trab', nome: 'Proposta', posicao: 3, degrau: 'proposta', marca: null },
];
const POR_ID = new Map(ETAPAS.map((e) => [e.id, e]));

// O mesmo funil com a etapa da Fase 3 de `docs/PLANO-reagendamento.md`: a
// "Reagendar", marcada "Reagendar" (1081). Nome e posição são do operador.
const COM_REAGENDAR: EtapaDoFunil[] = [
  ...ETAPAS,
  { id: 'reag', pipelineId: 'banc', nome: 'Reagendar', posicao: 10, degrau: 'reuniao', marca: 'reagendar' },
];
const POR_ID_R = new Map(COM_REAGENDAR.map((e) => [e.id, e]));

const entrada = (em: string, etapaId: string, por: string | null = 'Ana', dealId: string | null = 'd1'): EntradaDaTrilha => ({
  em,
  dealId,
  etapaId,
  etapa: POR_ID_R.get(etapaId)?.nome ?? null,
  por,
});

const marco = (m: Partial<LinhaDoMarco>): LinhaDoMarco => ({
  origem: 'calendly',
  reuniao_id: 'r1',
  marco: 'resultado',
  resultado: 'no_show',
  valor: null,
  registrado_por_nome: 'Leo',
  registrado_em: '2026-09-29T14:10:00Z',
  ...m,
});

describe('resultadoDaEtapa', () => {
  it('faltou → no show; compareceu → sem proposta; proposta em diante → com proposta', () => {
    expect(resultadoDaEtapa(POR_ID.get('noshow'))).toBe('no_show');
    expect(resultadoDaEtapa(POR_ID.get('semprop'))).toBe('sem_proposta');
    expect(resultadoDaEtapa(POR_ID.get('prop'))).toBe('proposta');
    expect(resultadoDaEtapa(POR_ID.get('contrato'))).toBe('proposta');
  });
  it('a MQL 2 (qualificada) e a Reunião Agendada NÃO dizem resultado', () => {
    expect(resultadoDaEtapa(POR_ID.get('mql2'))).toBeNull();
    expect(resultadoDaEtapa(POR_ID.get('agendada'))).toBeNull();
    expect(resultadoDaEtapa(undefined)).toBeNull();
  });
  it('o degrau de proposta VENCE a marcação: "Proposta Realizada" marcada "Compareceu" continua com proposta', () => {
    // Foi o que aconteceu em produção em 29/09/2026: a intuição "quem recebeu
    // proposta compareceu" marcava a etapa, e a entrada nela virava "sem proposta".
    for (const marca of ['compareceu', 'faltou', 'qualificada', 'reagendar'] as const) {
      expect(resultadoDaEtapa({ degrau: 'proposta', marca })).toBe('proposta');
      expect(resultadoDaEtapa({ degrau: 'contrato', marca })).toBe('proposta');
    }
  });
  it('reagendar → reagendar (em etapa de degrau reunião ou sem degrau); da proposta em diante, o degrau vence', () => {
    expect(resultadoDaEtapa(POR_ID_R.get('reag'))).toBe('reagendar');
    expect(resultadoDaEtapa({ degrau: null, marca: 'reagendar' })).toBe('reagendar');
    expect(resultadoDaEtapa({ degrau: 'proposta', marca: 'reagendar' })).toBe('proposta');
    expect(resultadoDaEtapa({ degrau: 'pasta', marca: 'reagendar' })).toBe('proposta');
  });
});

describe('RESULTADOS', () => {
  it('na ordem dos botões depois do início (D1): com proposta, sem proposta, reagendar, no show', () => {
    expect(RESULTADOS).toEqual(['proposta', 'sem_proposta', 'reagendar', 'no_show']);
    expect(ehResultado('reagendar')).toBe(true);
    expect(ehResultado('reagendada')).toBe(false);
  });
});

describe('alvosDoFunil', () => {
  it('cada botão leva à etapa MARCADA do funil do card, nunca de outro funil', () => {
    expect(alvosDoFunil(COM_REAGENDAR, 'banc')).toEqual({
      qualificada: { id: 'mql2', nome: 'MQL 2 - Reunião Qualificada' },
      proposta: { id: 'prop', nome: 'Proposta Realizada' },
      sem_proposta: { id: 'semprop', nome: 'Reunião Sem Proposta' },
      reagendar: { id: 'reag', nome: 'Reagendar' },
      no_show: { id: 'noshow', nome: 'No Show' },
    });
    const trab = alvosDoFunil(COM_REAGENDAR, 'trab');
    expect(trab.proposta).toEqual({ id: 'outro-prop', nome: 'Proposta' });
    expect(trab.qualificada).toBeNull();
    expect(trab.reagendar).toBeNull();
    expect(trab.no_show).toBeNull();
  });
  it('funil sem etapa marcada "Reagendar" (o de hoje, antes da Fase 3): o botão não tem destino', () => {
    expect(alvosDoFunil(ETAPAS, 'banc').reagendar).toBeNull();
    // Nunca pelo nome: uma etapa chamada "Reagendar" sem a marca não é destino.
    const soPeloNome = [...ETAPAS, { id: 'reag', pipelineId: 'banc', nome: 'Reagendar', posicao: 10, degrau: 'reuniao', marca: null }];
    expect(alvosDoFunil(soPeloNome, 'banc').reagendar).toBeNull();
  });
  it('duas etapas com a mesma marca: vale a de menor posição', () => {
    const etapas = [
      ...COM_REAGENDAR,
      { id: 'noshow2', pipelineId: 'banc', nome: 'No Show 2', posicao: 1, degrau: null, marca: 'faltou' as const },
      { id: 'reag2', pipelineId: 'banc', nome: 'Remarcar', posicao: 2, degrau: 'reuniao', marca: 'reagendar' as const },
    ];
    expect(alvosDoFunil(etapas, 'banc').no_show?.id).toBe('noshow2');
    expect(alvosDoFunil(etapas, 'banc').reagendar).toEqual({ id: 'reag2', nome: 'Remarcar' });
  });
  it('marcação numa etapa de proposta em diante não vira destino de botão', () => {
    // Só a Proposta Realizada marcada (sem a Reunião Sem Proposta): o botão
    // "Sem proposta" levaria o card para a proposta.
    const etapas: EtapaDoFunil[] = [
      { id: 'agendada', pipelineId: 'x', nome: 'Reunião Agendada', posicao: 0, degrau: 'reuniao', marca: null },
      { id: 'prop', pipelineId: 'x', nome: 'Proposta Realizada', posicao: 1, degrau: 'proposta', marca: 'compareceu' },
      { id: 'contrato', pipelineId: 'x', nome: 'Contrato', posicao: 2, degrau: 'contrato', marca: 'faltou' },
      { id: 'pasta', pipelineId: 'x', nome: 'Pasta', posicao: 3, degrau: 'pasta', marca: 'qualificada' },
      { id: 'contrato2', pipelineId: 'x', nome: 'Contrato 2', posicao: 4, degrau: 'contrato', marca: 'reagendar' },
    ];
    expect(alvosDoFunil(etapas, 'x')).toEqual({
      qualificada: null,
      proposta: { id: 'prop', nome: 'Proposta Realizada' },
      sem_proposta: null,
      reagendar: null,
      no_show: null,
    });
  });
});

describe('a marcação de etapa de proposta em diante não vale em lugar nenhum', () => {
  const comMarcaNaProposta = new Map(
    [...POR_ID].map(([id, e]) => [id, id === 'prop' ? { ...e, marca: 'faltou' as const } : id === 'contrato' ? { ...e, marca: 'qualificada' as const } : e]),
  );
  it('"Faltou" na Proposta Realizada não conta como falta anterior', () => {
    expect(
      faltouAntes({ inicio: '2026-09-29T14:00:00Z', entradas: [entrada('2026-09-20T10:00:00Z', 'prop')], etapas: comMarcaNaProposta }),
    ).toBeNull();
  });
  it('"Qualificada" no Contrato não conta como qualificação', () => {
    expect(
      qualificacaoDaReuniao({
        desde: '2026-09-28T10:00:00Z',
        ate: null,
        dealId: 'd1',
        marcos: [],
        entradas: [entrada('2026-09-29T10:00:00Z', 'contrato')],
        etapas: comMarcaNaProposta,
      }),
    ).toBeNull();
  });
});

describe('resultadoDaReuniao', () => {
  const inicio = '2026-09-29T14:00:00Z';

  it('sem nada: sem resultado', () => {
    expect(resultadoDaReuniao({ inicio, ate: null, dealId: 'd1', marcos: [], entradas: [], etapas: POR_ID })).toBeNull();
  });

  it('entrada no funil ANTES do início é de outra reunião e não conta', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [],
      entradas: [entrada('2026-09-20T10:00:00Z', 'noshow'), entrada('2026-09-29T13:59:00Z', 'prop')],
      etapas: POR_ID,
    });
    expect(r).toBeNull();
  });

  it('o card movido pelo funil DEPOIS do início resolve a reunião (fonte funil)', () => {
    const r = resultadoDaReuniao({ inicio, ate: null, dealId: 'd1', marcos: [], entradas: [entrada('2026-09-29T14:20:00Z', 'semprop', 'Bia')], etapas: POR_ID });
    expect(r).toEqual({
      tipo: 'sem_proposta',
      em: '2026-09-29T14:20:00Z',
      por: 'Bia',
      fonte: 'funil',
      etapa: 'Reunião Sem Proposta',
      valor: null,
    });
  });

  it('o marco da tela resolve mesmo sem entrada (o card já estava na etapa)', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [marco({ resultado: 'proposta', valor: 18000 })],
      entradas: [],
      etapas: POR_ID,
    });
    expect(r?.tipo).toBe('proposta');
    expect(r?.valor).toBe(18000);
    expect(r?.fonte).toBe('tela');
  });

  it('vence o MAIS RECENTE: marcado No show na tela e depois levado para Proposta no quadro', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [marco({ resultado: 'no_show', registrado_em: '2026-09-29T14:10:00Z' })],
      entradas: [entrada('2026-09-29T16:00:00Z', 'prop')],
      etapas: POR_ID,
    });
    expect(r?.tipo).toBe('proposta');
    expect(r?.fonte).toBe('funil');
  });

  it('o marco de QUALIFICADA não é resultado', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [marco({ marco: 'qualificada', resultado: null })],
      entradas: [entrada('2026-09-29T14:30:00Z', 'mql2')],
      etapas: POR_ID,
    });
    expect(r).toBeNull();
  });

  it('a entrada DEPOIS do início da próxima reunião do contato é da próxima, não desta', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: '2026-10-02T14:00:00Z',
      dealId: 'd1',
      marcos: [],
      entradas: [entrada('2026-10-02T14:40:00Z', 'semprop')],
      etapas: POR_ID,
    });
    expect(r).toBeNull();
  });

  it('entrada de OUTRO card do mesmo contato (outro funil) não resolve esta reunião', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [],
      entradas: [entrada('2026-09-29T15:00:00Z', 'outro-prop', 'Bia', 'd-trabalhista')],
      etapas: POR_ID,
    });
    expect(r).toBeNull();
  });

  it('marco de resultado gravado ANTES do início (reunião da agenda remarcada) não vale', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [marco({ resultado: 'no_show', registrado_em: '2026-09-20T10:00:00Z' })],
      entradas: [],
      etapas: POR_ID,
    });
    expect(r).toBeNull();
  });

  it('valor só acompanha a proposta', () => {
    const r = resultadoDaReuniao({ inicio, ate: null, dealId: 'd1', marcos: [marco({ resultado: 'no_show', valor: 5 })], entradas: [], etapas: POR_ID });
    expect(r?.valor).toBeNull();
  });
});

describe('marcoValeParaAReuniao', () => {
  const inicio = '2026-09-29T14:00:00Z';

  it('proposta, sem proposta e no show só valem gravados a partir do início — mesmo com o `inicio` gravado', () => {
    for (const resultado of ['proposta', 'sem_proposta', 'no_show'] as const) {
      expect(marcoValeParaAReuniao({ resultado, registrado_em: '2026-09-29T13:59:59Z', inicio }, inicio)).toBe(false);
      expect(marcoValeParaAReuniao({ resultado, registrado_em: '2026-09-29T14:00:00Z', inicio }, inicio)).toBe(true);
      expect(marcoValeParaAReuniao({ resultado, registrado_em: '2026-09-29T14:10:00Z', inicio: null }, inicio)).toBe(true);
      expect(marcoValeParaAReuniao({ resultado, registrado_em: '2026-09-28T10:00:00Z' }, inicio)).toBe(false);
    }
  });

  it('reagendar gravado para ESTE horário vale ANTES do início (D1), com o instante em qualquer forma', () => {
    const antes = '2026-09-28T10:00:00Z';
    for (const doMarco of [
      '2026-09-29T14:00:00Z',
      // Como o PostgREST devolve o timestamptz.
      '2026-09-29T14:00:00+00:00',
      '2026-09-29T14:00:00.000Z',
      '2026-09-29T14:00:00.000000+00:00',
      '2026-09-29 14:00:00+00',
      '2026-09-29T11:00:00-03:00',
    ]) {
      expect(marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: antes, inicio: doMarco }, inicio)).toBe(true);
    }
    // A reunião também pode vir com milissegundos (a remarcada pela ficha sai de `toISOString`).
    expect(marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: antes, inicio: '2026-09-29T14:00:00+00:00' }, '2026-09-29T14:00:00.000Z')).toBe(true);
    // E continua valendo depois do início.
    expect(marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: '2026-09-29T14:20:00Z', inicio }, inicio)).toBe(true);
  });

  it('um milissegundo de diferença já é OUTRO horário', () => {
    expect(
      marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: '2026-09-28T10:00:00Z', inicio: '2026-09-29T14:00:00.001Z' }, inicio),
    ).toBe(false);
  });

  it('reagendar gravado para OUTRO horário (a ficha remarcou a reunião) não vale — nem gravado entre o horário antigo e o novo', () => {
    const antigo = '2026-10-01T19:45:00Z';
    const novo = '2026-10-02T19:00:00.000Z';
    // Avisou antes do horário antigo.
    expect(marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: '2026-10-01T15:00:00Z', inicio: antigo }, novo)).toBe(false);
    // Gravado DEPOIS do início antigo e antes do novo: a exceção do Reagendar
    // não o salva — o horário dele é outro.
    expect(marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: '2026-10-01T20:00:00Z', inicio: antigo }, novo)).toBe(false);
    // Gravado depois do início NOVO, mas pela tela que ainda via o horário
    // antigo: o marco fala de outro horário (a tela recarrega e a pessoa marca
    // de novo).
    expect(marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: '2026-10-02T19:30:00Z', inicio: antigo }, novo)).toBe(false);
  });

  it('reagendar SEM `inicio` (marco anterior à 1081) segue a regra de sempre', () => {
    expect(marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: '2026-09-28T10:00:00Z', inicio: null }, inicio)).toBe(false);
    expect(marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: '2026-09-28T10:00:00Z' }, inicio)).toBe(false);
    expect(marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: '2026-09-29T14:05:00Z', inicio: null }, inicio)).toBe(true);
  });

  it('data que não se lê não vale', () => {
    expect(marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: 'ontem', inicio }, inicio)).toBe(false);
    expect(marcoValeParaAReuniao({ resultado: 'reagendar', registrado_em: '2026-09-28T10:00:00Z', inicio: 'amanhã' }, inicio)).toBe(false);
    expect(marcoValeParaAReuniao({ resultado: 'no_show', registrado_em: '2026-09-29T14:05:00Z' }, 'hoje')).toBe(false);
  });
});

describe('resultadoDaReuniao — Reagendar (1081)', () => {
  const inicio = '2026-09-29T14:00:00Z';
  const reagendou = (registrado_em: string, doMarco: string | null = '2026-09-29T14:00:00+00:00') =>
    marco({ resultado: 'reagendar', registrado_em, inicio: doMarco });

  it('Reagendar ANTES do início, para este horário: resolve (fonte tela), e a reunião sai da rede antes do horário', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [reagendou('2026-09-28T16:00:00Z')],
      // O mesmo clique levou o card para a etapa — antes do início, a trilha não conta.
      entradas: [entrada('2026-09-28T16:00:01Z', 'reag', 'Leo')],
      etapas: POR_ID_R,
    });
    expect(r).toEqual({ tipo: 'reagendar', em: '2026-09-28T16:00:00Z', por: 'Leo', fonte: 'tela', etapa: null, valor: null });
    expect(faseDaReuniao(reuniao({ inicio, resultado: r }), new Date('2026-09-28T17:00:00Z'))).toBe('com_resultado');
    expect(pendentes([reuniao({ inicio, resultado: r })], new Date('2026-09-29T15:00:00Z'))).toEqual([]);
  });

  it('a entrada na etapa Reagendar ANTES do início não resolve: o quadro antes da hora pede a confirmação na pauta', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [],
      entradas: [entrada('2026-09-28T16:00:00Z', 'reag')],
      etapas: POR_ID_R,
    });
    expect(r).toBeNull();
    expect(faseDaReuniao(reuniao({ inicio, resultado: r }), new Date('2026-09-28T17:00:00Z'))).toBe('antes');
  });

  it('a entrada na etapa Reagendar DEPOIS do início resolve (fonte funil)', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [],
      entradas: [entrada('2026-09-29T14:05:00Z', 'reag', 'Bia')],
      etapas: POR_ID_R,
    });
    expect(r).toEqual({ tipo: 'reagendar', em: '2026-09-29T14:05:00Z', por: 'Bia', fonte: 'funil', etapa: 'Reagendar', valor: null });
  });

  it('vence o MAIS RECENTE: Reagendar antes do horário e, depois do início, No Show pelo quadro → no show', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [reagendou('2026-09-28T16:00:00Z')],
      entradas: [entrada('2026-09-29T14:15:00Z', 'noshow', 'Bia')],
      etapas: POR_ID_R,
    });
    expect(r).toMatchObject({ tipo: 'no_show', fonte: 'funil', por: 'Bia' });
  });

  it('e o contrário: No Show pelo quadro e, depois, Reagendar na pauta → reagendar', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [reagendou('2026-09-29T14:30:00Z')],
      entradas: [entrada('2026-09-29T14:15:00Z', 'noshow', 'Bia')],
      etapas: POR_ID_R,
    });
    expect(r).toMatchObject({ tipo: 'reagendar', fonte: 'tela' });
  });

  it('Reagendar gravado para o horário ANTIGO não resolve a reunião remarcada', () => {
    const r = resultadoDaReuniao({
      inicio,
      ate: null,
      dealId: 'd1',
      marcos: [reagendou('2026-09-28T09:00:00Z', '2026-09-28T14:00:00Z')],
      entradas: [],
      etapas: POR_ID_R,
    });
    expect(r).toBeNull();
  });
});

describe('qualificacaoDaReuniao', () => {
  it('entrada na etapa qualificada a partir do agendamento conta; antes, não', () => {
    const desde = '2026-09-28T10:00:00Z';
    expect(
      qualificacaoDaReuniao({ desde, ate: null, dealId: 'd1', marcos: [], entradas: [entrada('2026-09-01T10:00:00Z', 'mql2')], etapas: POR_ID }),
    ).toBeNull();
    expect(
      qualificacaoDaReuniao({ desde, ate: null, dealId: 'd1', marcos: [], entradas: [entrada('2026-09-28T11:00:00Z', 'mql2', 'Leo')], etapas: POR_ID }),
    ).toEqual({ em: '2026-09-28T11:00:00Z', por: 'Leo', fonte: 'funil', etapa: 'MQL 2 - Reunião Qualificada' });
  });
  it('o marco da tela conta sempre', () => {
    const q = qualificacaoDaReuniao({
      desde: '2026-09-28T10:00:00Z',
      ate: null,
      dealId: 'd1',
      marcos: [marco({ marco: 'qualificada', resultado: null, registrado_em: '2026-09-28T12:00:00Z' })],
      entradas: [],
      etapas: POR_ID,
    });
    expect(q?.fonte).toBe('tela');
    expect(q?.por).toBe('Leo');
  });
});

describe('faltouAntes', () => {
  it('só a entrada numa etapa "faltou" ANTES desta reunião', () => {
    const inicio = '2026-09-29T14:00:00Z';
    expect(
      faltouAntes({ inicio, entradas: [entrada('2026-09-29T14:30:00Z', 'noshow')], etapas: POR_ID }),
    ).toBeNull();
    expect(
      faltouAntes({
        inicio,
        entradas: [entrada('2026-09-10T10:00:00Z', 'noshow'), entrada('2026-09-15T10:00:00Z', 'noshow')],
        etapas: POR_ID,
      }),
    ).toEqual({ em: '2026-09-15T10:00:00Z', etapa: 'No Show' });
  });
  it('o Reagendar NÃO é falta: não acende "Já faltou" (D2)', () => {
    expect(
      faltouAntes({ inicio: '2026-09-29T14:00:00Z', entradas: [entrada('2026-09-20T10:00:00Z', 'reag')], etapas: POR_ID_R }),
    ).toBeNull();
  });
});

/** O instante do clique nos testes de `comoMarcar` (o Reagendar compara com a reunião anterior). */
const AGORA_DO_CLIQUE = new Date('2026-09-28T12:00:00Z');

function reuniao(p: Partial<ReuniaoDaPauta>): ReuniaoDaPauta {
  return {
    chave: 'calendly:r1',
    origem: 'calendly',
    reuniaoId: 'r1',
    inicio: '2026-09-29T14:00:00Z',
    fim: '2026-09-29T14:30:00Z',
    evento: null,
    link: null,
    reagendamento: false,
    remarcadaDe: null,
    proximaEm: null,
    anteriorEm: null,
    contato: { id: 'c1', nome: 'Ana' },
    conversaId: 'v1',
    negocio: null,
    qualificacao: { divida: null, atraso: null, origem: null },
    qualificada: null,
    resultado: null,
    faltouAntes: null,
    aguardandoDesde: null,
    ...p,
  };
}

describe('faseDaReuniao', () => {
  it('o resultado abre no INÍCIO, não no fim', () => {
    const r = reuniao({});
    expect(faseDaReuniao(r, new Date('2026-09-29T13:59:59Z'))).toBe('antes');
    expect(faseDaReuniao(r, new Date('2026-09-29T14:00:00Z'))).toBe('sem_resultado');
    expect(faseDaReuniao(r, new Date('2026-09-29T14:05:00Z'))).toBe('sem_resultado');
  });
  it('com resultado registrado, fica resolvida', () => {
    const r = reuniao({ resultado: { tipo: 'no_show', em: 'x', por: null, fonte: 'tela', etapa: null, valor: null } });
    expect(faseDaReuniao(r, new Date('2026-09-29T13:00:00Z'))).toBe('com_resultado');
  });
});

describe('pendentes (a rede de segurança)', () => {
  const agora = new Date('2026-09-29T15:00:00Z');
  it('só o que já começou, sem resultado, nos últimos 30 dias, do mais antigo ao mais novo', () => {
    const lista = [
      reuniao({ chave: 'a', inicio: '2026-09-29T14:00:00Z' }),
      reuniao({ chave: 'futura', inicio: '2026-09-29T16:00:00Z' }),
      reuniao({ chave: 'b', inicio: '2026-09-22T10:00:00Z' }),
      reuniao({ chave: 'velha', inicio: '2026-08-20T10:00:00Z' }),
      reuniao({
        chave: 'resolvida',
        inicio: '2026-09-25T10:00:00Z',
        resultado: { tipo: 'proposta', em: 'x', por: null, fonte: 'funil', etapa: null, valor: null },
      }),
    ];
    expect(pendentes(lista, agora).map((r) => r.chave)).toEqual(['b', 'a']);
  });
});

describe('comoMarcar', () => {
  const n = { id: 'd', pipelineId: 'banc', pipelineNome: null, etapaId: 'agendada', etapaNome: null, valor: 0 };
  const alvos = alvosDoFunil(ETAPAS, 'banc');

  it('card aberto, sem reunião posterior e com etapa marcada: move', () => {
    expect(comoMarcar({ negocio: { ...n, status: 'open' }, proximaEm: null, anteriorEm: null }, 'no_show', alvos, AGORA_DO_CLIQUE)).toEqual({
      alvo: { id: 'noshow', nome: 'No Show' },
      motivo: null,
    });
  });

  it('sem card, card ganho ou PERDIDO: só registra (o perdido reabriria pela 1031)', () => {
    expect(comoMarcar({ negocio: null, proximaEm: null, anteriorEm: null }, 'no_show', alvos, AGORA_DO_CLIQUE)).toEqual({ alvo: null, motivo: 'sem_card' });
    expect(comoMarcar({ negocio: { ...n, status: 'won' }, proximaEm: null, anteriorEm: null }, 'no_show', alvos, AGORA_DO_CLIQUE).motivo).toBe('card_fechado');
    expect(comoMarcar({ negocio: { ...n, status: 'lost' }, proximaEm: null, anteriorEm: null }, 'no_show', alvos, AGORA_DO_CLIQUE).motivo).toBe('card_fechado');
  });

  it('com reunião POSTERIOR do contato, o resultado só registra (o card é da seguinte); a qualificação ainda move', () => {
    const r = { negocio: { ...n, status: 'open' as const }, proximaEm: '2026-10-02T14:00:00Z', anteriorEm: null };
    expect(comoMarcar(r, 'no_show', alvos, AGORA_DO_CLIQUE).motivo).toBe('reuniao_posterior');
    expect(comoMarcar(r, 'qualificada', alvos, AGORA_DO_CLIQUE).alvo?.id).toBe('mql2');
  });

  it('funil sem a etapa marcada: só registra', () => {
    const semMql = alvosDoFunil(ETAPAS.filter((e) => e.id !== 'mql2'), 'banc');
    expect(comoMarcar({ negocio: { ...n, status: 'open' }, proximaEm: null, anteriorEm: null }, 'qualificada', semMql, AGORA_DO_CLIQUE).motivo).toBe('sem_etapa');
  });

  describe('Reagendar (1081)', () => {
    const comReagendar = alvosDoFunil(COM_REAGENDAR, 'banc');
    const aberto = { ...n, status: 'open' as const };

    it('card aberto e etapa marcada: move para a Reagendar', () => {
      expect(comoMarcar({ negocio: aberto, proximaEm: null, anteriorEm: null }, 'reagendar', comReagendar, AGORA_DO_CLIQUE)).toEqual({
        alvo: { id: 'reag', nome: 'Reagendar' },
        motivo: null,
      });
    });

    it('com reunião POSTERIOR do contato, só registra (o card é da seguinte, e dos lembretes dela)', () => {
      expect(comoMarcar({ negocio: aberto, proximaEm: '2026-10-02T14:00:00Z', anteriorEm: null }, 'reagendar', comReagendar, AGORA_DO_CLIQUE)).toEqual({
        alvo: null,
        motivo: 'reuniao_posterior',
      });
    });

    it('sem card ou card fechado: só registra', () => {
      expect(comoMarcar({ negocio: null, proximaEm: null, anteriorEm: null }, 'reagendar', comReagendar, AGORA_DO_CLIQUE)).toEqual({ alvo: null, motivo: 'sem_card' });
      expect(comoMarcar({ negocio: { ...n, status: 'lost' }, proximaEm: null, anteriorEm: null }, 'reagendar', comReagendar, AGORA_DO_CLIQUE).motivo).toBe('card_fechado');
    });

    it('funil sem a etapa marcada "Reagendar" (ou sem destinos): só registra', () => {
      expect(comoMarcar({ negocio: aberto, proximaEm: null, anteriorEm: null }, 'reagendar', alvos, AGORA_DO_CLIQUE)).toEqual({ alvo: null, motivo: 'sem_etapa' });
      expect(comoMarcar({ negocio: aberto, proximaEm: null, anteriorEm: null }, 'reagendar', null, AGORA_DO_CLIQUE)).toEqual({ alvo: null, motivo: 'sem_etapa' });
    });

    it('com reunião ANTERIOR que ainda não começou, o Reagendar só registra (o card e os lembretes são dela)', () => {
      // O cliente antecipou: a anterior é amanhã; a reunião antiga, depois.
      const amanha = new Date(AGORA_DO_CLIQUE.getTime() + 24 * 3600_000).toISOString();
      expect(comoMarcar({ negocio: aberto, proximaEm: null, anteriorEm: amanha }, 'reagendar', comReagendar, AGORA_DO_CLIQUE)).toEqual({
        alvo: null,
        motivo: 'reuniao_anterior',
      });
      // Quando a anterior já começou (ou passou), o card volta a andar.
      const ontem = new Date(AGORA_DO_CLIQUE.getTime() - 24 * 3600_000).toISOString();
      expect(comoMarcar({ negocio: aberto, proximaEm: null, anteriorEm: ontem }, 'reagendar', comReagendar, AGORA_DO_CLIQUE).alvo?.id).toBe('reag');
      // Só o Reagendar: a qualificação segue como era.
      expect(comoMarcar({ negocio: aberto, proximaEm: null, anteriorEm: amanha }, 'qualificada', comReagendar, AGORA_DO_CLIQUE).alvo?.id).toBe('mql2');
    });
  });
});

describe('lerPauta', () => {
  it('forma estranha é "não sei" (null), nunca lista vazia', () => {
    expect(lerPauta(null)).toBeNull();
    expect(lerPauta({ reunioes: 'x', funis: {} })).toBeNull();
    expect(lerPauta({ reunioes: [], funis: null })).toBeNull();
    expect(lerPauta({ reunioes: [{ origem: 'zoom', reuniaoId: 'r', inicio: '2026-09-29T14:00:00Z' }], funis: {} })).toBeNull();
    expect(lerPauta({ reunioes: [{ origem: 'calendly', reuniaoId: 'r', inicio: 'ontem' }], funis: {} })).toBeNull();
  });
  it('lê a pauta e os destinos; destino de forma estranha vira null (botão desligado)', () => {
    const lido = lerPauta({
      reunioes: [reuniao({})],
      funis: { banc: { qualificada: { id: 'mql2', nome: 'MQL 2' }, proposta: { id: 1 }, sem_proposta: null } },
    });
    expect(lido?.reunioes).toHaveLength(1);
    expect(lido?.funis.banc).toEqual({
      qualificada: { id: 'mql2', nome: 'MQL 2' },
      proposta: null,
      sem_proposta: null,
      reagendar: null,
      no_show: null,
    });
  });
  it('lê o destino do Reagendar', () => {
    const lido = lerPauta({
      reunioes: [],
      funis: { banc: { reagendar: { id: 'reag', nome: 'Reagendar' }, no_show: { id: 'noshow', nome: 'No Show' } } },
    });
    expect(lido?.funis.banc.reagendar).toEqual({ id: 'reag', nome: 'Reagendar' });
    expect(lido?.funis.banc.no_show).toEqual({ id: 'noshow', nome: 'No Show' });
  });
});

describe('linkDeReuniao', () => {
  it('só abre http(s) — o local da agenda pode ser um endereço', () => {
    expect(linkDeReuniao('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    expect(linkDeReuniao('http://exemplo.com/sala')).toBe('http://exemplo.com/sala');
    expect(linkDeReuniao('Escritório')).toBeNull();
    expect(linkDeReuniao('Rua das Flores, 10')).toBeNull();
    expect(linkDeReuniao('javascript:alert(1)')).toBeNull();
    expect(linkDeReuniao(null)).toBeNull();
  });
});
