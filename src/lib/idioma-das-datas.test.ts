import { describe, expect, it } from 'vitest';
import { format, formatDistance } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';

import { localeDoDateFns } from './idioma-das-datas';

const AGORA = new Date('2026-09-10T15:00:00.000Z');
const minutosAntes = (n: number) => new Date(AGORA.getTime() - n * 60_000);

describe('localeDoDateFns', () => {
  it('pt-BR fala português', () => {
    expect(localeDoDateFns('pt-BR')).toBe(ptBR);
  });

  it('en, e qualquer idioma sem dicionário, fala inglês — como o próprio dicionário', () => {
    // `ko` foi apagado em 08/09/2026 e o `request.ts` cai no inglês.
    expect(localeDoDateFns('en')).toBe(enUS);
    expect(localeDoDateFns('ko')).toBe(enUS);
    expect(localeDoDateFns(undefined)).toBe(enUS);
  });
});

describe('o que as telas passam a mostrar', () => {
  // As frases são do próprio date-fns (texto fixo no locale, não do ICU do
  // Node), então não variam entre majors — mas a suíte roda no Node 22 do CI.
  it('pt-BR: a lista da caixa de entrada', () => {
    const l = localeDoDateFns('pt-BR');
    expect(formatDistance(minutosAntes(3), AGORA, { locale: l })).toBe('3 minutos');
    expect(formatDistance(minutosAntes(70), AGORA, { locale: l })).toBe(
      'cerca de 1 hora'
    );
    expect(formatDistance(minutosAntes(60 * 30), AGORA, { locale: l })).toBe('1 dia');
  });

  it('pt-BR com sufixo: as notificações', () => {
    const l = localeDoDateFns('pt-BR');
    expect(
      formatDistance(minutosAntes(3), AGORA, { locale: l, addSuffix: true })
    ).toBe('há 3 minutos');
  });

  it('data por extenso ("PPP"): o separador de dia da conversa', () => {
    // Meio-dia em São Paulo: o mesmo dia em UTC (CI) e no fuso local.
    const dia = new Date('2026-09-08T15:00:00.000Z');
    expect(format(dia, 'PPP', { locale: localeDoDateFns('pt-BR') })).toBe(
      '8 de setembro de 2026'
    );
    expect(format(dia, 'PPP', { locale: localeDoDateFns('en') })).toBe(
      'September 8th, 2026'
    );
  });

  it('en continua como era', () => {
    const l = localeDoDateFns('en');
    expect(formatDistance(minutosAntes(3), AGORA, { locale: l })).toBe('3 minutes');
    expect(formatDistance(minutosAntes(70), AGORA, { locale: l })).toBe(
      'about 1 hour'
    );
  });
});
