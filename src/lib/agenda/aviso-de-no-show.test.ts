import { describe, expect, it } from 'vitest';

import { avisoDeNoShow, lerAvisoDeNoShow, type EntradaNaEtapa, type ReuniaoDoAviso } from './aviso-de-no-show';

const AGORA = new Date('2026-09-27T15:00:00Z');

const reuniao = (inicio: string, extra: Partial<ReuniaoDoAviso> = {}): ReuniaoDoAviso => ({
  inicio,
  fim: new Date(Date.parse(inicio) + 30 * 60_000).toISOString(),
  desmarcada: false,
  desfecho: null,
  ...extra,
});

const entrada = (em: string, extra: Partial<EntradaNaEtapa> = {}): EntradaNaEtapa => ({
  em,
  etapa: 'Reunião Agendada',
  degrau: 'reuniao',
  desfecho: null,
  ...extra,
});

const NOVA = reuniao('2026-09-30T13:00:00Z');
const ANTIGA = reuniao('2026-09-15T13:00:00Z');
const NO_SHOW = entrada('2026-09-15T15:00:00Z', { etapa: 'No Show', desfecho: 'faltou' });

describe('avisoDeNoShow', () => {
  it('sem reunião futura não há aviso, por mais faltas que haja', () => {
    expect(avisoDeNoShow({ reunioes: [ANTIGA], entradas: [NO_SHOW], temValorNoCard: false, agora: AGORA })).toBeNull();
  });

  it('já passou por uma etapa "Faltou" e marcou de novo: avisa com a etapa e a data', () => {
    expect(avisoDeNoShow({ reunioes: [ANTIGA, NOVA], entradas: [NO_SHOW], temValorNoCard: false, agora: AGORA })).toEqual({
      motivo: 'faltou',
      em: NO_SHOW.em,
      etapa: 'No Show',
      proxima: { inicio: NOVA.inicio, fim: NOVA.fim },
    });
  });

  it('a falta vale mesmo depois de ter avançado ("movido para o no-show alguma outra vez")', () => {
    const proposta = entrada('2026-09-20T12:00:00Z', { etapa: 'Proposta Realizada', degrau: 'proposta' });
    const aviso = avisoDeNoShow({ reunioes: [NOVA], entradas: [NO_SHOW, proposta], temValorNoCard: true, agora: AGORA });
    expect(aviso?.motivo).toBe('faltou');
  });

  it('com várias faltas, cita a mais recente', () => {
    const outra = entrada('2026-08-01T15:00:00Z', { etapa: 'No Show', desfecho: 'faltou' });
    expect(avisoDeNoShow({ reunioes: [NOVA], entradas: [outra, NO_SHOW], temValorNoCard: false, agora: AGORA })).toMatchObject({
      em: NO_SHOW.em,
    });
  });

  it('a falta registrada na agenda do CRM também conta', () => {
    const faltou = reuniao('2026-09-10T13:00:00Z', { desfecho: 'faltou' });
    expect(avisoDeNoShow({ reunioes: [faltou, NOVA], entradas: [], temValorNoCard: false, agora: AGORA })).toEqual({
      motivo: 'faltou',
      em: faltou.inicio,
      etapa: null,
      proxima: { inicio: NOVA.inicio, fim: NOVA.fim },
    });
  });

  it('teve reunião, ela passou e o lead não avançou: sem_avanco, citando a mais recente', () => {
    const maisAntiga = reuniao('2026-09-01T13:00:00Z');
    expect(avisoDeNoShow({ reunioes: [maisAntiga, ANTIGA, NOVA], entradas: [entrada('2026-09-14T10:00:00Z')], temValorNoCard: false, agora: AGORA })).toEqual({
      motivo: 'sem_avanco',
      em: ANTIGA.inicio,
      proxima: { inicio: NOVA.inicio, fim: NOVA.fim },
    });
  });

  it.each([
    ['entrou numa etapa de proposta', { entradas: [entrada('2026-09-15T14:00:00Z', { etapa: 'Proposta Realizada', degrau: 'proposta' })] }],
    ['entrou numa etapa de contrato', { entradas: [entrada('2026-09-15T14:00:00Z', { degrau: 'contrato' })] }],
    ['entrou numa etapa de pasta', { entradas: [entrada('2026-09-15T14:00:00Z', { degrau: 'pasta' })] }],
    ['entrou numa etapa marcada "Compareceu"', { entradas: [entrada('2026-09-15T14:00:00Z', { etapa: 'Reunião Sem Proposta', desfecho: 'compareceu' })] }],
    ['tem card com valor', { temValorNoCard: true }],
  ])('não avisa quem avançou: %s', (_nome, extra) => {
    const base = { reunioes: [ANTIGA, NOVA], entradas: [] as EntradaNaEtapa[], temValorNoCard: false, agora: AGORA };
    expect(avisoDeNoShow({ ...base, ...extra })).toBeNull();
  });

  it('a agenda com a reunião "Realizada" também é avanço', () => {
    const realizada = reuniao('2026-09-15T13:00:00Z', { desfecho: 'compareceu' });
    expect(avisoDeNoShow({ reunioes: [realizada, NOVA], entradas: [], temValorNoCard: false, agora: AGORA })).toBeNull();
  });

  it('"Faltou" marcado numa etapa de proposta em diante NÃO é falta — ali houve proposta', () => {
    const proposta = entrada('2026-09-15T15:00:00Z', { etapa: 'Proposta Realizada', degrau: 'proposta', desfecho: 'faltou' });
    expect(avisoDeNoShow({ reunioes: [ANTIGA, NOVA], entradas: [proposta], temValorNoCard: false, agora: AGORA })).toBeNull();
  });

  it('MQL 2 (degrau reuniao) NÃO é avanço — ela acontece antes da reunião', () => {
    const mql2 = entrada('2026-09-15T08:00:00Z', { etapa: 'MQL 2 - Reunião Qualificada', degrau: 'reuniao' });
    expect(avisoDeNoShow({ reunioes: [ANTIGA, NOVA], entradas: [mql2], temValorNoCard: false, agora: AGORA })?.motivo).toBe('sem_avanco');
  });

  it('reunião cancelada ou reagendada não é "reunião que passou"', () => {
    const desmarcada = reuniao('2026-09-15T13:00:00Z', { desmarcada: true });
    expect(avisoDeNoShow({ reunioes: [desmarcada, NOVA], entradas: [], temValorNoCard: false, agora: AGORA })).toBeNull();
  });

  it('a primeira reunião do lead não avisa nada', () => {
    expect(avisoDeNoShow({ reunioes: [NOVA], entradas: [entrada('2026-09-27T12:00:00Z')], temValorNoCard: false, agora: AGORA })).toBeNull();
  });

  it('a nova reunião em andamento ainda conta como a próxima; depois do fim, o aviso some', () => {
    const emCurso = reuniao('2026-09-27T14:45:00Z');
    expect(avisoDeNoShow({ reunioes: [ANTIGA, emCurso], entradas: [NO_SHOW], temValorNoCard: false, agora: AGORA })?.proxima.inicio).toBe(emCurso.inicio);
    expect(avisoDeNoShow({ reunioes: [ANTIGA, emCurso], entradas: [NO_SHOW], temValorNoCard: false, agora: new Date('2026-09-27T15:16:00Z') })).toBeNull();
  });

  it('com duas futuras, a próxima é a mais cedo', () => {
    const depois = reuniao('2026-10-05T13:00:00Z');
    expect(avisoDeNoShow({ reunioes: [depois, NOVA], entradas: [NO_SHOW], temValorNoCard: false, agora: AGORA })?.proxima.inicio).toBe(NOVA.inicio);
  });
});

