import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  avaliarHoraDoDia,
  camposDaJanela,
  ehODiaInteiro,
  esperaPeloHorario,
  lerJanela,
  OPERANDO_DO_DIA_INTEIRO,
  operandoDaJanela,
  proximoInicioDaJanela,
  rotuloDaJanela,
  type CondicaoDeHora,
  type EsperaPeloHorario,
} from './hora-do-dia';
import { AUTOMATION_TEMPLATES } from './templates';
import { validateStepsForActivation } from './validate';

// Os instantes são UTC EXPLÍCITOS, então os pinos valem com a máquina em
// qualquer fuso. Brasília é UTC-3 (sem horário de verão desde 2019):
// 23:59Z = 20:59 em Brasília; 00:00Z do dia seguinte = 21:00 da véspera.
//
// 26/09/2026 é um SÁBADO; 25/09, sexta; 28/09, segunda.
const em = (iso: string) => new Date(iso);
// Só a resposta (o motor usa `avaliarHoraDoDia(...).sim`, com a nota).
const casa = (cfg: CondicaoDeHora, agora: Date) => avaliarHoraDoDia(cfg, agora).sim;

describe('lerJanela — o operando gravado', () => {
  it('lê "HH:mm-HH:mm" em minutos', () => {
    expect(lerJanela('08:00-21:00')).toEqual({ inicio: 480, fim: 1260 });
    expect(lerJanela('18:00-09:00')).toEqual({ inicio: 1080, fim: 540 });
  });

  it('aceita o que o upstream aceitava: hora sem minuto, espaços e "24:00" no fim', () => {
    expect(lerJanela('9-18')).toEqual({ inicio: 540, fim: 1080 });
    expect(lerJanela(' 09:00 - 18:30 ')).toEqual({ inicio: 540, fim: 1110 });
    expect(lerJanela('00:00-24:00')).toEqual({ inicio: 0, fim: 1440 });
  });

  it('aceita e IGNORA os segundos ("08:00:00-18:00:00"), como o upstream', () => {
    expect(lerJanela('08:00:00-18:00:00')).toEqual({ inicio: 480, fim: 1080 });
    expect(lerJanela('08:00:30-18:00:59')).toEqual({ inicio: 480, fim: 1080 });
    expect(lerJanela('00:00:00-24:00:00')).toEqual({ inicio: 0, fim: 1440 });
    expect(lerJanela('08:00:60-18:00')).toBeNull();
    expect(lerJanela('00:00-24:00:01')).toBeNull();
  });

  it('o fim "24:00" legado é a mesma janela que "00:00" (só o dia inteiro fica 1440)', () => {
    expect(lerJanela('18:00-24:00')).toEqual({ inicio: 1080, fim: 0 });
    expect(lerJanela('18:00-24:00')).toEqual(lerJanela('18:00-00:00'));
  });

  it('recusa o que não é janela', () => {
    expect(lerJanela('')).toBeNull();
    expect(lerJanela(undefined)).toBeNull();
    expect(lerJanela('09:00')).toBeNull();
    expect(lerJanela('09:00-')).toBeNull();
    expect(lerJanela('-18:00')).toBeNull();
    expect(lerJanela('25:00-09:00')).toBeNull();
    expect(lerJanela('09:60-18:00')).toBeNull();
    expect(lerJanela('24:00-09:00')).toBeNull();
    expect(lerJanela('abc-def')).toBeNull();
    expect(lerJanela('09:00-12:00-18:00')).toBeNull();
    expect(lerJanela('9:5-18:00')).toBeNull();
    // Um UUID que sobrou de outro critério (etiqueta, etapa).
    expect(lerJanela('2535dfad-e981-4a7d-8a50-ce5ca321c153')).toBeNull();
  });

  it('início igual ao fim é janela VAZIA — recusada, e a condição responde não (como no upstream)', () => {
    expect(lerJanela('09:00-09:00')).toBeNull();
    expect(casa({ operand: '09:00-09:00' }, em('2026-09-25T12:00:00Z'))).toBe(false);
  });
});

