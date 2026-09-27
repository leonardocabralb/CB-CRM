// ============================================================
// EXECUTAR as ações que o agente devolveu junto com a resposta (F4, D28 do
// docs/PLANO-agentes-de-ia.md). Servidor, com o cliente de SERVIÇO.
//
// Quem chama é o TURNO (`turno.ts`), e só DEPOIS de a resposta SAIR (o envio
// respondeu, inclusive a enviada sem registro): envio recusado ou incerto,
// nada executa — a ação não pode acontecer sem a resposta que a explica ao
// cliente, e a automação disparada não pode falar antes do agente. O
// Playground nunca chega aqui.
//
// ⚠️ O que cada ação respeita, e por quê:
//  - Os IDS são do servidor (`resolverAcoes`); o contato, o card e a conversa
//    são os DO TURNO — o modelo nunca escolhe de quem.
//  - Tudo é conferido DE NOVO na hora: a etapa não pode ter virado de
//    ganho/perdido, o campo de data não pode ter passado a ser vigiado por
//    lembrete, o valor tem de caber no formato do campo, e a automação não
//    pode ter ganhado passo fora da D5 ou "Aguardar" (ela pode ter sido
//    editada depois de liberada; `runAutomationById` roda a definição de
//    agora). ⚠️ A D5 vale SÓ para o que o agente faz (decisão do operador,
//    27/09/2026): as automações de ENTRADA da etapa movida e as da etiqueta
//    aplicada NÃO são conferidas — rodam como quando alguém da equipe move o
//    card ou etiqueta.
//  - Falha de uma ação NÃO impede as outras: cada uma fica no registro do
//    turno (`cb_ia_turnos.acoes`) com um CÓDIGO da lista fechada
//    (`CODIGOS_DE_FALHA_DA_ACAO`) e o texto cru em `detalhe`.
//  - Cada ação feita deixa uma anotação interna na conversa, "IA · <agente>
//    moveu o card para …" — é por ela que a equipe sabe quem foi (a trilha e
//    o webhook `deal.*` dizem `automacao`/`sistema`: a origem `ia` exige
//    migration nas funções de gatilho — limite escrito do plano).
//  - A AÇÃO REPETIDA não faz nada (o modelo re-emite em cada resposta as
//    ações das anteriores): mover para a etapa em que o card JÁ está,
//    etiqueta que já estava, etiqueta a tirar que não estava e campo com o
//    MESMO valor gravado (aparado, sem caixa) = ok com `detalhe: 'ja_estava'`,
//    sem escrita, sem anotação e sem disparar automação.
//  - Etiquetar dispara as automações de `tag_added` na hora, e mover o card
//    enfileira as da etapa nova (limite escrito da D28).
//  - MARCAR REUNIÃO (F5) roda por ÚLTIMO, depois das outras — o
//    `preencher_campo` do e-mail espelhado da mesma resposta já gravou o
//    e-mail que ela relê. A automação do tipo de evento roda pelo webhook
//    `invitee.created`, como quando o cliente agenda pelo link. A reunião que
//    não foi marcada faz o turno TRANSFERIR para gente (`turno.ts`): a
//    resposta já saiu prometendo.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  channelInScope,
  criarTarefaComAviso,
  runAutomationById,
  stageInScope,
} from '@/lib/automations/engine'
import { FUSO_DO_ESCRITORIO, TIPO_DATA } from '@/lib/contacts/campo-data'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import { removeContactTag } from '@/lib/contacts/tag-write'
import { diaNoFuso } from '@/lib/tasks/prazo'
import { normalizarTitulo } from '@/lib/tasks/validar'
import type { Automation } from '@/types'

import {
  formatoDoCampo,
  mesmoValorDoCampo,
  valorDoCampo,
  type AcaoResolvida,
  type CodigoDeFalhaDaAcao,
  type RegistroDeAcao,
} from './acoes'
import { marcarNoCalendly } from './agenda'
import { lerCamposVigiados, motivosForaDaD5 } from './ferramentas'
import { dataHoraDaReuniao } from './reuniao'
import { avisoDaTarefa, textosDaAcao } from './textos-do-servidor'

