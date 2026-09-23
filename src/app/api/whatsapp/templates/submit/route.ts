import { NextResponse } from 'next/server'
import { resolveMetaChannel } from '@/lib/cb-channels/resolve-meta'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureMediaHeaderHandle } from '@/lib/whatsapp/template-header-handle'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'

/**
 * Os campos do modelo que a submissão grava — nos dois desfechos (a Meta
 * aceitou / recusou) e nas duas formas (linha nova / linha achada).
 *
 * ⚠️ SEM `account_id` e SEM `user_id`: esses dois só entram na INSERÇÃO
 * (`inserirModelo`). `user_id` é o AUTOR da linha, nunca recorte — e
 * atualizar a linha que um colega criou não pode trocar o autor dela.
 * Reatribuir autoria é decisão de produto pendente (M24 do plano de 31/08),
 * porque `user_id` cascateia de `auth.users`.
 */
function camposDoModelo(
  payload: TemplatePayload,
  channelId: string | null,
  extras: {
    status: string
    metaTemplateId: string | null
    submissionError: string | null
  },
) {
  return {
    channel_id: channelId,
    name: payload.name,
    category: payload.category,
    language: payload.language,
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    header_handle: payload.header_handle ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sample_values: payload.sample_values ?? null,
    status: extras.status,
    meta_template_id: extras.metaTemplateId,
    submission_error: extras.submissionError,
    // Limpa a recusa anterior a cada envio; o webhook a grava de novo se a
    // Meta recusar outra vez.
    rejection_reason: null,
    last_submitted_at: new Date().toISOString(),
  }
}

type CamposDoModelo = ReturnType<typeof camposDoModelo>

/** O que a submissão precisa saber da linha local que já existe. */
interface LinhaDoModelo {
  id: string
  channel_id: string | null
  meta_template_id: string | null
}

/**
 * Procura o modelo local pela CONTA — nome, idioma e canal igual OU nulo,
 * a mesma régua da rota de sync.
 *
 * ⚠️ Até 23/09/2026 a busca era pelo AUTOR (`user_id`), DEPOIS da Meta, e o
 * erro era descartado. Dois danos: com outro admin a busca não achava o
 * modelo do colega e nascia um rascunho HOMÔNIMO (os índices únicos da 903
 * são por autor e deixam passar — a sync daquele modelo passava a falhar no
 * `maybeSingle` e `resolveTemplateRow` escolhia entre as duas sem critério);
 * e reenviar pela tela "Criar" um nome que já existia fazia a Meta recusar
 * e o caminho de falha REBAIXAR a linha aprovada para rascunho sem
 * `meta_template_id` — o modelo sumia dos seletores de disparo, da caixa de
 * entrada e das automações até alguém sincronizar da Meta.
 *
 * Lista, não `maybeSingle`: base antiga pode ter duas linhas (a do canal e
 * a global de antes da 903, ou o homônimo que o bug acima criou). Prefere a
 * do canal, depois a vinculada à Meta, depois a mais antiga. O recorte do
 * canal é feito aqui, e não num `.or()`: em modo de ensaio o canal vem do
 * corpo do pedido, e texto de fora não entra num filtro do PostgREST.
 */
async function buscarModeloDaConta(
  supabase: SupabaseClient,
  accountId: string,
  payload: TemplatePayload,
  channelId: string | null,
): Promise<{ linha: LinhaDoModelo | null; erro: string | null }> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, channel_id, meta_template_id')
    .eq('account_id', accountId)
    .eq('name', payload.name)
    .eq('language', payload.language)
    .order('created_at', { ascending: true })
  if (error) return { linha: null, erro: error.message }

  const pontos = (l: LinhaDoModelo) =>
    (l.channel_id === channelId ? 2 : 0) + (l.meta_template_id ? 1 : 0)
  let melhor: LinhaDoModelo | null = null
  for (const l of (data ?? []) as LinhaDoModelo[]) {
    if (l.channel_id !== channelId && l.channel_id !== null) continue
    if (!melhor || pontos(l) > pontos(melhor)) melhor = l
  }
  return { linha: melhor, erro: null }
}

