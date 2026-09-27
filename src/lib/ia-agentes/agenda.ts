// ============================================================
// A AGENDA do agente no Calendly (F5 dos agentes — D7 + D28 do
// docs/PLANO-agentes-de-ia.md). Servidor, com o cliente de SERVIÇO: toda
// consulta leva a conta. O que é regra (janela, texto do horário, corpo do
// `POST /invitees`, leitura da recusa) mora em `reuniao.ts`, PURO.
//
//  - `tiposDeEventoParaATela` — o select da sub-aba Ferramentas (nunca lança:
//    conectado / desconectado / falhou);
//  - `tiposDeEventoAtivos` — a conferência ao SALVAR (lança em falha);
//  - `lerAgendaDoAgente` — os horários livres para o pedido do turno e do
//    Playground, com PRAZO (`PRAZO_DOS_HORARIOS_MS`); falha em SILÊNCIO para o
//    turno (o pedido diz que não há horários agora), nunca lança;
//  - `marcarNoCalendly` — o `POST /invitees`, com o e-mail relido na hora.
//
// ⚠️ O token do Calendly é lido de `cb_calendly_config` e decifrado aqui,
// como `src/lib/calendly/conexao.ts` faz. Ele NUNCA vai para log: toda
// mensagem de erro do cliente já passa por `semSegredo`, e aqui só se loga o
// código e a mensagem limpa.
//
// ⚠️⚠️ Marcar a reunião é a EXCEÇÃO à D5 pela cascata (plano, 5.6, passo 4):
// o Calendly entrega o `invitee.created` ao nosso webhook e a automação do
// tipo de evento roda como quando o PRÓPRIO cliente agenda pelo link — pode
// avisar o advogado por outro número (`send_to_number`) e mover o card. É o
// que se quer: o agente só faz pelo cliente o que o link faria.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { CalendlyError, criarClienteCalendly, type ClienteCalendly, type TipoDeEvento } from '@/lib/calendly/cliente'
import { EVENTO_AGENDADO } from '@/lib/calendly/payload'
import { nomeDoContato } from '@/lib/contacts/identidade'
import { decrypt } from '@/lib/whatsapp/encryption'

import { valorDoCampo, type CodigoDeFalhaDaAcao, type OpcaoDeAcao } from './acoes'
import { itensDaAcao, type FerramentasDoAgente } from './agente'
import {
  corpoDoConvidado,
  janelaDosHorarios,
  opcoesDeHorario,
  PRAZO_DOS_HORARIOS_MS,
  recusaDoHorario,
} from './reuniao'

type FabricaDeCliente = (token: string) => ClienteCalendly

/** Para os testes: o cliente do Calendly é um dublê. */
export interface DependenciasDaAgenda {
  cliente?: FabricaDeCliente
}

/** Prazo do `POST /invitees` (a resposta ao cliente já saiu; o turno tem folga até o recolhimento). */
export const PRAZO_DO_AGENDAMENTO_MS = 15_000

type Conexao =
  | { estado: 'desconectado' }
  | { estado: 'conectado'; cliente: ClienteCalendly; userUri: string; organizationUri: string }

/** O token gravado não decifra (a `ENCRYPTION_KEY` mudou): para quem usa, é reconectar. */
class TokenIlegivel extends Error {
  constructor() {
    super('o token do Calendly não decifra')
    this.name = 'TokenIlegivel'
  }
}

/**
 * A conexão do Calendly desta conta, com o cliente pronto. Sem linha =
 * `desconectado`. Lança em erro de banco (`Error`) e em token que não
 * decifra (`TokenIlegivel`) — quem chama decide o que cada um quer dizer.
 */
async function lerConexao(db: SupabaseClient, accountId: string, deps: DependenciasDaAgenda): Promise<Conexao> {
  const { data, error } = await db
    .from('cb_calendly_config')
    .select('access_token, user_uri, organization_uri')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw new Error(`leitura da conexão do Calendly: ${error.message}`)
  if (!data) return { estado: 'desconectado' }
  const linha = data as { access_token: string; user_uri: string; organization_uri: string }
  let token: string
  try {
    token = decrypt(linha.access_token)
  } catch {
    throw new TokenIlegivel()
  }
  return {
    estado: 'conectado',
    cliente: (deps.cliente ?? criarClienteCalendly)(token),
    userUri: linha.user_uri,
    organizationUri: linha.organization_uri,
  }
}

