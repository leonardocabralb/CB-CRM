// ============================================================
// Condição por CAMPO PERSONALIZADO da ficha (Fase 2.10 do plano do
// previdenciário, CB, 26/09/2026): "o campo X é / contém / está vazio / não
// está vazio". É o que faz a automação de volta devolver ao robô SÓ o
// "Desqualificado" por "Não respondeu" (`aa_motivo_desqualificacao`): a
// condição "campo do contato" antiga (`contact_field`) só lê colunas de
// `contacts`.
//
// `step_config`: `subject: 'custom_field'`, `operand` = `custom_fields.id` (da
// conta da automação), `operator`, `value`. Puro: o motor (`engine.ts`) lê o
// valor e chama `campoAtendeACondicao`; a ativação confere a forma
// (`problemaDaFormaDaCondicao`, em `validate.ts`) e, na rota, com os campos da
// conta carregados, o que só o banco responde (`problemaDaCondicaoPorCampo`).
//
// Os operadores por tipo de campo são o MENOR conjunto que serve:
// - texto: é, contém, vazio, preenchido;
// - lista (`select`) e número: é, vazio, preenchido ("contém" num campo de
//   lista não pergunta nada que "é" não pergunte);
// - data: só vazio/preenchido — a coluna guarda ISO em UTC, e "é 30/08/2026"
//   nunca casaria.
//
// ⚠️ "é" e "contém" comparam SEM diferença de maiúsculas e sem os espaços das
// pontas (a régua de `message_content`): um "não respondeu" digitado casa com
// "Não respondeu". Acento conta. No campo de número, "é" compara o VALOR,
// lido pela MESMA régua do robô (`numeroDigitado`: "150.000" é 150 mil, "2,5"
// é dois e meio) — "150000" casa com "150.000".
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import type { CustomField, OperadorDoCampo } from '@/types'
import { opcoesDoCampo } from '@/lib/contacts/campo-opcoes'
import { numeroDigitado } from '@/lib/flows/resposta-na-ficha'

export const OPERADORES_DO_CAMPO: readonly OperadorDoCampo[] = [
  'equals',
  'contains',
  'empty',
  'not_empty',
]

/** O operador gravado; ausente = `equals`; qualquer outra coisa = `null`. */
export function operadorDaCondicao(v: unknown): OperadorDoCampo | null {
  if (v === undefined || v === null || v === '') return 'equals'
  return typeof v === 'string' && (OPERADORES_DO_CAMPO as readonly string[]).includes(v)
    ? (v as OperadorDoCampo)
    : null
}

/** Os operadores que o tipo de campo aceita (ver o cabeçalho). */
export function operadoresDoTipo(fieldType: string): OperadorDoCampo[] {
  switch (fieldType) {
    case 'datetime':
      return ['empty', 'not_empty']
    case 'select':
    case 'number':
      return ['equals', 'empty', 'not_empty']
    default:
      return [...OPERADORES_DO_CAMPO]
  }
}

/** "é" e "contém" comparam com um valor; vazio/preenchido, não. */
export function operadorPedeValor(op: OperadorDoCampo): boolean {
  return op === 'equals' || op === 'contains'
}

function normalizar(s: string): string {
  return s.trim().toLowerCase()
}

function comoNumero(s: string): number | null {
  const canonico = numeroDigitado(s)
  if (canonico === null) return null
  const n = Number(canonico)
  return Number.isFinite(n) ? n : null
}

/**
 * O valor gravado na ficha atende à condição? `gravado` nulo/ausente = o
 * contato não tem valor nesse campo (a linha de `contact_custom_values` não
 * existe) — que é "vazio". Valor esperado em branco nunca casa com "é" nem
 * com "contém" (a ativação o recusa).
 */
export function campoAtendeACondicao(args: {
  operador: OperadorDoCampo
  tipo: string
  gravado: string | null | undefined
  esperado: string | null | undefined
}): boolean {
  const gravado = (args.gravado ?? '').trim()
  const esperado = (args.esperado ?? '').trim()
  switch (args.operador) {
    case 'empty':
      return gravado === ''
    case 'not_empty':
      return gravado !== ''
    case 'equals': {
      if (gravado === '' || esperado === '') return false
      if (args.tipo === 'number') {
        const a = comoNumero(gravado)
        const b = comoNumero(esperado)
        if (a !== null && b !== null) return a === b
      }
      return normalizar(gravado) === normalizar(esperado)
    }
    case 'contains':
      if (esperado === '') return false
      return normalizar(gravado).includes(normalizar(esperado))
  }
}

/** O que a ativação precisa saber de um campo da conta. */
export interface CampoParaCondicao {
  field_name: string
  field_type: string
  /** As opções do campo `select` (`opcoesDoCampo`); vazio nos demais. */
  opcoes: string[]
}

