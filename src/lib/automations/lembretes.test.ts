import { describe, expect, it } from 'vitest';

import {
  LARGURA_MS,
  deslocamentoEmMs,
  janelaDeBusca,
  larguraDaJanela,
  motivoDeConfigInvalida,
} from './lembretes';
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

// ============================================================
// Fonte "reunião" e deslocamento em minutos (migration 947).
// ============================================================

describe('deslocamento em minutos (947)', () => {
  it('soma horas e minutos', () => {
    expect(deslocamentoEmMs({ offset_hours: 1, offset_minutes: 30 })).toBe(
      90 * 60_000,
    )
  })

  it('aceita só minutos', () => {
    expect(deslocamentoEmMs({ offset_minutes: 10 })).toBe(10 * 60_000)
  })

  it('config antiga, só com horas, continua valendo', () => {
    expect(deslocamentoEmMs({ offset_hours: 24 })).toBe(24 * 3_600_000)
  })

  it('config vazia é zero, não NaN', () => {
    expect(deslocamentoEmMs({})).toBe(0)
    expect(deslocamentoEmMs({ offset_hours: NaN })).toBe(0)
  })
})

describe('⚠️ largura da janela x deslocamento curto (947)', () => {
  it('deslocamento longo mantém a guarda de 1 hora', () => {
    expect(larguraDaJanela({ offset_hours: 24 })).toBe(LARGURA_MS)
    expect(larguraDaJanela({ offset_hours: 4 })).toBe(LARGURA_MS)
  })

  it('⚠️ deslocamento de 10 min encolhe a janela para 10 min', () => {
    // Com a largura fixa de 1h, este gatilho aceitaria disparar até 50 minutos
    // DEPOIS de a reunião começar — a guarda contra atraso virando a causa do
    // atraso, e o cliente lendo "sua reunião é em 10 minutos" com ela em curso.
    expect(larguraDaJanela({ offset_minutes: 10 })).toBe(10 * 60_000)
  })

  it('a janela de um lembrete de 10 min nunca alcança o passado do alvo', () => {
    const agora = new Date('2026-09-02T12:00:00.000Z').getTime()
    const { de, ate } = janelaDeBusca(
      { offset_minutes: 10, direction: 'antes' },
      agora,
    )
    // O alvo é 12:10; a janela vai de 12:00 a 12:10 — nunca antes de agora.
    expect(ate).toBe('2026-09-02T12:10:00.000Z')
    expect(de).toBe('2026-09-02T12:00:00.000Z')
    expect(new Date(de).getTime()).toBeGreaterThanOrEqual(agora)
  })

  it('deslocamento zero não zera a janela', () => {
    // Sem o piso, a janela teria largura zero e nunca casaria com nada.
    expect(larguraDaJanela({ offset_hours: 0 })).toBe(LARGURA_MS)
  })
})

describe('validação com a fonte (947)', () => {
  it('⚠️ fonte "reuniao" NÃO exige campo de data', () => {
    // Exigir o campo aqui deixaria o gatilho novo permanentemente inválido.
    expect(
      motivoDeConfigInvalida({
        fonte: 'reuniao',
        offset_hours: 24,
        direction: 'antes',
      }),
    ).toBeNull()
  })

  it('fonte "campo" (e a ausente) continuam exigindo o campo', () => {
    expect(
      motivoDeConfigInvalida({ fonte: 'campo', offset_hours: 24, direction: 'antes' }),
    ).toMatch(/campo de data/)
    expect(
      motivoDeConfigInvalida({ offset_hours: 24, direction: 'antes' }),
    ).toMatch(/campo de data/)
  })

  it('recusa fonte desconhecida', () => {
    expect(
      motivoDeConfigInvalida({
        fonte: 'astrologia' as 'campo',
        offset_hours: 1,
        direction: 'antes',
      }),
    ).toMatch(/fonte/)
  })

  it('aceita só minutos, sem horas', () => {
    expect(
      motivoDeConfigInvalida({
        fonte: 'reuniao',
        offset_minutes: 10,
        direction: 'antes',
      }),
    ).toBeNull()
  })

  it('recusa minutos negativos e mantém o teto de um ano', () => {
    expect(
      motivoDeConfigInvalida({
        fonte: 'reuniao',
        offset_minutes: -5,
        direction: 'antes',
      }),
    ).toMatch(/inválido/)
    expect(
      motivoDeConfigInvalida({
        fonte: 'reuniao',
        offset_hours: 24 * 366,
        direction: 'antes',
      }),
    ).toMatch(/um ano/)
  })
})