function atualizarModelo(
  supabase: SupabaseClient,
  id: string,
  campos: CamposDoModelo,
) {
  return supabase
    .from('message_templates')
    .update(campos)
    .eq('id', id)
    .select()
    .single()
}

function inserirModelo(
  supabase: SupabaseClient,
  accountId: string,
  autorId: string,
  campos: CamposDoModelo,
) {
  return supabase
    .from('message_templates')
    // account_id é NOT NULL desde a 017; o autor só é gravado na criação.
    .insert({ ...campos, account_id: accountId, user_id: autorId })
    .select()
    .single()
}

/**
 * Submit a template to Meta for approval AND persist it locally.
 *
 * Auth → validate → resolve o canal → busca a linha local PELA CONTA
 * (erro de busca = 500, sem chamar a Meta) → (DRY_RUN short-circuit) →
 * POST to Meta → grava:
 *   - a Meta aceitou: atualiza a linha achada (religa, se estava velha) ou
 *     insere; um 23505 na inserção (corrida) busca de novo e atualiza;
 *   - a Meta recusou: sem linha, insere o rascunho; linha sem
 *     `meta_template_id`, atualiza o rascunho; linha VINCULADA à Meta, não
 *     toca em nada e responde com a dica (`code: 'modelo_ja_existe'`).
 *
 * When WHATSAPP_TEMPLATES_DRY_RUN=true, we skip the network call and
 * insert a row with a synthetic `dry-run-<uuid>` meta_template_id so
 * CI / local dev can exercise the full UI without a real Meta App.
 *
 * On the Meta side this is a one-way trip — editing or deleting an
 * already-submitted template lives in /api/whatsapp/templates/[id].
 */