/** O que as ações sabem do turno. Nada disto vem do modelo. */
export interface ContextoDasAcoes {
  accountId: string
  conversationId: string
  contactId: string
  /** O card do turno (`cb_ia_turnos.deal_id`). */
  dealId: string | null
  canalId: string | null
  agente: { id: string; nome: string }
  /** O dono da conta: o autor da tarefa que o agente cria. */
  dono: string
  /**
   * O tipo de evento do Calendly liberado em "Marcar reunião" (F5), lido no
   * começo do turno com as ferramentas; nulo = reunião desligada.
   */
  tipoDeEvento?: string | null
}

/**
 * Anotação interna sem usuário (autor congelado "IA · <agente>"). Melhor
 * esforço: erro vira log. Usada também pela transferência e pela passagem.
 */
export async function anotarNaConversa(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; contactId: string | null; autor: string; texto: string },
): Promise<void> {
  const { error } = await db.from('cb_conversation_notes').insert({
    account_id: args.accountId,
    conversation_id: args.conversationId,
    contact_id: args.contactId,
    author_user_id: null,
    autor_nome: args.autor,
    texto: args.texto,
  })
  if (error) console.error('[ia-agentes] anotação da IA falhou:', error.message)
}

/**
 * O que uma ação fez: `nota` nula = deu certo sem mudar nada (a etiqueta já
 * estava lá, o card já estava na etapa, o campo já tinha o valor — com
 * `detalhe: 'ja_estava'`). `detalhe` é o complemento cru.
 */
type Resultado =
  | { ok: true; nota: { valor?: string } | null; detalhe?: string }
  | { ok: false; erro: CodigoDeFalhaDaAcao; detalhe?: string }

const falha = (erro: CodigoDeFalhaDaAcao, detalhe?: string | null): Resultado =>
  detalhe ? { ok: false, erro, detalhe } : { ok: false, erro }
const feita = (valor?: string): Resultado => ({ ok: true, nota: valor === undefined ? {} : { valor } })
/** A ação repetida: já estava assim — nada muda, nada dispara, nada a anotar. */
const jaEstava: Resultado = { ok: true, nota: null, detalhe: 'ja_estava' }

function resultadoDa(v: unknown): 'ganho' | 'perdido' | null {
  return v === 'ganho' || v === 'perdido' ? v : null
}

async function moverEtapa(db: SupabaseClient, ctx: ContextoDasAcoes, acao: AcaoResolvida): Promise<Resultado> {
  if (!ctx.dealId) return falha('sem_card')
  // A etapa, relida: da conta e SEM resultado (D5) — ela pode ter virado de
  // ganho/perdido depois de liberada.
  const { data: etapa, error: erroEtapa } = await db
    .from('pipeline_stages')
    .select('id, resultado, pipelines!inner(account_id)')
    .eq('pipelines.account_id', ctx.accountId)
    .eq('id', acao.id)
    .maybeSingle()
  if (erroEtapa) throw new Error(`leitura da etapa: ${erroEtapa.message}`)
  if (!etapa) return falha('item_de_outra_conta')
  if (resultadoDa((etapa as { resultado: unknown }).resultado)) return falha('etapa_de_resultado')

  // O card do TURNO, do contato do turno, lido agora: a RPC só escreve se ele
  // continua no status lido, e só card ABERTO se move (o perdido voltaria a
  // aberto numa etapa neutra — decisão que a IA não toma).
  const { data: card, error: erroCard } = await db
    .from('deals')
    .select('id, status, stage_id')
    .eq('account_id', ctx.accountId)
    .eq('id', ctx.dealId)
    .eq('contact_id', ctx.contactId)
    .maybeSingle()
  if (erroCard) throw new Error(`leitura do card: ${erroCard.message}`)
  if (!card) return falha('sem_card')
  const { status, stage_id: etapaAtual } = card as { status: string; stage_id: string | null }
  if (status !== 'open') return falha('card_fechado')
  // Já está lá: nada muda, nada dispara, nada a anotar.
  if (etapaAtual === acao.id) return jaEstava
  // As automações de ENTRADA na etapa não são conferidas: rodam como quando
  // alguém da equipe move o card (a D5 vale só para o que o agente faz).

  // Pela RPC do motor (funil e etapa no MESMO update, a trilha da 912 conta
  // uma linha), com o status esperado.
  const { data, error } = await db.rpc('cb_atualizar_negocio', {
    p_deal_id: ctx.dealId,
    p_account_id: ctx.accountId,
    p_pipeline_id: null,
    p_stage_id: acao.id,
    p_status: null,
    p_cadeia: [],
    p_status_esperado: status,
  })
  if (error) throw new Error(`cb_atualizar_negocio: ${error.message}`)
  const r = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; motivo?: string | null } | null
  if (!r?.ok) return falha('recusado', r?.motivo)
  return feita()
}

