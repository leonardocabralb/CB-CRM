import { describe, expect, it } from 'vitest';

import type { Availability } from '@/types';

import { FUSO_PADRAO, horaNoFuso } from './fuso';
import {
  agruparVagasPorDia,
  calcularVagas,
  seSobrepoem,
  type Intervalo,
} from './vagas';

// ============================================================
// O "agora" de referência: terça, 1º de setembro de 2026, 8h em Brasília.
// Fixo porque vaga depende de tempo, e teste que depende do relógio da máquina
// passa hoje e falha amanhã de madrugada.
// ============================================================
const AGORA = new Date('2026-09-01T11:00:00.000Z'); // 8h em Brasília

function faixa(over: Partial<Availability> = {}): Availability {
  return {
    id: 'f1',
    account_id: 'conta',
    user_id: 'advogado',
    dia_da_semana: 3, // quarta
    hora_inicio: '09:00:00',
    hora_fim: '12:00:00',
    timezone: FUSO_PADRAO,
    duracao_minutos: 60,
    intervalo_minutos: 0,
    antecedencia_minima_horas: 0,
    janela_maxima_dias: 60,
    ativo: true,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

/** Período: os próximos 7 dias a partir do AGORA. */
const DE = new Date('2026-09-01T00:00:00.000Z');
const ATE = new Date('2026-09-08T23:59:59.000Z');

function horarios(vagas: Intervalo[]): string[] {
  return vagas.map((v) => horaNoFuso(v.inicio, FUSO_PADRAO));
}

describe('seSobrepoem', () => {
  const nove = {
    inicio: new Date('2026-09-02T12:00:00Z'),
    fim: new Date('2026-09-02T13:00:00Z'),
  };

  it('⚠️ intervalos encostados NÃO se sobrepõem', () => {
    // 9h–10h e 10h–11h são consecutivos, não conflitantes. É a regra `[)` que a
    // restrição do banco usa; divergir aqui faria a tela recusar horário que o
    // banco aceita.
    const dez = {
      inicio: new Date('2026-09-02T13:00:00Z'),
      fim: new Date('2026-09-02T14:00:00Z'),
    };
    expect(seSobrepoem(nove, dez)).toBe(false);
  });

  it('detecta cruzamento parcial nos dois sentidos', () => {
    const meio = {
      inicio: new Date('2026-09-02T12:30:00Z'),
      fim: new Date('2026-09-02T13:30:00Z'),
    };
    expect(seSobrepoem(nove, meio)).toBe(true);
    expect(seSobrepoem(meio, nove)).toBe(true);
  });

  it('detecta contido e idêntico', () => {
    const dentro = {
      inicio: new Date('2026-09-02T12:15:00Z'),
      fim: new Date('2026-09-02T12:45:00Z'),
    };
    expect(seSobrepoem(nove, dentro)).toBe(true);
    expect(seSobrepoem(nove, nove)).toBe(true);
  });
});

describe('calcularVagas', () => {
  it('gera as vagas da faixa, no dia da semana certo', () => {
    const vagas = calcularVagas({
      faixas: [faixa()],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });

    // Quartas no período: 2 e 9 de setembro. A de 9/9 cai fora do ATE (8/9).
    expect(vagas).toHaveLength(3);
    expect(horarios(vagas)).toEqual(['09:00', '10:00', '11:00']);
  });

  it('⚠️ a última vaga cabe inteira dentro da faixa', () => {
    // Faixa 9h–12h com reunião de 1h termina às 11h, nunca às 12h.
    const vagas = calcularVagas({
      faixas: [faixa({ duracao_minutos: 90 })],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    // 9h–10h30 e 10h30–12h. Uma terceira começaria meio-dia e passaria do fim.
    expect(horarios(vagas)).toEqual(['09:00', '10:30']);
  });

  it('respeita o intervalo entre reuniões', () => {
    const vagas = calcularVagas({
      faixas: [faixa({ duracao_minutos: 30, intervalo_minutos: 30 })],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    expect(horarios(vagas)).toEqual(['09:00', '10:00', '11:00']);
  });

  it('ignora faixa desativada', () => {
    const vagas = calcularVagas({
      faixas: [faixa({ ativo: false })],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    expect(vagas).toEqual([]);
  });

  it('remove a vaga que colide com reunião já marcada', () => {
    const dezDaQuarta = {
      inicio: new Date('2026-09-02T13:00:00Z'), // 10h em Brasília
      fim: new Date('2026-09-02T14:00:00Z'),
    };
    const vagas = calcularVagas({
      faixas: [faixa()],
      ocupados: [dezDaQuarta],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    expect(horarios(vagas)).toEqual(['09:00', '11:00']);
  });

  it('reunião que cobre a faixa inteira zera as vagas', () => {
    const vagas = calcularVagas({
      faixas: [faixa()],
      ocupados: [
        {
          inicio: new Date('2026-09-02T11:00:00Z'),
          fim: new Date('2026-09-02T16:00:00Z'),
        },
      ],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    expect(vagas).toEqual([]);
  });

  it('⚠️ a antecedência mínima conta a partir de AGORA, não do início do dia', () => {
    // AGORA é terça 8h. Com 48h de antecedência, a quarta (dia seguinte) some
    // inteira, porque 9h de quarta está a 25h de distância.
    const vagas = calcularVagas({
      faixas: [faixa({ antecedencia_minima_horas: 48 })],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    expect(vagas).toEqual([]);
  });

  it('a janela máxima corta o que está longe demais', () => {
    const vagas = calcularVagas({
      faixas: [faixa({ janela_maxima_dias: 1 })],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    // Só sobra o que cabe em 24h a partir de terça 8h — a quarta começa 9h,
    // dentro da janela por 1 hora... não: quarta 9h está a 25h. Nada sobra.
    expect(vagas).toEqual([]);
  });

  it('⚠️ não repete a vaga quando duas faixas se sobrepõem', () => {
    // Cadastro descuidado: 9h–12h e 10h–14h na mesma quarta.
    const vagas = calcularVagas({
      faixas: [
        faixa({ id: 'a' }),
        faixa({ id: 'b', hora_inicio: '10:00:00', hora_fim: '14:00:00' }),
      ],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    expect(horarios(vagas)).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00']);
  });

  it('devolve em ordem cronológica mesmo com faixas fora de ordem', () => {
    const vagas = calcularVagas({
      faixas: [
        faixa({ id: 'tarde', hora_inicio: '14:00:00', hora_fim: '16:00:00' }),
        faixa({ id: 'manha' }),
      ],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    expect(horarios(vagas)).toEqual(['09:00', '10:00', '11:00', '14:00', '15:00']);
  });

  it('⚠️ a faixa da sexta à noite não vaza para sábado', () => {
    // 20h–22h de sexta em Brasília é 23h–01h em UTC — já sábado. Ler o dia da
    // semana em UTC faria estas vagas sumirem da sexta.
    const vagas = calcularVagas({
      faixas: [
        faixa({ dia_da_semana: 5, hora_inicio: '20:00:00', hora_fim: '22:00:00' }),
      ],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    expect(vagas).toHaveLength(2);
    expect(horarios(vagas)).toEqual(['20:00', '21:00']);
    // E o instante realmente cai no sábado em UTC — a prova de que o teste
    // não passou por acaso.
    expect(vagas[0].inicio.toISOString()).toBe('2026-09-04T23:00:00.000Z');
  });

  it('faixa em outro fuso é resolvida no fuso dela', () => {
    const vagas = calcularVagas({
      faixas: [faixa({ timezone: 'UTC' })],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    // 9h UTC = 6h em Brasília.
    expect(horarios(vagas)).toEqual(['06:00', '07:00', '08:00']);
  });

  it('período vazio não gera nada', () => {
    const vagas = calcularVagas({
      faixas: [faixa()],
      ocupados: [],
      de: DE,
      ate: DE,
      agora: AGORA,
    });
    expect(vagas).toEqual([]);
  });

  it('sem faixa cadastrada não há vaga', () => {
    const vagas = calcularVagas({
      faixas: [],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });
    expect(vagas).toEqual([]);
  });
});

describe('agruparVagasPorDia', () => {
  it('agrupa pelo dia local, não pelo de UTC', () => {
    const vagas = calcularVagas({
      faixas: [
        faixa({ dia_da_semana: 5, hora_inicio: '20:00:00', hora_fim: '22:00:00' }),
      ],
      ocupados: [],
      de: DE,
      ate: ATE,
      agora: AGORA,
    });

    const porDia = agruparVagasPorDia(vagas, FUSO_PADRAO);
    // Sexta, 4 de setembro — apesar de os instantes caírem no sábado em UTC.
    expect([...porDia.keys()]).toEqual(['2026-09-04']);
    expect(porDia.get('2026-09-04')).toHaveLength(2);
  });

  it('lista vazia devolve mapa vazio', () => {
    expect(agruparVagasPorDia([], FUSO_PADRAO).size).toBe(0);
  });
});
