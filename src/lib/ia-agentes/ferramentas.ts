// ============================================================
// As FERRAMENTAS do agente no banco (F4, D28): o catálogo que a tela mostra,
// a conferência ao salvar, as opções numeradas do pedido e a régua da D5
// sobre as automações. Servidor, com o cliente de SERVIÇO: toda consulta leva
// a conta — `pipeline_stages` e `automation_steps` não têm conta, e o recorte
// é pelo funil e pela automação (`!inner`), que têm.
//
// A régua em si (o que sai da D5, o que é campo vigiado) é PURA e mora em
// `acoes.ts`; aqui só se lê o que ela precisa.
//
// ⚠️ A D5 vale SÓ para o que o agente faz (decisão do operador, 27/09/2026):
// a régua confere a automação que ele EXECUTA (e as que ela aciona por
// `run_automation`) e a etapa de ganho/perdido — não percorre mais a CASCATA
// (as automações de entrada da etapa movida e as de etiqueta aplicada rodam
// como quando alguém da equipe move o card ou etiqueta).
//
// "Marcar reunião" (F5) é conferido contra o CALENDLY (o tipo de evento é
// ativo na conta conectada), não contra o banco. Os horários do pedido vêm
// de `agenda.ts`, não de `opcoesDoAgente`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ehGatilhoDaRegua } from '@/lib/asaas/regua'
import { TIPO_DATA } from '@/lib/contacts/campo-data'

import {
  automacoesAlcancaveis,
  camposVigiados,
  formatoDoCampo,
  motivoForaDaD5,
  type MotivoForaDaD5,
  type OpcoesDeAcao,
  type PassoDaAutomacao,
  type ReguaDaD5,
} from './acoes'
import { itensDaAcao, type FerramentasDoAgente } from './agente'
import { tiposDeEventoAtivos } from './agenda'

const PAGINA = 1000
/** Camadas de automação percorridas (as acionadas por `run_automation`): passou disso, a régua desiste (e recusa). */
const CAMADAS_DA_D5 = 20