describe('avaliarHoraDoDia — no fuso do escritório, nunca no do servidor', () => {
  const comercial = { operand: '08:00-21:00' };

  it('20:59 em Brasília ainda está dentro; 21:00 já está fora (o fim não conta)', () => {
    expect(casa(comercial, em('2026-09-25T23:59:00Z'))).toBe(true);
    expect(casa(comercial, em('2026-09-26T00:00:00Z'))).toBe(false);
  });

  it('08:00 conta (o início conta); 07:59 não', () => {
    expect(casa(comercial, em('2026-09-25T11:00:00Z'))).toBe(true);
    expect(casa(comercial, em('2026-09-25T10:59:00Z'))).toBe(false);
  });

  it('é a hora de Brasília, não a de Greenwich: 06:00 em Brasília (09:00 UTC) está fora', () => {
    // O bug que motivou o módulo: com `getHours()` num contêiner em UTC, isto
    // dava "dentro" (09:00 ≥ 08:00).
    expect(casa(comercial, em('2026-09-25T09:00:00Z'))).toBe(false);
    // …e 19:00 em Brasília (22:00 UTC) está dentro, embora 22h UTC passe das 21h.
    expect(casa(comercial, em('2026-09-25T22:00:00Z'))).toBe(true);
  });

  it('a virada do dia no servidor (meia-noite UTC = 21h em Brasília) não muda o dia do escritório', () => {
    const r = avaliarHoraDoDia(comercial, em('2026-09-26T00:30:00Z'));
    expect(r.sim).toBe(false);
    // Em UTC já é sábado 00:30; em Brasília ainda é sexta 21:30.
    expect(r.nota).toBe('hora no escritório: sex 21:30');
  });

  it('janela que ATRAVESSA a meia-noite ("18:00-09:00", o "Out of Office")', () => {
    const fora = { operand: '18:00-09:00' };
    expect(casa(fora, em('2026-09-25T20:59:00Z'))).toBe(false); // 17:59
    expect(casa(fora, em('2026-09-25T21:00:00Z'))).toBe(true); // 18:00
    expect(casa(fora, em('2026-09-26T02:59:00Z'))).toBe(true); // 23:59
    expect(casa(fora, em('2026-09-26T03:00:00Z'))).toBe(true); // 00:00
    expect(casa(fora, em('2026-09-26T11:59:00Z'))).toBe(true); // 08:59
    expect(casa(fora, em('2026-09-26T12:00:00Z'))).toBe(false); // 09:00
    // O bug: 15:00 em Brasília é 18:00 UTC — com `getHours()` em UTC o
    // "estamos fora do horário" saía no meio da tarde.
    expect(casa(fora, em('2026-09-25T18:00:00Z'))).toBe(false);
  });

  it('"18:00-00:00" e o legado "18:00-24:00" pegam os mesmos minutos', () => {
    for (const operand of ['18:00-00:00', '18:00-24:00']) {
      expect(casa({ operand }, em('2026-09-26T02:59:00Z'))).toBe(true); // 23:59
      expect(casa({ operand }, em('2026-09-26T03:00:00Z'))).toBe(false); // 00:00
      expect(casa({ operand }, em('2026-09-25T20:59:00Z'))).toBe(false); // 17:59
    }
  });

  it('operando inválido responde NÃO e o registro diz por quê', () => {
    const r = avaliarHoraDoDia({ operand: 'amanhã' }, em('2026-09-25T15:00:00Z'));
    expect(r).toEqual({ sim: false, nota: 'janela de horário inválida: "amanhã"' });
    expect(avaliarHoraDoDia({}, em('2026-09-25T15:00:00Z')).sim).toBe(false);
  });
});

