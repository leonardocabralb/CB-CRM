import { describe, expect, it } from 'vitest';

import {
  FUSO_PADRAO,
  diaNoFuso,
  fusoValido,
  horaNoFuso,
  horaParaMinutos,
  minutosParaHora,
  paraInstante,
  partesNoFuso,
} from './fuso';

// ============================================================
// O teste que importa é o primeiro: 9h em Brasília tem de virar 12h UTC. Se
// esta suíte ficar verde com a conversão errada, a agenda inteira erra por três
// horas sem que nada estoure.
// ============================================================

describe('fusoValido', () => {
  it('aceita fusos IANA reais', () => {
    expect(fusoValido('America/Sao_Paulo')).toBe(true);
    expect(fusoValido('UTC')).toBe(true);
    expect(fusoValido('America/New_York')).toBe(true);
  });

  it('recusa nome inventado, vazio e só espaço', () => {
    expect(fusoValido('Mordor/Barad-dur')).toBe(false);
    expect(fusoValido('')).toBe(false);
    expect(fusoValido('   ')).toBe(false);
  });

  it('⚠️ recusa DESLOCAMENTO fixo, que o Intl aceitaria', () => {
    // `-03:00` não estoura no `Intl` — é válido desde o ES2022. Mas é uma
    // constante que não sabe horário de verão, e gravá-la no lugar do nome
    // IANA faria a agenda errar a hora em silêncio se as regras mudassem.
    expect(fusoValido('-03:00')).toBe(false);
    expect(fusoValido('+05:30')).toBe(false);
    expect(fusoValido('GMT-3')).toBe(false);
  });
});