type Consulta = (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>

/** Todas as linhas, página a página (o PostgREST corta em 1000). Lança em erro. */
async function lerTodas<T>(consulta: Consulta, rotulo: string): Promise<T[]> {
  const tudo: T[] = []
  for (let pagina = 0; pagina < 20; pagina++) {
    const { data, error } = await consulta(pagina * PAGINA, (pagina + 1) * PAGINA - 1)
    if (error) throw new Error(`${rotulo}: ${error.message}`)
    const linhas = (data ?? []) as T[]
    tudo.push(...linhas)
    if (linhas.length < PAGINA) return tudo
  }
  throw new Error(`${rotulo}: mais de 20 páginas`)
}

function nomeDoMembro(l: { full_name?: unknown; email?: unknown }): string {
  const nome = typeof l.full_name === 'string' ? l.full_name.trim() : ''
  return nome || (typeof l.email === 'string' ? l.email : '')
}

/** O nome do funil embutido (`pipelines!inner(name)`). */
function funilDa(l: { pipelines: { name?: unknown } | null }): string {
  return typeof l.pipelines?.name === 'string' ? l.pipelines.name : ''
}

function resultadoDa(v: unknown): 'ganho' | 'perdido' | null {
  return v === 'ganho' || v === 'perdido' ? v : null
}

// ------------------------------------------------------------
// O que a régua da D5 precisa ler
// ------------------------------------------------------------

/** Os campos de data vigiados por lembrete LIGADO nesta conta. Lança em erro. */
export async function lerCamposVigiados(db: SupabaseClient, accountId: string): Promise<Set<string>> {
  const linhas = await lerTodas<{ trigger_type: string; trigger_config: unknown; is_active: boolean }>(
    (de, ate) =>
      db
        .from('automations')
        .select('id, trigger_type, trigger_config, is_active')
        .eq('account_id', accountId)
        .eq('trigger_type', 'date_field_offset')
        .eq('is_active', true)
        .order('id')
        .range(de, ate),
    'automações de lembrete',
  )
  return camposVigiados(linhas)
}

/** As etapas de ganho/perdido desta conta. Lança em erro. */
async function lerEtapasDeResultado(db: SupabaseClient, accountId: string): Promise<Set<string>> {
  const linhas = await lerTodas<{ id: string }>(
    (de, ate) =>
      db
        .from('pipeline_stages')
        .select('id, pipelines!inner(account_id)')
        .eq('pipelines.account_id', accountId)
        .not('resultado', 'is', null)
        .order('id')
        .range(de, ate),
    'etapas com resultado',
  )
  return new Set(linhas.map((l) => l.id))
}

/** Linhas de `automation_steps` → passos por automação. */
function agruparPassos(
  linhas: Array<{ automation_id: string; step_type: string; step_config: unknown }>,
  passosDe: Map<string, PassoDaAutomacao[]>,
): void {
  for (const l of linhas) {
    const config =
      l.step_config && typeof l.step_config === 'object' ? (l.step_config as Record<string, unknown>) : {}
    passosDe.set(l.automation_id, [...(passosDe.get(l.automation_id) ?? []), { tipo: l.step_type, config }])
  }
}

/** A régua da conta: as etapas de resultado e os campos vigiados. Lança em erro. */
async function lerRegua(db: SupabaseClient, accountId: string): Promise<ReguaDaD5> {
  const [etapasDeResultado, vigiados] = await Promise.all([
    lerEtapasDeResultado(db, accountId),
    lerCamposVigiados(db, accountId),
  ])
  return { etapasDeResultado, camposVigiados: vigiados }
}

/**
 * A D5 de cada automação que a IA EXECUTA (e das que ela aciona por
 * `run_automation`; o "Aguardar" conta) — `null` = dentro. Lê os passos
 * CAMADA POR CAMADA — só os que a régua percorre (`automacoesAlcancaveis`,
 * as MESMAS arestas) e só de automação DESTA conta (`automations!inner`).
 * Lança em erro de leitura (quem chama recusa: na dúvida, a IA não dispara).
 */
export async function motivosForaDaD5(
  db: SupabaseClient,
  accountId: string,
  automacoes: readonly string[],
): Promise<Map<string, MotivoForaDaD5 | null>> {
  const regua = await lerRegua(db, accountId)
  const passosDe = new Map<string, PassoDaAutomacao[]>()
  const lidas = new Set<string>()
  for (let camada = 0; ; camada++) {
    const faltam = [...automacoesAlcancaveis(automacoes, passosDe)].filter((id) => !lidas.has(id))
    if (faltam.length === 0) break
    if (camada >= CAMADAS_DA_D5) throw new Error('automações encadeadas demais para conferir a D5')
    for (const id of faltam) lidas.add(id)
    const linhas = await lerTodas<{ automation_id: string; step_type: string; step_config: unknown }>(
      (de, ate) =>
        db
          .from('automation_steps')
          .select('id, automation_id, step_type, step_config, automations!inner(account_id)')
          .eq('automations.account_id', accountId)
          .in('automation_id', faltam)
          .order('id')
          .range(de, ate),
      'passos das automações',
    )
    agruparPassos(linhas, passosDe)
  }
  return new Map(automacoes.map((id) => [id, motivoForaDaD5(id, passosDe, regua)]))
}

// ------------------------------------------------------------
// A conferência ao SALVAR (PATCH do agente)
// ------------------------------------------------------------

export type CodigoDaFerramenta =
  | 'etapa_de_resultado'
  | 'item_de_outra_conta'
  | 'campo_vigiado'
  | 'automacao_fora_da_d5'
  /** "Marcar reunião" (F5): o tipo de evento não é um ATIVO da conta do Calendly conectado. */
  | 'tipo_de_evento_invalido'
  /** "Marcar reunião" (F5): não há Calendly conectado (ou o token foi recusado). */
  | 'calendly_desconectado'

export type ConferenciaDasFerramentas = { ok: true } | { ok: false; codigo: CodigoDaFerramenta; itens: string[] }

function faltando(pedidos: readonly string[], achados: Iterable<string>): string[] {
  const tem = new Set(achados)
  return pedidos.filter((id) => !tem.has(id))
}

/**
 * Confere as ferramentas que a tela manda: todo item é DESTA conta (array sem
 * FK, escrita em service role), nenhuma etapa é de ganho/perdido (D5),
 * nenhum campo de data é vigiado por lembrete e nenhuma automação tem passo
 * fora da D5 ou "Aguardar" (percorrendo as que ela aciona por
 * `run_automation`). As automações de ENTRADA da etapa e as de etiqueta não
 * são conferidas: a D5 vale só para o que o agente faz (27/09/2026). A
 * recusa leva os ids. Lança em erro de leitura.
 *
 * "Marcar reunião" (F5): o tipo de evento tem de ser um ATIVO da conta do
 * Calendly conectado, lido na API (`tipo_de_evento_invalido`; sem Calendly,
 * `calendly_desconectado`). A automação do tipo de evento (que pode avisar o
 * advogado por `send_to_number` e mover o card) roda como roda quando o
 * PRÓPRIO cliente agenda pelo link. O Calendly só é consultado
 * quando o tipo de evento MUDOU em relação ao gravado (`gravadas`, as
 * ferramentas do agente antes da alteração; ausente = criação, confere sempre):
 * sem isso, salvar outra ferramenta com o Calendly fora do ar dava 500.
 */
export async function conferirFerramentas(
  db: SupabaseClient,
  accountId: string,
  f: FerramentasDoAgente,
  gravadas?: FerramentasDoAgente | null,
): Promise<ConferenciaDasFerramentas> {
  const etapas = itensDaAcao(f, 'mover_etapa')
  const etiquetas = [...new Set([...itensDaAcao(f, 'etiquetar'), ...itensDaAcao(f, 'tirar_etiqueta')])]
  const campos = itensDaAcao(f, 'preencher_campo')
  const membros = itensDaAcao(f, 'criar_tarefa')
  const automacoes = itensDaAcao(f, 'executar_automacao')
  const tiposDeEvento = itensDaAcao(f, 'marcar_reuniao')

  const vazio = Promise.resolve({ data: [] as unknown[], error: null })
  const [rEtapas, rEtiquetas, rCampos, rMembros, rAutomacoes] = await Promise.all([
    etapas.length
      ? db
          .from('pipeline_stages')
          .select('id, resultado, pipelines!inner(account_id)')
          .eq('pipelines.account_id', accountId)
          .in('id', etapas)
      : vazio,
    etiquetas.length ? db.from('tags').select('id').eq('account_id', accountId).in('id', etiquetas) : vazio,
    campos.length
      ? db.from('custom_fields').select('id, field_type').eq('account_id', accountId).in('id', campos)
      : vazio,
    membros.length ? db.from('profiles').select('user_id').eq('account_id', accountId).in('user_id', membros) : vazio,
    automacoes.length ? db.from('automations').select('id').eq('account_id', accountId).in('id', automacoes) : vazio,
  ])
  for (const r of [rEtapas, rEtiquetas, rCampos, rMembros, rAutomacoes]) {
    if (r.error) throw new Error(`conferência das ferramentas: ${r.error.message}`)
  }
  const linhasDeEtapa = (rEtapas.data ?? []) as Array<{ id: string; resultado: unknown }>
  const linhasDeCampo = (rCampos.data ?? []) as Array<{ id: string; field_type: string | null }>

  const deOutraConta = [
    ...faltando(etapas, linhasDeEtapa.map((l) => l.id)),
    ...faltando(etiquetas, ((rEtiquetas.data ?? []) as Array<{ id: string }>).map((l) => l.id)),
    ...faltando(campos, linhasDeCampo.map((l) => l.id)),
    ...faltando(membros, ((rMembros.data ?? []) as Array<{ user_id: string }>).map((l) => l.user_id)),
    ...faltando(automacoes, ((rAutomacoes.data ?? []) as Array<{ id: string }>).map((l) => l.id)),
  ]
  if (deOutraConta.length) return { ok: false, codigo: 'item_de_outra_conta', itens: deOutraConta }

  const deResultado = linhasDeEtapa.filter((l) => resultadoDa(l.resultado) !== null).map((l) => l.id)
  if (deResultado.length) return { ok: false, codigo: 'etapa_de_resultado', itens: deResultado }

  const deData = linhasDeCampo.filter((l) => l.field_type === TIPO_DATA).map((l) => l.id)
  if (deData.length) {
    const vigiados = await lerCamposVigiados(db, accountId)
    const recusados = deData.filter((id) => vigiados.has(id))
    if (recusados.length) return { ok: false, codigo: 'campo_vigiado', itens: recusados }
  }

  if (automacoes.length) {
    const d5 = await motivosForaDaD5(db, accountId, automacoes)
    const fora = automacoes.filter((id) => d5.get(id))
    if (fora.length) return { ok: false, codigo: 'automacao_fora_da_d5', itens: fora }
  }

  // A reunião (F5): contra o Calendly, e só quando o tipo de evento mudou — o
  // gravado já passou por aqui, e o turno e a execução o conferem de novo no
  // Calendly (desativado = recusado). Leitura que falha lança (quem chama
  // recusa com `banco`).
  const gravados = gravadas ? itensDaAcao(gravadas, 'marcar_reuniao') : null
  const mudou = !gravados || gravados.length !== tiposDeEvento.length || tiposDeEvento.some((uri) => !gravados.includes(uri))
  if (tiposDeEvento.length && mudou) {
    const calendly = await tiposDeEventoAtivos(db, accountId)
    if (calendly.estado === 'desconectado') return { ok: false, codigo: 'calendly_desconectado', itens: tiposDeEvento }
    const ativos = new Set(calendly.tipos.map((t) => t.uri))
    const invalidos = tiposDeEvento.filter((uri) => !ativos.has(uri))
    if (invalidos.length) return { ok: false, codigo: 'tipo_de_evento_invalido', itens: invalidos }
  }
  return { ok: true }
}

// ------------------------------------------------------------
// O catálogo da tela (GET …/ferramentas/opcoes)
// ------------------------------------------------------------

export interface CatalogoDeFerramentas {
  /** A etapa de ganho/perdido vem em `resultado` (a única que a D5 recusa). */
  etapas: Array<{ id: string; nome: string; funil: string; resultado: 'ganho' | 'perdido' | null }>
  etiquetas: Array<{ id: string; nome: string }>
  /**
   * `tipo` = `field_type`, menos o campo que espelha o e-mail (`'email'`);
   * `opcoes` = as opções do `select` (vazia nos outros).
   */
  campos: Array<{ id: string; nome: string; vigiado: boolean; tipo: string; opcoes: string[] }>
  membros: Array<{ userId: string; nome: string }>
  /** `foraDaD5`: o passo fora da D5 (ou o "Aguardar") nela e nas que ela aciona por `run_automation`. */
  automacoes: Array<{ id: string; nome: string; foraDaD5: MotivoForaDaD5 | null }>
}

/**
 * TUDO o que a conta tem para as ferramentas, com o que o SERVIDOR decide
 * (etapa de resultado, campo vigiado, D5 da automação) — a tela só mostra. A régua do Asaas fica de fora
 * (ela só roda pela varredura). Lança em erro de leitura: um catálogo pela
 * metade faria a tela dizer "a conta não tem etiquetas".
 */
export async function lerCatalogoDeFerramentas(db: SupabaseClient, accountId: string): Promise<CatalogoDeFerramentas> {
  const [etapas, etiquetas, campos, membros, automacoes, passos, regua] = await Promise.all([
    lerTodas<{ id: string; name: string; position: number; resultado: unknown; pipelines: { name?: unknown } | null }>(
      (de, ate) =>
        db
          .from('pipeline_stages')
          .select('id, name, position, resultado, pipelines!inner(account_id, name)')
          .eq('pipelines.account_id', accountId)
          .order('id')
          .range(de, ate),
      'etapas',
    ),
    lerTodas<{ id: string; name: string }>(
      (de, ate) => db.from('tags').select('id, name').eq('account_id', accountId).order('id').range(de, ate),
      'etiquetas',
    ),
    lerTodas<{ id: string; field_name: string; field_type: string | null; field_options: unknown; espelho: string | null }>(
      (de, ate) =>
        db
          .from('custom_fields')
          .select('id, field_name, field_type, field_options, espelho')
          .eq('account_id', accountId)
          .order('id')
          .range(de, ate),
      'campos',
    ),
    lerTodas<{ user_id: string; full_name: unknown; email: unknown }>(
      (de, ate) =>
        db.from('profiles').select('user_id, full_name, email').eq('account_id', accountId).order('user_id').range(de, ate),
      'membros',
    ),
    lerTodas<{ id: string; name: string; trigger_type: string }>(
      (de, ate) =>
        db.from('automations').select('id, name, trigger_type').eq('account_id', accountId).order('id').range(de, ate),
      'automações',
    ),
    lerTodas<{ automation_id: string; step_type: string; step_config: unknown }>(
      (de, ate) =>
        db
          .from('automation_steps')
          .select('id, automation_id, step_type, step_config, automations!inner(account_id)')
          .eq('automations.account_id', accountId)
          .order('id')
          .range(de, ate),
      'passos das automações',
    ),
    lerRegua(db, accountId),
  ])
  const passosDe = new Map<string, PassoDaAutomacao[]>()
  agruparPassos(passos, passosDe)
  const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, 'pt-BR')

  return {
    etapas: [...etapas]
      .sort((a, b) => funilDa(a).localeCompare(funilDa(b), 'pt-BR') || a.position - b.position)
      .map((e) => ({ id: e.id, nome: e.name, funil: funilDa(e), resultado: resultadoDa(e.resultado) })),
    etiquetas: etiquetas.map((t) => ({ id: t.id, nome: t.name })).sort(porNome),
    campos: campos
      .map((c) => {
        const formato = formatoDoCampo(c)
        return {
          id: c.id,
          nome: c.field_name,
          vigiado: c.field_type === TIPO_DATA && regua.camposVigiados.has(c.id),
          // O espelho do e-mail vai como `email` (a tela pede um e-mail); o resto, o `field_type` cru.
          tipo: formato.tipo === 'email' ? 'email' : (c.field_type ?? 'text'),
          opcoes: formato.tipo === 'lista' ? formato.opcoes : [],
        }
      })
      .sort(porNome),
    membros: membros.map((m) => ({ userId: m.user_id, nome: nomeDoMembro(m) })).sort(porNome),
    automacoes: automacoes
      .filter((a) => !ehGatilhoDaRegua(a.trigger_type))
      .map((a) => ({ id: a.id, nome: a.name, foraDaD5: motivoForaDaD5(a.id, passosDe, regua) }))
      .sort(porNome),
  }
}

