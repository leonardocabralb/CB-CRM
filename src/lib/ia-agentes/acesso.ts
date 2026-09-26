// ============================================================
// O que o agente VÊ além da conversa (F3, docs/PLANO-agentes-de-ia.md 5.5).
//
// Cada agente marca, em `cb_ia_agentes.acesso`, os blocos que entram no
// pedido: ficha, campos personalizados (um a um), negócio, etiquetas,
// cobranças (espelho do Asaas, SÓ leitura) e a próxima reunião (Calendly).
// Nada marcado = só a conversa (fechado por padrão: é dado de cliente indo a
// provedor externo).
//
// Três partes:
//  - `montarBlocos` (PURO): os dados lidos → os textos, em INGLÊS (são para o
//    MODELO, como o texto-base do pedido), com teto por bloco e truncamento
//    DECLARADO. As cobranças trazem o link de pagamento de cada parcela
//    devida SÓ com a leitura fresca (F4, a 2ª via da D6 sem ferramenta). Bloco que não pôde ser lido diz "unavailable right now" —
//    nunca inventa, e nunca "no overdue installments" sem a leitura.
//  - `lerDadosDoAcesso` (I/O): lê SÓ o que está marcado, cada bloco com o
//    seu try — erro num bloco não derruba o turno nem os outros blocos.
//  - `lerOQueOAgenteVe`: blocos + base do agente (`conhecimento.ts`) + o
//    RETRATO que o turno grava em `cb_ia_turnos.contexto` (1052).
//
// ⚠️ Toda consulta leva a conta (`.eq('account_id', …)`): o cliente é o de
// SERVIÇO e ignora a RLS. `contact_tags` e `contact_custom_values` não têm
// conta — o recorte é pelo contato, que quem chama já conferiu na conta, e o
// catálogo (`tags`, `custom_fields`) é lido pela conta.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  cicloCompleto,
  leituraFresca,
  lerClientesDoContato,
  lerCobrancasDosClientes,
  lerConfigDoEspelho,
} from '@/lib/asaas/espelho'
import {
  classificar,
  diasDeAtraso,
  dinheiro,
  resumirDivida,
  valorAtualizado,
  type ParcelaDoEspelho,
  type ResumoDeDivida,
} from '@/lib/asaas/inadimplencia'
import { EVENTO_AGENDADO, EVENTO_CANCELADO } from '@/lib/calendly/payload'
import { lerChaveDeEmbeddings } from '@/lib/ia-chaves/repo'

import { BLOCOS_DO_ACESSO, blocoMarcado, type AcessoDoAgente, type BlocoDoAcesso } from './agente'
import { retrieveKnowledgeDoAgente, type TrechoDaBase } from './conhecimento'
import { dataEHora, FUSO_DO_ESCRITORIO } from './pedido'

/** Teto de cada bloco, em caracteres (o truncamento é DECLARADO ao modelo). */
export const TETO_DO_BLOCO = 1_500

/** Teto do retrato gravado em `cb_ia_turnos.contexto` (JSON), em caracteres. */
export const TETO_DO_RETRATO = 20_000

const TRUNCADO = '\n[… truncated]'
const INDISPONIVEL = 'unavailable right now.'
const DIA_MS = 86_400_000

/** Um bloco como entrou no pedido. */
export interface BlocoVisto {
  bloco: BlocoDoAcesso
  texto: string
}

/** Resultado da leitura de um bloco: o valor, ou "não deu para ler". */
export type Leitura<T> = { ok: true; valor: T } | { ok: false }

export interface FichaLida {
  nome: string | null
  telefone: string | null
  email: string | null
  empresa: string | null
  /** Os @ (a ficha só do Instagram, ou só com o nome de usuário do WhatsApp, não tem telefone). */
  whatsapp?: string | null
  instagram?: string | null
}

export interface CampoLido {
  nome: string
  valor: string
}

export interface NegocioLido {
  funil: string | null
  etapa: string | null
  valor: number
  /** `deals.etapa_desde` (1049). */
  etapaDesde: string | null
}

