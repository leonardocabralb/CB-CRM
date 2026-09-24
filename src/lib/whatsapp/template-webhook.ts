/**
 * Handlers for Meta's template-lifecycle webhook events.
 *
 * Meta delivers three template-related webhook fields, each with a
 * different `value` shape:
 *
 *   - message_template_status_update      — APPROVED / REJECTED / PAUSED / etc.
 *   - message_template_quality_update     — GREEN / YELLOW / RED quality score
 *   - message_template_components_update  — Meta auto-modified the template
 *
 * The route handler at /api/whatsapp/webhook receives every change and
 * delegates here when `change.field` starts with `message_template_`.
 *
 * ─── Setup requirement (out-of-band) ──────────────────────────────
 * These fields are NOT subscribed to by default. In Meta App Dashboard
 * → WhatsApp → Configuration → Webhooks, you must explicitly toggle
 * each of the three fields above. There is no API to do this for
 * Cloud API apps — it's a one-time manual step per app. Until that's
 * done, status updates only land via the manual "Sync from Meta"
 * button (the legacy fallback, intentionally preserved).
 *
 * ─── Multi-tenant note ────────────────────────────────────────────
 * `meta_template_id` is globally unique per WABA — the lookup doesn't
 * filter by user_id. If two wacrm tenants somehow ended up with the
 * same id (impossible in practice, but a theoretical race during
 * cross-tenant moves), the handler updates both rows and logs a
 * warning so operators can investigate.
 *
 * ─── Unknown templates (issue #534) ───────────────────────────────
 * A template created directly in Meta Business Manager has no local
 * row until someone presses "Sync from Meta", so its status / quality
 * events used to match 0 rows and be dropped. Both handlers now fall
 * back to creating a stub row: the WABA id on the webhook entry
 * resolves the official connection via `cb_channels.waba_id` (OURS — the
 * original used `whatsapp_config`; see `createStubForUnknownTemplate`).
 *
 * ⚠️ NOSSO também: o stub nasce com o CONTEÚDO do modelo, lido na Meta
 * pelo id (`lerModeloNaMeta`, com o token da conexão) e convertido pela
 * MESMA função da sincronização. O original gravava `body_text: ''`, e a
 * linha vazia virava o modelo do envio: `buildSendComponents` contava zero
 * variáveis e descartava os parâmetros de quem mandava pelo nome — o envio
 * que funcionava sem linha local passava a ser recusado pela Meta (revisão da
 * Fase 6). Leitura que falha = nenhum stub, e o evento só vai para o log,
 * como antes; "Sync from Meta" continua sendo a saída.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from './encryption'
import { conteudoDoModeloDaMeta, lerModeloNaMeta } from './modelo-da-meta'
import { normalizeStatus } from './template-status-normalize'

const TEMPLATE_WEBHOOK_FIELDS = new Set([
  'message_template_status_update',
  'message_template_quality_update',
  'message_template_components_update',
])

export function isTemplateWebhookField(field: string): boolean {
  return TEMPLATE_WEBHOOK_FIELDS.has(field)
}

interface TemplateStatusUpdateValue {
  event?: string
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
  reason?: string
}

interface TemplateQualityUpdateValue {
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
  previous_quality_score?: string
  new_quality_score?: string
}

interface TemplateComponentsUpdateValue {
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
}

export interface TemplateWebhookChange {
  field: string
  value: unknown
  /**
   * `entry.id` from the webhook envelope — for template events this is
   * the WABA id. Optional so existing callers / tests keep working;
   * without it an unknown template can only be logged, not stubbed.
   */
  wabaId?: string
}

/**
 * Eventos de um modelo que está SAINDO da Meta. Sem linha local, eles não
 * criam stub: a rota de exclusão apaga na Meta e em seguida a linha local, e
 * o aviso que a Meta manda depois (`PENDING_DELETION`) ressuscitaria o modelo
 * que o operador acabou de apagar — a sincronização nunca remove linha. O
 * valor é o CRU do evento: `normalizeStatus` achata DELETED/ARCHIVED em PENDING.
 */
const EVENTOS_DE_SAIDA = new Set(['PENDING_DELETION', 'DELETED', 'ARCHIVED'])
/** Postgres unique_violation — the row appeared between our UPDATE and INSERT. */
const PG_UNIQUE_VIOLATION = '23505'