/** A mensagem do erro, já sem segredo (o cliente passa tudo por `semSegredo`). */
function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ------------------------------------------------------------
// Os tipos de evento (a tela e a conferência ao salvar)
// ------------------------------------------------------------

/**
 * Os tipos de evento ATIVOS da conta do Calendly conectado: os da organização
 * e, se o token não enxerga a organização (403), os do próprio usuário — a
 * mesma leitura de `/api/cb/calendly/event-types`. Token recusado (401) ou
 * que não decifra contam como `desconectado` (o conserto é reconectar em
 * Integrações). Lança em qualquer outra falha (banco, rede, 5xx).
 */
export async function tiposDeEventoAtivos(
  db: SupabaseClient,
  accountId: string,
  deps: DependenciasDaAgenda = {},
): Promise<{ estado: 'desconectado' } | { estado: 'conectado'; tipos: TipoDeEvento[] }> {
  let conexao: Conexao
  try {
    conexao = await lerConexao(db, accountId, deps)
  } catch (e) {
    if (e instanceof TokenIlegivel) return { estado: 'desconectado' }
    throw e
  }
  if (conexao.estado === 'desconectado') return conexao
  let tipos: TipoDeEvento[]
  try {
    try {
      tipos = await conexao.cliente.tiposDeEvento({ organization: conexao.organizationUri })
    } catch (e) {
      if (!(e instanceof CalendlyError) || e.codigo !== 'sem_permissao') throw e
      tipos = await conexao.cliente.tiposDeEvento({ user: conexao.userUri })
    }
  } catch (e) {
    if (e instanceof CalendlyError && e.codigo === 'token_invalido') return { estado: 'desconectado' }
    throw e
  }
  return { estado: 'conectado', tipos: tipos.filter((t) => t.ativo) }
}

export type EstadoDoCalendly = 'conectado' | 'desconectado' | 'falhou'

/**
 * O que a sub-aba Ferramentas mostra no "Marcar reunião": `tiposDeEvento` =
 * só os ATIVOS, em ordem de nome; `null` quando não está conectado ou a
 * leitura falhou (a tela diz qual — nunca lista vazia com cara de "não há").
 * Nunca lança.
 */
export async function tiposDeEventoParaATela(
  db: SupabaseClient,
  accountId: string,
  deps: DependenciasDaAgenda = {},
): Promise<{ calendly: EstadoDoCalendly; tiposDeEvento: Array<{ uri: string; nome: string; duracao: number }> | null }> {
  try {
    const r = await tiposDeEventoAtivos(db, accountId, deps)
    if (r.estado === 'desconectado') return { calendly: 'desconectado', tiposDeEvento: null }
    return {
      calendly: 'conectado',
      tiposDeEvento: r.tipos
        .map((t) => ({ uri: t.uri, nome: t.nome, duracao: t.duracao ?? 0 }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    }
  } catch (e) {
    console.error('[ia-agentes] tipos de evento do Calendly (a tela diz que falhou):', mensagemDe(e))
    return { calendly: 'falhou', tiposDeEvento: null }
  }
}

// ------------------------------------------------------------
// O e-mail do cliente
// ------------------------------------------------------------

/** O e-mail com a forma de um e-mail (a régua do campo espelhado), aparado; senão nulo. */
function emailValido(v: unknown): string | null {
  return typeof v === 'string' ? valorDoCampo(v, { tipo: 'email' }) : null
}

/**
 * O e-mail com que o Calendly marca: o da FICHA (`contacts.email`, lido
 * agora — o `preencher_campo` do e-mail espelhado pode tê-lo acabado de
 * gravar), senão o do ÚLTIMO agendamento do contato (`invitee.created` em
 * `cb_calendly_eventos`: a coluna `email`, senão a variável
 * `agendamento_email`). Nulo = nenhum. Lança em erro de banco.
 */
export async function emailDoCliente(db: SupabaseClient, accountId: string, contactId: string): Promise<string | null> {
  const { data: contato, error } = await db
    .from('contacts')
    .select('email')
    .eq('account_id', accountId)
    .eq('id', contactId)
    .maybeSingle()
  if (error) throw new Error(`leitura do e-mail do contato: ${error.message}`)
  const daFicha = emailValido((contato as { email?: unknown } | null)?.email)
  if (daFicha) return daFicha

  const { data: eventos, error: erroEventos } = await db
    .from('cb_calendly_eventos')
    .select('email, variaveis')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('evento', EVENTO_AGENDADO)
    .order('recebido_em', { ascending: false })
    .limit(1)
  if (erroEventos) throw new Error(`leitura do último agendamento: ${erroEventos.message}`)
  const ultimo = ((eventos ?? []) as Array<{ email: unknown; variaveis: unknown }>)[0]
  if (!ultimo) return null
  const variaveis = ultimo.variaveis && typeof ultimo.variaveis === 'object' ? (ultimo.variaveis as Record<string, unknown>) : {}
  return emailValido(ultimo.email) ?? emailValido(variaveis.agendamento_email)
}

// ------------------------------------------------------------
// Os horários livres (o pedido do turno e do Playground)
// ------------------------------------------------------------

/** A agenda do agente para o pedido: os horários numerados e o que o pedido diz. */
export interface AgendaDoAgente {
  /** A URI do tipo de evento liberado (a execução marca nele). */
  tipoDeEvento: string
  /** `false` = a leitura falhou ou estourou o prazo (o pedido diz que não há horários agora). */
  lida: boolean
  /** Os horários oferecidos, numerados na ordem (vazio quando não foram lidos, ou nenhum está livre). */
  horarios: OpcaoDeAcao[]
  temEmail: boolean
}

/** Rejeita quando o prazo passa (o pedido em voo é abortado pelo próprio cliente, com o mesmo prazo). */
function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined
  const estouro = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new Error(`a leitura dos horários passou de ${ms} ms`)), ms)
  })
  return Promise.race([p, estouro]).finally(() => clearTimeout(relogio))
}

