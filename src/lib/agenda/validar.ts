// ============================================================
// Validação da reunião (migration 945).
//
// Mora fora das rotas porque criar e editar validam a MESMA coisa, e duas
// cópias divergindo é como se cria o caminho em que a edição aceita o que a
// criação recusa.
//
// ⚠️ Isto NÃO substitui os CHECKs do banco — os duplica de propósito. O banco é
// quem garante; esta camada existe para o operador receber uma frase em vez de
// um erro de Postgres na tela.
// ============================================================

import type { MeetingStatus, MeetingType } from '@/types';

import { fusoValido } from './fuso';

export const TIPOS: readonly MeetingType[] = ['onboarding', 'atualizacao', 'outra'];

export const STATUS: readonly MeetingStatus[] = [
  'agendada',
  'realizada',
  'cancelada',
  'falta',
];

/** Mesmos tetos do CHECK da 945 — se um mudar, o outro tem de mudar junto. */
export const MAX_TITULO = 200;
export const MAX_DESCRICAO = 4000;
export const MAX_LOCAL = 500;

/**
 * Teto de duração de uma reunião.
 *
 * ⚠️ NÃO existe no banco, de propósito: uma reunião de dois dias é esquisita,
 * não inválida, e um CHECK a tornaria impossível de registrar. Aqui o limite
 * protege a TELA — o calendário de mês desenha cada reunião como uma faixa, e
 * uma de trinta dias atravessaria o mês inteiro tornando a grade ilegível.
 */
export const MAX_DURACAO_HORAS = 24;

export interface DadosDaReuniao {
  titulo?: unknown;
  descricao?: unknown;
  local?: unknown;
  tipo?: unknown;
  status?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
}

/** `null` quando está tudo certo; a frase do erro quando não está. */
export type Erro = string | null;

function textoOuNulo(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

/**
 * A data chegou num formato que o Postgres aceita como `timestamptz`?
 *
 * ⚠️ Exige o fuso escrito na string (`Z` ou `±HH:MM`). Sem ele o Postgres
 * interpreta o texto como UTC e a reunião das 14h vira 11h — o erro de três
 * horas que a 935 documenta, e que não estoura em lugar nenhum.
 */
export function instanteValido(valor: unknown): boolean {
  if (typeof valor !== 'string' || !valor.trim()) return false;
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(valor.trim())) return false;
  return !Number.isNaN(new Date(valor).getTime());
}

/**
 * Valida o corpo de uma criação (todos os campos obrigatórios presentes) ou de
 * uma edição (só o que veio é conferido).
 */
export function validarReuniao(
  dados: DadosDaReuniao,
  { parcial = false }: { parcial?: boolean } = {},
): Erro {
  const temTitulo = dados.titulo !== undefined;
  if (!parcial || temTitulo) {
    const titulo = textoOuNulo(dados.titulo);
    if (!titulo) return 'A reunião precisa de um título.';
    if (titulo.length > MAX_TITULO) {
      return `O título passa de ${MAX_TITULO} caracteres.`;
    }
  }

  const descricao = textoOuNulo(dados.descricao);
  if (descricao && descricao.length > MAX_DESCRICAO) {
    return `A descrição passa de ${MAX_DESCRICAO} caracteres.`;
  }

  const local = textoOuNulo(dados.local);
  if (local && local.length > MAX_LOCAL) {
    return `O local passa de ${MAX_LOCAL} caracteres.`;
  }

  if (dados.tipo !== undefined && !TIPOS.includes(dados.tipo as MeetingType)) {
    return 'Tipo de reunião desconhecido.';
  }

  if (
    dados.status !== undefined &&
    !STATUS.includes(dados.status as MeetingStatus)
  ) {
    return 'Situação de reunião desconhecida.';
  }

  // ⚠️ As duas datas andam juntas. Numa edição que mande só uma delas, a
  // comparação abaixo não teria com o que comparar — quem chama precisa
  // completar o par a partir da linha atual antes de validar.
  const temInicio = dados.starts_at !== undefined;
  const temFim = dados.ends_at !== undefined;

  if (!parcial || temInicio || temFim) {
    if (!instanteValido(dados.starts_at)) {
      return 'A data de início é inválida ou está sem fuso horário.';
    }
    if (!instanteValido(dados.ends_at)) {
      return 'A data de término é inválida ou está sem fuso horário.';
    }

    const inicio = new Date(dados.starts_at as string);
    const fim = new Date(dados.ends_at as string);

    if (fim <= inicio) {
      return 'A reunião precisa terminar depois de começar.';
    }

    const horas = (fim.getTime() - inicio.getTime()) / 3_600_000;
    if (horas > MAX_DURACAO_HORAS) {
      return `A reunião não pode passar de ${MAX_DURACAO_HORAS} horas.`;
    }
  }

  return null;
}

/** Valida uma faixa de atendimento (usada pela tela da Fase 2). */
export function validarFaixa(faixa: {
  dia_da_semana?: unknown;
  hora_inicio?: unknown;
  hora_fim?: unknown;
  timezone?: unknown;
  duracao_minutos?: unknown;
}): Erro {
  const dia = faixa.dia_da_semana;
  if (typeof dia !== 'number' || !Number.isInteger(dia) || dia < 0 || dia > 6) {
    return 'Dia da semana inválido.';
  }

  const hora = /^\d{2}:\d{2}(:\d{2})?$/;
  if (typeof faixa.hora_inicio !== 'string' || !hora.test(faixa.hora_inicio)) {
    return 'Hora de início inválida.';
  }
  if (typeof faixa.hora_fim !== 'string' || !hora.test(faixa.hora_fim)) {
    return 'Hora de término inválida.';
  }
  if (faixa.hora_fim <= faixa.hora_inicio) {
    return 'A faixa precisa terminar depois de começar.';
  }

  // ⚠️ A 945 NÃO valida o nome do fuso (CHECK não aceita consulta a
  // `pg_timezone_names`). Se esta linha sair, fuso inventado passa a ser
  // gravável e só aparece quando alguém tenta calcular um horário.
  if (typeof faixa.timezone !== 'string' || !fusoValido(faixa.timezone)) {
    return 'Fuso horário desconhecido.';
  }

  const duracao = faixa.duracao_minutos;
  if (
    typeof duracao !== 'number' ||
    !Number.isInteger(duracao) ||
    duracao <= 0 ||
    duracao > 1440
  ) {
    return 'Duração inválida.';
  }

  return null;
}