async function etiquetar(db: SupabaseClient, ctx: ContextoDasAcoes, acao: AcaoResolvida): Promise<Resultado> {
  // O escritor central: dispara o `tag_added` só para etiqueta NOVA, com o
  // canal da conversa do turno. A etiqueta que já estava (o UNIQUE
  // `(contact_id, tag_id)` recusa o INSERT) não dispara nada: `ja_estava`.
  // As automações da etiqueta não são conferidas (a D5 vale só para o que o
  // agente faz).
  const r = await addContactTagAndDispatch({
    db,
    accountId: ctx.accountId,
    contactId: ctx.contactId,
    tagId: acao.id,
    context: { conversation_id: ctx.conversationId, channel_id: ctx.canalId },
  })
  return r.added ? feita() : jaEstava
}

async function tirarEtiqueta(db: SupabaseClient, ctx: ContextoDasAcoes, acao: AcaoResolvida): Promise<Resultado> {
  // O motor não tem gatilho de etiqueta tirada. Zero linhas apagadas = a
  // etiqueta não estava lá: `ja_estava`.
  const tirou = await removeContactTag(db, { accountId: ctx.accountId, contactId: ctx.contactId, tagId: acao.id })
  return tirou ? feita() : jaEstava
}

async function preencherCampo(db: SupabaseClient, ctx: ContextoDasAcoes, acao: AcaoResolvida): Promise<Resultado> {
  // Valor vazio NÃO apaga o que a ficha já sabe (a régua do `update_contact_field`).
  const valor = (acao.valor ?? '').trim()
  if (!valor) return falha('valor_vazio')
  const { data: campo, error } = await db
    .from('custom_fields')
    .select('id, field_type, field_options, espelho')
    .eq('account_id', ctx.accountId)
    .eq('id', acao.id)
    .maybeSingle()
  if (error) throw new Error(`leitura do campo: ${error.message}`)
  if (!campo) return falha('item_de_outra_conta')
  const linha = campo as { field_type: string | null; field_options: unknown; espelho: string | null }
  // De novo na hora: o lembrete pode ter sido ligado depois de o campo ser liberado.
  if (linha.field_type === TIPO_DATA && (await lerCamposVigiados(db, ctx.accountId)).has(acao.id)) {
    return falha('campo_vigiado')
  }
  // O valor no FORMATO do campo (o pedido o disse ao modelo): data num
  // instante canônico — a chave da trava do lembrete (935), a mesma escrita
  // do passo `update_contact_field` —, número só com dígitos, a opção da
  // lista na grafia dela, o e-mail com a forma de um e-mail.
  const formato = formatoDoCampo(linha)
  const gravado = valorDoCampo(valor, formato)
  if (gravado === null) return falha('valor_invalido', formato.tipo)
  // O MESMO valor que a ficha já tem (o modelo repete as ações das respostas
  // anteriores): nada a gravar nem a anotar. A conta vem pelo contato (a
  // tabela não a tem). Leitura que falha lança.
  const { data: atual, error: erroAtual } = await db
    .from('contact_custom_values')
    .select('value, contacts!inner(account_id)')
    .eq('contacts.account_id', ctx.accountId)
    .eq('contact_id', ctx.contactId)
    .eq('custom_field_id', acao.id)
    .maybeSingle()
  if (erroAtual) throw new Error(`leitura do valor do campo: ${erroAtual.message}`)
  if (mesmoValorDoCampo((atual as { value?: unknown } | null)?.value, gravado, formato)) return jaEstava
  const { error: erroGravar } = await db
    .from('contact_custom_values')
    .upsert({ contact_id: ctx.contactId, custom_field_id: acao.id, value: gravado }, { onConflict: 'contact_id,custom_field_id' })
  if (erroGravar) throw new Error(`gravar o campo: ${erroGravar.message}`)
  // Na anotação, a data como o agente a escreveu (o instante em UTC não é
  // para gente ler); nos outros, o que foi gravado.
  return feita(formato.tipo === 'data' ? valor : gravado)
}