describe('lerAvisoDeNoShow', () => {
  const proxima = { inicio: '2026-09-30T13:00:00.000Z', fim: '2026-09-30T13:30:00.000Z' };

  it('lê os dois motivos que a rota devolve', () => {
    expect(lerAvisoDeNoShow({ aviso: { motivo: 'faltou', em: '2026-09-15T15:00:00Z', etapa: 'No Show', proxima } })).toEqual({
      motivo: 'faltou',
      em: '2026-09-15T15:00:00Z',
      etapa: 'No Show',
      proxima,
    });
    expect(lerAvisoDeNoShow({ aviso: { motivo: 'sem_avanco', em: '2026-09-15T13:00:00Z', proxima } })).toEqual({
      motivo: 'sem_avanco',
      em: '2026-09-15T13:00:00Z',
      proxima,
    });
  });

  it('sem aviso, ou com forma estranha, não há faixa', () => {
    expect(lerAvisoDeNoShow({ reunioes: [], aviso: null })).toBeNull();
    expect(lerAvisoDeNoShow(null)).toBeNull();
    expect(lerAvisoDeNoShow({ aviso: { motivo: 'talvez', em: '2026-09-15T13:00:00Z', proxima } })).toBeNull();
    expect(lerAvisoDeNoShow({ aviso: { motivo: 'faltou', em: 'ontem', proxima } })).toBeNull();
    expect(lerAvisoDeNoShow({ aviso: { motivo: 'faltou', em: '2026-09-15T13:00:00Z', proxima: { inicio: 'x' } } })).toBeNull();
  });

  it('a faixa ignora etapa que não é texto', () => {
    expect(lerAvisoDeNoShow({ aviso: { motivo: 'faltou', em: '2026-09-15T13:00:00Z', etapa: 7, proxima } })).toMatchObject({ etapa: null });
  });
});
