// ============================================================
// Textos que o SERVIDOR grava para a equipe ler (a anotação de transferência
// do agente). O turno roda no `after()` da ingestão ou do cron, sem pedido de
// tela: o idioma é o da instalação (`NEXT_PUBLIC_APP_LOCALE`, o mesmo de
// `src/i18n/request.ts`), e o texto sai do dicionário — nunca frase fixa no
// código (o `ai_handoff_summary` do app anterior era inglês fixo).
// ============================================================

import { createTranslator } from 'next-intl'

export const MOTIVOS_DE_TRANSFERENCIA = ['sentinela', 'teto', 'audio', 'incerto'] as const
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
  const t = createTranslator({ locale, messages, namespace: 'IaAgentes.transferencia' })
  return {
    autor: t('autor', { agente }),
    texto: t(`nota.${motivo}`, { agente }),
  }
}