describe('somente_seg_a_sex — de segunda a sexta, no fuso do escritório', () => {
  const util = { operand: '08:00-21:00', somente_seg_a_sex: true };

  it('sexta sim, sábado e domingo não, segunda sim', () => {
    expect(casa(util, em('2026-09-25T15:00:00Z'))).toBe(true); // sex 12:00
    expect(casa(util, em('2026-09-26T15:00:00Z'))).toBe(false); // sáb 12:00
    expect(casa(util, em('2026-09-27T15:00:00Z'))).toBe(false); // dom 12:00
    expect(casa(util, em('2026-09-28T15:00:00Z'))).toBe(true); // seg 12:00
  });

  it('o dia é o de Brasília: sexta 20:59 em Brasília já é sábado em UTC e continua valendo', () => {
    expect(casa(util, em('2026-09-25T23:59:00Z'))).toBe(true);
    // Domingo 20:30 em Brasília (23:30 UTC, ainda domingo nos dois) — fora.
    expect(casa(util, em('2026-09-27T23:30:00Z'))).toBe(false);
    // Das 21h à meia-noite o dia de Brasília e o de UTC DIFEREM.
    const tarde = { operand: '21:00-23:59', somente_seg_a_sex: true };
    // Domingo 22:00 em Brasília = segunda 01:00 UTC → domingo, fora.
    expect(casa(tarde, em('2026-09-28T01:00:00Z'))).toBe(false);
    // Sexta 22:00 em Brasília = sábado 01:00 UTC → sexta, dentro.
    expect(casa(tarde, em('2026-09-26T01:00:00Z'))).toBe(true);
  });

  it('na janela que atravessa a meia-noite, a madrugada é do dia em que a janela COMEÇOU', () => {
    const noite = { operand: '22:00-06:00', somente_seg_a_sex: true };
    // Sábado 02:00 = a noite de SEXTA → vale.
    expect(casa(noite, em('2026-09-26T05:00:00Z'))).toBe(true);
    // Sábado 22:00 = a noite de sábado → não.
    expect(casa(noite, em('2026-09-27T01:00:00Z'))).toBe(false);
    // Segunda 02:00 = a noite de DOMINGO → não.
    expect(casa(noite, em('2026-09-28T05:00:00Z'))).toBe(false);
    // Segunda 22:00 → sim; terça 05:59 (noite de segunda) → sim.
    expect(casa(noite, em('2026-09-29T01:00:00Z'))).toBe(true);
    expect(casa(noite, em('2026-09-29T08:59:00Z'))).toBe(true);
  });

  it('a virada do DIA DA SEMANA é a meia-noite de Brasília (03:00 UTC), não a de UTC', () => {
    const diaUtil = { operand: OPERANDO_DO_DIA_INTEIRO, somente_seg_a_sex: true };
    expect(casa(diaUtil, em('2026-09-26T02:59:00Z'))).toBe(true); // sex 23:59
    expect(casa(diaUtil, em('2026-09-26T03:00:00Z'))).toBe(false); // sáb 00:00
    expect(casa(diaUtil, em('2026-09-28T02:59:00Z'))).toBe(false); // dom 23:59
    expect(casa(diaUtil, em('2026-09-28T03:00:00Z'))).toBe(true); // seg 00:00
    // O FIM da madrugada que conta para a véspera (sexta à noite).
    const noite = { operand: '22:00-06:00', somente_seg_a_sex: true };
    expect(casa(noite, em('2026-09-26T08:59:00Z'))).toBe(true); // sáb 05:59
    expect(casa(noite, em('2026-09-26T09:00:00Z'))).toBe(false); // sáb 06:00
  });

  it('só o booleano `true` liga — "true" e 1 vindos de JSONB não recortam', () => {
    const sabado = em('2026-09-26T15:00:00Z');
    expect(casa({ operand: '08:00-21:00', somente_seg_a_sex: 'true' }, sabado)).toBe(true);
    expect(casa({ operand: '08:00-21:00', somente_seg_a_sex: 1 }, sabado)).toBe(true);
    expect(casa({ operand: '08:00-21:00', somente_seg_a_sex: false }, sabado)).toBe(true);
  });
});

