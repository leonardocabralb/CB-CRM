// ============================================================
// O AVISO quando um agente de IA passa a conversa para a equipe (1139).
//
// Pedido do operador (11/11/2026; `docs/PLANO-aviso-da-ia-que-passa-a-conversa.md`):
// a transferência pausava a IA, deixava a conversa Pendente e escrevia uma
// anotação sem menção — ninguém era avisado, e a cliente esperava. Agora
// `transferirParaGente` chama `avisarDaTransferencia` depois da anotação, e
// cada pessoa escolhida recebe uma linha `ia_transferiu` no sino (com a
// caixinha clicável dentro do CRM e o pop-up do navegador).
//
// Decisões do operador:
// - D1, QUEM: as pessoas marcadas no agente (`avisar_ao_transferir`) e,
//   sempre, o responsável pela conversa. Sem ninguém marcado ainda ativo, o
//   dono, os administradores e quem atende o número (perfil que vê a
//   conexão) — a régua dos alarmes de conexão (1122): o aviso nunca fica sem
//   ninguém.
// - D2, O TEXTO: título "IA passou <cliente> para a equipe"; embaixo, os
//   campos que o agente preencheu na mesma resposta ("Pendência da IA: …"),
//   ou, sem campo, o motivo do sistema (o texto da anotação).
//
// Melhor esforço, como a anotação: a transferência já aconteceu, e o aviso
// que falha vira log — nunca derruba o turno.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { nomeDoContato, type ContatoIdentificavel } from '@/lib/contacts/identidade'
import { TIPO_DO_AVISO_DA_IA } from '@/lib/notifications/aviso-da-ia'
import { canalNoEscopo } from '@/lib/perfis/escopo'
import type { PerfilDeAcesso } from '@/lib/perfis/tipos'
import type { AccountRole } from '@/lib/auth/roles'

import type { CampoPreenchido } from './executar-acoes'
import { tituloDoAvisoDaTransferencia } from './textos-do-servidor'

/** O teto do corpo gravado — o mesmo dos avisos de anotação (`anotacao-da-automacao.ts`). */
export const TETO_DO_CORPO = 280

/** Um membro ATIVO da conta, com o perfil REAL (o recorte por conexão). */
export interface MembroAvisavel {
  userId: string
  papel: AccountRole | null
  perfil: PerfilDeAcesso | null
}

/**
 * Quem recebe o aviso (D1). Puro.
 *
 * - `escolhidos`: a lista do agente; só vale quem é membro ATIVO agora (quem
 *   saiu ou está suspenso é ignorado, como na menção).
 * - `responsavel`: o `assigned_agent_id` da conversa DEPOIS da transferência
 *   (inclui o destino que ela acabou de atribuir); recebe sempre, se ativo.
 * - Nenhum escolhido ativo = o dono, os administradores e quem tem a conexão
 *   da conversa no perfil (`canalNoEscopo`). Conversa sem conexão: só quem
 *   não tem recorte de conexão (o perfil sem lista, o dono) — a régua não
 *   adivinha um número.
 *
 * Sem repetição, na ordem: escolhidos, responsável, o resto.
 */
export function quemAvisarDaTransferencia(args: {
  escolhidos: readonly string[]
  responsavel: string | null
  membros: readonly MembroAvisavel[]
  canalId: string | null
}): string[] {
  const ativos = new Map(args.membros.map((m) => [m.userId, m]))
  const saida = new Set<string>()
  for (const id of args.escolhidos) if (ativos.has(id)) saida.add(id)
  const ninguemEscolhido = saida.size === 0
  if (args.responsavel && ativos.has(args.responsavel)) saida.add(args.responsavel)
  if (ninguemEscolhido) {
    for (const m of args.membros) {
      if (m.papel === 'owner' || m.papel === 'admin') {
        saida.add(m.userId)
        continue
      }
      const ctx = { papel: m.papel, perfil: m.perfil }
      const veAConexao = args.canalId
        ? canalNoEscopo(ctx, args.canalId)
        : !m.perfil || m.perfil.channel_ids.length === 0
      if (veAConexao) saida.add(m.userId)
    }
  }
  return [...saida]
}

/**
 * O corpo do aviso (D2). Puro. Os campos preenchidos nesta resposta, um por
 * linha ("Pendência da IA: Pediu condição diferente"), na ordem em que o
 * agente os escreveu, sem repetir o mesmo campo (vale o ÚLTIMO valor); sem
 * campo, o motivo do sistema. Cortado em `TETO_DO_CORPO`, com reticências.
 */
