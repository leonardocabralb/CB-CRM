// ============================================================
// Os FATOS da retomada, lidos do banco (1056). As regras estão em
// `retomada.ts` (puro); quem arma e quem roda, em `turno.ts`. O cliente vem
// por parâmetro (o de serviço, no turno).
//
// ⚠️ Os lembretes da reunião NUNCA são números cravados aqui: saem das
// automações `date_field_offset` LIGADAS da conta (`campoDoLembrete`, a mesma
// régua do cancelamento do Calendly, e `motivoDeConfigInvalida`/
// `deslocamentoEmMs`, as da varredura de lembretes), aplicadas ao valor do
// campo na ficha do contato (`instanteCanonico`, a mesma chave da trava).
// Todo campo vigiado por lembrete conta como data de REUNIÃO — é o que ele é
// nesta conta ("Data e Hora Reunião", do Calendly).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { deslocamentoEmMs, motivoDeConfigInvalida } from '@/lib/automations/lembretes'
import { campoDoLembrete } from '@/lib/calendly/cancelamento'
import { ehMeta } from '@/lib/cb-channels/transporte'
import { instanteCanonico } from '@/lib/contacts/campo-data'
import { minutosRestantesNoMapa } from '@/lib/inbox/selo-da-janela'
import type { DateFieldTriggerConfig } from '@/types'

import { bloqueiosDoContato, SEM_BLOQUEIOS, type Bloqueios, type LembreteDaConta, type MensagemDepois } from './retomada'

/** Quantas mensagens depois da âncora a conferência lê (qualquer uma que não seja do agente já para a série). */
const MENSAGENS_DEPOIS_LIDAS = 50

/**
 * Os bloqueios de um contato: os lembretes LIGADOS da conta aplicados à
 * ficha. Sem contato, ou sem lembrete ligado, nada bloqueia. LANÇA em erro de
 * leitura (quem chama decide: armar segue sem bloqueio, porque a tentativa
 * relê tudo quando vence; rodar para a série).
 */
export async function lerBloqueiosDaRetomada(
  db: SupabaseClient,
  accountId: string,
  contactId: string | null,
): Promise<Bloqueios> {
  if (!contactId) return SEM_BLOQUEIOS
  const { data: autos, error } = await db
    .from('automations')
    .select('id, trigger_config')
    .eq('account_id', accountId)
    .eq('trigger_type', 'date_field_offset')
    .eq('is_active', true)
  if (error) throw new Error(`leitura dos lembretes falhou: ${error.message}`)
  const lembretes: LembreteDaConta[] = []
  for (const a of (autos ?? []) as Array<{ trigger_config: unknown }>) {
    const campoId = campoDoLembrete(a.trigger_config)
    if (!campoId) continue
    const cfg = (a.trigger_config ?? {}) as DateFieldTriggerConfig
    if (motivoDeConfigInvalida(cfg)) continue
    lembretes.push({ campoId, deslocamentoMs: deslocamentoEmMs(cfg), direcao: cfg.direction === 'depois' ? 'depois' : 'antes' })
  }
  if (lembretes.length === 0) return SEM_BLOQUEIOS

  const { data: valores, error: erroDosValores } = await db
    .from('contact_custom_values')
    .select('custom_field_id, value')
    .eq('contact_id', contactId)
    .in('custom_field_id', [...new Set(lembretes.map((l) => l.campoId))])
  if (erroDosValores) throw new Error(`leitura da data da reunião falhou: ${erroDosValores.message}`)
  const instantes = new Map<string, number>()
  for (const v of (valores ?? []) as Array<{ custom_field_id: string; value: unknown }>) {
    const iso = instanteCanonico(typeof v.value === 'string' ? v.value : null)
    if (iso) instantes.set(v.custom_field_id, Date.parse(iso))
  }
  return bloqueiosDoContato(lembretes, (campoId) => instantes.get(campoId) ?? null)
}

/**
 * As mensagens gravadas DEPOIS da âncora, na conversa inteira (qualquer
 * conexão), e o instante da última do PRÓPRIO agente depois dela (a retomada
 * anterior; nulo = nenhuma). Mensagem do histórico importado (`gravada_em`
 * nula) não conta. LANÇA em erro de leitura.
 */
export async function lerMensagensDepois(
  db: SupabaseClient,
  args: { conversationId: string; ancoraGravadaEm: string; agenteId: string },
): Promise<{ depois: MensagemDepois[]; ultimaDoAgente: number | null }> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, ia_agente_id, gravada_em')
    .eq('conversation_id', args.conversationId)
    .gt('gravada_em', args.ancoraGravadaEm)
    .order('gravada_em', { ascending: true })
    .limit(MENSAGENS_DEPOIS_LIDAS)
  if (error) throw new Error(`leitura das mensagens depois da âncora falhou: ${error.message}`)
  const linhas = (data ?? []) as Array<{ sender_type: string; ia_agente_id: string | null; gravada_em: string | null }>
  let ultimaDoAgente: number | null = null
  for (const m of linhas) {
    if (m.sender_type !== 'bot' || m.ia_agente_id !== args.agenteId) continue
    const t = Date.parse(m.gravada_em ?? '')
    if (Number.isFinite(t) && (ultimaDoAgente === null || t > ultimaDoAgente)) ultimaDoAgente = t
  }
  return {
    depois: linhas.map((m) => ({ sender_type: m.sender_type, ia_agente_id: m.ia_agente_id ?? null })),
    ultimaDoAgente,
  }
}

/**
 * Quando FECHA a janela de 24 h da Meta nesta conexão (ms), pela régua da
 * lista (`minutosRestantesNoMapa` sobre `conversations.janela_meta`, 993).
 * Nulo = a conexão não é o número oficial (a Evolution não tem janela). Janela
 * já fechada = `agora`. LANÇA em erro de leitura.
 */
export async function lerFimDaJanelaMeta(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; canalId: string; agora: number },
): Promise<number | null> {
  const { data: canal, error } = await db
    .from('cb_channels')
    .select('kind')
    .eq('id', args.canalId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (error) throw new Error(`leitura da conexão falhou: ${error.message}`)
  if (!canal || !ehMeta(canal as { kind: string })) return null
  const { data: conv, error: erroDaConversa } = await db
    .from('conversations')
    .select('janela_meta')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (erroDaConversa) throw new Error(`leitura da janela da Meta falhou: ${erroDaConversa.message}`)
  const bruto = (conv as { janela_meta?: unknown } | null)?.janela_meta
  const mapa = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? (bruto as Record<string, string>) : null
  return args.agora + minutosRestantesNoMapa(mapa, args.canalId, args.agora) * 60_000
}
