// ============================================================
// Textos que o SERVIDOR grava para a equipe ler (a anotação de transferência
// do agente, a da passagem e a de cada AÇÃO que ele fez — F4). O turno roda no `after()` da ingestão ou do cron, sem pedido de
// tela: o idioma é o da instalação (`NEXT_PUBLIC_APP_LOCALE`, o mesmo de
// `src/i18n/request.ts`), e o texto sai do dicionário — nunca frase fixa no
// código (o `ai_handoff_summary` do app anterior era inglês fixo).
// ============================================================

import { createTranslator } from 'next-intl'

import type { TipoDeAcao } from './agente'

/**
 * `link_inventado` (F4): a resposta trazia uma URL que não veio do sistema
 * (5.6) — ela é retida e a conversa vai para gente.
 */
export const MOTIVOS_DE_TRANSFERENCIA = ['sentinela', 'teto', 'audio', 'incerto', 'link_inventado'] as const
export type MotivoDeTransferencia = (typeof MOTIVOS_DE_TRANSFERENCIA)[number]

type Dicionario = { locale: string; messages: Record<string, unknown> }
let carregado: Promise<Dicionario> | null = null

async function dicionario(): Promise<Dicionario> {
  carregado ??= (async () => {
    const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en'
    try {
      return { locale, messages: (await import(`../../../messages/${locale}.json`)).default }
    } catch {
      return { locale: 'en', messages: (await import('../../../messages/en.json')).default }
    }
  })()
  return carregado
}

/** O autor ("IA · Triagem") e o texto da anotação de uma transferência. */
export async function textosDaTransferencia(
  agente: string,
  motivo: MotivoDeTransferencia,
): Promise<{ autor: string; texto: string }> {
  const { locale, messages } = await dicionario()
  // O dicionário é carregado em tempo de execução (o do idioma da instalação),
  // então o tradutor não tem as chaves tipadas: a função é tipada à mão. As
  // chaves existem nos dois dicionários — `textos-do-servidor.test.ts` cobra.
  const t = createTranslator({ locale, messages, namespace: 'IaAgentes.transferencia' }) as unknown as (
    chave: string,
    valores: Record<string, string>,
  ) => string
  return {
    autor: t('autor', { agente }),
    texto: t(`nota.${motivo}`, { agente }),
  }
}

/**
 * O autor ("IA · Triagem") e o texto da anotação da PASSAGEM (D25): a
 * triagem entregou a conversa a outro agente e o card foi para a etapa dele.
 * Chave `IaAgentes.transferencia.passagem`, com `{agente}` e `{destino}`.
 */
export async function textosDaPassagem(agente: string, destino: string): Promise<{ autor: string; texto: string }> {
  const { locale, messages } = await dicionario()
  const t = createTranslator({ locale, messages, namespace: 'IaAgentes.transferencia' }) as unknown as (
    chave: string,
    valores: Record<string, string>,
  ) => string
  return { autor: t('autor', { agente }), texto: t('passagem', { agente, destino }) }
}

/**
 * A anotação de uma AÇÃO que o agente fez junto com a resposta (F4, D28):
 * "IA · Triagem moveu o card para Bancário · Proposta". Chave
 * `IaAgentes.transferencia.acoes.<tipo>`, com `{agente}`, `{alvo}` (o nome
 * da etapa, etiqueta, campo, membro ou automação) e `{valor}` (o valor do
 * campo, o título da tarefa).
 */
export async function textosDaAcao(
  agente: string,
  tipo: TipoDeAcao,
  alvo: string,
  valor: string = '',
): Promise<{ autor: string; texto: string }> {
  const { locale, messages } = await dicionario()
  const t = createTranslator({ locale, messages, namespace: 'IaAgentes.transferencia' }) as unknown as (
    chave: string,
    valores: Record<string, string>,
  ) => string
  return { autor: t('autor', { agente }), texto: t(`acoes.${tipo}`, { agente, alvo, valor }) }
}

/** O título do aviso no sino de quem recebe a tarefa que o agente criou. */
export async function avisoDaTarefa(agente: string): Promise<string> {
  const { locale, messages } = await dicionario()
  const t = createTranslator({ locale, messages, namespace: 'IaAgentes.transferencia' }) as unknown as (
    chave: string,
    valores: Record<string, string>,
  ) => string
  return t('acoes.avisoDaTarefa', { agente })
}
