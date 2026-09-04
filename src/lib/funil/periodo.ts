import { localDayKey } from "@/lib/dashboard/date-utils";

/**
 * Período do painel e da lista. Tudo em FUSO LOCAL do navegador, como o
 * painel (`dashboard/date-utils.ts`): a virada de mês é a de quem olha.
 *
 * Um intervalo é `[desde, ate)` — `ate` EXCLUSIVO. `ate` nulo = aberto até
 * agora ("Este mês", "Este ano"); `desde` nulo = "Total".
 *
 * Período ANTERIOR = o de MESMA DURAÇÃO imediatamente anterior (frase da
 * referência: "comparação vs período de mesma duração anterior"; decisão
 * D4 do plano). Para intervalo aberto a duração é contada em DIAS INTEIROS
 * (do `desde` até o fim de hoje): "Este mês" no dia 3 compara 3 dias com os
 * 3 dias anteriores — comparar com o mês inteiro anterior mentiria em -90%.
 *
 * ⚠️ A duração é contada e deslocada em DIAS DE CALENDÁRIO locais, nunca em
 * milissegundos: num fuso com horário de verão, março tem 30 dias e 23
 * horas, e subtrair esse tanto de 1º de março cairia em 29 de janeiro à 1h
 * — a hora de fronteira sumiria da comparação (achado do Codex no PR #119).
 * O Brasil não tem horário de verão desde 2019; o dia em que houver alguém
 * em outro fuso, isto já está certo.
 */

export const PRESETS = [
  "este_mes",
  "mes_passado",
  "este_ano",
  "ano_passado",
  "total",
  "personalizado",
] as const;
export type Preset = (typeof PRESETS)[number];

export interface Intervalo {
  desde: Date | null;
  ate: Date | null;
}

export const INTERVALO_TOTAL: Intervalo = { desde: null, ate: null };

const DIA_MS = 24 * 60 * 60 * 1000;

export function inicioDoDiaLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** `mes0` pode sair de 0..11 — o `Date` normaliza (mês -1 = dezembro do ano anterior). */
export function inicioDoMesLocal(ano: number, mes0: number): Date {
  return new Date(ano, mes0, 1);
}

export function diaSeguinte(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

/** "AAAA-MM-DD" (o valor de um `<input type="date">`) → meia-noite LOCAL. */
export function lerDataLocal(texto: string | null | undefined): Date | null {
  if (!texto) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(ano, mes - 1, dia);
  // "2026-02-31" normaliza para março — não é a data que a pessoa digitou.
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return d;
}

export interface Personalizado {
  desde: string;
  ate: string;
}

export function intervaloDoPreset(
  preset: Preset,
  agora: Date,
  personalizado?: Personalizado | null,
): Intervalo {
  const ano = agora.getFullYear();
  const mes = agora.getMonth();
  switch (preset) {
    case "este_mes":
      return { desde: inicioDoMesLocal(ano, mes), ate: null };
    case "mes_passado":
      return { desde: inicioDoMesLocal(ano, mes - 1), ate: inicioDoMesLocal(ano, mes) };
    case "este_ano":
      return { desde: new Date(ano, 0, 1), ate: null };
    case "ano_passado":
      return { desde: new Date(ano - 1, 0, 1), ate: new Date(ano, 0, 1) };
    case "total":
      return INTERVALO_TOTAL;
    case "personalizado": {
      let desde = lerDataLocal(personalizado?.desde);
      let ate = lerDataLocal(personalizado?.ate);
      if (!desde && !ate) return INTERVALO_TOTAL;
      if (desde && ate && desde > ate) [desde, ate] = [ate, desde];
      // o fim digitado é INCLUSIVO; o intervalo é exclusivo
      return { desde, ate: ate ? diaSeguinte(ate) : null };
    }
  }
}

/** O instante onde o intervalo termina: `ate`, ou o fim de hoje quando aberto. */
export function fimDoIntervalo(intervalo: Intervalo, agora: Date): Date | null {
  if (intervalo.ate) return intervalo.ate;
  if (intervalo.desde) return diaSeguinte(inicioDoDiaLocal(agora));
  return null;
}

export function periodoAnterior(intervalo: Intervalo, agora: Date): Intervalo | null {
  if (!intervalo.desde) return null;
  const fim = fimDoIntervalo(intervalo, agora);
  if (!fim) return null;
  // Dias de calendário, arredondados: um dia de 23h ou 25h (virada de
  // horário de verão) continua contando como UM dia.
  const dias = Math.round((fim.getTime() - intervalo.desde.getTime()) / DIA_MS);
  if (dias <= 0) return null;
  const d = intervalo.desde;
  return {
    desde: new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() - dias,
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
      d.getMilliseconds(),
    ),
    ate: intervalo.desde,
  };
}

export function dentroDoIntervalo(d: Date, intervalo: Intervalo): boolean {
  if (intervalo.desde && d < intervalo.desde) return false;
  if (intervalo.ate && d >= intervalo.ate) return false;
  return true;
}

/**
 * Chaves de dia (AAAA-MM-DD) DENSAS do `desde` ao fim do intervalo, para o
 * gráfico de entradas não pular dia sem lead. Vazio quando não há `desde`.
 */
export function diasDoIntervalo(intervalo: Intervalo, agora: Date): string[] {
  if (!intervalo.desde) return [];
  const fim = fimDoIntervalo(intervalo, agora);
  if (!fim) return [];
  const dias: string[] = [];
  for (let d = inicioDoDiaLocal(intervalo.desde); d < fim; d = diaSeguinte(d)) {
    dias.push(localDayKey(d));
    if (dias.length > 4000) break; // 10+ anos num período: ninguém desenha isso por dia
  }
  return dias;
}

export interface MesDoHistorico {
  /** AAAA-MM */
  chave: string;
  ano: number;
  mes0: number;
  desde: Date;
  ate: Date;
}

/** Os últimos `n` meses, do mais antigo ao atual (o atual, parcial). */
export function mesesAnteriores(agora: Date, n: number): MesDoHistorico[] {
  const ano = agora.getFullYear();
  const mes = agora.getMonth();
  const meses: MesDoHistorico[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const desde = inicioDoMesLocal(ano, mes - i);
    const ate = inicioDoMesLocal(ano, mes - i + 1);
    meses.push({
      chave: `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, "0")}`,
      ano: desde.getFullYear(),
      mes0: desde.getMonth(),
      desde,
      ate,
    });
  }
  return meses;
}

/** Diferença em dias inteiros entre dois instantes (para rótulos). */
export function duracaoEmDias(intervalo: Intervalo, agora: Date): number | null {
  if (!intervalo.desde) return null;
  const fim = fimDoIntervalo(intervalo, agora);
  if (!fim) return null;
  return Math.round((fim.getTime() - intervalo.desde.getTime()) / DIA_MS);
}