async function criarTarefa(db: SupabaseClient, ctx: ContextoDasAcoes, acao: AcaoResolvida): Promise<Resultado> {
  const titulo = normalizarTitulo(acao.valor)
  if (!titulo) return falha('titulo_invalido')
  // A MESMA inserção do passo `create_task`: responsável da lista (membro da
  // conta, conferido lá), prazo HOJE no fuso do escritório, autor = o dono.
  await criarTarefaComAviso(db, {
    accountId: ctx.accountId,
    contactId: ctx.contactId,
    autorId: ctx.dono,
    responsavelUserId: acao.id,
    titulo,
    descricao: null,
    venceEm: diaNoFuso(new Date(), FUSO_DO_ESCRITORIO),
    venceAs: null,
    importante: false,
    tituloDoAviso: await avisoDaTarefa(ctx.agente.nome),
  })
  return feita(titulo)
}

async function executarAutomacao(db: SupabaseClient, ctx: ContextoDasAcoes, acao: AcaoResolvida): Promise<Resultado> {
  // A D5 DE NOVO (Codex, #292): a automação liberada pode ter sido editada
  // (passo fora da D5 ou "Aguardar", nela ou nas que ela aciona). Leitura
  // que falha lança, e a ação falha — na dúvida, a IA não dispara.
  const motivo = (await motivosForaDaD5(db, ctx.accountId, [acao.id])).get(acao.id)
  if (motivo) return falha('automacao_fora_da_d5', motivo)

  const { data, error } = await db
    .from('automations')
    .select('*')
    .eq('account_id', ctx.accountId)
    .eq('id', acao.id)
    .maybeSingle()
  if (error) throw new Error(`leitura da automação: ${error.message}`)
  if (!data) return falha('item_de_outra_conta')
  const alvo = data as Automation
  if (!alvo.is_active) return falha('automacao_desligada')
  // As guardas da rota manual ("Executar automação" da conversa): o escopo
  // de conexão e o de etapa, que `runAutomationById` pula de propósito.
  const contexto = { conversation_id: ctx.conversationId, channel_id: ctx.canalId }
  if (!channelInScope(alvo, contexto)) return falha('fora_da_conexao')
  if (!(await stageInScope(db, alvo, ctx.contactId, contexto))) return falha('fora_da_etapa')

  const r = await runAutomationById({
    automationId: alvo.id,
    accountId: ctx.accountId,
    contactId: ctx.contactId,
    context: contexto,
    triggerType: alvo.trigger_type,
    rotuloDoDisparo: `ia:${ctx.agente.nome}`,
  })
  if (!r.ok) return falha('recusado', r.detail)
  return feita()
}

async function marcarReuniao(db: SupabaseClient, ctx: ContextoDasAcoes, acao: AcaoResolvida): Promise<Resultado> {
  // A automação do tipo de evento roda pelo `invitee.created`, como quando o
  // PRÓPRIO cliente agenda pelo link — e é ela que move o card, grava a data
  // e arma os lembretes. Nada disso é feito aqui.
  if (!ctx.tipoDeEvento) return falha('recusado', 'marcar reunião sem tipo de evento liberado')
  // O horário é o `id` da opção: um horário que o SERVIDOR leu no Calendly.
  // O nome completo que o cliente deu (`[[REUNIAO:n=Nome]]`), se veio.
  const r = await marcarNoCalendly(db, {
    accountId: ctx.accountId,
    contactId: ctx.contactId,
    tipoDeEvento: ctx.tipoDeEvento,
    inicio: acao.id,
    ...(acao.valor ? { nome: acao.valor } : {}),
  })
  if (!r.ok) return falha(r.erro, r.detalhe)
  // Na anotação, a data e a hora no fuso do escritório (o ISO em UTC não é para gente ler).
  const marcada = feita(dataHoraDaReuniao(acao.id))
  // O nome que o modelo passou sem origem na conversa caiu (a ficha foi usada): o registro diz.
  return acao.nomeSemOrigem && marcada.ok ? { ...marcada, detalhe: 'nome_sem_origem' } : marcada
}

