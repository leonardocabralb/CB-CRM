// ============================================================
// A PAUSA da IA na conversa: temporária × permanente (1138, revisa a D26;
// decisões do operador de 11/11/2026, docs/PLANO-pausa-temporaria-da-ia.md).
//
// Configuração da CONTA (`ai_configs.ia_volta_apos_min`, a linha padrão): vale
// para todo agente. Com N > 0:
//  - as pausas `gente` (a equipe respondeu) e `botao` (o "Pausar") são
//    TEMPORÁRIAS: a mensagem da cliente enfileira o turno para quando ela
//    estiver esperando há N min (âncora = a 1ª mensagem sem resposta, 972, ou
//    a pausa, a mais nova); a resposta da equipe o descarta (o gatilho da
//    1138); vencido, o turno LEVANTA a pausa (`cb_ia_voltar_da_pausa`) e
//    responde;
//  - a fala da equipe PRÉ-ARMA o follow-up (a retomada da 1056 ancorada na
//    mensagem da equipe); o follow-up que sai levanta a pausa `gente`;
//  - `desativada` (o "Desativar IA"), `transferencia` e `automacao` são
//    PERMANENTES: só o "Retomar IA" (ou o `set_ai` "ligar", na de automação).
// Com N = 0, tudo como antes da 1138: toda pausa até o "Retomar IA".
//
// ⚠️ A lista dos motivos e as marcas vivem TAMBÉM no SQL da 1138 (o gatilho e
// a função): pino `supabase/migrations/pausa-temporaria-1138.test.ts`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/** Os motivos de `conversations.ia_pausada_por` (o CHECK da 1138). */
export const MOTIVOS_DA_PAUSA = ['gente', 'botao', 'desativada', 'transferencia', 'automacao'] as const
export type MotivoDaPausa = (typeof MOTIVOS_DA_PAUSA)[number]

/** As pausas que VOLTAM sozinhas (com N > 0 na conta). */
export const MOTIVOS_TEMPORARIOS: readonly MotivoDaPausa[] = ['gente', 'botao']

/** O padrão da conta (o DEFAULT da coluna). */
export const VOLTA_APOS_MIN_PADRAO = 15
/** O teto aceito (o CHECK da coluna): um dia. */
export const VOLTA_APOS_MIN_TETO = 1440

/** A marca do turno que espera a equipe responder (a aba Turnos a reconhece). */
export const ERRO_DA_ESPERA_DA_EQUIPE = 'aguardando a equipe responder'
/** A marca da PRÉ-ARMAÇÃO do follow-up depois da fala da equipe (gravada pelo gatilho da 1138). */
export const ERRO_DA_ARMACAO_PELA_EQUIPE = 'armar a partir da fala da equipe'
/** O retorno descartado porque a equipe respondeu antes (o gatilho e o turno). */
export const ERRO_DA_EQUIPE_RESPONDEU = 'a equipe respondeu'

export function ehMotivoTemporario(motivo: string | null | undefined): boolean {
  return (MOTIVOS_TEMPORARIOS as readonly string[]).includes(motivo ?? '')
}

/** A configuração lida da linha: inteiro de 0 ao teto; fora disso, o padrão. */
export function lerMinutos(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= VOLTA_APOS_MIN_TETO ? v : VOLTA_APOS_MIN_PADRAO
}

/**
 * Em quantos minutos sem resposta da equipe a IA volta, na CONTA. Sem a linha
 * padrão, o padrão. LANÇA em erro de leitura: quem chama falha FECHADO (a
 * conversa fica pausada — o lado que não fala por cima da equipe).
 */
export async function lerVoltaAposMin(db: SupabaseClient, accountId: string): Promise<number> {
  const { data, error } = await db
    .from('ai_configs')
    .select('ia_volta_apos_min')
    .eq('account_id', accountId)
    .is('channel_id', null)
    .maybeSingle()
  if (error) throw new Error(`[ia-agentes] leitura da pausa da conta falhou: ${error.message}`)
  return data ? lerMinutos((data as { ia_volta_apos_min?: unknown }).ia_volta_apos_min) : VOLTA_APOS_MIN_PADRAO
}

function instante(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/**
 * Quando a IA volta para a mensagem que acabou de chegar: a cliente esperando
 * há N min, contados da 1ª mensagem sem resposta (`aguardando_desde`, 972) ou
 * da pausa, a mais nova — o "Pausar" apertado depois recomeça dali. A MESMA
 * conta de `cb_ia_voltar_da_pausa` (1138), que decide de novo na hora.
 */
export function voltaDaPausaEm(args: {
  agora: number
  aguardandoDesde: string | null
  pausadaEm: string | null
  minutos: number
}): number {
  const ancora = Math.max(instante(args.aguardandoDesde) ?? args.agora, instante(args.pausadaEm) ?? args.agora)
  return ancora + args.minutos * 60_000
}

/** O que `cb_ia_voltar_da_pausa` responde. */
export type ResultadoDaVolta =
  | 'voltou'
  | 'cedo'
  | 'equipe_respondeu'
  | 'alguem_escreveu'
  | 'permanente'
  | 'nao_pausada'
  | 'encerrada'
  | 'sem_gatilho'
  | 'descartado'

const RESULTADOS: ReadonlySet<string> = new Set<ResultadoDaVolta>([
  'voltou',
  'cedo',
  'equipe_respondeu',
  'alguem_escreveu',
  'permanente',
  'nao_pausada',
  'encerrada',
  'sem_gatilho',
  'descartado',
])

/**
 * O turno LEVANTA a pausa temporária (`cb_ia_voltar_da_pausa`, 1138): sob a
 * trava da conversa e com a cerca de posse. `voltaEm` vem com `cedo`. LANÇA em
 * erro (o turno vira `falhou`).
 */
export async function voltarDaPausa(
  db: SupabaseClient,
  turno: { id: string; rodando_desde: string },
  minutos: number,
): Promise<{ resultado: ResultadoDaVolta; voltaEm: string | null }> {
  const { data, error } = await db.rpc('cb_ia_voltar_da_pausa', {
    p_turno_id: turno.id,
    p_rodando_desde: turno.rodando_desde,
    p_minutos: minutos,
  })
  if (error) throw new Error(`[ia-agentes] levantar a pausa falhou: ${error.message}`)
  const linha = (Array.isArray(data) ? data[0] : data) as { resultado?: unknown; volta_em?: unknown } | null
  const resultado = typeof linha?.resultado === 'string' && RESULTADOS.has(linha.resultado) ? linha.resultado : null
  if (!resultado) throw new Error('[ia-agentes] levantar a pausa: resposta desconhecida')
  return {
    resultado: resultado as ResultadoDaVolta,
    voltaEm: typeof linha?.volta_em === 'string' ? linha.volta_em : null,
  }
}
