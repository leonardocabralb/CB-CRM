import { validateInteractivePayload } from '@/lib/whatsapp/interactive'

// Porte do upstream #673 (`src/lib/quick-replies/patch.ts`): a edição parcial
// de uma resposta rápida é conferida contra a LINHA MESCLADA (a gravada + a
// mudança), não só contra o corpo do pedido. Sem isso, o PATCH sem `kind`
// gravava a resposta de texto com o texto vazio ou nulo, e a interativa sem
// `interactive_payload` — o seletor da caixa de entrada inseria nada. A única
// diferença para o original são os textos: aqui sem o tradutor do servidor
// (`getT`), que não entrou no porte de outubro (PLANO-merge-upstream-2026-10).

export type QuickReplyKind = 'text' | 'interactive'

export interface StoredQuickReply {
  kind: QuickReplyKind
  content_text: string | null
  interactive_payload: unknown
}

export type QuickReplyPatchResult =
  | { ok: true; update: Record<string, unknown> }
  | { ok: false; error: string }

const CONTENT_TEXT_REQUIRED = 'content_text is required for text quick replies'

export function resolveQuickReplyPatch(
  body: Record<string, unknown>,
  stored: StoredQuickReply,
): QuickReplyPatchResult {
  const update: Record<string, unknown> = {}

  if (typeof body.title === 'string') {
    const title = body.title.trim()
    if (!title) return { ok: false, error: 'title cannot be empty' }
    update.title = title
  }

  let kind = stored.kind
  if ('kind' in body) {
    if (body.kind !== 'text' && body.kind !== 'interactive') {
      return { ok: false, error: 'kind must be "text" or "interactive"' }
    }
    kind = body.kind
    update.kind = kind
    if (kind === 'interactive') {
      update.interactive_payload = body.interactive_payload
      update.content_text = null
    } else {
      update.content_text = body.content_text
      update.interactive_payload = null
    }
  } else {
    if ('content_text' in body) update.content_text = body.content_text ?? null
    if ('interactive_payload' in body) {
      update.interactive_payload = body.interactive_payload ?? null
    }
  }

  const merged = { ...stored, ...update }

  if (merged.content_text != null && typeof merged.content_text !== 'string') {
    return { ok: false, error: CONTENT_TEXT_REQUIRED }
  }

  if (kind === 'interactive' || update.interactive_payload != null) {
    const result = validateInteractivePayload(merged.interactive_payload)
    if (!result.ok) return { ok: false, error: result.error }
  }

  if (kind === 'text') {
    const text = merged.content_text
    if (typeof text !== 'string' || !text.trim()) {
      return { ok: false, error: CONTENT_TEXT_REQUIRED }
    }
  }

  return { ok: true, update }
}
