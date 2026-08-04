import { describe, expect, it } from 'vitest';

import { janelaDeBusca, motivoDeConfigInvalida, LARGURA_MS } from './lembretes';
import { paraEntradaLocal, deEntradaLocal } from '@/lib/contacts/campo-data';

// Uma quinta-feira qualquer, às 12h UTC.
const AGORA = new Date('2026-08-06T12:00:00.000Z').getTime();

describe('janelaDeBusca', () => {
  it('CRÍTICO: "24h antes" procura valores 24h À FRENTE de agora', () => {
    // O erro mais provável desta feature inteira é o sinal invertido — e ele
    // é silencioso: a confirmação de reunião chegaria 24h DEPOIS dela.
    const j = janelaDeBusca(
      { custom_field_id: 'f1', offset_hours: 24, direction: 'antes' },
      AGORA,
    );
    expect(j.ate).toBe('2026-08-07T12:00:00.000Z');
    expect(j.de).toBe('2026-08-07T11:00:00.000Z');
  });

  it('"2h depois" procura valores 2h ATRÁS de agora', () => {
    // Follow-up: "2 horas depois da reunião, pergunte como foi".
    const j = janelaDeBusca(
      { custom_field_id: 'f1', offset_hours: 2, direction: 'depois' },
      AGORA,
    );
    expect(j.ate).toBe('2026-08-06T10:00:00.000Z');
    expect(j.de).toBe('2026-08-06T09:00:00.000Z');
  });

  it('deslocamento zero é "na hora exata"', () => {
    const j = janelaDeBusca(
      { custom_field_id: 'f1', offset_hours: 0, direction: 'antes' },
      AGORA,
    );
    expect(j.ate).toBe('2026-08-06T12:00:00.000Z');
  });

  it('a janela tem exatamente a largura da guarda de atraso', () => {
    // É ela que impede o agendador religado de manhã de despejar os lembretes
    // da noite inteira de uma vez.
    const j = janelaDeBusca(
      { custom_field_id: 'f1', offset_hours: 24, direction: 'antes' },
      AGORA,
    );
    expect(new Date(j.ate).getTime() - new Date(j.de).getTime()).toBe(LARGURA_MS);
  });

  it('deslocamento não numérico não explode a janela', () => {
    const j = janelaDeBusca(
      { custom_field_id: 'f1', offset_hours: NaN, direction: 'antes' },
      AGORA,
    );
    expect(j.ate).toBe('2026-08-06T12:00:00.000Z');
  });
});

describe('motivoDeConfigInvalida', () => {
  it('config completa passa', () => {
    expect(
      motivoDeConfigInvalida({
        custom_field_id: 'f1',
        offset_hours: 24,
        direction: 'antes',
      }),
    ).toBeNull();
  });

  it('sem campo de data não há alvo nem instante', () => {
    expect(motivoDeConfigInvalida({ offset_hours: 24, direction: 'antes' })).toContain(
      'campo de data',
    );
  });

  it('deslocamento negativo é recusado — a direção já é quem dá o sinal', () => {
    expect(
      motivoDeConfigInvalida({
        custom_field_id: 'f1',
        offset_hours: -5,
        direction: 'antes',
      }),
    ).toContain('inválido');
  });

  it('deslocamento absurdo é recusado (zero a mais na digitação)', () => {
    expect(
      motivoDeConfigInvalida({
        custom_field_id: 'f1',
        offset_hours: 24 * 400,
        direction: 'antes',
      }),
    ).toContain('um ano');
  });

  it('direção inválida é recusada', () => {
    expect(
      motivoDeConfigInvalida({
        custom_field_id: 'f1',
        offset_hours: 24,
        direction: 'quando der' as never,
      }),
    ).toContain('direção');
  });
});

// ------------------------------------------------------------
// Fuso do campo de data.
//
// O contêiner roda em UTC e quem digita está em Brasília. Sem estas duas
// conversões, todo lembrete erraria por 3 horas — sem erro nenhum, só
// chegando na hora errada.
// ------------------------------------------------------------

describe('campo de data — ida e volta', () => {
  it('CRÍTICO: o que sai do input volta igual pelo banco', () => {
    // A propriedade que importa: gravar e reler não pode deslocar a hora.
    const digitado = '2026-08-06T14:30';
    const noBanco = deEntradaLocal(digitado);
    expect(paraEntradaLocal(noBanco)).toBe(digitado);
  });

  it('o banco recebe ISO absoluto, com fuso', () => {
    const iso = deEntradaLocal('2026-08-06T14:30');
    // Termina em Z: é instante, não "14:30 em algum lugar".
    expect(iso.endsWith('Z')).toBe(true);
    expect(new Date(iso).getTime()).toBe(
      new Date('2026-08-06T14:30').getTime(),
    );
  });

  it('texto que não é data devolve vazio, não quebra a ficha', () => {
    // O campo é TEXT livre e pode ter qualquer coisa escrita antes de virar
    // data — exatamente o caso que `cb_para_timestamp` também tolera.
    expect(paraEntradaLocal('amanhã de tarde')).toBe('');
    expect(paraEntradaLocal(null)).toBe('');
    expect(deEntradaLocal('')).toBe('');
  });
});