describe('a tela: dois campos de hora ↔ o operando', () => {
  it('lê o operando gravado, lado a lado', () => {
    expect(camposDaJanela('08:00-21:00')).toEqual({ inicio: '08:00', fim: '21:00' });
    expect(camposDaJanela('9-18')).toEqual({ inicio: '09:00', fim: '18:00' });
    expect(camposDaJanela('18:00-24:00')).toEqual({ inicio: '18:00', fim: '00:00' });
    expect(camposDaJanela('08:00-')).toEqual({ inicio: '08:00', fim: '' });
    expect(camposDaJanela('')).toEqual({ inicio: '', fim: '' });
    expect(camposDaJanela(undefined)).toEqual({ inicio: '', fim: '' });
    expect(camposDaJanela('uma-etiqueta')).toEqual({ inicio: '', fim: '' });
    expect(camposDaJanela('08:00:00-18:00:00')).toEqual({ inicio: '08:00', fim: '18:00' });
  });

  it('mais de um "-" deixa os DOIS campos em branco (coerente com o aviso "escolha o início e o fim")', () => {
    expect(camposDaJanela('09:00-12:00-18:00')).toEqual({ inicio: '', fim: '' });
    expect(camposDaJanela('2535dfad-e981-4a7d-8a50-ce5ca321c153')).toEqual({ inicio: '', fim: '' });
  });

  it('"o dia inteiro" é "00:00-24:00" — o que os dois campos não escrevem', () => {
    expect(ehODiaInteiro(lerJanela(OPERANDO_DO_DIA_INTEIRO))).toBe(true);
    expect(ehODiaInteiro(lerJanela('0-24'))).toBe(true);
    expect(ehODiaInteiro(lerJanela('00:00-23:59'))).toBe(false);
    expect(ehODiaInteiro(lerJanela('18:00-24:00'))).toBe(false);
    expect(ehODiaInteiro(lerJanela('00:00-00:00'))).toBe(false);
    expect(ehODiaInteiro(null)).toBe(false);
    // Todos os minutos do dia; 00:00 → 00:00 seria janela vazia.
    expect(casa({ operand: OPERANDO_DO_DIA_INTEIRO }, em('2026-09-26T02:59:00Z'))).toBe(true); // 23:59
    expect(casa({ operand: OPERANDO_DO_DIA_INTEIRO }, em('2026-09-26T03:00:00Z'))).toBe(true); // 00:00
  });

  it('monta o operando no formato do upstream, e ida e volta preservam a janela', () => {
    expect(operandoDaJanela('08:00', '21:00')).toBe('08:00-21:00');
    expect(operandoDaJanela('08:00', '')).toBe('08:00-');
    expect(operandoDaJanela('', '')).toBe('');
    const { inicio, fim } = camposDaJanela('18:00-24:00');
    expect(lerJanela(operandoDaJanela(inicio, fim))).toEqual({ inicio: 1080, fim: 0 });
  });
});