export type CobrancasLidas =
  | { conectado: false }
  | {
      conectado: true
      /** A última listagem completa das vencidas é recente (`leituraFresca`). */
      fresca: boolean
      /** O início da última listagem completa (`vencidas_listadas_em`). */
      atualizadoEm: string | null
      cicloCompleto: boolean
      /** Quantos clientes do Asaas estão ligados ao contato. */
      clientes: number
      resumo: ResumoDeDivida
    }

export interface ReuniaoLida {
  inicio: string
  evento: string | null
  /** O link de remarcar do Calendly (`variaveis.agendamento_remarcar`). */
  remarcar: string | null
}

/**
 * O que foi lido para cada bloco. AUSENTE = não foi lido (não marcado, ou
 * sem contato) e o bloco não entra. `negocio`/`reuniao` nulos = lidos, e não
 * há (nenhum card aberto, nenhuma reunião marcada).
 */
export interface DadosDoAcesso {
  ficha?: Leitura<FichaLida>
  campos?: Leitura<CampoLido[]>
  negocio?: Leitura<NegocioLido | null>
  etiquetas?: Leitura<string[]>
  cobrancas?: Leitura<CobrancasLidas>
  reuniao?: Leitura<ReuniaoLida | null>
}

const TITULO: Record<BlocoDoAcesso, string> = {
  ficha: 'Customer record',
  campos: 'Custom fields',
  negocio: 'Deal',
  etiquetas: 'Tags',
  cobrancas: 'Billing (Asaas)',
  reuniao: 'Next meeting',
}

// ------------------------------------------------------------
// A montagem (pura)
// ------------------------------------------------------------

/**
 * Corta no teto, dizendo que cortou. ⚠️ Nunca no meio de uma palavra: um
 * LINK cortado ao meio (o de pagamento, F4) iria ao cliente pela metade — e
 * a trava de link inventado não o pegaria, porque ele "apareceu" no pedido.
 */
export function limitarBloco(texto: string, teto: number = TETO_DO_BLOCO): string {
  if (texto.length <= teto) return texto
  const n = Math.max(0, teto - TRUNCADO.length)
  let corte = texto.slice(0, n)
  if (!/\s/.test(texto[n] ?? ' ')) corte = corte.replace(/\S*$/, '')
  return corte.trimEnd() + TRUNCADO
}

/** Uma linha por valor: quebras de linha e espaços repetidos viram um espaço. */
function numaLinha(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim()
}