async function executarUma(db: SupabaseClient, ctx: ContextoDasAcoes, acao: AcaoResolvida): Promise<Resultado> {
  switch (acao.tipo) {
    case 'mover_etapa':
      return moverEtapa(db, ctx, acao)
    case 'etiquetar':
      return etiquetar(db, ctx, acao)
    case 'tirar_etiqueta':
      return tirarEtiqueta(db, ctx, acao)
    case 'preencher_campo':
      return preencherCampo(db, ctx, acao)
    case 'criar_tarefa':
      return criarTarefa(db, ctx, acao)
    case 'executar_automacao':
      return executarAutomacao(db, ctx, acao)
    case 'marcar_reuniao':
      return marcarReuniao(db, ctx, acao)
    default: {
      const nunca: never = acao.tipo
      throw new Error(`ação desconhecida: ${String(nunca)}`)
    }
  }
}

/**
 * Executa as ações ACEITAS, na ordem em que o modelo as pediu, uma de cada
 * vez — menos a REUNIÃO (F5), que vai por ÚLTIMO: o e-mail que ela relê pode
 * ter sido gravado pelo `preencher_campo` da mesma resposta. Nunca lança:
 * cada falha vira linha do registro com o código e o detalhe. Devolve o
 * registro (para `cb_ia_turnos.acoes`) e se o card mudou de etapa (o turno
 * drena a fila do funil depois).
 */
export async function executarAcoes(
  db: SupabaseClient,
  ctx: ContextoDasAcoes,
  aceitas: readonly AcaoResolvida[],
): Promise<{ registros: RegistroDeAcao[]; moveu: boolean }> {
  const registros: RegistroDeAcao[] = []
  let moveu = false
  const naOrdem = [
    ...aceitas.filter((a) => a.tipo !== 'marcar_reuniao'),
    ...aceitas.filter((a) => a.tipo === 'marcar_reuniao'),
  ]
  for (const acao of naOrdem) {
    const alvo = { id: acao.id, nome: acao.nome }
    let r: Resultado
    try {
      r = await executarUma(db, ctx, acao)
    } catch (err) {
      const detalhe = err instanceof Error ? err.message : String(err)
      console.error('[ia-agentes] a ação falhou:', acao.tipo, detalhe)
      r = falha('falhou', detalhe)
    }
    const detalhe = r.detalhe ? { detalhe: r.detalhe } : {}
    if (!r.ok) {
      registros.push({ tipo: acao.tipo, alvo, ok: false, erro: r.erro, ...detalhe })
      continue
    }
    registros.push({ tipo: acao.tipo, alvo, ok: true, ...detalhe })
    if (!r.nota) continue
    if (acao.tipo === 'mover_etapa') moveu = true
    try {
      // A reunião é nomeada na anotação pela data e hora no fuso do escritório
      // ("28/09/2026 15:15"), recalculada do horário que o Calendly marcou —
      // o mesmo texto do `nome` da opção (`opcoesDeHorario`).
      const alvo = acao.tipo === 'marcar_reuniao' ? (r.nota.valor ?? acao.nome) : acao.nome
      const { autor, texto } = await textosDaAcao(ctx.agente.nome, acao.tipo, alvo, r.nota.valor)
      await anotarNaConversa(db, {
        accountId: ctx.accountId,
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        autor,
        texto,
      })
    } catch (err) {
      console.error('[ia-agentes] anotar a ação falhou:', acao.tipo, err)
    }
  }
  return { registros, moveu }
}
