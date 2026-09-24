/**
 * O modelo como a Meta o descreve → as colunas de `message_templates`.
 *
 * Saiu da rota de sincronização (`/api/whatsapp/templates/sync`) quando o
 * stub do webhook (Fase 6b do merge do upstream) precisou da MESMA conversão:
 * o modelo criado direto no painel da Meta chegava ao CRM com o corpo vazio,
 * e o envio pelo nome passava a mandar zero parâmetros — a Meta recusava o
 * que antes funcionava pelo caminho sem linha local. Uma conversão só, para
 * a sincronização e o stub não divergirem sobre o que um modelo é.
 */

import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import type { TemplateButton, TemplateSampleValues } from '@/types'

const META_API_BASE = 'https://graph.facebook.com/v21.0'

/** Os campos que a sincronização já pede — pedir um que a Meta não conhece derruba a leitura (#100). */
export const CAMPOS_DO_MODELO = 'id,name,language,status,category,components,quality_score'

interface MetaButton {
  type: string
  text: string
  url?: string
  phone_number?: string
  example?: string[] | string
}

interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
  buttons?: MetaButton[]
  example?: {
    header_text?: string[]
    header_handle?: string[]
    body_text?: string[][]
  }
}

export interface MetaTemplate {
  id: string
  name: string
  language: string
  status: string
  category: string
  components?: MetaTemplateComponent[]
  quality_score?: { score?: string } | string
}

function normalizeCategory(
  meta: string,
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

function normalizeQualityScore(
  raw: MetaTemplate['quality_score'],
): 'GREEN' | 'YELLOW' | 'RED' | null {
  const score =
    typeof raw === 'string' ? raw : raw?.score ? String(raw.score) : null
  if (!score) return null
  const upper = score.toUpperCase()
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED'
    ? (upper as 'GREEN' | 'YELLOW' | 'RED')
    : null
}

function parseButtons(metaButtons: MetaButton[] | undefined): TemplateButton[] {
  if (!metaButtons?.length) return []
  const out: TemplateButton[] = []
  for (const b of metaButtons) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: b.text })
        break
      case 'URL':
        out.push({
          type: 'URL',
          text: b.text,
          url: b.url ?? '',
          example: Array.isArray(b.example) ? b.example[0] : b.example,
        })
        break
      case 'PHONE_NUMBER':
        out.push({
          type: 'PHONE_NUMBER',
          text: b.text,
          phone_number: b.phone_number ?? '',
        })
        break
      case 'COPY_CODE':
        out.push({
          type: 'COPY_CODE',
          text: b.text,
          example: Array.isArray(b.example) ? b.example[0] ?? '' : b.example ?? '',
        })
        break
      // OTP, FLOW, etc — out of scope for v1; drop silently.
    }
  }
  return out
}

function extractSampleValues(
  body: MetaTemplateComponent | undefined,
  header: MetaTemplateComponent | undefined,
): TemplateSampleValues | null {
  // Meta returns body_text as a 2D array — one row per example set.
  // We take the first row (most templates have exactly one).
  const bodySample = body?.example?.body_text?.[0]
  const headerSample = header?.example?.header_text
  if (!bodySample?.length && !headerSample?.length) return null
  const sv: TemplateSampleValues = {}
  if (bodySample?.length) sv.body = bodySample
  if (headerSample?.length) sv.header = headerSample
  return sv
}

/** As colunas de conteúdo — sem conta, autor e canal, que cada chamador decide. */
export function conteudoDoModeloDaMeta(t: MetaTemplate) {
  const body = (t.components ?? []).find((c) => c.type === 'BODY')
  const header = (t.components ?? []).find((c) => c.type === 'HEADER')
  const footer = (t.components ?? []).find((c) => c.type === 'FOOTER')
  const buttons = (t.components ?? []).find((c) => c.type === 'BUTTONS')

  const parsedButtons = parseButtons(buttons?.buttons)
  const headerFormat = header?.format?.toUpperCase()
  const headerType =
    headerFormat === 'TEXT' ||
    headerFormat === 'IMAGE' ||
    headerFormat === 'VIDEO' ||
    headerFormat === 'DOCUMENT'
      ? headerFormat.toLowerCase()
      : null

  return {
    name: t.name,
    category: normalizeCategory(t.category),
    language: t.language,
    header_type: headerType,
    header_content: header?.text ?? null,
    header_handle: header?.example?.header_handle?.[0] ?? null,
    body_text: body?.text ?? '',
    footer_text: footer?.text ?? null,
    buttons: parsedButtons.length ? parsedButtons : null,
    sample_values: extractSampleValues(body, header),
    status: normalizeStatus(t.status),
    meta_template_id: t.id,
    quality_score: normalizeQualityScore(t.quality_score),
  }
}

export type LeituraDoModelo =
  | { ok: true; modelo: MetaTemplate }
  /** `falha` NUNCA traz a mensagem da Meta: ela pode ecoar o token. */
  | { ok: false; falha: string }

/**
 * Um modelo pelo id, com o token (já decifrado) da conexão dona da WABA. O
 * token vai no cabeçalho, nunca na URL; o host é fixo.
 */
export async function lerModeloNaMeta(
  metaTemplateId: string,
  accessToken: string,
): Promise<LeituraDoModelo> {
  let res: Response
  try {
    res = await fetch(
      `${META_API_BASE}/${encodeURIComponent(metaTemplateId)}?fields=${CAMPOS_DO_MODELO}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch (e) {
    return {
      ok: false,
      falha: (e as { name?: unknown } | null)?.name === 'TimeoutError' ? 'timeout' : 'network',
    }
  }
  if (!res.ok) {
    let codigo = ''
    try {
      const corpo = (await res.json()) as { error?: { code?: unknown } }
      if (corpo?.error?.code !== undefined) codigo = ` (code ${String(corpo.error.code)})`
    } catch {
      // corpo que não é JSON — basta o status
    }
    return { ok: false, falha: `HTTP ${res.status}${codigo}` }
  }
  let corpo: Partial<MetaTemplate> | null
  try {
    corpo = (await res.json()) as Partial<MetaTemplate> | null
  } catch {
    return { ok: false, falha: 'invalid JSON' }
  }
  if (
    !corpo ||
    typeof corpo.id !== 'string' ||
    typeof corpo.name !== 'string' ||
    typeof corpo.language !== 'string' ||
    typeof corpo.status !== 'string' ||
    typeof corpo.category !== 'string'
  ) {
    return { ok: false, falha: 'unexpected shape' }
  }
  return { ok: true, modelo: corpo as MetaTemplate }
}
