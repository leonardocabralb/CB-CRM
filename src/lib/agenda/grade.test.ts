import { describe, expect, it } from 'vitest';

import { FUSO_PADRAO } from './fuso';
import {
  diaDaReuniao,
  diaDaSemana,
  diasNoMes,
  gradeDaSemana,
  gradeDoMes,
  horaDaReuniao,
  inicioDaSemana,
  inicioDoMes,
  navegar,
  periodoDaVisao,
  somarDias,
} from './grade';

const HOJE = '2026-09-15';

describe('somarDias', () => {
  it('soma e subtrai dentro do mês', () => {
    expect(somarDias('2026-09-10', 5)).toBe('2026-09-15');
    expect(somarDias('2026-09-10', -5)).toBe('2026-09-05');
  });

  it('atravessa a virada de mês e de ano', () => {
    expect(somarDias('2026-09-30', 1)).toBe('2026-10-01');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('acerta o ano bissexto', () => {
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(somarDias('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('diaDaSemana e inicioDaSemana', () => {
  it('lê o dia da semana', () => {
    expect(diaDaSemana('2026-09-15')).toBe(2); // terça
    expect(diaDaSemana('2026-09-13')).toBe(0); // domingo
  });

  it('recua até o domingo — e não move quando já é domingo', () => {
    expect(inicioDaSemana('2026-09-15')).toBe('2026-09-13');
    expect(inicioDaSemana('2026-09-13')).toBe('2026-09-13');
  });

  it('atravessa a virada de mês para trás', () => {
    // 1º de outubro de 2026 é quinta; a semana começou em 27 de setembro.
    expect(inicioDaSemana('2026-10-01')).toBe('2026-09-27');
  });
});

describe('diasNoMes', () => {
  it('conta certo, inclusive fevereiro', () => {
    expect(diasNoMes('2026-09-01')).toBe(30);
    expect(diasNoMes('2026-10-01')).toBe(31);
    expect(diasNoMes('2026-02-01')).toBe(28);
    expect(diasNoMes('2028-02-01')).toBe(29);
  });
});

describe('gradeDoMes', () => {
  it('⚠️ tem sempre 42 dias, para a grade não pular de altura', () => {
    for (const mes of ['2026-02-01', '2026-09-01', '2026-08-01']) {
      expect(gradeDoMes(mes, HOJE)).toHaveLength(42);
    }
  });

  it('começa num domingo e termina num sábado', () => {
    const grade = gradeDoMes('2026-09-01', HOJE);
    expect(diaDaSemana(grade[0].dia)).toBe(0);
    expect(diaDaSemana(grade[41].dia)).toBe(6);
  });

  it('cobre o mês inteiro, sem buraco nem repetição', () => {
    const grade = gradeDoMes('2026-09-01', HOJE);
    const doMes = grade.filter((d) => d.doMesAtual).map((d) => d.dia);
    expect(doMes).toHaveLength(30);
    expect(doMes[0]).toBe('2026-09-01');
    expect(doMes[29]).toBe('2026-09-30');
    expect(new Set(grade.map((d) => d.dia)).size).toBe(42);
  });

  it('marca os dias de mês vizinho', () => {
    const grade = gradeDoMes('2026-09-01', HOJE);
    // 1º de setembro de 2026 é terça, então a grade abre em 30 de agosto.
    expect(grade[0].dia).toBe('2026-08-30');
    expect(grade[0].doMesAtual).toBe(false);
  });

  it('⚠️ mês que começa no domingo não ganha semana vazia na frente', () => {
    // Fevereiro de 2026 começa num domingo.
    const grade = gradeDoMes('2026-02-01', HOJE);
    expect(grade[0].dia).toBe('2026-02-01');
    expect(grade[0].doMesAtual).toBe(true);
  });

  it('marca hoje uma única vez', () => {
    const grade = gradeDoMes('2026-09-01', HOJE);
    expect(grade.filter((d) => d.ehHoje)).toHaveLength(1);
    expect(grade.find((d) => d.ehHoje)?.dia).toBe(HOJE);
  });

  it('não marca hoje quando ele está fora do mês desenhado', () => {
    expect(gradeDoMes('2027-05-01', HOJE).some((d) => d.ehHoje)).toBe(false);
  });
});

describe('gradeDaSemana', () => {
  it('devolve 7 dias, de domingo a sábado', () => {
    const semana = gradeDaSemana('2026-09-15', HOJE);
    expect(semana).toHaveLength(7);
    expect(semana[0].dia).toBe('2026-09-13');
    expect(semana[6].dia).toBe('2026-09-19');
  });

  it('atravessa a virada de mês', () => {
    const semana = gradeDaSemana('2026-10-01', HOJE);
    expect(semana[0].dia).toBe('2026-09-27');
    expect(semana[6].dia).toBe('2026-10-03');
  });
});

describe('navegar', () => {
  it('anda um dia por vez na visão de dia', () => {
    expect(navegar('dia', '2026-09-15', 1)).toBe('2026-09-16');
    expect(navegar('dia', '2026-09-15', -1)).toBe('2026-09-14');
  });

  it('anda sete dias na visão de semana', () => {
    expect(navegar('semana', '2026-09-15', 1)).toBe('2026-09-22');
    expect(navegar('semana', '2026-09-15', -1)).toBe('2026-09-08');
  });

  it('⚠️ no mês, ancora no dia 1 em vez de somar 30 dias', () => {
    // Somar 30 dias a 31 de janeiro cairia em 2 de março, pulando fevereiro.
    expect(navegar('mes', '2026-01-31', 1)).toBe('2026-02-01');
    expect(navegar('mes', '2026-03-31', -1)).toBe('2026-02-01');
  });

  it('atravessa a virada de ano', () => {
    expect(navegar('mes', '2026-12-10', 1)).toBe('2027-01-01');
    expect(navegar('mes', '2026-01-10', -1)).toBe('2025-12-01');
  });
});

describe('periodoDaVisao', () => {
  it('⚠️ o mês cobre os dias de mês vizinho que a grade desenha', () => {
    const { de, ate } = periodoDaVisao('mes', '2026-09-15', FUSO_PADRAO);
    // A grade de setembro abre em 30 de agosto — o período tem de alcançá-lo,
    // senão a célula aparece desenhada e vazia.
    expect(diaDaReuniao(de.toISOString(), FUSO_PADRAO)).toBe('2026-08-30');
    expect(diaDaReuniao(ate.toISOString(), FUSO_PADRAO)).toBe('2026-10-10');
  });

  it('a semana cobre exatamente sete dias', () => {
    const { de, ate } = periodoDaVisao('semana', '2026-09-15', FUSO_PADRAO);
    expect(diaDaReuniao(de.toISOString(), FUSO_PADRAO)).toBe('2026-09-13');
    expect(diaDaReuniao(ate.toISOString(), FUSO_PADRAO)).toBe('2026-09-19');
  });

  it('o dia cobre só ele', () => {
    const { de, ate } = periodoDaVisao('dia', '2026-09-15', FUSO_PADRAO);
    expect(diaDaReuniao(de.toISOString(), FUSO_PADRAO)).toBe('2026-09-15');
    expect(diaDaReuniao(ate.toISOString(), FUSO_PADRAO)).toBe('2026-09-15');
  });

  it('⚠️ o período começa à meia-noite LOCAL, não à meia-noite UTC', () => {
    const { de } = periodoDaVisao('dia', '2026-09-15', FUSO_PADRAO);
    // Meia-noite em Brasília é 3h UTC.
    expect(de.toISOString()).toBe('2026-09-15T03:00:00.000Z');
  });
});

describe('diaDaReuniao e horaDaReuniao', () => {
  it('põem a reunião no dia e hora locais', () => {
    const noite = '2026-09-15T23:30:00.000Z'; // 20h30 em Brasília
    expect(diaDaReuniao(noite, FUSO_PADRAO)).toBe('2026-09-15');
    expect(horaDaReuniao(noite, FUSO_PADRAO)).toBe('20:30');
  });

  it('⚠️ a reunião da noite não escorrega para o dia seguinte', () => {
    // 22h em Brasília é 01h do dia seguinte em UTC. Ler UTC desenharia a
    // reunião na célula errada da grade.
    const tarde = '2026-09-16T01:00:00.000Z';
    expect(diaDaReuniao(tarde, FUSO_PADRAO)).toBe('2026-09-15');
    expect(horaDaReuniao(tarde, FUSO_PADRAO)).toBe('22:00');
  });
});

describe('inicioDoMes', () => {
  it('ancora no dia 1', () => {
    expect(inicioDoMes('2026-09-15')).toBe('2026-09-01');
    expect(inicioDoMes('2026-09-01')).toBe('2026-09-01');
  });
});
