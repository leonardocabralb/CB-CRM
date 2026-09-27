// ============================================================
// Textos que o SERVIDOR grava para a equipe ler (a anotação de transferência
// do agente, a da passagem e a de cada AÇÃO que ele fez — F4). O turno roda no `after()` da ingestão ou do cron, sem pedido de
// tela: o idioma é o da instalação (`NEXT_PUBLIC_APP_LOCALE`, o mesmo de
// `src/i18n/request.ts`), e o texto sai do dicionário — nunca frase fixa no
// código (o `ai_handoff_summary` do app anterior era inglês fixo).
// ============================================================

import { createTranslator } from 'next-intl'

import { CODIGOS_DE_FALHA_DA_ACAO, type CodigoDeFalhaDaAcao, type MotivoDaRecusa } from './acoes'
import type { TipoDeAcao } from './agente'

/**
 * `link_inventado` (F4): a resposta trazia uma URL que não veio do sistema
 * (5.6) — ela é retida e a conversa vai para gente. `reuniao_nao_marcada`
 * (F5): a resposta SAIU, mas a reunião pedida não foi marcada (a nota diz o
 * motivo, `{motivo}`) — gente confirma o horário com o cliente.
 * `reuniao_prometida` (F5, 27/09/2026): a resposta dizia que a reunião
 * estava marcada SEM o marcador (`reuniaoPrometida`) — ela é retida (nada
 * foi marcado) e a conversa vai para gente.
 */
export const MOTIVOS_DE_TRANSFERENCIA = [
  'sentinela',
  'teto',
  'audio',
  'incerto',
  'link_inventado',
  'reuniao_nao_marcada',
  'reuniao_prometida',
] as const
export type MotivoDeTransferencia = (typeof MOTIVOS_DE_TRANSFERENCIA)[number]

/**
 * Os códigos com que uma reunião pode deixar de ser marcada (F5): as recusas
 * da leitura do marcador e as falhas de `marcarNoCalendly`. O `{motivo}` da
 * nota sai do MESMO texto que a aba Turnos mostra para o código
 * (`chaveDoMotivoDaReuniao`); `textos-do-servidor.test.ts` cobra cada chave
 * nos dois dicionários.
 */
export const CODIGOS_DA_REUNIAO_NAO_MARCADA = [
  'malformada',
  'teto',
  'nao_liberada',
  'fora_da_lista',
  'sem_email',
  'horario_indisponivel',
  'calendly_desconectado',
  'recusado',
  'falhou',
] as const satisfies ReadonlyArray<MotivoDaRecusa | CodigoDeFalhaDaAcao>

/**
 * A chave (dentro de `IaAgentes`) do texto de um código de ação: a falha na
 * execução em `turnos.acoes.erro.<c>`, a recusa em `ferramentas.recusa.<c>` —
 * as mesmas da tela.
 */
export function chaveDoMotivoDaReuniao(codigo: string): string {
  return (CODIGOS_DE_FALHA_DA_ACAO as readonly string[]).includes(codigo)
    ? `turnos.acoes.erro.${codigo}`
    : `ferramentas.recusa.${codigo}`
}

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

/**
 * O autor ("IA · Triagem") e o texto da anotação de uma transferência. Na
 * `reuniao_nao_marcada` (F5), `codigoDaReuniao` vira o `{motivo}` da nota.
 */
export async function textosDaTransferencia(
  agente: string,
  motivo: MotivoDeTransferencia,
  codigoDaReuniao?: string | null,
): Promise<{ autor: string; texto: string }> {
  const { locale, messages } = await dicionario()
  // O dicionário é carregado em tempo de execução (o do idioma da instalação),
  // então o tradutor não tem as chaves tipadas: a função é tipada à mão. As
  // chaves existem nos dois dicionários — `textos-do-servidor.test.ts` cobra.
  const t = createTranslator({ locale, messages, namespace: 'IaAgentes.transferencia' }) as unknown as (
    chave: string,
    valores: Record<string, string>,
  ) => string
  if (motivo === 'reuniao_nao_marcada') {
    const tDaTela = createTranslator({ locale, messages, namespace: 'IaAgentes' }) as unknown as (
      chave: string,
      valores?: Record<string, string>,
    ) => string
    const codigo = (CODIGOS_DA_REUNIAO_NAO_MARCADA as readonly string[]).includes(codigoDaReuniao ?? '')
      ? (codigoDaReuniao as string)
      : 'falhou'
    return {
      autor: t('autor', { agente }),
      texto: t('nota.reuniao_nao_marcada', { agente, motivo: tDaTela(chaveDoMotivoDaReuniao(codigo)) }),
    }
  }
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