/**
 * A agenda do agente, se "Marcar reunião" estiver liberado nele (senão
 * `null`): os horários LIVRES do tipo de evento, de agora + 1 h a 7 dias, os
 * mais próximos (até 12), e se o cliente tem e-mail. A leitura dos horários
 * tem PRAZO (`prazoMs`, 4 s): falhou, estourou ou o Calendly está
 * desconectado = `lida: false`, e o pedido diz ao modelo que os horários não
 * estão disponíveis agora. Nunca lança.
 */
export async function lerAgendaDoAgente(
  db: SupabaseClient,
  args: {
    accountId: string
    ferramentas: FerramentasDoAgente
    /** Sem contato (Playground sem contato), `temEmail` é `false`. */
    contactId: string | null
    agora: Date
    prazoMs?: number
  },
  deps: DependenciasDaAgenda = {},
): Promise<AgendaDoAgente | null> {
  const tipoDeEvento = itensDaAcao(args.ferramentas, 'marcar_reuniao')[0]
  if (!tipoDeEvento) return null
  const prazo = args.prazoMs ?? PRAZO_DOS_HORARIOS_MS

  const lerHorarios = async (): Promise<string[] | null> => {
    const conexao = await lerConexao(db, args.accountId, deps)
    if (conexao.estado === 'desconectado') return null
    return conexao.cliente.horariosLivres({ tipoDeEvento, ...janelaDosHorarios(args.agora) }, { prazoMs: prazo })
  }
  const lerEmail = async (): Promise<boolean> =>
    args.contactId ? (await emailDoCliente(db, args.accountId, args.contactId)) !== null : false

  const [horarios, temEmail] = await Promise.all([
    comPrazo(lerHorarios(), prazo).catch((e) => {
      console.error('[ia-agentes] horários do Calendly (o pedido diz que não há agora):', mensagemDe(e))
      return null
    }),
    // Leitura que falha = "sem e-mail": o modelo pede o e-mail, que é o lado inofensivo.
    lerEmail().catch((e) => {
      console.error('[ia-agentes] e-mail do cliente para a agenda:', mensagemDe(e))
      return false
    }),
  ])
  return horarios === null
    ? { tipoDeEvento, lida: false, horarios: [], temEmail }
    : { tipoDeEvento, lida: true, horarios: opcoesDeHorario(horarios), temEmail }
}