/** "20 September 2026" no fuso do escritório. */
function dia(iso: string, fuso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', { timeZone: fuso, day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

function textoDaFicha(f: FichaLida): string {
  const linhas: string[] = []
  if (f.nome?.trim()) linhas.push(`- Name: ${numaLinha(f.nome)}`)
  if (f.telefone?.trim()) linhas.push(`- Phone: ${numaLinha(f.telefone)}`)
  if (f.whatsapp?.trim()) linhas.push(`- WhatsApp username: @${numaLinha(f.whatsapp)}`)
  if (f.instagram?.trim()) linhas.push(`- Instagram: @${numaLinha(f.instagram)}`)
  if (f.email?.trim()) linhas.push(`- Email: ${numaLinha(f.email)}`)
  if (f.empresa?.trim()) linhas.push(`- Company: ${numaLinha(f.empresa)}`)
  return linhas.length ? `${TITULO.ficha}:\n${linhas.join('\n')}` : `${TITULO.ficha}: no details on file.`
}

function textoDosCampos(campos: CampoLido[]): string {
  const linhas = campos
    .filter((c) => c.valor.trim() !== '')
    .map((c) => `- ${numaLinha(c.nome)}: ${numaLinha(c.valor)}`)
  return linhas.length ? `${TITULO.campos}:\n${linhas.join('\n')}` : `${TITULO.campos}: none filled in.`
}

function textoDoNegocio(n: NegocioLido | null, agora: Date, fuso: string): string {
  if (!n) return `${TITULO.negocio}: this customer has no open deal.`
  const linhas: string[] = []
  if (n.funil) linhas.push(`- Pipeline: ${numaLinha(n.funil)}`)
  if (n.etapa) linhas.push(`- Stage: ${numaLinha(n.etapa)}`)
  // `deals.value` é NOT NULL DEFAULT 0: zero é "sem valor", não um valor.
  if (n.valor > 0) linhas.push(`- Value: ${dinheiro(n.valor)}`)
  const desde = n.etapaDesde ? dia(n.etapaDesde, fuso) : null
  if (desde && n.etapaDesde) {
    const dias = Math.max(0, Math.floor((agora.getTime() - Date.parse(n.etapaDesde)) / DIA_MS))
    linhas.push(`- In this stage since: ${desde} (${dias === 0 ? 'today' : dias === 1 ? '1 day' : `${dias} days`})`)
  }
  return `${TITULO.negocio} (open):\n${linhas.join('\n')}`
}

function textoDasEtiquetas(nomes: string[]): string {
  const limpos = nomes.map(numaLinha).filter((n) => n !== '')
  return limpos.length ? `${TITULO.etiquetas}: ${limpos.join(', ')}` : `${TITULO.etiquetas}: none.`
}

function rotuloDaParcela(p: ParcelaDoEspelho): string {
  if (p.parcela_numero !== null) {
    return p.parcela_total !== null && p.parcela_total > 0
      ? `installment ${p.parcela_numero}/${p.parcela_total}`
      : `installment ${p.parcela_numero}`
  }
  const descricao = p.descricao?.trim()
  return descricao ? numaLinha(descricao) : 'charge'
}

function textoDasCobrancas(c: CobrancasLidas, agora: Date, fuso: string): string {
  if (!c.conectado) {
    return `${TITULO.cobrancas}: the billing system is not connected — the customer's billing status is unknown.`
  }
  // Sem listagem completa nenhuma, nada do espelho é resposta.
  if (!c.atualizadoEm) return `${TITULO.cobrancas}: ${INDISPONIVEL}`
  const atualizado = dia(c.atualizadoEm, fuso) ?? c.atualizadoEm
  const nota = c.fresca ? '' : `\nData as of ${atualizado}, may be outdated.`
  if (c.clientes === 0) {
    // Sem o vínculo da listagem vigente terminado, "nenhum cliente ligado" é
    // lacuna, não resposta (`cicloCompleto`).
    if (!c.cicloCompleto) return `${TITULO.cobrancas}: ${INDISPONIVEL}`
    return `${TITULO.cobrancas}: no billing record is linked to this customer.${nota}`
  }
  const { vencidas, emConferencia } = c.resumo
  // ⚠️ As RESSALVAS vêm primeiro: o teto do bloco corta pelo FIM, e com ~20
  // parcelas a nota de dado velho, o aviso das parcelas em conferência e o
  // total sumiam — o modelo veria a dívida sem saber que ela pode estar
  // velha ou já paga (revisão da F3).
  const ressalvas: string[] = []
  if (!c.fresca) ressalvas.push(`Data as of ${atualizado}, may be outdated.`)
  if (emConferencia.length > 0) {
    ressalvas.push(
      `${emConferencia.length} other ${emConferencia.length === 1 ? 'installment is' : 'installments are'} being re-checked ` +
        'and may already be paid — do not treat them as owed.',
    )
  }
  const linhas: string[] = []
  if (vencidas.length === 0) {
    linhas.push(`${TITULO.cobrancas}: no overdue installments.`, ...ressalvas)
  } else {
    linhas.push(
      `${TITULO.cobrancas} — overdue installments (total ${dinheiro(c.resumo.totalAtualizado)}):`,
      ...ressalvas,
    )
    for (const p of vencidas) {
      const dias = diasDeAtraso(p.vencimento, agora, fuso)
      const atraso = dias !== null && dias > 0 ? `, ${dias} ${dias === 1 ? 'day' : 'days'} overdue` : ''
      const negativada = classificar(p.status, p.deleted) === 'negativada' ? ' — sent to the credit bureau' : ''
      // O LINK de pagamento que já existe (a 2ª via da D6, F4): a fatura, senão
      // o boleto. ⚠️ Só com a leitura FRESCA — com leitura velha a parcela
      // pode já ter sido paga, e o link levaria o cliente a pagar de novo.
      const link = c.fresca ? p.link_fatura?.trim() || p.link_boleto?.trim() || null : null
      const pagar = link ? ` — payment link: ${link}` : ''
      linhas.push(`- ${rotuloDaParcela(p)} — due ${p.vencimento} — ${dinheiro(valorAtualizado(p))}${atraso}${negativada}${pagar}`)
    }
  }
  return linhas.join('\n')
}

function textoDaReuniao(r: ReuniaoLida | null, fuso: string): string {
  if (!r) return `${TITULO.reuniao}: none scheduled.`
  const d = new Date(r.inicio)
  const quando = Number.isNaN(d.getTime()) ? r.inicio : `${dataEHora(d, fuso)} (the business's timezone)`
  const evento = r.evento?.trim() ? ` — ${numaLinha(r.evento)}` : ''
  const remarcar = r.remarcar?.trim() ? `\n- Reschedule link: ${r.remarcar.trim()}` : ''
  return `${TITULO.reuniao}: ${quando}${evento}${remarcar}`
}

/**
 * Os blocos marcados E lidos, na ordem de `BLOCOS_DO_ACESSO`. Bloco marcado
 * sem leitura (sem contato) não entra; bloco cuja leitura falhou entra
 * dizendo que não está disponível.
 */
export function montarBlocos(
  dados: DadosDoAcesso,
  acesso: AcessoDoAgente,
  agora: Date,
  fuso: string = FUSO_DO_ESCRITORIO,
): BlocoVisto[] {
  const blocos: BlocoVisto[] = []
  for (const bloco of BLOCOS_DO_ACESSO) {
    if (!blocoMarcado(acesso, bloco)) continue
    const texto = textoDoBloco(bloco, dados, agora, fuso)
    if (texto !== null) blocos.push({ bloco, texto: limitarBloco(texto) })
  }
  return blocos
}

/** O bloco saiu como "indisponível" (a leitura falhou ou não há resposta): o Playground não diz que o agente o viu. */
export function blocoIndisponivel(b: Pick<BlocoVisto, 'texto'>): boolean {
  return b.texto.endsWith(INDISPONIVEL)
}

function textoDoBloco(bloco: BlocoDoAcesso, dados: DadosDoAcesso, agora: Date, fuso: string): string | null {
  const indisponivel = `${TITULO[bloco]}: ${INDISPONIVEL}`
  switch (bloco) {
    case 'ficha':
      return dados.ficha ? (dados.ficha.ok ? textoDaFicha(dados.ficha.valor) : indisponivel) : null
    case 'campos':
      return dados.campos ? (dados.campos.ok ? textoDosCampos(dados.campos.valor) : indisponivel) : null
    case 'negocio':
      return dados.negocio ? (dados.negocio.ok ? textoDoNegocio(dados.negocio.valor, agora, fuso) : indisponivel) : null
    case 'etiquetas':
      return dados.etiquetas ? (dados.etiquetas.ok ? textoDasEtiquetas(dados.etiquetas.valor) : indisponivel) : null
    case 'cobrancas':
      return dados.cobrancas
        ? dados.cobrancas.ok
          ? textoDasCobrancas(dados.cobrancas.valor, agora, fuso)
          : indisponivel
        : null
    case 'reuniao':
      return dados.reuniao ? (dados.reuniao.ok ? textoDaReuniao(dados.reuniao.valor, fuso) : indisponivel) : null
    default: {
      const nunca: never = bloco
      throw new Error(`bloco desconhecido: ${String(nunca)}`)
    }
  }
}

// ------------------------------------------------------------
// O retrato (o que o turno grava em `cb_ia_turnos.contexto`)
// ------------------------------------------------------------

export interface RetratoDoContexto {
  blocos: Array<{ bloco: string; texto: string }>
  /** Os documentos de onde vieram os trechos da base, sem repetição. */
  documentos: string[]
}

/**
 * O RETRATO do que o modelo viu: os blocos como entraram e os documentos dos
 * trechos. Com `TETO_DO_BLOCO` por bloco ele cabe folgado em
 * `TETO_DO_RETRATO`; o laço só age com texto fora do comum (o JSON escapa
 * caractere de controle em seis), cortando o bloco mais longo pela metade.
 */
export function montarRetrato(blocos: BlocoVisto[], trechos: TrechoDaBase[]): RetratoDoContexto {
  const retrato: RetratoDoContexto = {
    blocos: blocos.map((b) => ({ bloco: b.bloco, texto: b.texto })),
    documentos: [...new Set(trechos.map((t) => t.documentoId))],
  }
  while (JSON.stringify(retrato).length > TETO_DO_RETRATO) {
    const maior = retrato.blocos.reduce<{ bloco: string; texto: string } | null>(
      (m, b) => (!m || b.texto.length > m.texto.length ? b : m),
      null,
    )
    if (!maior || maior.texto.length <= TRUNCADO.length) break
    maior.texto = limitarBloco(maior.texto, Math.floor(maior.texto.length / 2))
  }
  return retrato
}

/** O retrato guardado → a forma da rota. Parse, nunca `as`: nulo quando não é retrato. */
export function lerRetrato(v: unknown): RetratoDoContexto | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (!Array.isArray(r.blocos) || !Array.isArray(r.documentos)) return null
  return {
    blocos: r.blocos
      .filter(
        (b): b is { bloco: string; texto: string } =>
          !!b && typeof b === 'object' && typeof (b as { bloco?: unknown }).bloco === 'string' &&
          typeof (b as { texto?: unknown }).texto === 'string',
      )
      .map((b) => ({ bloco: b.bloco, texto: b.texto })),
    documentos: r.documentos.filter((d): d is string => typeof d === 'string'),
  }
}

