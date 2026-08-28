// ============================================================
// A grade de horas das visões de semana e dia (migration 945).
//
// Converte reunião em retângulo: onde começa (topo) e quanto ocupa (altura),
// mais o arranjo lado a lado quando duas se sobrepõem.
//
// Puro e testado pelo mesmo motivo do `vagas.ts`: erro de meia hora aqui
// desenha a reunião no lugar errado e ninguém percebe olhando o código — só
// olhando a tela, e só se souber que horas a reunião era.
// ============================================================

import { partesNoFuso } from './fuso';
import type { Meeting } from '@/types';

/** Primeira e última hora desenhadas. */
export const HORA_INICIAL = 6;
export const HORA_FINAL = 23;

/** Altura de uma hora, em pixels. É a régua de toda a conversão. */
export const ALTURA_DA_HORA = 56;

/** Minutos de granularidade ao arrastar — meia hora é o passo de agenda. */
export const PASSO_MINUTOS = 15;

export const ALTURA_TOTAL = (HORA_FINAL - HORA_INICIAL + 1) * ALTURA_DA_HORA;

/** As horas que a régua da esquerda imprime. */
export function horasDaRegua(): number[] {
  return Array.from(
    { length: HORA_FINAL - HORA_INICIAL + 1 },
    (_, i) => HORA_INICIAL + i,
  );
}

/** Minutos desde a meia-noite, no fuso da tela. */
export function minutosDoDia(instante: Date, timezone: string): number {
  const p = partesNoFuso(instante, timezone);
  return p.hora * 60 + p.minuto;
}

/**
 * A que altura (px) a reunião começa.
 *
 * ⚠️ Pode ser NEGATIVO para reunião que começa antes de `HORA_INICIAL` — e é
 * assim de propósito: o retângulo é recortado pelo `overflow` do contêiner, o
 * que desenha a reunião "vindo de cima" em vez de fingir que ela começa às 6h.
 */
export function topoEmPx(inicio: Date, timezone: string): number {
  const minutos = minutosDoDia(inicio, timezone) - HORA_INICIAL * 60;
  return (minutos / 60) * ALTURA_DA_HORA;
}

/**
 * A altura (px) do retângulo.
 *
 * ⚠️ Tem um piso: uma reunião de 15 minutos vira uma faixa de 14px, onde não
 * cabe nem o horário. Abaixo do piso o retângulo mente sobre a duração, o que
 * é melhor do que ser ilegível — e a duração real está no título.
 */
export function alturaEmPx(inicio: Date, fim: Date): number {
  const minutos = (fim.getTime() - inicio.getTime()) / 60000;
  return Math.max((minutos / 60) * ALTURA_DA_HORA, 20);
}

/**
 * Quantos minutos um arraste vertical de `deltaY` px representa, arredondado
 * ao passo.
 *
 * É o que transforma "arrastei o cartão 40px para baixo" em "adiei 45 minutos".
 */
export function minutosDoDeslocamento(deltaY: number): number {
  const minutos = (deltaY / ALTURA_DA_HORA) * 60;
  // O `|| 0` normaliza o `-0` que `Math.round` devolve para deslocamentos
  // negativos pequenos. Somar -0 minutos não quebra nada, mas ele sobrevive a
  // `JSON.stringify` e a comparações com `Object.is` — ruído que não precisa
  // existir num número que representa "não mudou".
  return Math.round(minutos / PASSO_MINUTOS) * PASSO_MINUTOS || 0;
}

/** Uma reunião já posicionada na grade. */
export interface ReuniaoPosicionada {
  reuniao: Meeting;
  topo: number;
  altura: number;
  /** Fatia horizontal: 0 = primeira coluna. */
  coluna: number;
  /** Em quantas colunas o grupo sobreposto foi dividido. */
  colunas: number;
}

/**
 * Arruma as reuniões de UM dia, dividindo a largura entre as que se cruzam.
 *
 * ⚠️ Sem isto, duas reuniões no mesmo horário são desenhadas uma EXATAMENTE
 * sobre a outra — a de baixo fica invisível, e o operador jura que só tem uma
 * reunião marcada. É o modo de falha que mais engana, porque a tela parece
 * certa.
 *
 * O algoritmo é o clássico de calendário: varre em ordem de início, abre um
 * "grupo" enquanto houver cruzamento com o grupo corrente, e divide a largura
 * do grupo pelo número máximo de simultâneas dentro dele.
 */
export function posicionarNoDia(
  reunioes: Meeting[],
  timezone: string,
): ReuniaoPosicionada[] {
  const ordenadas = [...reunioes].sort(
    (a, b) =>
      new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime() ||
      new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime(),
  );

  const saida: ReuniaoPosicionada[] = [];
  let grupo: Meeting[] = [];
  let fimDoGrupo = 0;

  const fecharGrupo = () => {
    if (grupo.length === 0) return;

    // Dentro do grupo, cada reunião ocupa a primeira coluna livre — duas que
    // NÃO se cruzam entre si podem dividir a mesma coluna.
    const fimPorColuna: number[] = [];
    const colunaDe = new Map<string, number>();

    for (const r of grupo) {
      const inicio = new Date(r.starts_at).getTime();
      let col = fimPorColuna.findIndex((fim) => fim <= inicio);
      if (col === -1) {
        col = fimPorColuna.length;
        fimPorColuna.push(0);
      }
      fimPorColuna[col] = new Date(r.ends_at).getTime();
      colunaDe.set(r.id, col);
    }

    for (const r of grupo) {
      const inicio = new Date(r.starts_at);
      saida.push({
        reuniao: r,
        topo: topoEmPx(inicio, timezone),
        altura: alturaEmPx(inicio, new Date(r.ends_at)),
        coluna: colunaDe.get(r.id) ?? 0,
        colunas: fimPorColuna.length,
      });
    }

    grupo = [];
    fimDoGrupo = 0;
  };

  for (const r of ordenadas) {
    const inicio = new Date(r.starts_at).getTime();
    const fim = new Date(r.ends_at).getTime();

    // Começou depois de todo mundo do grupo terminar: é outro grupo.
    if (grupo.length > 0 && inicio >= fimDoGrupo) fecharGrupo();

    grupo.push(r);
    fimDoGrupo = Math.max(fimDoGrupo, fim);
  }
  fecharGrupo();

  return saida;
}

/**
 * A que altura (px) fica a linha do "agora".
 *
 * `null` quando o instante está fora da faixa desenhada — a linha não deve ser
 * grampeada no topo nem no rodapé, onde afirmaria uma hora que não é.
 */
export function topoDoAgora(agora: Date, timezone: string): number | null {
  const minutos = minutosDoDia(agora, timezone);
  if (minutos < HORA_INICIAL * 60 || minutos > (HORA_FINAL + 1) * 60) {
    return null;
  }
  return ((minutos - HORA_INICIAL * 60) / 60) * ALTURA_DA_HORA;
}