// ------------------------------------------------------------
// Marcar (a execução da ação, depois de a resposta sair)
// ------------------------------------------------------------

export type ResultadoDoAgendamento =
  | { ok: true; uri: string | null }
  | {
      ok: false
      erro: Extract<CodigoDeFalhaDaAcao, 'sem_email' | 'horario_indisponivel' | 'calendly_desconectado' | 'recusado' | 'falhou'>
      detalhe?: string
    }

/** Uma falha do Calendly → o código da ação. Rede e tempo = `falhou`; token recusado = `calendly_desconectado`. */
function falhaDoCalendly(e: unknown): Extract<ResultadoDoAgendamento, { ok: false }> {
  const detalhe = mensagemDe(e)
  if (!(e instanceof CalendlyError)) return { ok: false, erro: 'falhou', detalhe }
  if (e.codigo === 'rede') return { ok: false, erro: 'falhou', detalhe }
  if (e.codigo === 'token_invalido') return { ok: false, erro: 'calendly_desconectado', detalhe }
  return { ok: false, erro: e.status !== null ? recusaDoHorario(e.status, e.message) : 'recusado', detalhe }
}

/**
 * Marca a reunião no Calendly em nome do cliente do turno (`POST /invitees`),
 * no tipo de evento liberado e no horário ESCOLHIDO (o `id` de uma opção que
 * o servidor leu — nunca um horário vindo do modelo). Nome da ficha (sem
 * nome, o telefone ou o `@`), o e-mail relido AGORA (`emailDoCliente`), o
 * fuso do escritório, o telefone para o lembrete por SMS, e o local do tipo
 * de evento lido na hora. Nunca lança.
 *
 * ⚠️ Não mexe no card, nos campos nem nos lembretes: o Calendly entrega o
 * `invitee.created` ao nosso webhook e a automação do Calendly faz o resto,
 * como quando o cliente agenda pelo link (a exceção da D5 pela cascata).
 */
export async function marcarNoCalendly(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; tipoDeEvento: string; inicio: string },
  deps: DependenciasDaAgenda = {},
): Promise<ResultadoDoAgendamento> {
  try {
    const { data: contato, error } = await db
      .from('contacts')
      .select('name, phone, wa_username, instagram_username')
      .eq('account_id', args.accountId)
      .eq('id', args.contactId)
      .maybeSingle()
    if (error) return { ok: false, erro: 'falhou', detalhe: `leitura do contato: ${error.message}` }
    if (!contato) return { ok: false, erro: 'falhou', detalhe: 'contato não encontrado nesta conta' }

    const email = await emailDoCliente(db, args.accountId, args.contactId)
    if (!email) return { ok: false, erro: 'sem_email' }

    let conexao: Conexao
    try {
      conexao = await lerConexao(db, args.accountId, deps)
    } catch (e) {
      // Token que não decifra: para quem marca, é o Calendly que não está de
      // pé. Erro de banco não é "desconectado": é falha.
      return { ok: false, erro: e instanceof TokenIlegivel ? 'calendly_desconectado' : 'falhou', detalhe: mensagemDe(e) }
    }
    if (conexao.estado === 'desconectado') return { ok: false, erro: 'calendly_desconectado' }

    // O tipo de evento, lido na hora: pode ter sido desativado depois de
    // liberado, e o local (o link da videochamada) vem dele.
    const tipo = await conexao.cliente.tipoDeEvento(args.tipoDeEvento)
    if (!tipo.ativo) return { ok: false, erro: 'recusado', detalhe: 'tipo de evento desativado no Calendly' }

    const c = contato as { name: string | null; phone: string | null; wa_username?: string | null; instagram_username?: string | null }
    const corpo = corpoDoConvidado({
      tipoDeEvento: args.tipoDeEvento,
      inicio: args.inicio,
      nome: nomeDoContato(c, email),
      email,
      telefone: c.phone,
      local: tipo.local,
    })
    const criado = await conexao.cliente.criarConvidado(corpo, { prazoMs: PRAZO_DO_AGENDAMENTO_MS })
    return { ok: true, uri: criado.uri }
  } catch (e) {
    const falha = falhaDoCalendly(e)
    console.error('[ia-agentes] marcar no Calendly falhou:', falha.erro, falha.detalhe)
    return falha
  }
}
