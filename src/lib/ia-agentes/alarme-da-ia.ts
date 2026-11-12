// ============================================================
// O ALARME quando a IA para de responder (1140).
//
// Pedido do operador (12/11/2026; `docs/PLANO-alarme-quando-a-ia-para.md`):
// créditos esgotados, chave recusada, modelo retirado ou provedor fora do ar
// terminavam o turno em `falhou` (E8: sem pausar, sem transferir) e ninguém
// era avisado — a cliente só ficava "em atraso". Decisões:
// - F1: alarme no sino e na tela (a caixinha VERMELHA), UM por problema: abre
//   na 1ª falha, lembra a cada `LEMBRAR_APOS_MIN` enquanto durar e diz quando
//   normalizou (a 1ª geração que deu certo depois).
// - F2: a IA NÃO é pausada (a E8 continua): o alarme leva às clientes "Em
//   atraso", e a IA volta sozinha quando o problema for resolvido.
// - F3: recebem o dono, os admins e os marcados (`avisar_ao_transferir`) dos
//   agentes daquele provedor.
//
// O episódio é por (conta, PROVEDOR): a chave e os créditos são do provedor,
// e todos os agentes dele param juntos. A decisão "abre / lembra / só conta"
// mora no banco (`cb_ia_registrar_falha`, sob trava): dois processos falhando
// juntos não abrem dois avisos.
//
// Melhor esforço: o alarme que falha vira log e nunca muda o desfecho do turno.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { diaNoFuso, FUSO_PADRAO, horaNoFuso } from '@/lib/agenda/fuso'
import { AiError } from '@/lib/ai/types'

import { lerMembrosAtivos, type MembroAvisavel } from './aviso-da-transferencia'
import { tradutorDoAlarme } from './textos-do-servidor'

/** O lembrete enquanto o problema dura (F1, decisão do operador: a cada 6 h). */
export const LEMBRAR_APOS_MIN = 6 * 60

export const MOTIVOS_DA_FALHA_DA_IA = [
  'creditos',
  'chave_recusada',
  'sem_chave',
  'modelo',
  'limite_por_minuto',
  'fora_do_ar',
  'cortada',
  'outro',
] as const
export type MotivoDaFalhaDaIa = (typeof MOTIVOS_DA_FALHA_DA_IA)[number]

/**
 * O texto do provedor que diz "acabou o dinheiro": a Anthropic responde 400
 * ("Your credit balance is too low…", "You have reached your specified API
 * usage limits…"), a OpenAI 429 ("You exceeded your current quota, please
 * check your plan and billing details"), o Gemini 429 com "quota"/"billing" ou
 * os créditos pré-pagos esgotados. Lido ANTES do status — senão o 429 sem
 * crédito pareceria só "limite por minuto", que se resolve sozinho.
 * ⚠️ O Gemini escreve "quota" também no limite POR MINUTO: por isso o texto do
 * motivo diz "créditos ou cota" (`IaAgentes.alarme.motivo.creditos`).
 */
const SEM_CREDITO = /credit|usage limit|spend(ing)? limit|insufficient[_ ]quota|billing|quota/i

/** O motivo, em código, de uma falha da GERAÇÃO. Puro. */
export function motivoDaFalhaDaIa(err: unknown): MotivoDaFalhaDaIa {
  if (!(err instanceof AiError)) return 'outro'
  if (SEM_CREDITO.test(err.message)) return 'creditos'
  if (err.code === 'invalid_key') return 'chave_recusada'
  if (err.code === 'rate_limited') return 'limite_por_minuto'
  if (err.code === 'timeout') return 'fora_do_ar'
  if (err.code === 'output_truncated') return 'cortada'
  if (err.code === 'provider_error') {
    if (err.upstreamStatus === 404) return 'modelo'
    if ((err.upstreamStatus ?? 0) >= 500) return 'fora_do_ar'
  }
  return 'outro'
}

/**
 * Quem recebe o alarme (F3). Puro. O dono, os admins e os marcados dos
 * agentes daquele provedor — só quem é membro ATIVO agora. Sem repetição, na
 * ordem: dono e admins, depois os marcados.
 */
export function quemAvisarDoAlarme(membros: readonly MembroAvisavel[], marcados: readonly string[]): string[] {
  const ativos = new Set(membros.map((m) => m.userId))
  const saida = new Set<string>()
  for (const m of membros) if (m.papel === 'owner' || m.papel === 'admin') saida.add(m.userId)
  for (const id of marcados) if (ativos.has(id)) saida.add(id)
  return [...saida]
}

/** "HH:MM" no fuso do escritório; noutro dia, "DD/MM HH:MM". Puro. */
export function quandoNoEscritorio(instante: Date, agora: Date): string {
  const hora = horaNoFuso(instante, FUSO_PADRAO)
  const dia = diaNoFuso(instante, FUSO_PADRAO)
  if (dia === diaNoFuso(agora, FUSO_PADRAO)) return hora
  const [, mes, d] = dia.split('-')
  return `${d}/${mes} ${hora}`
}

