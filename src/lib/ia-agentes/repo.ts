// ============================================================
// Agentes de IA no banco (1043). Servidor, com o cliente de SERVIÇO.
//
// ⚠️ `cb_ia_agentes` só dá SELECT ao ADMINISTRADOR (D14) e nenhuma escrita ao
// navegador: toda escrita passa por aqui, e toda consulta leva a conta
// (`.eq('account_id', …)`) — o cliente de serviço ignora a RLS. Quem chama já
// conferiu o papel (`requireRole('admin')`).
// ============================================================

import { supabaseAdmin } from '@/lib/ai/admin-client'

import {
  COLUNAS_DO_AGENTE,
  colunasDaAlteracao,
  lerLinhaDoAgente,
  type AlteracaoDoAgente,
  type IaAgente,
} from './agente'

export class ErroDoAgente extends Error {
  constructor(
    public readonly codigo:
      | 'nao_encontrado'
      | 'nome_repetido'
      | 'conexao_de_outra_conta'
      | 'agente_de_outra_conta'
      | 'membro_de_outra_conta'
      | 'passar_para_si'
      | 'banco',
    mensagem: string,
  ) {
    super(mensagem)
  }
}

export async function listarAgentes(
  accountId: string,
  opcoes: { incluirArquivados?: boolean } = {},
): Promise<IaAgente[]> {
  let q = supabaseAdmin()
    .from('cb_ia_agentes')
    .select(COLUNAS_DO_AGENTE)
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (!opcoes.incluirArquivados) q = q.is('arquivado_em', null)
  const { data, error } = await q
  if (error) throw new ErroDoAgente('banco', error.message)
  return (data ?? [])
    .map((l) => lerLinhaDoAgente(l as Record<string, unknown>))
    .filter((a): a is IaAgente => a !== null)
}

export async function obterAgente(accountId: string, id: string): Promise<IaAgente | null> {
  const { data, error } = await supabaseAdmin()
    .from('cb_ia_agentes')
    .select(COLUNAS_DO_AGENTE)
    .eq('account_id', accountId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new ErroDoAgente('banco', error.message)
  return data ? lerLinhaDoAgente(data as Record<string, unknown>) : null
}

/**
 * Confere que os ids da alteração são DESTA conta: conexões, agentes para
 * quem passar e o membro da transferência. Array sem FK e escrita em service
 * role: sem a conferência, um id de outra conta seria gravado.
 */
async function conferirReferencias(
  accountId: string,
  a: AlteracaoDoAgente,
  proprioId: string | null,
): Promise<void> {
  const db = supabaseAdmin()
  if (a.conexoes && a.conexoes.length > 0) {
    const { data, error } = await db
      .from('cb_channels')
      .select('id')
      .eq('account_id', accountId)
      .in('id', a.conexoes)
    if (error) throw new ErroDoAgente('banco', error.message)
    if ((data ?? []).length !== a.conexoes.length) {
      throw new ErroDoAgente('conexao_de_outra_conta', 'conexão que não é desta conta')
    }
  }
  if (a.podePassarPara && a.podePassarPara.length > 0) {
    if (proprioId && a.podePassarPara.includes(proprioId)) {
      throw new ErroDoAgente('passar_para_si', 'o agente não passa para si mesmo')
    }
    const { data, error } = await db
      .from('cb_ia_agentes')
      .select('id')
      .eq('account_id', accountId)
      .is('arquivado_em', null)
      .in('id', a.podePassarPara)
    if (error) throw new ErroDoAgente('banco', error.message)
    if ((data ?? []).length !== a.podePassarPara.length) {
      throw new ErroDoAgente('agente_de_outra_conta', 'agente que não é desta conta')
    }
  }
  if (a.transferirPara) {
    const { data, error } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .eq('user_id', a.transferirPara)
      .maybeSingle()
    if (error) throw new ErroDoAgente('banco', error.message)
    if (!data) throw new ErroDoAgente('membro_de_outra_conta', 'membro que não é desta conta')
  }
}

function traduzirErroDeEscrita(error: { code?: string; message: string }): never {
  // Índice único do nome entre os não arquivados.
  if (error.code === '23505') throw new ErroDoAgente('nome_repetido', 'já existe um agente com este nome')
  throw new ErroDoAgente('banco', error.message)
}

export async function criarAgente(
  accountId: string,
  userId: string,
  a: AlteracaoDoAgente,
): Promise<IaAgente> {
  await conferirReferencias(accountId, a, null)
  const { data, error } = await supabaseAdmin()
    .from('cb_ia_agentes')
    .insert({
      account_id: accountId,
      criado_por: userId,
      atualizado_por: userId,
      ...colunasDaAlteracao(a),
    })
    .select(COLUNAS_DO_AGENTE)
    .single()
  if (error) traduzirErroDeEscrita(error)
  const agente = lerLinhaDoAgente(data as Record<string, unknown>)
  if (!agente) throw new ErroDoAgente('banco', 'linha criada ilegível')
  return agente
}

export async function atualizarAgente(
  accountId: string,
  userId: string,
  id: string,
  a: AlteracaoDoAgente,
): Promise<IaAgente> {
  await conferirReferencias(accountId, a, id)
  const { data, error } = await supabaseAdmin()
    .from('cb_ia_agentes')
    .update({
      ...colunasDaAlteracao(a),
      atualizado_por: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('id', id)
    .is('arquivado_em', null)
    .select(COLUNAS_DO_AGENTE)
    .maybeSingle()
  if (error) traduzirErroDeEscrita(error)
  if (!data) throw new ErroDoAgente('nao_encontrado', 'agente não encontrado')
  const agente = lerLinhaDoAgente(data as Record<string, unknown>)
  if (!agente) throw new ErroDoAgente('banco', 'linha ilegível')
  return agente
}

/**
 * Apagar é ARQUIVAR (o uso antigo mantém o nome). Desliga o agente e o tira
 * das listas "pode passar para" dos outros agentes da conta.
 */
export async function arquivarAgente(accountId: string, userId: string, id: string): Promise<void> {
  const db = supabaseAdmin()
  const agora = new Date().toISOString()
  const { data, error } = await db
    .from('cb_ia_agentes')
    .update({ arquivado_em: agora, ativo: false, atualizado_por: userId, updated_at: agora })
    .eq('account_id', accountId)
    .eq('id', id)
    .is('arquivado_em', null)
    .select('id')
    .maybeSingle()
  if (error) throw new ErroDoAgente('banco', error.message)
  if (!data) throw new ErroDoAgente('nao_encontrado', 'agente não encontrado')

  const { data: outros, error: erroOutros } = await db
    .from('cb_ia_agentes')
    .select('id, pode_passar_para')
    .eq('account_id', accountId)
    .contains('pode_passar_para', [id])
  if (erroOutros) {
    console.error('[ia-agentes] limpeza do "passar para" falhou:', erroOutros.message)
    return
  }
  for (const o of outros ?? []) {
    const lista = (o.pode_passar_para as string[]).filter((x) => x !== id)
    const { error: e } = await db
      .from('cb_ia_agentes')
      .update({ pode_passar_para: lista, updated_at: agora })
      .eq('account_id', accountId)
      .eq('id', o.id as string)
    if (e) console.error('[ia-agentes] limpeza do "passar para" falhou:', e.message)
  }
}