describe('esperaPeloHorario — "Aguardar até estar dentro do horário" (B6a)', () => {
  const comercial: EsperaPeloHorario = { janela: '08:00-21:00' };
  const util: EsperaPeloHorario = { janela: '08:00-21:00', somente_seg_a_sex: true };
  // Até quando estaciona, em ISO UTC (ou o tipo, quando não estaciona).
  const ate = (cfg: EsperaPeloHorario, iso: string) => {
    const d = esperaPeloHorario(cfg, em(iso));
    return d.tipo === 'espera' ? d.ate.toISOString() : d.tipo;
  };

  it('dentro do horário: segue na hora, e o registro diz a hora lida', () => {
    expect(esperaPeloHorario(comercial, em('2026-09-25T13:00:00Z'))).toEqual({
      tipo: 'segue',
      nota: 'dentro do horário (sex 10:00); segue',
    });
    // 08:00 em ponto conta (o início conta); 20:59 também.
    expect(ate(comercial, '2026-09-25T11:00:00Z')).toBe('segue');
    expect(ate(comercial, '2026-09-25T23:59:00Z')).toBe('segue');
  });

  it('o exemplo do operador: sexta 22:40, de segunda a sexta → espera até segunda 08:00', () => {
    // Sexta 22:40 em Brasília = sábado 01:40 UTC.
    expect(esperaPeloHorario(util, em('2026-09-26T01:40:00Z'))).toEqual({
      tipo: 'espera',
      ate: em('2026-09-28T11:00:00Z'),
      nota: 'fora do horário (sex 22:40); aguarda até seg 08:00',
    });
    // Sem o recorte, o próximo início é o de sábado.
    expect(ate(comercial, '2026-09-26T01:40:00Z')).toBe('2026-09-26T11:00:00.000Z');
  });

  it('antes do início: espera o início de HOJE (07:59 → 08:00)', () => {
    expect(ate(comercial, '2026-09-25T10:59:00Z')).toBe('2026-09-25T11:00:00.000Z');
    // Um milissegundo antes das 08:00: o início ainda não chegou, e é ele.
    expect(ate(comercial, '2026-09-25T10:59:59.999Z')).toBe('2026-09-25T11:00:00.000Z');
  });

  it('o fim não conta: 21:00 em ponto já espera o início do dia seguinte', () => {
    expect(ate(comercial, '2026-09-26T00:00:00Z')).toBe('2026-09-26T11:00:00.000Z');
  });

  it('06:00 de Brasília (09:00 UTC) está fora e espera as 08:00 — não "já passou das 08:00 UTC"', () => {
    expect(ate(comercial, '2026-09-25T09:00:00Z')).toBe('2026-09-25T11:00:00.000Z');
  });

  it('o dia é o de Brasília: das 21h à meia-noite, o início de HOJE ainda vale', () => {
    // Sexta 21:30 em Brasília = sábado 00:30 UTC. Uma conta pelo dia UTC
    // (sábado) pularia o início de sexta 22:30 e esperaria até sábado.
    expect(ate({ janela: '22:30-23:30' }, '2026-09-26T00:30:00Z')).toBe('2026-09-26T01:30:00.000Z');
    // Domingo 23:59 em Brasília = segunda 02:59 UTC: com "segunda a sexta",
    // espera a segunda 08:00 de Brasília (não a terça).
    expect(ate(util, '2026-09-28T02:59:00Z')).toBe('2026-09-28T11:00:00.000Z');
  });

  it('segunda a sexta: sábado e domingo esperam a segunda', () => {
    expect(ate(util, '2026-09-26T15:00:00Z')).toBe('2026-09-28T11:00:00.000Z'); // sáb 12:00
    expect(ate(util, '2026-09-27T15:00:00Z')).toBe('2026-09-28T11:00:00.000Z'); // dom 12:00
    expect(ate(util, '2026-09-25T15:00:00Z')).toBe('segue'); // sex 12:00
  });

  it('janela que atravessa a meia-noite: a madrugada é do dia em que a janela começou', () => {
    const noite: EsperaPeloHorario = { janela: '22:00-06:00' };
    expect(ate(noite, '2026-09-25T10:00:00Z')).toBe('2026-09-26T01:00:00.000Z'); // sex 07:00 → sex 22:00
    expect(ate(noite, '2026-09-26T02:00:00Z')).toBe('segue'); // sex 23:00
    expect(ate(noite, '2026-09-26T08:59:00Z')).toBe('segue'); // sáb 05:59
    const noiteUtil: EsperaPeloHorario = { janela: '22:00-06:00', somente_seg_a_sex: true };
    // Sábado 05:00 = a noite de SEXTA → segue.
    expect(ate(noiteUtil, '2026-09-26T08:00:00Z')).toBe('segue');
    // Segunda 02:00 = a noite de DOMINGO → espera a noite de segunda.
    expect(ate(noiteUtil, '2026-09-28T05:00:00Z')).toBe('2026-09-29T01:00:00.000Z');
    // Sábado 07:00 → a noite de segunda.
    expect(ate(noiteUtil, '2026-09-26T10:00:00Z')).toBe('2026-09-29T01:00:00.000Z');
  });

  it('"o dia inteiro" com "segunda a sexta" = aguardar até um dia de semana (segunda 00:00)', () => {
    const diaUtil: EsperaPeloHorario = { janela: OPERANDO_DO_DIA_INTEIRO, somente_seg_a_sex: true };
    expect(ate(diaUtil, '2026-09-26T15:00:00Z')).toBe('2026-09-28T03:00:00.000Z');
    expect(ate(diaUtil, '2026-09-25T15:00:00Z')).toBe('segue');
    // Sem o recorte, todo instante está dentro.
    expect(ate({ janela: OPERANDO_DO_DIA_INTEIRO }, '2026-09-26T15:00:00Z')).toBe('segue');
  });

  it('janela que o motor não lê: inválida (o passo falha), com a janela no registro', () => {
    expect(esperaPeloHorario({ janela: '' }, em('2026-09-25T15:00:00Z'))).toEqual({
      tipo: 'invalida',
      nota: 'janela de horário inválida: ""',
    });
    expect(ate({ janela: '09:00-09:00' }, '2026-09-25T15:00:00Z')).toBe('invalida');
    expect(ate({}, '2026-09-25T15:00:00Z')).toBe('invalida');
    expect(ate({ janela: 'amanhã' }, '2026-09-25T15:00:00Z')).toBe('invalida');
  });

  it('só o booleano `true` liga o "segunda a sexta" — "true" e 1 de JSONB não recortam', () => {
    for (const valor of ['true', 1, false]) {
      expect(ate({ janela: '08:00-21:00', somente_seg_a_sex: valor }, '2026-09-26T15:00:00Z')).toBe('segue');
    }
  });

  it('anda por dias de CALENDÁRIO: atravessa o horário de verão sem errar uma hora', () => {
    // Nova York: o relógio adianta em 08/03/2026 e atrasa em 01/11/2026.
    // Somar 24 h ao início de sábado daria 13:00 UTC no domingo (09:00 EDT).
    const r = proximoInicioDaJanela(lerJanela('08:00-21:00')!, false, em('2026-03-08T03:00:00Z'), 'America/New_York');
    expect(r?.toISOString()).toBe('2026-03-08T12:00:00.000Z'); // dom 08:00 EDT
    const s = proximoInicioDaJanela(lerJanela('08:00-21:00')!, false, em('2026-11-01T02:00:00Z'), 'America/New_York');
    expect(s?.toISOString()).toBe('2026-11-01T13:00:00.000Z'); // dom 08:00 EST
  });

  it('propriedade: o instante da espera é o PRIMEIRO dentro do horário, e sempre no futuro', () => {
    // Uma semana inteira, a cada 347 min, para seis janelas: estacionar num
    // instante que não é "dentro" faria o passo seguinte sair fora do
    // horário; num instante passado, o agendador giraria em falso.
    const janelas: EsperaPeloHorario[] = [
      { janela: '08:00-21:00' },
      { janela: '08:00-21:00', somente_seg_a_sex: true },
      { janela: '22:00-06:00' },
      { janela: '22:00-06:00', somente_seg_a_sex: true },
      { janela: OPERANDO_DO_DIA_INTEIRO, somente_seg_a_sex: true },
      { janela: '00:30-00:45' },
    ];
    const inicio = em('2026-09-24T00:00:00Z').getTime();
    for (const cfg of janelas) {
      for (let t = inicio; t < inicio + 7 * 86_400_000; t += 347 * 60_000) {
        const agora = new Date(t);
        const d = esperaPeloHorario(cfg, agora);
        const dentro = avaliarHoraDoDia({ operand: cfg.janela, somente_seg_a_sex: cfg.somente_seg_a_sex }, agora).sim;
        expect(d.tipo).toBe(dentro ? 'segue' : 'espera');
        if (d.tipo !== 'espera') continue;
        expect(d.ate.getTime()).toBeGreaterThan(t);
        expect(esperaPeloHorario(cfg, d.ate).tipo).toBe('segue');
        // Nenhum instante no meio já estava dentro (oito amostras), nem o
        // minuto logo antes do início.
        const minutoAntes = d.ate.getTime() - 60_000;
        if (minutoAntes > t) expect(esperaPeloHorario(cfg, new Date(minutoAntes)).tipo).toBe('espera');
        const passo = (d.ate.getTime() - t) / 8;
        for (let k = 1; k < 8; k++) {
          const meio = new Date(t + k * passo);
          if (meio.getTime() >= d.ate.getTime() - 60_000) break;
          expect(esperaPeloHorario(cfg, meio).tipo).toBe('espera');
        }
      }
    }
    // Cada leitura monta um `Intl.DateTimeFormat`; com a suíte inteira em
    // paralelo, os 5 s padrão não bastam.
  }, 30_000);
});