// ------------------------------------------------------------
// A leitura (I/O)
// ------------------------------------------------------------

/** Quantos agendamentos futuros ler para achar o primeiro que não foi cancelado. */
// Folgado de propósito: cada reagendamento deixa um `invitee.created`
// cancelado no futuro, e cortar cedo esconderia o agendamento vivo atrás dos
// cancelados (Codex, #312).
const AGENDAMENTOS_LIDOS = 100
/** Teto das etiquetas de um contato. */
const ETIQUETAS_LIDAS = 200

async function lerFicha(db: SupabaseClient, accountId: string, contactId: string): Promise<FichaLida> {
  const { data, error } = await db
    .from('contacts')
    .select('name, phone, wa_username, instagram_username, email, company')
    .eq('account_id', accountId)
    .eq('id', contactId)
    .maybeSingle()
  if (error) throw new Error(`ficha: ${error.message}`)
  if (!data) throw new Error('ficha: contato não encontrado nesta conta')
  const l = data as Record<string, unknown>
  const texto = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    nome: texto(l.name),
    telefone: texto(l.phone),
    whatsapp: texto(l.wa_username),
    instagram: texto(l.instagram_username),
    email: texto(l.email),
    empresa: texto(l.company),
  }
}

/** Os campos MARCADOS, na ordem em que o administrador os marcou; o de outra conta (ou apagado) some. */
async function lerCampos(db: SupabaseClient, accountId: string, contactId: string, ids: string[]): Promise<CampoLido[]> {
  const [{ data: campos, error: erroCampos }, { data: valores, error: erroValores }] = await Promise.all([
    db.from('custom_fields').select('id, field_name').eq('account_id', accountId).in('id', ids),
    db.from('contact_custom_values').select('custom_field_id, value').eq('contact_id', contactId).in('custom_field_id', ids),
  ])
  if (erroCampos) throw new Error(`campos: ${erroCampos.message}`)
  if (erroValores) throw new Error(`valores dos campos: ${erroValores.message}`)
  const nomeDe = new Map(((campos ?? []) as { id: string; field_name: string }[]).map((c) => [c.id, c.field_name]))
  const valorDe = new Map(
    ((valores ?? []) as { custom_field_id: string; value: string | null }[]).map((v) => [v.custom_field_id, v.value ?? '']),
  )
  return ids
    .filter((id) => nomeDe.has(id))
    .map((id) => ({ nome: nomeDe.get(id) ?? '', valor: valorDe.get(id) ?? '' }))
}

