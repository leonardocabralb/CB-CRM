import { describe, expect, it } from 'vitest';

import {
  alvosDoFunil,
  comoMarcar,
  faltouAntes,
  faseDaReuniao,
  lerPauta,
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

const entrada = (em: string, etapaId: string, por: string | null = 'Ana', dealId: string | null = 'd1'): EntradaDaTrilha => ({
  em,
  dealId,
  etapaId,
  etapa: POR_ID.get(etapaId)?.nome ?? null,
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
    for (const marca of ['compareceu', 'faltou', 'qualificada'] as const) {
      expect(resultadoDaEtapa({ degrau: 'proposta', marca })).toBe('proposta');
      expect(resultadoDaEtapa({ degrau: 'contrato', marca })).toBe('proposta');
    }
  });
});

describe('alvosDoFunil', () => {
  it('cada botão leva à etapa MARCADA do funil do card, nunca de outro funil', () => {
    expect(alvosDoFunil(ETAPAS, 'banc')).toEqual({
      qualificada: { id: 'mql2', nome: 'MQL 2 - Reunião Qualificada' },
      proposta: { id: 'prop', nome: 'Proposta Realizada' },
      sem_proposta: { id: 'semprop', nome: 'Reunião Sem Proposta' },
      no_show: { id: 'noshow', nome: 'No Show' },
    });
    const trab = alvosDoFunil(ETAPAS, 'trab');
    expect(trab.proposta).toEqual({ id: 'outro-prop', nome: 'Proposta' });
    expect(trab.qualificada).toBeNull();
    expect(trab.no_show).toBeNull();
  });
  it('duas etapas com a mesma marca: vale a de menor posição', () => {
    const etapas = [
      ...ETAPAS,
      { id: 'noshow2', pipelineId: 'banc', nome: 'No Show 2', posicao: 1, degrau: null, marca: 'faltou' as const },
    ];
    expect(alvosDoFunil(etapas, 'banc').no_show?.id).toBe('noshow2');
  });
  it('marcação numa etapa de proposta em diante não vira destino de botão', () => {
    // Só a Proposta Realizada marcada (sem a Reunião Sem Proposta): o botão
    // "Sem proposta" levaria o card para a proposta.
    const etapas: EtapaDoFunil[] = [
      { id: 'agendada', pipelineId: 'x', nome: 'Reunião Agendada', posicao: 0, degrau: 'reuniao', marca: null },
      { id: 'prop', pipelineId: 'x', nome: 'Proposta Realizada', posicao: 1, degrau: 'proposta', marca: 'compareceu' },
      { id: 'contrato', pipelineId: 'x', nome: 'Contrato', posicao: 2, degrau: 'contrato', marca: 'faltou' },
      { id: 'pasta', pipelineId: 'x', nome: 'Pasta', posicao: 3, degrau: 'pasta', marca: 'qualificada' },
    ];
    expect(alvosDoFunil(etapas, 'x')).toEqual({
      qualificada: null,
      proposta: { id: 'prop', nome: 'Proposta Realizada' },
      sem_proposta: null,
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
});

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
    proximaEm: null,
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
    expect(comoMarcar({ negocio: { ...n, status: 'open' }, proximaEm: null }, 'no_show', alvos)).toEqual({
      alvo: { id: 'noshow', nome: 'No Show' },
      motivo: null,
    });
  });

  it('sem card, card ganho ou PERDIDO: só registra (o perdido reabriria pela 1031)', () => {
    expect(comoMarcar({ negocio: null, proximaEm: null }, 'no_show', alvos)).toEqual({ alvo: null, motivo: 'sem_card' });
    expect(comoMarcar({ negocio: { ...n, status: 'won' }, proximaEm: null }, 'no_show', alvos).motivo).toBe('card_fechado');
    expect(comoMarcar({ negocio: { ...n, status: 'lost' }, proximaEm: null }, 'no_show', alvos).motivo).toBe('card_fechado');
  });

  it('com reunião POSTERIOR do contato, o resultado só registra (o card é da seguinte); a qualificação ainda move', () => {
    const r = { negocio: { ...n, status: 'open' as const }, proximaEm: '2026-10-02T14:00:00Z' };
    expect(comoMarcar(r, 'no_show', alvos).motivo).toBe('reuniao_posterior');
    expect(comoMarcar(r, 'qualificada', alvos).alvo?.id).toBe('mql2');
  });

  it('funil sem a etapa marcada: só registra', () => {
    const semMql = alvosDoFunil(ETAPAS.filter((e) => e.id !== 'mql2'), 'banc');
    expect(comoMarcar({ negocio: { ...n, status: 'open' }, proximaEm: null }, 'qualificada', semMql).motivo).toBe('sem_etapa');
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
    expect(lido?.funis.banc).toEqual({ qualificada: { id: 'mql2', nome: 'MQL 2' }, proposta: null, sem_proposta: null, no_show: null });
  });
});