// ------------------------------------------------------------
// Os textos (o idioma da instalação, como os de `textos-do-servidor.ts`)
// ------------------------------------------------------------

type Tradutor = (chave: string, valores?: Record<string, string | number>) => string

/** Título e corpo do alarme (a falha e o lembrete) e do "normalizou". Puro sobre o tradutor. */
export function textosDoAlarme(
  t: Tradutor,
  aviso:
    | { tipo: 'abriu' | 'continua'; provedor: string; motivo: MotivoDaFalhaDaIa; desde: Date; falhas: number; agora: Date }
    | { tipo: 'voltou'; provedor: string; desde: Date; falhas: number; agora: Date },
): { titulo: string; corpo: string } {
  const provedor = t(`provedor.${aviso.provedor}`)
  if (aviso.tipo === 'voltou') {
    return {
      titulo: t('titulo.voltou', { provedor }),
      corpo: t('corpo.voltou', {
        desde: quandoNoEscritorio(aviso.desde, aviso.agora),
        agora: quandoNoEscritorio(aviso.agora, aviso.agora),
        falhas: aviso.falhas,
      }),
    }
  }
  return {
    titulo: t(`titulo.${aviso.tipo}`, { provedor }),
    corpo: `${t(`motivo.${aviso.motivo}`, { provedor })} ${t('corpo.desde', {
      desde: quandoNoEscritorio(aviso.desde, aviso.agora),
      falhas: aviso.falhas,
    })}`,
  }
}

/**
 * Os títulos do alarme DESTE provedor (o que abriu e o lembrete). O aviso não
 * guarda o provedor; o título o carrega, montado pela mesma função — é por
 * ele que o lembrete e o "voltou" aposentam só os alarmes deste provedor.
 * Puro sobre o tradutor.
 */
export function titulosDoAlarme(t: Tradutor, provedor: string): string[] {
  const nome = t(`provedor.${provedor}`)
  return [t('titulo.abriu', { provedor: nome }), t('titulo.continua', { provedor: nome })]
}

// ------------------------------------------------------------
// A gravação
// ------------------------------------------------------------

/**
 * Marca como lidos os alarmes NÃO lidos deste episódio (desde a abertura) e
 * deste provedor. O lembrete SUBSTITUI o anterior (senão um dia de problema
 * empilharia quatro caixinhas vermelhas iguais na abertura do CRM, D6 da
 * 1139); o "voltou" os encerra. O UPDATE do tempo real fecha a caixinha
 * aberta. Falha vira log: o aviso novo sai mesmo assim.
 */
async function aposentarAlarmes(
  db: SupabaseClient,
  accountId: string,
  desde: Date,
  titulos: string[],
  agora: Date,
): Promise<void> {
  const { error } = await db
    .from('notifications')
    .update({ read_at: agora.toISOString() })
    .eq('account_id', accountId)
    .eq('type', 'ia_falhou')
    .is('read_at', null)
    .gte('created_at', desde.toISOString())
    .in('title', titulos)
  if (error) console.warn('[ia-agentes] alarmes da IA não marcados como lidos:', error.message)
}

/** Os marcados de TODOS os agentes daquele provedor na conta (não arquivados). */
async function marcadosDoProvedor(db: SupabaseClient, accountId: string, provedor: string): Promise<string[]> {
  const { data, error } = await db
    .from('cb_ia_agentes')
    .select('avisar_ao_transferir')
    .eq('account_id', accountId)
    .eq('provedor', provedor)
    .is('arquivado_em', null)
  if (error) throw new Error(`leitura dos agentes: ${error.message}`)
  const ids = ((data ?? []) as Array<{ avisar_ao_transferir: unknown }>).flatMap((a) =>
    Array.isArray(a.avisar_ao_transferir) ? a.avisar_ao_transferir.filter((x): x is string => typeof x === 'string') : [],
  )
  return [...new Set(ids)]
}