/** O card: o do turno (`dealId`), senão o ABERTO mais recente do contato (o Playground). */
async function lerNegocio(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  dealId: string | null,
): Promise<NegocioLido | null> {
  const base = db.from('deals').select('id, pipeline_id, stage_id, value, etapa_desde').eq('account_id', accountId)
  // ⚠️ O card do turno TAMBÉM pelo contato: se alguém trocou o contato do
  // card entre a conferência e esta leitura, os dados dele iriam ao provedor
  // na conversa de outra pessoa (Codex, #312).
  const { data, error } = dealId
    ? await base.eq('id', dealId).eq('contact_id', contactId).maybeSingle()
    : await base
        .eq('contact_id', contactId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
  if (error) throw new Error(`negócio: ${error.message}`)
  if (!data) return null
  const d = data as { pipeline_id: string; stage_id: string; value: unknown; etapa_desde: string | null }
  const [{ data: funil, error: erroFunil }, { data: etapa, error: erroEtapa }] = await Promise.all([
    db.from('pipelines').select('name').eq('account_id', accountId).eq('id', d.pipeline_id).maybeSingle(),
    // `pipeline_stages` não tem conta: o recorte é o funil, que é da conta.
    db.from('pipeline_stages').select('name').eq('id', d.stage_id).eq('pipeline_id', d.pipeline_id).maybeSingle(),
  ])
  if (erroFunil) throw new Error(`funil: ${erroFunil.message}`)
  if (erroEtapa) throw new Error(`etapa: ${erroEtapa.message}`)
  const valor = Number(d.value ?? 0)
  return {
    funil: (funil as { name?: string } | null)?.name ?? null,
    etapa: (etapa as { name?: string } | null)?.name ?? null,
    valor: Number.isFinite(valor) ? valor : 0,
    etapaDesde: d.etapa_desde,
  }
}

async function lerEtiquetas(db: SupabaseClient, accountId: string, contactId: string): Promise<string[]> {
  const { data: ligadas, error } = await db
    .from('contact_tags')
    .select('tag_id')
    .eq('contact_id', contactId)
    .limit(ETIQUETAS_LIDAS)
  if (error) throw new Error(`etiquetas do contato: ${error.message}`)
  const ids = ((ligadas ?? []) as { tag_id: string }[]).map((l) => l.tag_id)
  if (ids.length === 0) return []
  const { data: tags, error: erroTags } = await db
    .from('tags')
    .select('name')
    .eq('account_id', accountId)
    .in('id', ids)
    .order('name', { ascending: true })
  if (erroTags) throw new Error(`etiquetas: ${erroTags.message}`)
  return ((tags ?? []) as { name: string }[]).map((t) => t.name)
}

/** O espelho do Asaas para o contato — a mesma leitura da aba Cobranças. SÓ leitura. */
async function lerCobrancas(db: SupabaseClient, accountId: string, contactId: string, agora: Date): Promise<CobrancasLidas> {
  const config = await lerConfigDoEspelho(db, accountId)
  if (!config) return { conectado: false }
  const clientes = await lerClientesDoContato(db, accountId, contactId)
  const parcelas = await lerCobrancasDosClientes(
    db,
    accountId,
    clientes.map((c) => c.asaas_customer_id),
  )
  return {
    conectado: true,
    fresca: leituraFresca(config, agora),
    atualizadoEm: config.vencidas_listadas_em,
    cicloCompleto: cicloCompleto(config),
    clientes: clientes.length,
    resumo: resumirDivida(parcelas, agora, config.vencidas_listadas_em),
  }
}

/**
 * A PRÓXIMA reunião: o `invitee.created` do contato com `inicio` no futuro e
 * SEM `invitee.canceled` para o mesmo invitee — reagendar cancela o antigo e
 * cria um novo (a URI muda), então o antigo cancelado fica de fora sozinho.
 */
async function lerReuniao(db: SupabaseClient, accountId: string, contactId: string, agora: Date): Promise<ReuniaoLida | null> {
  const { data, error } = await db
    .from('cb_calendly_eventos')
    .select('invitee_uri, inicio, event_type_nome, variaveis')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('evento', EVENTO_AGENDADO)
    .gt('inicio', agora.toISOString())
    .order('inicio', { ascending: true })
    .limit(AGENDAMENTOS_LIDOS)
  if (error) throw new Error(`reuniões: ${error.message}`)
  const futuras = (data ?? []) as { invitee_uri: string; inicio: string; event_type_nome: string | null; variaveis: unknown }[]
  if (futuras.length === 0) return null
  const { data: canceladas, error: erroCanceladas } = await db
    .from('cb_calendly_eventos')
    .select('invitee_uri')
    .eq('account_id', accountId)
    .eq('evento', EVENTO_CANCELADO)
    .in('invitee_uri', futuras.map((f) => f.invitee_uri))
  if (erroCanceladas) throw new Error(`cancelamentos: ${erroCanceladas.message}`)
  const cancelada = new Set(((canceladas ?? []) as { invitee_uri: string }[]).map((c) => c.invitee_uri))
  const proxima = futuras.find((f) => !cancelada.has(f.invitee_uri))
  if (!proxima) return null
  const variaveis =
    proxima.variaveis && typeof proxima.variaveis === 'object' ? (proxima.variaveis as Record<string, unknown>) : {}
  const remarcar = typeof variaveis.agendamento_remarcar === 'string' ? variaveis.agendamento_remarcar : null
  return { inicio: proxima.inicio, evento: proxima.event_type_nome, remarcar: remarcar || null }
}

async function lerBloco<T>(rotulo: string, ler: () => Promise<T>): Promise<Leitura<T>> {
  try {
    return { ok: true, valor: await ler() }
  } catch (err) {
    console.error(`[ia-agentes] leitura do bloco ${rotulo} falhou (vai como indisponível):`, err)
    return { ok: false }
  }
}

/**
 * Lê SÓ os blocos marcados, em paralelo. Sem contato (conversa sem ficha,
 * Playground sem contato), nada — todos os blocos dependem dele. Nunca lança.
 */
export async function lerDadosDoAcesso(
  db: SupabaseClient,
  args: { accountId: string; contactId: string | null; dealId: string | null; acesso: AcessoDoAgente; agora: Date },
): Promise<DadosDoAcesso> {
  const { accountId, contactId, acesso, agora } = args
  if (!contactId) return {}
  const [ficha, campos, negocio, etiquetas, cobrancas, reuniao] = await Promise.all([
    acesso.ficha ? lerBloco('ficha', () => lerFicha(db, accountId, contactId)) : undefined,
    acesso.campos.length > 0 ? lerBloco('campos', () => lerCampos(db, accountId, contactId, acesso.campos)) : undefined,
    acesso.negocio ? lerBloco('negocio', () => lerNegocio(db, accountId, contactId, args.dealId)) : undefined,
    acesso.etiquetas ? lerBloco('etiquetas', () => lerEtiquetas(db, accountId, contactId)) : undefined,
    acesso.cobrancas ? lerBloco('cobrancas', () => lerCobrancas(db, accountId, contactId, agora)) : undefined,
    acesso.reuniao ? lerBloco('reuniao', () => lerReuniao(db, accountId, contactId, agora)) : undefined,
  ])
  const dados: DadosDoAcesso = {}
  if (ficha) dados.ficha = ficha
  if (campos) dados.campos = campos
  if (negocio) dados.negocio = negocio
  if (etiquetas) dados.etiquetas = etiquetas
  if (cobrancas) dados.cobrancas = cobrancas
  if (reuniao) dados.reuniao = reuniao
  return dados
}

// ------------------------------------------------------------
// Tudo junto: o que o agente vê num turno (ou no Playground)
// ------------------------------------------------------------

export interface OQueOAgenteVe {
  blocos: BlocoVisto[]
  trechos: TrechoDaBase[]
  retrato: RetratoDoContexto
}

/**
 * Os blocos de acesso e os trechos da base do agente, lidos UMA vez, e o
 * retrato. `consulta` = a última mensagem do cliente (texto ou transcrição).
 * Nunca lança: bloco que falha diz "unavailable", base que falha fica vazia.
 */
export async function lerOQueOAgenteVe(
  db: SupabaseClient,
  args: {
    accountId: string
    agente: { id: string; acesso: AcessoDoAgente }
    contactId: string | null
    dealId: string | null
    consulta: string
    agora: Date
  },
): Promise<OQueOAgenteVe> {
  const [dados, trechos] = await Promise.all([
    lerDadosDoAcesso(db, {
      accountId: args.accountId,
      contactId: args.contactId,
      dealId: args.dealId,
      acesso: args.agente.acesso,
      agora: args.agora,
    }),
    retrieveKnowledgeDoAgente(
      db,
      args.accountId,
      args.agente.id,
      // Só lida se o agente tem documento (a primeira coisa que a busca confere).
      async () => (await lerChaveDeEmbeddings(args.accountId)).chave,
      args.consulta,
    ),
  ])
  const blocos = montarBlocos(dados, args.agente.acesso, args.agora)
  return { blocos, trechos, retrato: montarRetrato(blocos, trechos) }
}