describe('rotuloDaJanela — o resumo do passo', () => {
  it('início e fim como a tela os mostra; o dia inteiro vai até 24:00', () => {
    expect(rotuloDaJanela('08:00-21:00')).toEqual({ inicio: '08:00', fim: '21:00' });
    expect(rotuloDaJanela('9-18')).toEqual({ inicio: '09:00', fim: '18:00' });
    expect(rotuloDaJanela('18:00-24:00')).toEqual({ inicio: '18:00', fim: '00:00' });
    expect(rotuloDaJanela(OPERANDO_DO_DIA_INTEIRO)).toEqual({ inicio: '00:00', fim: '24:00' });
    expect(rotuloDaJanela('')).toBeNull();
    expect(rotuloDaJanela('09:00-09:00')).toBeNull();
  });
});

describe('o motor não lê hora local', () => {
  // Pino: o contêiner roda em UTC. `getHours()`/`getDay()`/`getMinutes()` no
  // motor voltam a responder na hora de Greenwich, sem erro nenhum.
  const semComentarios = (fonte: string) =>
    fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  for (const arquivo of ['engine.ts', 'hora-do-dia.ts']) {
    it(arquivo, () => {
      const fonte = semComentarios(readFileSync(join(__dirname, arquivo), 'utf8'));
      expect(fonte).not.toMatch(/\.get(Hours|Minutes|Day)\(\)/);
    });
  }

  it('o passo de condição desvia time_of_day para avaliarHoraDoDia (o caminho que RODA)', () => {
    // ⚠️ O `case 'time_of_day'` de `evaluateCondition` é cópia para um
    // chamador direto: `executeStepsFrom` desvia a hora ANTES (para gravar a
    // nota) e nunca chega a chamá-la com esse critério. Vigiar aquele caso
    // deixaria passar uma leitura local no desvio. O anti-`getHours` acima
    // cobre os dois, e a seção "hora do dia" de `engine.test.ts` exercita o
    // caminho real.
    const fonte = readFileSync(join(__dirname, 'engine.ts'), 'utf8');
    const inicio = fonte.indexOf("step.step_type === 'condition'");
    const fim = fonte.indexOf('evaluateCondition(', inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    expect(fonte.slice(inicio, fim)).toMatch(
      /cfg\.subject === 'time_of_day'\s*\?\s*avaliarHoraDoDia\(cfg, new Date\(\)\)/,
    );
  });
});

describe('o modelo pronto "Out of Office"', () => {
  const modelo = AUTOMATION_TEMPLATES.out_of_office;
  const condicao = modelo.steps[0].step_config as Record<string, unknown>;
  const ramoDaResposta = modelo.steps[1].branch;
  // Responde (vai para o ramo da mensagem) quando NÃO é expediente.
  const responde = (iso: string) =>
    (casa(condicao, em(iso)) ? 'yes' : 'no') === ramoDaResposta;

  it('é uma condição válida para a ativação', () => {
    expect(validateStepsForActivation([{ step_type: 'condition', step_config: condicao }])).toEqual([]);
  });

  it('cala no expediente de Brasília e responde fora dele — inclusive no fim de semana', () => {
    expect(responde('2026-09-25T18:00:00Z')).toBe(false); // sex 15:00
    expect(responde('2026-09-25T12:00:00Z')).toBe(false); // sex 09:00
    expect(responde('2026-09-25T11:59:00Z')).toBe(true); // sex 08:59
    expect(responde('2026-09-25T21:00:00Z')).toBe(true); // sex 18:00
    expect(responde('2026-09-26T15:00:00Z')).toBe(true); // sáb 12:00
    expect(responde('2026-09-28T02:00:00Z')).toBe(true); // dom 23:00
  });
});