/**
 * O que a ESTRUTURA da condição precisa ter, sem banco (`validateOne`, no
 * navegador e na rota): operador conhecido e, para "é"/"contém", um valor.
 */
export function problemaDaFormaDaCondicao(cfg: { operator?: unknown; value?: unknown }): string | null {
  const op = operadorDaCondicao(cfg.operator)
  if (!op) return 'A condição "Campo personalizado da ficha" tem um operador desconhecido — escolha "é", "contém", "está vazio" ou "não está vazio".'
  const valor = typeof cfg.value === 'string' ? cfg.value.trim() : ''
  if (operadorPedeValor(op) && !valor) {
    return 'A condição "Campo personalizado da ficha" precisa do valor a comparar.'
  }
  return null
}

/**
 * O que só o BANCO responde (a rota, com os campos da conta carregados), em
 * frase para o operador — ou `null`. `campo` ausente = não existe NESTA conta
 * (apagado, ou de outra conta). O que é da forma (operador desconhecido,
 * valor vazio) fica com `problemaDaFormaDaCondicao`, para não sair duas vezes.
 */
export function problemaDaCondicaoPorCampo(
  cfg: { operator?: unknown; value?: unknown },
  campo: CampoParaCondicao | undefined,
): string | null {
  if (!campo) {
    return 'O campo escolhido na condição "Campo personalizado da ficha" não existe nesta conta (foi apagado?) — escolha outro campo.'
  }
  const op = operadorDaCondicao(cfg.operator)
  if (!op) return null
  if (!operadoresDoTipo(campo.field_type).includes(op)) {
    return campo.field_type === 'datetime'
      ? `O campo "${campo.field_name}" é uma data: a condição só pode perguntar se ele está vazio ou preenchido.`
      : `O campo "${campo.field_name}" não aceita "contém" — use "é", "está vazio" ou "não está vazio".`
  }
  const valor = typeof cfg.value === 'string' ? cfg.value.trim() : ''
  if (!operadorPedeValor(op) || !valor) return null
  if (campo.field_type === 'select' && !campo.opcoes.some((o) => normalizar(o) === normalizar(valor))) {
    return `"${valor}" não é uma opção do campo "${campo.field_name}" (as opções mudaram?) — escolha uma das opções da lista.`
  }
  if (campo.field_type === 'number' && comoNumero(valor) === null) {
    return `O campo "${campo.field_name}" é um número: o valor da condição precisa ser um número.`
  }
  return null
}

/** Os ids de campo que as condições por campo apontam (com ramos). */
export function camposDasCondicoes(steps: ReadonlyArray<PassoComRamos>): string[] {
  const ids = new Set<string>()
  const andar = (lista: ReadonlyArray<PassoComRamos> | undefined) => {
    for (const s of lista ?? []) {
      if (s.step_type === 'condition' && s.step_config?.subject === 'custom_field') {
        const id = typeof s.step_config.operand === 'string' ? s.step_config.operand.trim() : ''
        if (FORMA_DE_UUID.test(id)) ids.add(id)
      }
      andar(s.branches?.yes)
      andar(s.branches?.no)
    }
  }
  andar(steps)
  return [...ids]
}

export interface PassoComRamos {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: PassoComRamos[]; no?: PassoComRamos[] }
}

const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * O operando tem forma de id de campo? Sem ela nem vai ao banco: o Postgres o
 * recusaria (22P02), derrubando a consulta, e o motor diria "leitura falhou"
 * sobre um valor que simplesmente não é campo nenhum.
 */
export function ehIdDeCampo(v: string): boolean {
  return FORMA_DE_UUID.test(v)
}

/**
 * I/O: os campos DESTA conta entre os que as condições apontam (service role
 * na rota — o `.eq('account_id')` é a cerca). `null` = a leitura falhou: quem
 * chama pula a conferência, e o motor continua sendo a guarda (campo de outra
 * conta nunca é lido; campo apagado responde "não", com a nota).
 */
export async function carregarCamposParaCondicoes(
  db: SupabaseClient,
  accountId: string,
  steps: ReadonlyArray<PassoComRamos>,
): Promise<Map<string, CampoParaCondicao> | null> {
  const ids = camposDasCondicoes(steps)
  if (ids.length === 0) return new Map()
  const { data, error } = await db
    .from('custom_fields')
    .select('id, field_name, field_type, field_options')
    .eq('account_id', accountId)
    .in('id', ids)
  if (error) return null
  return new Map(
    ((data ?? []) as Array<Pick<CustomField, 'id' | 'field_name' | 'field_type' | 'field_options'>>).map((c) => [
      c.id,
      { field_name: c.field_name, field_type: c.field_type, opcoes: opcoesDoCampo(c as CustomField) },
    ]),
  )
}