/**
 * Dispatch a single change record to the matching handler. Returns
 * silently on unrecognised fields — the caller already pre-filtered
 * via isTemplateWebhookField, but treat unknown values as no-ops
 * defensively in case Meta adds new template fields later.
 */
export async function handleTemplateWebhookChange(
  change: TemplateWebhookChange,
  // SupabaseClient typed loosely — the webhook route lazy-initialises
  // the admin client and exposes it as `any`. Type as the generic
  // SupabaseClient here so this module is testable in isolation.
  supabase: SupabaseClient,
): Promise<void> {
  switch (change.field) {
    case 'message_template_status_update':
      await handleStatusUpdate(
        change.value as TemplateStatusUpdateValue,
        supabase,
        change.wabaId,
      )
      return
    case 'message_template_quality_update':
      await handleQualityUpdate(
        change.value as TemplateQualityUpdateValue,
        supabase,
        change.wabaId,
      )
      return
    case 'message_template_components_update':
      handleComponentsUpdate(
        change.value as TemplateComponentsUpdateValue,
      )
      return
  }
}

async function handleStatusUpdate(
  value: TemplateStatusUpdateValue,
  supabase: SupabaseClient,
  wabaId: string | undefined,
): Promise<void> {
  const metaTemplateId =
    value.message_template_id !== undefined
      ? String(value.message_template_id)
      : null
  if (!metaTemplateId || !value.event) {
    console.warn(
      '[template-webhook] status update missing message_template_id or event:',
      value,
    )
    return
  }

  const status = normalizeStatus(value.event)

  // Persist the rejection reason on REJECTED — that's the only event
  // where Meta sends a human-readable explanation. Clear it on any
  // other status flip so the UI doesn't show a stale REJECTED banner
  // after Meta re-approves a resubmitted template.
  const update: Record<string, unknown> = {
    status,
    rejection_reason:
      status === 'REJECTED' ? value.reason ?? 'Rejected by Meta' : null,
    submission_error: null,
  }

  const { data, error } = await supabase
    .from('message_templates')
    .update(update)
    .eq('meta_template_id', metaTemplateId)
    .select('id')

  if (error) {
    console.error(
      '[template-webhook] status update failed for meta_template_id',
      metaTemplateId,
      error.message,
    )
    return
  }
  if (!data || data.length === 0) {
    if (EVENTOS_DE_SAIDA.has(value.event.toUpperCase())) {
      console.info(
        `[template-webhook] ${value.event} for unknown template meta_template_id ${metaTemplateId} (${value.message_template_name ?? 'unnamed'}) — nothing local to update, and a template on its way out is not stubbed.`,
      )
      return
    }
    await createStubForUnknownTemplate({
      kind: 'status update',
      metaTemplateId,
      name: value.message_template_name,
      wabaId,
      motivoDaRecusa: status === 'REJECTED' ? (update.rejection_reason as string) : null,
      retryUpdate: () =>
        supabase
          .from('message_templates')
          .update(update)
          .eq('meta_template_id', metaTemplateId)
          .select('id'),
      supabase,
    })
    return
  }
  if (data.length > 1) {
    console.warn(
      `[template-webhook] status update matched ${data.length} rows for meta_template_id ${metaTemplateId} — investigate.`,
    )
  }
}

async function handleQualityUpdate(
  value: TemplateQualityUpdateValue,
  supabase: SupabaseClient,
  wabaId: string | undefined,
): Promise<void> {
  const metaTemplateId =
    value.message_template_id !== undefined
      ? String(value.message_template_id)
      : null
  if (!metaTemplateId) {
    console.warn(
      '[template-webhook] quality update missing message_template_id:',
      value,
    )
    return
  }

  const raw = value.new_quality_score
  const score =
    raw && ['GREEN', 'YELLOW', 'RED'].includes(raw.toUpperCase())
      ? (raw.toUpperCase() as 'GREEN' | 'YELLOW' | 'RED')
      : null

  const update = { quality_score: score }
  const runUpdate = () =>
    supabase
      .from('message_templates')
      .update(update)
      .eq('meta_template_id', metaTemplateId)
      .select('id')

  const { data, error } = await runUpdate()

  if (error) {
    console.error(
      '[template-webhook] quality update failed for meta_template_id',
      metaTemplateId,
      error.message,
    )
    return
  }
  if (!data || data.length === 0) {
    // O evento de qualidade não traz situação — o stub a lê na Meta junto
    // com o conteúdo, em vez de nascer com o padrão da coluna (DRAFT).
    await createStubForUnknownTemplate({
      kind: 'quality update',
      metaTemplateId,
      name: value.message_template_name,
      wabaId,
      motivoDaRecusa: null,
      retryUpdate: runUpdate,
      supabase,
    })
  }
}