describe('paraInstante', () => {
  it('9h em Brasília é 12h UTC', () => {
    const i = paraInstante('2026-09-01', '09:00', FUSO_PADRAO);
    expect(i.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });

  it('meia-noite em Brasília é 3h UTC do mesmo dia', () => {
    const i = paraInstante('2026-09-01', '00:00', FUSO_PADRAO);
    expect(i.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('⚠️ 22h em Brasília já é o DIA SEGUINTE em UTC', () => {
    // É o caso que quebra quem usa `toISOString().slice(0,10)` para achar o
    // dia: a reunião de segunda à noite apareceria na terça.
    const i = paraInstante('2026-09-01', '22:00', FUSO_PADRAO);
    expect(i.toISOString()).toBe('2026-09-02T01:00:00.000Z');
  });

  it('aceita hora com segundos, como a coluna `time` devolve', () => {
    const i = paraInstante('2026-09-01', '09:30:00', FUSO_PADRAO);
    expect(i.toISOString()).toBe('2026-09-01T12:30:00.000Z');
  });

  it('em UTC a conversão é identidade', () => {
    const i = paraInstante('2026-09-01', '09:00', 'UTC');
    expect(i.toISOString()).toBe('2026-09-01T09:00:00.000Z');
  });

  it('estoura em data ou hora malformada, em vez de devolver Invalid Date', () => {
    expect(() => paraInstante('ontem', '09:00', FUSO_PADRAO)).toThrow();
    expect(() => paraInstante('2026-09-01', 'de manhã', FUSO_PADRAO)).toThrow();
  });

  // ------------------------------------------------------------
  // Horário de verão. O Brasil não usa desde 2019, mas a segunda passada do
  // algoritmo existe por causa destes casos — e sem teste ninguém saberia que
  // ela é necessária.
  // ------------------------------------------------------------

  it('⚠️ atravessa a virada do horário de verão sem errar uma hora', () => {
    // Nova York adiantou o relógio em 8 de março de 2026, às 2h da manhã.
    // Antes: UTC-5. Depois: UTC-4.
    const antes = paraInstante('2026-03-07', '12:00', 'America/New_York');
    expect(antes.toISOString()).toBe('2026-03-07T17:00:00.000Z');

    const depois = paraInstante('2026-03-09', '12:00', 'America/New_York');
    expect(depois.toISOString()).toBe('2026-03-09T16:00:00.000Z');
  });

  it('meio-dia continua sendo meio-dia dos dois lados da virada', () => {
    // A prova de que a ida e a volta são coerentes: seja qual for o
    // deslocamento, quem marcou meio-dia lê meio-dia.
    for (const dia of ['2026-03-07', '2026-03-08', '2026-03-09']) {
      const i = paraInstante(dia, '12:00', 'America/New_York');
      expect(horaNoFuso(i, 'America/New_York')).toBe('12:00');
    }
  });
});

describe('partesNoFuso', () => {
  it('lê o instante no fuso pedido, não no de quem roda', () => {
    const i = new Date('2026-09-01T12:00:00.000Z');
    expect(partesNoFuso(i, FUSO_PADRAO)).toEqual({
      ano: 2026,
      mes: 9,
      dia: 1,
      hora: 9,
      minuto: 0,
      diaDaSemana: 2, // terça
    });
  });

  it('⚠️ o dia da semana é o do FUSO, não o de UTC', () => {
    // Sexta, 20h em Brasília — já é sábado em UTC (23h... não: 01h de sábado).
    // Uma faixa de atendimento de sexta deixaria de casar se lêssemos UTC.
    const sextaANoite = paraInstante('2026-09-04', '22:00', FUSO_PADRAO);
    expect(sextaANoite.getUTCDay()).toBe(6); // sábado, em UTC
    expect(partesNoFuso(sextaANoite, FUSO_PADRAO).diaDaSemana).toBe(5); // sexta
  });

  it('⚠️ meia-noite é hora 0, nunca 24', () => {
    // Algumas versões do ICU devolvem "24" com hour12:false. Sem o `% 24`,
    // nenhuma comparação de faixa reconheceria a hora.
    const meiaNoite = paraInstante('2026-09-01', '00:00', FUSO_PADRAO);
    expect(partesNoFuso(meiaNoite, FUSO_PADRAO).hora).toBe(0);
  });
});

describe('diaNoFuso e horaNoFuso', () => {
  it('devolvem o dia e a hora locais, com zero à esquerda', () => {
    const i = paraInstante('2026-09-05', '09:05', FUSO_PADRAO);
    expect(diaNoFuso(i, FUSO_PADRAO)).toBe('2026-09-05');
    expect(horaNoFuso(i, FUSO_PADRAO)).toBe('09:05');
  });

  it('⚠️ discordam de UTC quando a reunião é à noite', () => {
    const i = paraInstante('2026-09-01', '23:30', FUSO_PADRAO);
    expect(diaNoFuso(i, FUSO_PADRAO)).toBe('2026-09-01');
    expect(i.toISOString().slice(0, 10)).toBe('2026-09-02');
  });

  it('ida e volta preservam o horário original', () => {
    for (const hora of ['00:00', '07:30', '12:00', '18:45', '23:59']) {
      const i = paraInstante('2026-09-01', hora, FUSO_PADRAO);
      expect(horaNoFuso(i, FUSO_PADRAO)).toBe(hora);
    }
  });
});

describe('horaParaMinutos e minutosParaHora', () => {
  it('converte nos dois sentidos', () => {
    expect(horaParaMinutos('09:00')).toBe(540);
    expect(horaParaMinutos('00:00')).toBe(0);
    expect(horaParaMinutos('23:59')).toBe(1439);
    expect(minutosParaHora(540)).toBe('09:00');
    expect(minutosParaHora(0)).toBe('00:00');
    expect(minutosParaHora(1439)).toBe('23:59');
  });

  it('aceita o `HH:MM:SS` que a coluna `time` devolve', () => {
    expect(horaParaMinutos('09:00:00')).toBe(540);
    expect(horaParaMinutos('14:30:00')).toBe(870);
  });

  it('estoura em hora malformada', () => {
    expect(() => horaParaMinutos('meio-dia')).toThrow();
    expect(() => horaParaMinutos('')).toThrow();
  });
});
