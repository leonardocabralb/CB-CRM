import { describe, expect, it } from 'vitest';

import { instanteValido, validarFaixa, validarReuniao } from './validar';

const OK = {
  titulo: 'Reunião de onboarding',
  tipo: 'onboarding',
  starts_at: '2026-09-02T12:00:00.000Z',
  ends_at: '2026-09-02T13:00:00.000Z',
};

describe('instanteValido', () => {
  it('aceita ISO com Z e com deslocamento', () => {
    expect(instanteValido('2026-09-02T12:00:00.000Z')).toBe(true);
    expect(instanteValido('2026-09-02T09:00:00-03:00')).toBe(true);
    expect(instanteValido('2026-09-02T09:00:00-0300')).toBe(true);
  });

  it('⚠️ recusa data SEM fuso', () => {
    // É o caso perigoso: o Postgres leria "14:00" como 14h UTC, e a reunião
    // aconteceria às 11h para quem marcou. Sem erro nenhum no caminho.
    expect(instanteValido('2026-09-02T14:00:00')).toBe(false);
    expect(instanteValido('2026-09-02')).toBe(false);
  });

  it('recusa lixo e tipo errado', () => {
    expect(instanteValido('amanhã de tarde')).toBe(false);
    expect(instanteValido('')).toBe(false);
    expect(instanteValido(null)).toBe(false);
    expect(instanteValido(12345)).toBe(false);
  });
});

describe('validarReuniao — criação', () => {
  it('aceita o caso comum', () => {
    expect(validarReuniao(OK)).toBeNull();
  });

  it('exige título', () => {
    expect(validarReuniao({ ...OK, titulo: '' })).toMatch(/título/i);
    expect(validarReuniao({ ...OK, titulo: '   ' })).toMatch(/título/i);
    expect(validarReuniao({ ...OK, titulo: undefined })).toMatch(/título/i);
  });

  it('recusa título longo demais', () => {
    expect(validarReuniao({ ...OK, titulo: 'a'.repeat(201) })).toMatch(/título/i);
  });

  it('recusa tipo e situação desconhecidos', () => {
    expect(validarReuniao({ ...OK, tipo: 'almoço' })).toMatch(/tipo/i);
    expect(validarReuniao({ ...OK, status: 'talvez' })).toMatch(/situação/i);
  });

  it('⚠️ recusa término antes ou igual ao início', () => {
    expect(
      validarReuniao({ ...OK, ends_at: '2026-09-02T11:00:00.000Z' }),
    ).toMatch(/terminar depois/i);
    expect(
      validarReuniao({ ...OK, ends_at: OK.starts_at }),
    ).toMatch(/terminar depois/i);
  });

  it('recusa reunião mais longa que o teto', () => {
    expect(
      validarReuniao({ ...OK, ends_at: '2026-09-05T12:00:00.000Z' }),
    ).toMatch(/24 horas/);
  });

  it('recusa data sem fuso', () => {
    expect(validarReuniao({ ...OK, starts_at: '2026-09-02T09:00:00' })).toMatch(
      /fuso/i,
    );
  });
});

describe('validarReuniao — edição parcial', () => {
  it('deixa passar o corpo que só muda o título', () => {
    expect(validarReuniao({ titulo: 'Novo nome' }, { parcial: true })).toBeNull();
  });

  it('deixa passar o corpo que só muda a situação', () => {
    expect(validarReuniao({ status: 'realizada' }, { parcial: true })).toBeNull();
  });

  it('mas ainda recusa o que veio errado', () => {
    expect(validarReuniao({ titulo: '' }, { parcial: true })).toMatch(/título/i);
    expect(validarReuniao({ status: 'talvez' }, { parcial: true })).toMatch(
      /situação/i,
    );
  });

  it('⚠️ ao mover, cobra o PAR de datas', () => {
    // Mandar só `starts_at` deixaria a comparação sem com o que comparar. Quem
    // chama tem de completar o par a partir da linha atual.
    expect(validarReuniao({ starts_at: OK.starts_at }, { parcial: true })).toMatch(
      /término/i,
    );
    expect(
      validarReuniao(
        { starts_at: OK.starts_at, ends_at: OK.ends_at },
        { parcial: true },
      ),
    ).toBeNull();
  });
});

describe('validarFaixa', () => {
  const FAIXA = {
    dia_da_semana: 3,
    hora_inicio: '09:00',
    hora_fim: '12:00',
    timezone: 'America/Sao_Paulo',
    duracao_minutos: 60,
  };

  it('aceita o caso comum e o `HH:MM:SS` do banco', () => {
    expect(validarFaixa(FAIXA)).toBeNull();
    expect(
      validarFaixa({ ...FAIXA, hora_inicio: '09:00:00', hora_fim: '12:00:00' }),
    ).toBeNull();
  });

  it('recusa dia da semana fora de 0–6', () => {
    expect(validarFaixa({ ...FAIXA, dia_da_semana: 7 })).toMatch(/dia/i);
    expect(validarFaixa({ ...FAIXA, dia_da_semana: -1 })).toMatch(/dia/i);
    expect(validarFaixa({ ...FAIXA, dia_da_semana: 2.5 })).toMatch(/dia/i);
  });

  it('recusa faixa que termina antes de começar', () => {
    expect(validarFaixa({ ...FAIXA, hora_fim: '08:00' })).toMatch(
      /terminar depois/i,
    );
  });

  it('⚠️ recusa fuso desconhecido — o banco não valida isto', () => {
    expect(validarFaixa({ ...FAIXA, timezone: 'Mordor/Barad-dur' })).toMatch(
      /fuso/i,
    );
    expect(validarFaixa({ ...FAIXA, timezone: '-03:00' })).toMatch(/fuso/i);
  });

  it('recusa duração zero, negativa ou maior que um dia', () => {
    expect(validarFaixa({ ...FAIXA, duracao_minutos: 0 })).toMatch(/duração/i);
    expect(validarFaixa({ ...FAIXA, duracao_minutos: -30 })).toMatch(/duração/i);
    expect(validarFaixa({ ...FAIXA, duracao_minutos: 1441 })).toMatch(/duração/i);
  });
});