export async function POST(request: Request) {
  try {
    // Message templates are settings-class data: `canEditSettings` and the
    // message_templates_insert/update RLS policies (migration 017) both
    // require 'admin'. Resolving account_id off the profile only proved
    // membership, so a viewer or agent could push a template to Meta for
    // approval — an external side effect RLS can't roll back — before the
    // local upsert was refused.
    const { supabase, accountId, userId } = await requireRole('admin')

    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
        },
        { status: 400 },
      )
    }

    try {
      validateTemplatePayload(payload)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    const dryRun =
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'

    // Canal escolhido no corpo; o modelo nasce carimbado com ele.
    const canalPedido =
      typeof (payload as { channel_id?: unknown }).channel_id === 'string'
        ? ((payload as { channel_id?: string }).channel_id as string)
        : null
    let canalDoModelo: string | null = canalPedido

    // Multi-canal: cria o modelo no WABA do canal PEDIDO. Antes ia sempre
    // para o WABA do espelho — o operador cadastrava o 2o numero, criava um
    // modelo achando que era "do numero 2", e ele nascia no WABA do 1o.
    const canal = dryRun
      ? null
      : await resolveMetaChannel(supabase, accountId, canalPedido)
    if (!dryRun) {
      if (!canal) {
        return NextResponse.json(
          {
            error:
              'WhatsApp not configured. Connect an official Meta (Cloud API) number in Settings > Connections first.',
          },
          { status: 400 },
        )
      }
      if (!canal.wabaId) {
        return NextResponse.json(
          {
            error: `WABA (WhatsApp Business Account) ID missing for "${canal.label}". Re-connect that number in Settings.`,
          },
          { status: 400 },
        )
      }
      canalDoModelo = canal.channelId
    }

    // ANTES de qualquer chamada à Meta (inclusive o upload do cabeçalho):
    // sem saber que linha já existe, a rota não sabe o que pode gravar
    // depois — e a chamada à Meta não se desfaz.
    const busca = await buscarModeloDaConta(
      supabase,
      accountId,
      payload,
      canalDoModelo,
    )
    if (busca.erro) {
      console.error('[templates/submit] busca do modelo falhou:', busca.erro)
      return NextResponse.json(
        {
          error: `Could not check the existing templates: ${busca.erro}. Nothing was sent to Meta.`,
        },
        { status: 500 },
      )
    }
    const existente = busca.linha

    let metaTemplateId: string
    let metaStatus: string

    if (dryRun || !canal) {
      metaTemplateId = `dry-run-${crypto.randomUUID()}`
      metaStatus = 'PENDING'
    } else {
      const accessToken = decrypt(canal.accessToken)

      // Media headers (image/video/document) need a Resumable-Upload
      // handle (Meta rejects a plain URL at creation). Derive it from
      // header_media_url before building the payload. Surfaces a 400 with
      // an actionable message (missing META_APP_ID, unreachable URL,
      // wrong type/size).
      try {
        await ensureMediaHeaderHandle(payload, accessToken)
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Header media upload failed.' },
          { status: 400 },
        )
      }

      const metaPayload = buildMetaTemplatePayload(payload)
      try {
        const meta = await submitMessageTemplate({
          wabaId: canal.wabaId as string,
          accessToken,
          payload: metaPayload,
        })
        metaTemplateId = meta.id
        metaStatus = meta.status
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta submit failed.'
        const isRateLimit = /\b429\b/.test(message)
        const erro = isRateLimit
          ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
          : message
        const status = isRateLimit ? 429 : 502

        // ⚠️ A linha VINCULADA à Meta nunca é rebaixada. Reenviar pela tela
        // "Criar" um nome que já existe faz a Meta recusar, e gravar o
        // rascunho aqui apagaria o `meta_template_id` de um modelo em uso.
        if (existente?.meta_template_id) {
          return NextResponse.json(
            isRateLimit ? { error: erro } : { error: erro, code: 'modelo_ja_existe' },
            { status },
          )
        }

        // Sem linha, ou só o rascunho local: guarda a tentativa para o
        // operador corrigir e reenviar.
        const rascunho = camposDoModelo(payload, canalDoModelo, {
          status: 'DRAFT',
          metaTemplateId: null,
          submissionError: message,
        })
        const { error: errRascunho } = existente
          ? await atualizarModelo(supabase, existente.id, rascunho)
          : await inserirModelo(supabase, accountId, userId, rascunho)
        if (errRascunho) {
          console.error(
            '[templates/submit] rascunho não gravado depois da recusa da Meta:',
            errRascunho.message,
          )
        }
        return NextResponse.json({ error: erro }, { status })
      }
    }

    const aceito = camposDoModelo(payload, canalDoModelo, {
      status: normalizeStatus(metaStatus),
      metaTemplateId,
      submissionError: null,
    })
    let gravado = existente
      ? await atualizarModelo(supabase, existente.id, aceito)
      : await inserirModelo(supabase, accountId, userId, aceito)

    // Corrida: outra submissão criou a linha entre a busca e a inserção.
    // A Meta já aceitou — religar a linha que venceu, em vez de perder o id.
    if (!existente && gravado.error?.code === '23505') {
      const nova = await buscarModeloDaConta(
        supabase,
        accountId,
        payload,
        canalDoModelo,
      )
      if (nova.linha) {
        gravado = await atualizarModelo(supabase, nova.linha.id, aceito)
      }
    }

    if (gravado.error) {
      // The submit succeeded on Meta's side but we failed to persist
      // locally. That's a data-drift state — surface the meta_template_id
      // so the user can recover via "Sync from Meta".
      return NextResponse.json(
        {
          error: `Submitted to Meta but failed to save locally: ${gravado.error.message}. Run "Sync from Meta" to recover.`,
          meta_template_id: metaTemplateId,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      template: gravado.data,
      dry_run: dryRun,
    })
  } catch (error) {
    // Auth failures map to 401/403. Handled before the generic branch
    // below, which surfaces `error.message` as a 500 — reporting "you
    // aren't an admin" as a template submission failure would send the
    // user chasing the wrong problem.
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError
    ) {
      return toErrorResponse(error)
    }
    console.error('Error submitting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to submit template.',
      },
      { status: 500 },
    )
  }
}