// ------------------------------------------------------------
// As opções numeradas do pedido (o turno e o Playground)
// ------------------------------------------------------------

/**
 * As opções de cada tipo LIGADO no agente, com os nomes, na ordem em que o
 * pedido as numera. Só entra o que ainda existe na conta e pode ser feito
 * agora: etapa sem resultado, etiqueta, campo não vigiado (com o FORMATO do
 * valor, que o pedido diz ao modelo; `select` sem opção fica de fora — nada
 * o preencheria), automação ligada, dentro da D5 e fora da régua do Asaas.
 * A execução confere tudo DE NOVO.
 * Nunca lança: o tipo cuja leitura falha fica de fora (o agente só não o
 * oferece) — a leitura da D5 só pesa nas automações —, e agente sem
 * ferramenta não lê nada.
 * A reunião (F5) NÃO sai daqui: os horários são lidos com prazo próprio por
 * `lerAgendaDoAgente` (`agenda.ts`), que o turno e o Playground juntam.
 */
export async function opcoesDoAgente(
  db: SupabaseClient,
  accountId: string,
  f: FerramentasDoAgente,
): Promise<OpcoesDeAcao> {
  const opcoes: OpcoesDeAcao = {}
  const tentar = async (rotulo: string, ler: () => Promise<void>) => {
    try {
      await ler()
    } catch (err) {
      console.error(`[ia-agentes] opções de ${rotulo} (a ação fica de fora):`, err)
    }
  }
  const lista = <T,>(r: { data: unknown; error: { message: string } | null }, rotulo: string): T[] => {
    if (r.error) throw new Error(`${rotulo}: ${r.error.message}`)
    return (r.data ?? []) as T[]
  }

  const etapas = itensDaAcao(f, 'mover_etapa')
  const etiquetar = itensDaAcao(f, 'etiquetar')
  const tirar = itensDaAcao(f, 'tirar_etiqueta')
  const campos = itensDaAcao(f, 'preencher_campo')
  const membros = itensDaAcao(f, 'criar_tarefa')
  const automacoes = itensDaAcao(f, 'executar_automacao')

  await Promise.all([
    etapas.length > 0 &&
      tentar('etapas', async () => {
        const linhas = lista<{ id: string; name: string; position: number; resultado: unknown; pipelines: { name?: unknown } | null }>(
          await db
            .from('pipeline_stages')
            .select('id, name, position, resultado, pipelines!inner(account_id, name)')
            .eq('pipelines.account_id', accountId)
            .in('id', etapas),
          'etapas',
        )
        opcoes.mover_etapa = linhas
          .filter((l) => resultadoDa(l.resultado) === null)
          .sort((a, b) => funilDa(a).localeCompare(funilDa(b), 'pt-BR') || a.position - b.position)
          .map((l) => ({ id: l.id, nome: funilDa(l) ? `${funilDa(l)} · ${l.name}` : l.name }))
      }),
    etiquetar.length + tirar.length > 0 &&
      tentar('etiquetas', async () => {
        const linhas = lista<{ id: string; name: string }>(
          await db
            .from('tags')
            .select('id, name')
            .eq('account_id', accountId)
            .in('id', [...new Set([...etiquetar, ...tirar])]),
          'etiquetas',
        ).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        const de = (ids: string[]) => linhas.filter((l) => ids.includes(l.id)).map((l) => ({ id: l.id, nome: l.name }))
        if (etiquetar.length) opcoes.etiquetar = de(etiquetar)
        if (tirar.length) opcoes.tirar_etiqueta = de(tirar)
      }),
    campos.length > 0 &&
      tentar('campos', async () => {
        const linhas = lista<{ id: string; field_name: string; field_type: string | null; field_options: unknown; espelho: string | null }>(
          await db
            .from('custom_fields')
            .select('id, field_name, field_type, field_options, espelho')
            .eq('account_id', accountId)
            .in('id', campos),
          'campos',
        )
        const vigiados = linhas.some((l) => l.field_type === TIPO_DATA) ? await lerCamposVigiados(db, accountId) : new Set()
        opcoes.preencher_campo = linhas
          .filter((l) => !(l.field_type === TIPO_DATA && vigiados.has(l.id)))
          .map((l) => ({ id: l.id, nome: l.field_name, formato: formatoDoCampo(l) }))
          .filter((o) => !(o.formato.tipo === 'lista' && o.formato.opcoes.length === 0))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      }),
    membros.length > 0 &&
      tentar('membros', async () => {
        const linhas = lista<{ user_id: string; full_name: unknown; email: unknown }>(
          // 1064: quem está suspenso não recebe tarefa nova da IA.
          await db
            .from('profiles')
            .select('user_id, full_name, email')
            .eq('account_id', accountId)
            .in('user_id', membros)
            .is('suspenso_em', null),
          'membros',
        )
        opcoes.criar_tarefa = linhas
          .map((l) => ({ id: l.user_id, nome: nomeDoMembro(l) }))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      }),
    automacoes.length > 0 &&
      tentar('automações', async () => {
        const linhas = lista<{ id: string; name: string; trigger_type: string }>(
          await db
            .from('automations')
            .select('id, name, trigger_type')
            .eq('account_id', accountId)
            .eq('is_active', true)
            .in('id', automacoes),
          'automações',
        )
        const motivos = await motivosForaDaD5(db, accountId, automacoes)
        opcoes.executar_automacao = linhas
          .filter((l) => !ehGatilhoDaRegua(l.trigger_type) && !motivos.get(l.id))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
          .map((l) => ({ id: l.id, nome: l.name }))
      }),
  ])
  return opcoes
}