interface StubParams {
  /** For log lines — 'status update' | 'quality update'. */
  kind: string
  metaTemplateId: string
  /** Só para o log — o nome gravado é o que a Meta devolve. */
  name: string | undefined
  wabaId: string | undefined
  /** O motivo do evento REJECTED: a leitura da Meta não o traz. */
  motivoDaRecusa: string | null
  /** Re-runs the original UPDATE if the INSERT loses a race. */
  retryUpdate: () => PromiseLike<{
    data: { id: string }[] | null
    error: { message: string } | null
  }>
  supabase: SupabaseClient
}

/**
 * 0-row fallback shared by the status and quality handlers: resolve
 * the tenant from the WABA id and insert a stub `message_templates`
 * row so the event isn't lost. Every early-return path logs the WABA
 * id so an operator can tell which tenant needs a "Sync from Meta".
 *
 * O stub é uma linha COMPLETA: o conteúdo vem da Meta, pelo id do modelo,
 * com o token da conexão dona da WABA. Sem ele, não há stub.
 */
async function createStubForUnknownTemplate(p: StubParams): Promise<void> {
  const { kind, metaTemplateId, name, wabaId, supabase } = p
  const where = `meta_template_id ${metaTemplateId} (${name ?? 'unnamed'}), WABA ${wabaId ?? 'unknown'}`

  if (!wabaId) {
    console.warn(
      `[template-webhook] ${kind} for unknown template ${where} — no WABA id on the webhook entry, cannot resolve the account; run "Sync from Meta".`,
    )
    return
  }

  // ⚠️ NOSSO (Fase 6b do merge do upstream). O original resolve a conta por
  // `whatsapp_config.waba_id` — o espelho de UM número, que nesta produção
  // nunca casaria (o número oficial vive em `cb_channels`). E o catálogo é
  // POR WABA (903): o stub nasce com o `channel_id` da conexão — uma linha
  // sem canal valeria para QUALQUER número da conta (`resolveTemplateRow`), e
  // a sincronização de outra WABA poderia adotá-la. `.eq('kind', 'meta')`: só
  // a conexão oficial tem WABA.
  const { data: canais, error: canalError } = await supabase
    .from('cb_channels')
    .select('id, account_id, access_token')
    .eq('kind', 'meta')
    .eq('waba_id', wabaId)

  if (canalError) {
    console.error(
      `[template-webhook] ${kind} for unknown template ${where} — cb_channels lookup failed:`,
      canalError.message,
    )
    return
  }
  const rows = (canais ?? []) as { id: string; account_id: string; access_token: string | null }[]
  if (rows.length !== 1) {
    // Dois números na MESMA WABA: cada um tem o seu catálogo (a sincronização
    // cria uma linha por canal), e escolher um aqui seria adivinhar.
    console.warn(
      `[template-webhook] ${kind} for unknown template ${where} — ${rows.length === 0 ? 'no' : rows.length} official connections match that WABA id; not creating a stub. Run "Sync from Meta" for the owning account.`,
    )
    return
  }
  const canal = rows[0]

  // O conteúdo, na Meta. Linha sem ele viraria o modelo do envio com zero
  // variáveis (ver o cabeçalho deste arquivo).
  let token: string
  try {
    if (!canal.access_token) throw new Error('no access token')
    token = decrypt(canal.access_token)
  } catch (e) {
    console.error(
      `[template-webhook] ${kind} for unknown template ${where} — connection ${canal.id} has no usable access token (${e instanceof Error ? e.message : 'decrypt failed'}); run "Sync from Meta".`,
    )
    return
  }
  const leitura = await lerModeloNaMeta(metaTemplateId, token)
  if (!leitura.ok) {
    console.warn(
      `[template-webhook] ${kind} for unknown template ${where} — could not read it from Meta (${leitura.falha}); not creating a stub. Run "Sync from Meta".`,
    )
    return
  }
  if (leitura.modelo.id !== metaTemplateId) {
    console.warn(
      `[template-webhook] ${kind} for unknown template ${where} — Meta answered with template ${leitura.modelo.id}; not creating a stub.`,
    )
    return
  }
  const conteudo = conteudoDoModeloDaMeta(leitura.modelo)

  // A linha com o mesmo nome e idioma NESTE canal OU sem canal, de qualquer
  // autor: é a régua da sincronização (e da submissão), que adota as duas. O
  // índice único leva o `user_id` e os dois índices da 903 são parciais —
  // o stub nasceria ao lado dela, e o `maybeSingle` da sincronização passaria
  // a falhar para aquele modelo em toda sincronização. O id do canal vem do
  // banco, não de fora, então o `.or()` é seguro.
  const { data: existente, error: existenteError } = await supabase
    .from('message_templates')
    .select('id')
    .eq('account_id', canal.account_id)
    .or(`channel_id.eq.${canal.id},channel_id.is.null`)
    .eq('name', conteudo.name)
    .eq('language', conteudo.language)
    .limit(1)
  if (existenteError) {
    console.error(
      `[template-webhook] ${kind} for unknown template ${where} — local lookup failed:`,
      existenteError.message,
    )
    return
  }
  if ((existente ?? []).length > 0) {
    console.warn(
      `[template-webhook] ${kind} for unknown template ${where} — a local row with the same name/language exists but is not linked to this meta_template_id; run "Sync from Meta" to link it.`,
    )
    return
  }

  // O autor é o DONO da conta, nunca um membro: `message_templates.user_id`
  // CASCADEia de `auth.users` (a regra dos contatos, M24 do plano de 31/08).
  const { data: conta, error: contaError } = await supabase
    .from('accounts')
    .select('owner_user_id')
    .eq('id', canal.account_id)
    .maybeSingle()
  const dono = (conta as { owner_user_id?: string } | null)?.owner_user_id
  if (contaError || !dono) {
    console.error(
      `[template-webhook] ${kind} for unknown template ${where} — account owner lookup failed:`,
      contaError?.message ?? 'no owner',
    )
    return
  }

  // A linha espelha a Meta AGORA (a leitura é posterior ao evento); do
  // evento sobra só o motivo da recusa, que a leitura não traz.
  const stub = {
    account_id: canal.account_id,
    user_id: dono,
    channel_id: canal.id,
    ...conteudo,
    rejection_reason:
      conteudo.status === 'REJECTED' ? p.motivoDaRecusa ?? 'Rejected by Meta' : null,
  }

  const { error: insertError } = await supabase
    .from('message_templates')
    .insert(stub)

  if (!insertError) {
    console.info(
      `[template-webhook] ${kind} for unknown template ${where} — created it from Meta for account ${canal.account_id}, channel ${canal.id}.`,
    )
    return
  }

  if ((insertError as { code?: string }).code !== PG_UNIQUE_VIOLATION) {
    console.error(
      `[template-webhook] ${kind} for unknown template ${where} — stub insert failed:`,
      insertError.message,
    )
    return
  }

  // Unique violation: a concurrent webhook or sync just created the row (the
  // unlinked same-name row was ruled out above). Retry the original UPDATE
  // once so this event still lands on it.
  const { data, error } = await p.retryUpdate()
  if (error) {
    console.error(
      `[template-webhook] ${kind} for unknown template ${where} — retry after unique violation failed:`,
      error.message,
    )
    return
  }
  if (!data || data.length === 0) {
    console.warn(
      `[template-webhook] ${kind} for unknown template ${where} — a local row with the same name/language exists but is not linked to this meta_template_id; run "Sync from Meta" to link it.`,
    )
  }
}

/**
 * Meta auto-modified the template (typically a category reclassification
 * — e.g. Marketing → Utility after content review).
 *
 * For v1 we just log and let the user pull updated components via the
 * existing "Sync from Meta" button — persisting Meta's modified
 * components without showing the user would silently change what they
 * thought they submitted. A future PR could mark the row with a
 * "Meta modified this template" banner.
 */
function handleComponentsUpdate(value: TemplateComponentsUpdateValue): void {
  console.info(
    '[template-webhook] components updated by Meta for template',
    value.message_template_id,
    value.message_template_name,
    '— run "Sync from Meta" in Settings to pull the new components.',
  )
}
