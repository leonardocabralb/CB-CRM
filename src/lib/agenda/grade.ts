// ============================================================
// A grade do calendário (migration 945).
//
// Montar "o mês de setembro" parece trivial e tem três armadilhas clássicas:
// o mês que começa no domingo, o que termina no sábado, e a semana que
// atravessa a virada do ano. Todas produzem grade com buraco ou com dia
// repetido, e nenhuma estoura — a tela só fica errada.
//
// Puro e testável pelo mesmo motivo do `vagas.ts`: aqui um erro de um dia é
// invisível na revisão e óbvio para quem usa.
// ============================================================

import { diaNoFuso, paraInstante, partesNoFuso } from './fuso';

export type Visao = 'mes' | 'semana' | 'dia';

/** Um dia da grade. `dia` é `YYYY-MM-DD` no fuso da tela. */
export interface DiaDaGrade {
  dia: string;
  /** `false` para os dias de mês vizinho que completam a primeira/última semana. */
  doMesAtual: boolean;
  ehHoje: boolean;
}

/** Soma dias a uma data `YYYY-MM-DD`, sem passar por fuso. */
export function somarDias(data: string, dias: number): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  // ⚠️ `Date.UTC` de propósito: não tem horário de verão, então somar dias aqui
  // nunca pula nem repete um dia. Somar 24h a um instante local, sim.
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return (
    `${d.getUTCFullYear()}-` +
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getUTCDate()).padStart(2, '0')}`
  );
}

/** O dia da semana (0=domingo) de uma data `YYYY-MM-DD`. */
export function diaDaSemana(data: string): number {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/** O primeiro dia (domingo) da semana que contém esta data. */
export function inicioDaSemana(data: string): string {
  return somarDias(data, -diaDaSemana(data));
}

/** O primeiro dia do mês que contém esta data. */
export function inicioDoMes(data: string): string {
  const [ano, mes] = data.split('-');
  return `${ano}-${mes}-01`;
}

/** Quantos dias tem o mês desta data. */
export function diasNoMes(data: string): number {
  const [ano, mes] = data.split('-').map(Number);
  // Dia 0 do mês seguinte é o último dia deste.
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * A grade do mês: sempre semanas COMPLETAS, de domingo a sábado.
 *
 * ⚠️ Sempre 6 semanas (42 dias), nunca 4 ou 5. Uma grade que encolhe conforme o
 * mês faz o calendário inteiro pular de altura ao trocar de mês, e as linhas
 * abaixo dele dançam. O custo é uma linha às vezes toda de mês vizinho.
 */
export function gradeDoMes(mesDe: string, hoje: string): DiaDaGrade[] {
  const primeiro = inicioDoMes(mesDe);
  const comeco = inicioDaSemana(primeiro);
  const mesAtual = primeiro.slice(0, 7);

  const dias: DiaDaGrade[] = [];
  for (let i = 0; i < 42; i++) {
    const dia = somarDias(comeco, i);
    dias.push({
      dia,
      doMesAtual: dia.slice(0, 7) === mesAtual,
      ehHoje: dia === hoje,
    });
  }
  return dias;
}

/** Os 7 dias da semana que contém esta data. */
export function gradeDaSemana(data: string, hoje: string): DiaDaGrade[] {
  const comeco = inicioDaSemana(data);
  const mesAtual = data.slice(0, 7);

  return Array.from({ length: 7 }, (_, i) => {
    const dia = somarDias(comeco, i);
    return {
      dia,
      doMesAtual: dia.slice(0, 7) === mesAtual,
      ehHoje: dia === hoje,
    };
  });
}

/**
 * O período que a consulta precisa cobrir para desenhar esta visão.
 *
 * ⚠️ Vai além do mês nas duas pontas, de propósito: a grade do mês mostra dias
 * de meses vizinhos, e sem eles no recorte as reuniões daquelas células
 * sumiriam — com a célula desenhada e vazia, que é pior do que não desenhar.
 */
export function periodoDaVisao(
  visao: Visao,
  referencia: string,
  timezone: string,
): { de: Date; ate: Date } {
  let primeiro: string;
  let ultimo: string;

  if (visao === 'dia') {
    primeiro = referencia;
    ultimo = referencia;
  } else if (visao === 'semana') {
    primeiro = inicioDaSemana(referencia);
    ultimo = somarDias(primeiro, 6);
  } else {
    primeiro = inicioDaSemana(inicioDoMes(referencia));
    ultimo = somarDias(primeiro, 41);
  }

  return {
    de: paraInstante(primeiro, '00:00', timezone),
    ate: paraInstante(ultimo, '23:59', timezone),
  };
}

/** O dia de hoje `YYYY-MM-DD` no fuso da tela. */
export function hojeNoFuso(agora: Date, timezone: string): string {
  return diaNoFuso(agora, timezone);
}

/**
 * O rótulo do período, para o cabeçalho da tela.
 *
 * ⚠️ Usa `undefined` como locale — nunca `'pt-BR'` fixo. O CLAUDE.md registra
 * que locale fixo faz a data sair no idioma errado quando o app muda de língua.
 */
export function rotuloDoPeriodo(visao: Visao, referencia: string): string {
  const [ano, mes, dia] = referencia.split('-').map(Number);
  const base = new Date(Date.UTC(ano, mes - 1, dia, 12));

  if (visao === 'dia') {
    return base.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  if (visao === 'semana') {
    const comeco = inicioDaSemana(referencia);
    const fim = somarDias(comeco, 6);
    const [a1, m1, d1] = comeco.split('-').map(Number);
    const [a2, m2, d2] = fim.split('-').map(Number);
    const inicio = new Date(Date.UTC(a1, m1 - 1, d1, 12));
    const termino = new Date(Date.UTC(a2, m2 - 1, d2, 12));

    const curto: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    };
    return `${inicio.toLocaleDateString(undefined, curto)} – ${termino.toLocaleDateString(
      undefined,
      { ...curto, year: 'numeric' },
    )}`;
  }

  return base.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Move a referência para o período anterior ou seguinte. */
export function navegar(
  visao: Visao,
  referencia: string,
  passo: 1 | -1,
): string {
  if (visao === 'dia') return somarDias(referencia, passo);
  if (visao === 'semana') return somarDias(referencia, passo * 7);

  // ⚠️ No mês, somar 30 dias erraria: de 31 de janeiro cairia em 2 de março.
  // Mexer no componente de mês e ancorar no dia 1 é o único jeito estável.
  const [ano, mes] = referencia.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + passo, 1));
  return (
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
  );
}

/** Em que dia da grade esta reunião cai. */
export function diaDaReuniao(
  starts_at: string,
  timezone: string,
): string {
  return diaNoFuso(new Date(starts_at), timezone);
}

/** A hora `HH:MM` da reunião, no fuso da tela. */
export function horaDaReuniao(starts_at: string, timezone: string): string {
  const p = partesNoFuso(new Date(starts_at), timezone);
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
}
