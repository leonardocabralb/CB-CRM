import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { nomeDoContato } from '@/lib/contacts/identidade'
import { lerRetrato } from '@/lib/ia-agentes/acesso'
import { lerRegistrosDasAcoes } from '@/lib/ia-agentes/acoes'
import { obterAgente } from '@/lib/ia-agentes/repo'
import { respostaDoErro } from '@/lib/ia-agentes/resposta'

type Contexto = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Quantos turnos a sub-aba mostra. */
const TURNOS_NA_TELA = 50

interface LinhaDoTurno {
  id: string
  status: string
  created_at: string
  terminado_em: string | null
  erro: string | null
  /** Nula quando a conversa foi apagada ou a ficha está na Lixeira (1110: o turno fica). */
  conversation_id: string | null
  contexto: unknown
  acoes: unknown
  tipo: string | null
  tentativa: number | null
  tentativas: number | null
  executar_apos: string | null
  conteudo_removido_em: string | null
  conteudo_removido_por: string | null
}

/**
 * GET /api/cb/ia/agentes/[id]/turnos  (admin, D14)
 *
 * Os 50 últimos turnos do agente, mais novos primeiro: `{ turnos: [{ id,
 * status, criadoEm, terminadoEm, erro, conversationId, contato, contexto }] }`.
 * `contexto` é o RETRATO do que o modelo viu (F3, 1052): `{ blocos: [{ bloco,
 * texto }], documentos: [ids] }`; nulo nos turnos anteriores à F3 e nos que
 * não chegaram a montar o pedido. `acoes` (F4) é o que o agente FEZ junto com
 * a resposta: `[{ tipo, alvo: { id, nome }, ok, erro?, detalhe? }]` — as
 * executadas, as recusadas na leitura (`alvo.id` nulo e `alvo.nome` "#n": o
 * número que o modelo pediu) e as aceitas que não executaram (`passagem`,
 * `transferencia`, `envio_falhou`). `erro` é um código (`MotivoDaRecusa` ou
 * `CODIGOS_DE_FALHA_DA_ACAO`; o de um registro antigo passa como está),
 * `detalhe` o complemento cru (o motivo da D5, a recusa da RPC, `ja_estava`).
 * Nulo quando o registro não é uma lista. O `erro` do TURNO que reteve um
 * link inventado traz os links ("link inventado: https://…").
 * A RETOMADA (1056) vem com `retomada: { tentativa, de }` (nula no turno de
 * resposta) e `executarApos` — o vencimento da que ainda espera na fila.
 * O turno SOBREVIVE à conversa (1110, DC1): `conversationId` e `contato` vêm
 * nulos quando a conversa foi apagada ou a ficha está na Lixeira (restaurar
 * religa). `conteudoRemovido: { em, por }` (`por` = 'prazo' | 'exclusao')
 * quando o texto do cliente já saiu (a poda de 90 dias ou a ficha excluída de
 * vez): `contexto` vem nulo e as ações sem o detalhe cru — a tela diz que o
 * conteúdo foi removido, nunca mostra um retrato vazio.
 * `cb_ia_turnos` é fechada ao navegador — daí a rota, com o cliente de
 * serviço e a conta conferida (o agente e cada consulta).
 */
export async function GET(_request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const naoEncontrado = () =>
      NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    if (!UUID.test(id)) return naoEncontrado()
    if (!(await obterAgente(ctx.accountId, id))) return naoEncontrado()

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('cb_ia_turnos')
      .select(
        'id, status, created_at, terminado_em, erro, conversation_id, contexto, acoes, tipo, tentativa, tentativas, executar_apos, conteudo_removido_em, conteudo_removido_por',
      )
      .eq('account_id', ctx.accountId)
      .eq('ia_agente_id', id)
      .order('created_at', { ascending: false })
      .limit(TURNOS_NA_TELA)
    if (error) {
      console.error('[cb/ia/agentes/turnos] leitura falhou:', error.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    const turnos = (data ?? []) as LinhaDoTurno[]

    // O contato de cada conversa. Falhar aqui não derruba a lista: a tela
    // mostra o turno sem o nome.
    const contatoDa = new Map<string, string>()
    const conversas = [...new Set(turnos.map((t) => t.conversation_id).filter((c): c is string => c !== null))]
    if (conversas.length > 0) {
      const { data: linhas, error: erroDosContatos } = await db
        .from('conversations')
        .select('id, contact:contacts(name, phone, wa_username, instagram_username)')
        .eq('account_id', ctx.accountId)
        .in('id', conversas)
      if (erroDosContatos) console.error('[cb/ia/agentes/turnos] contatos:', erroDosContatos.message)
      for (const l of (linhas ?? []) as { id: string; contact: Parameters<typeof nomeDoContato>[0] }[]) {
        const nome = nomeDoContato(l.contact, '')
        if (nome) contatoDa.set(l.id, nome)
      }
    }

    return NextResponse.json({
      turnos: turnos.map((t) => ({
        id: t.id,
        status: t.status,
        criadoEm: t.created_at,
        terminadoEm: t.terminado_em,
        erro: t.erro,
        conversationId: t.conversation_id,
        contato: t.conversation_id ? (contatoDa.get(t.conversation_id) ?? null) : null,
        contexto: lerRetrato(t.contexto),
        acoes: lerRegistrosDasAcoes(t.acoes),
        retomada:
          t.tipo === 'retomada' && typeof t.tentativa === 'number' && typeof t.tentativas === 'number'
            ? { tentativa: t.tentativa, de: t.tentativas }
            : null,
        executarApos: t.executar_apos,
        conteudoRemovido: t.conteudo_removido_em
          ? { em: t.conteudo_removido_em, por: t.conteudo_removido_por }
          : null,
      })),
    })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}
