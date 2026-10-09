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

// D2 de docs/PLANO-reagendamento.md (09/10/2026): a reunião que terminou em
// Reagendar não aconteceu — não é "reunião anterior" nem falta.
describe('avisoDeNoShow — Reagendar (1081)', () => {
  const REAGENDAR = { etapa: 'Reagendar', desfecho: 'reagendar' as const };
  const base = { entradas: [] as EntradaNaEtapa[], temValorNoCard: false, agora: AGORA };

  it('a reunião reagendada pelo marco da pauta sai do sem_avanco', () => {
    expect(avisoDeNoShow({ ...base, reunioes: [reuniao(ANTIGA.inicio, { reagendada: true }), NOVA] })).toBeNull();
  });

  it('a entrada em "Reagendar" depois do AGENDAMENTO da reunião seguinte é dela, não da anterior (revisão do PR #395)', () => {
    // Z terminou sem avanço; A agendada em 30/09 para 02/10 e reagendada em
    // 01/10 (o card entrou em Reagendar antes do início da A); B em 10/10.
    const z = reuniao('2026-09-29T14:00:00Z', { fim: '2026-09-29T14:30:00Z', agendadaEm: '2026-09-25T10:00:00Z' });
    const a = reuniao('2026-10-02T14:00:00Z', { fim: '2026-10-02T14:30:00Z', agendadaEm: '2026-09-30T10:00:00Z', reagendada: true });
    const b = reuniao('2026-10-10T14:00:00Z', { fim: '2026-10-10T14:30:00Z', agendadaEm: '2026-10-05T10:00:00Z' });
    const depois = new Date('2026-10-06T10:00:00Z');
    expect(
      avisoDeNoShow({ ...base, agora: depois, reunioes: [z, a, b], entradas: [entrada('2026-10-01T12:00:01Z', REAGENDAR)] }),
    ).toEqual({ motivo: 'sem_avanco', em: z.inicio, proxima: { inicio: b.inicio, fim: b.fim } });
    // Antes do agendamento da A, a mesma entrada ainda é da Z.
    expect(
      avisoDeNoShow({ ...base, agora: depois, reunioes: [z, a, b], entradas: [entrada('2026-09-29T20:00:00Z', REAGENDAR)] }),
    ).toBeNull();
  });

  it('a FUTURA reagendada pelo marco não é "a próxima": a faixa cita a seguinte, ou some sem outra', () => {
    const faltou = [entrada('2026-09-15T14:00:00Z', { etapa: 'No Show', desfecho: 'faltou' })];
    const morta = reuniao(NOVA.inicio, { fim: NOVA.fim, reagendada: true });
    const depois = reuniao('2026-10-20T13:00:00Z');
    expect(avisoDeNoShow({ ...base, entradas: faltou, reunioes: [ANTIGA, morta, depois] })?.proxima).toEqual({
      inicio: depois.inicio,
      fim: depois.fim,
    });
    expect(avisoDeNoShow({ ...base, entradas: faltou, reunioes: [ANTIGA, morta] })).toBeNull();
  });

  it('sem o marco, a mesma reunião continua contando (controle)', () => {
    expect(avisoDeNoShow({ ...base, reunioes: [reuniao(ANTIGA.inicio, { reagendada: false }), NOVA] })?.motivo).toBe('sem_avanco');
  });

  it('com outra reunião anterior de pé, o sem_avanco cita ESSA, nunca a reagendada', () => {
    const maisAntiga = reuniao('2026-09-01T13:00:00Z');
    expect(
      avisoDeNoShow({ ...base, reunioes: [maisAntiga, reuniao(ANTIGA.inicio, { reagendada: true }), NOVA] }),
    ).toEqual({ motivo: 'sem_avanco', em: maisAntiga.inicio, proxima: { inicio: NOVA.inicio, fim: NOVA.fim } });
  });

  it('a entrada numa etapa "Reagendar" dentro da janela da reunião a tira do sem_avanco', () => {
    // Janela [início da ANTIGA, início da NOVA — futura]: no instante do início
    // e dias depois (a equipe moveu o card bem mais tarde).
    for (const em of [ANTIGA.inicio, '2026-09-27T14:00:00Z']) {
      expect(avisoDeNoShow({ ...base, reunioes: [ANTIGA, NOVA], entradas: [entrada(em, REAGENDAR)] })).toBeNull();
    }
  });

  it('a entrada ANTES do início da reunião não a tira (o quadro antes da hora não resolve a reunião)', () => {
    const antes = entrada('2026-09-15T12:59:00Z', REAGENDAR);
    expect(avisoDeNoShow({ ...base, reunioes: [ANTIGA, NOVA], entradas: [antes] })?.motivo).toBe('sem_avanco');
  });

  it('a janela fecha no início da próxima reunião válida, mesmo que ela também já tenha passado', () => {
    const segunda = reuniao('2026-09-20T13:00:00Z');
    // Reagendou a SEGUNDA (no início dela ou depois): a ANTIGA continua contando.
    for (const em of [segunda.inicio, '2026-09-20T13:10:00Z']) {
      expect(avisoDeNoShow({ ...base, reunioes: [ANTIGA, segunda, NOVA], entradas: [entrada(em, REAGENDAR)] })).toMatchObject({
        motivo: 'sem_avanco',
        em: ANTIGA.inicio,
      });
    }
    // Reagendou as duas: não sobra reunião anterior.
    const ambas = [entrada('2026-09-15T13:10:00Z', REAGENDAR), entrada('2026-09-20T13:10:00Z', REAGENDAR)];
    expect(avisoDeNoShow({ ...base, reunioes: [ANTIGA, segunda, NOVA], entradas: ambas })).toBeNull();
  });

  it('reunião desmarcada não fecha a janela da anterior', () => {
    const cancelada = reuniao('2026-09-18T13:00:00Z', { desmarcada: true });
    const reagendou = entrada('2026-09-19T10:00:00Z', REAGENDAR);
    expect(avisoDeNoShow({ ...base, reunioes: [ANTIGA, cancelada, NOVA], entradas: [reagendou] })).toBeNull();
  });

  it('"Reagendar" marcado numa etapa de proposta em diante não vale como reagendar — mas ali já houve avanço', () => {
    const proposta = entrada('2026-09-15T14:00:00Z', { etapa: 'Proposta Realizada', degrau: 'proposta', desfecho: 'reagendar' });
    expect(avisoDeNoShow({ ...base, reunioes: [ANTIGA, NOVA], entradas: [proposta] })).toBeNull();
  });

  it('a falta continua vencendo, mesmo com a reunião reagendada', () => {
    expect(
      avisoDeNoShow({ ...base, reunioes: [reuniao(ANTIGA.inicio, { reagendada: true }), NOVA], entradas: [NO_SHOW, entrada('2026-09-15T13:10:00Z', REAGENDAR)] }),
    ).toMatchObject({ motivo: 'faltou', em: NO_SHOW.em, etapa: 'No Show' });
  });

  it('Reagendar nunca vira "faltou"', () => {
    const reagendou = entrada('2026-09-15T13:10:00Z', REAGENDAR);
    expect(avisoDeNoShow({ ...base, reunioes: [ANTIGA, NOVA], entradas: [reagendou] })).toBeNull();
    // Sem a reunião anterior (só a futura), também nada: a entrada sozinha não é falta.
    expect(avisoDeNoShow({ ...base, reunioes: [NOVA], entradas: [reagendou] })).toBeNull();
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