/** Grava o aviso para quem recebe (F3). Devolve os ids gravados. */
async function gravarAviso(
  db: SupabaseClient,
  accountId: string,
  provedor: string,
  tipo: 'ia_falhou' | 'ia_voltou',
  textos: { titulo: string; corpo: string },
): Promise<string[]> {
  const [membros, marcados] = await Promise.all([
    lerMembrosAtivos(db, accountId),
    marcadosDoProvedor(db, accountId, provedor),
  ])
  const destinatarios = quemAvisarDoAlarme(membros, marcados)
  if (destinatarios.length === 0) {
    console.warn('[ia-agentes] alarme da IA sem destinatário:', accountId, provedor)
    return []
  }
  const { data, error } = await db.from('notifications').insert(
    destinatarios.map((userId) => ({
      account_id: accountId,
      user_id: userId,
      type: tipo,
      conversation_id: null,
      contact_id: null,
      actor_user_id: null,
      title: textos.titulo,
      body: textos.corpo,
    })),
  ).select('id')
  if (error) throw new Error(`gravação do aviso: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map((l) => l.id)
}

/**
 * ⚠️ A corrida com o "voltou" (Codex, #512): entre a decisão do banco e a
 * gravação do alarme, a geração boa de OUTRO turno pode fechar o episódio e
 * aposentar os alarmes dele — o nosso, gravado depois, ficaria vermelho e não
 * lido com a IA de pé, e nada mais o aposentaria. Por isso, DEPOIS de gravar,
 * relê o episódio: fechado (ou já outro) = os avisos que este turno acabou de
 * gravar saem como lidos. Um dos dois lados sempre vê o do outro: o alarme
 * grava e depois lê; o "voltou" fecha e depois aposenta. Só os ids gravados
 * aqui — o alarme de um episódio NOVO não é tocado.
 */
async function conferirSeAindaParada(
  db: SupabaseClient,
  args: { accountId: string; provedor: string },
  desde: Date,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  const { data, error } = await db
    .from('cb_ia_alarmes')
    .select('desde, normalizou_em')
    .eq('account_id', args.accountId)
    .eq('provedor', args.provedor)
    .maybeSingle()
  if (error) {
    console.warn('[ia-agentes] episódio do alarme não relido:', error.message)
    return
  }
  const ep = data as { desde?: unknown; normalizou_em?: unknown } | null
  const aindaAberto =
    !!ep && ep.normalizou_em == null && typeof ep.desde === 'string' && Date.parse(ep.desde) === desde.getTime()
  if (aindaAberto) return
  const { error: erroLido } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null)
  if (erroLido) console.warn('[ia-agentes] alarme da IA que voltou não marcado como lido:', erroLido.message)
}

/**
 * Uma resposta da IA não saiu por um problema DELA (o turno terminou
 * `falhou`). Abre o episódio, lembra ou só conta — `cb_ia_registrar_falha`
 * decide. Nunca lança.
 */
export async function registrarFalhaDaIa(
  db: SupabaseClient,
  args: { accountId: string; provedor: string; motivo: MotivoDaFalhaDaIa },
): Promise<void> {
  try {
    const { data, error } = await db.rpc('cb_ia_registrar_falha', {
      p_conta: args.accountId,
      p_provedor: args.provedor,
      p_motivo: args.motivo,
      p_lembrar_apos_min: LEMBRAR_APOS_MIN,
    })
    if (error) throw new Error(`registrar a falha: ${error.message}`)
    const r = (data ?? {}) as { acao?: unknown; desde?: unknown; falhas?: unknown }
    if (r.acao !== 'abriu' && r.acao !== 'continua') return
    const agora = new Date()
    const desde = typeof r.desde === 'string' ? new Date(r.desde) : agora
    const falhas = typeof r.falhas === 'number' ? r.falhas : 1
    const t = await tradutorDoAlarme()
    const textos = textosDoAlarme(t, {
      tipo: r.acao,
      provedor: args.provedor,
      motivo: args.motivo,
      desde,
      falhas,
      agora,
    })
    if (r.acao === 'continua') {
      await aposentarAlarmes(db, args.accountId, desde, titulosDoAlarme(t, args.provedor), agora)
    }
    const ids = await gravarAviso(db, args.accountId, args.provedor, 'ia_falhou', textos)
    await conferirSeAindaParada(db, args, desde, ids)
  } catch (err) {
    console.error('[ia-agentes] alarme da IA falhou:', args.accountId, err instanceof Error ? err.message : err)
  }
}

/**
 * Uma geração deu certo: se havia episódio aberto naquele provedor, ele FECHA
 * (o UPDATE só casa com o aberto: dois processos não fecham duas vezes), os
 * alarmes dele saem como lidos (senão voltariam na tela a cada abertura do
 * CRM, D6 da 1139) e quem recebe ganha o "voltou". Nunca lança.
 */
export async function registrarIaVoltou(db: SupabaseClient, args: { accountId: string; provedor: string }): Promise<void> {
  try {
    const agora = new Date()
    const { data, error } = await db
      .from('cb_ia_alarmes')
      .update({ normalizou_em: agora.toISOString() })
      .eq('account_id', args.accountId)
      .eq('provedor', args.provedor)
      .is('normalizou_em', null)
      .select('desde, falhas')
    if (error) throw new Error(`fechar o episódio: ${error.message}`)
    const fechado = (data ?? [])[0] as { desde?: unknown; falhas?: unknown } | undefined
    if (!fechado) return

    const desde = typeof fechado.desde === 'string' ? new Date(fechado.desde) : agora
    const t = await tradutorDoAlarme()
    await aposentarAlarmes(db, args.accountId, desde, titulosDoAlarme(t, args.provedor), agora)

    const textos = textosDoAlarme(t, {
      tipo: 'voltou',
      provedor: args.provedor,
      desde,
      falhas: typeof fechado.falhas === 'number' ? fechado.falhas : 1,
      agora,
    })
    await gravarAviso(db, args.accountId, args.provedor, 'ia_voltou', textos)
  } catch (err) {
    console.error('[ia-agentes] "a IA voltou" falhou:', args.accountId, err instanceof Error ? err.message : err)
  }
}