export function corpoDoAvisoDaTransferencia(campos: readonly CampoPreenchido[], motivo: string): string {
  const porNome = new Map<string, string>()
  for (const c of campos) {
    const nome = c.nome.trim()
    const valor = c.valor.replace(/\s+/g, ' ').trim()
    if (!nome || !valor) continue
    porNome.delete(nome)
    porNome.set(nome, valor)
  }
  const texto =
    porNome.size > 0 ? [...porNome].map(([nome, valor]) => `${nome}: ${valor}`).join('\n') : motivo.trim()
  return texto.length > TETO_DO_CORPO ? `${texto.slice(0, TETO_DO_CORPO - 1).trimEnd()}…` : texto
}

const COLUNAS_DO_PERFIL = 'id, account_id, nome, papel_base, telas, secoes_config, channel_ids, pipeline_ids, sistema'

/** Os membros ATIVOS da conta, com o perfil real de cada um. Lança na falha. */
export async function lerMembrosAtivos(db: SupabaseClient, accountId: string): Promise<MembroAvisavel[]> {
  const [perfis, membros] = await Promise.all([
    db.from('cb_perfis_de_acesso').select(COLUNAS_DO_PERFIL).eq('account_id', accountId),
    db.from('profiles').select('user_id, account_role, perfil_id').eq('account_id', accountId).is('suspenso_em', null),
  ])
  const falha = perfis.error ?? membros.error
  if (falha) throw new Error(`leitura dos membros: ${falha.message}`)
  const porId = new Map(((perfis.data ?? []) as PerfilDeAcesso[]).map((p) => [p.id, p]))
  return (
    (membros.data ?? []) as Array<{ user_id: string | null; account_role: AccountRole | null; perfil_id: string | null }>
  )
    .filter((m): m is { user_id: string; account_role: AccountRole | null; perfil_id: string | null } => !!m.user_id)
    .map((m) => ({
      userId: m.user_id,
      papel: m.account_role,
      perfil: m.perfil_id ? (porId.get(m.perfil_id) ?? null) : null,
    }))
}

/**
 * Grava o aviso `ia_transferiu` para quem deve receber. Chamada por
 * `transferirParaGente` SÓ quando a transferência aconteceu (`transferiu`).
 * Nunca lança: a falha (leitura, CHECK sem a 1139, gravação) vira log.
 */
export async function avisarDaTransferencia(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    /** A lista do agente (`avisar_ao_transferir`). */
    escolhidos: readonly string[]
    /** Os campos preenchidos na resposta que passou a conversa (vazio fora do turno). */
    campos: readonly CampoPreenchido[]
    /** O motivo do sistema: o texto da anotação da transferência. */
    motivo: string
  },
): Promise<void> {
  try {
    const { data: conversa, error } = await db
      .from('conversations')
      .select('assigned_agent_id, channel_id, contact_id, contact:contacts(name, phone, wa_username, instagram_username)')
      .eq('id', args.conversationId)
      .eq('account_id', args.accountId)
      .maybeSingle()
    if (error) throw new Error(`leitura da conversa: ${error.message}`)
    if (!conversa) return

    const linha = conversa as {
      assigned_agent_id: string | null
      channel_id: string | null
      contact_id: string | null
      contact: ContatoIdentificavel | ContatoIdentificavel[] | null
    }
    const membros = await lerMembrosAtivos(db, args.accountId)
    const destinatarios = quemAvisarDaTransferencia({
      escolhidos: args.escolhidos,
      responsavel: linha.assigned_agent_id,
      membros,
      canalId: linha.channel_id,
    })
    if (destinatarios.length === 0) {
      console.warn('[ia-agentes] aviso da transferência sem destinatário:', args.conversationId)
      return
    }

    const contato = Array.isArray(linha.contact) ? (linha.contact[0] ?? null) : linha.contact
    const titulo = await tituloDoAvisoDaTransferencia(nomeDoContato(contato, '') || null)
    const body = corpoDoAvisoDaTransferencia(args.campos, args.motivo)
    const { error: erroDoAviso } = await db.from('notifications').insert(
      destinatarios.map((userId) => ({
        account_id: args.accountId,
        user_id: userId,
        type: TIPO_DO_AVISO_DA_IA,
        conversation_id: args.conversationId,
        contact_id: linha.contact_id,
        // A IA não é um login: sem autor, como os avisos de automação.
        actor_user_id: null,
        title: titulo,
        body: body || null,
      })),
    )
    if (erroDoAviso) throw new Error(`gravação do aviso: ${erroDoAviso.message}`)
  } catch (err) {
    console.error(
      '[ia-agentes] aviso da transferência falhou:',
      args.conversationId,
      err instanceof Error ? err.message : err,
    )
  }
}
