// ============================================================
// Agentes de IA no banco (1043). Servidor, com o cliente de SERVIÇO.
//
// ⚠️ `cb_ia_agentes` só dá SELECT ao ADMINISTRADOR (D14) e nenhuma escrita ao
// navegador: toda escrita passa por aqui, e toda consulta leva a conta
// (`.eq('account_id', …)`) — o cliente de serviço ignora a RLS. Quem chama já
// conferiu o papel (`requireRole('admin')`).
// ============================================================

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { ehInstagram } from '@/lib/cb-channels/transporte'
import { lerEstado } from '@/lib/ia-chaves/repo'

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
      | 'provedor_sem_chave'
      | 'provedor_so_da_base'
      | 'conexao_instagram'
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
 * role: sem a conferência, um id de outra conta seria gravado. E mais duas
 * regras do plano (5.9): o provedor ESCOLHIDO tem de ter chave (senão o
 * agente nasce mudo, sem aviso), e conexão do Instagram não entra — lá o robô
 * não responde (D1 do Instagram).
 */
async function conferirReferencias(
  accountId: string,
  a: AlteracaoDoAgente,
  proprioId: string | null,
): Promise<void> {
  const db = supabaseAdmin()
  if (a.provedor) {
    let estado: Awaited<ReturnType<typeof lerEstado>>
    try {
      estado = await lerEstado(accountId)
    } catch (err) {
      throw new ErroDoAgente('banco', err instanceof Error ? err.message : String(err))
    }
    const doProvedor = estado.find((e) => e.provedor === a.provedor)
    if (!doProvedor?.existe) {
      throw new ErroDoAgente('provedor_sem_chave', 'o provedor escolhido não tem chave')
    }
    // A chave da OpenAI que nasceu SÓ da base (1042) pode ser restrita aos
    // embeddings: o agente nasceria mudo, e o Playground falharia em toda
    // geração. Vale até uma chave de CHAT da OpenAI ser gravada (Codex, #295).
    if (doProvedor.soDaBase) {
      throw new ErroDoAgente('provedor_so_da_base', 'a chave da OpenAI é só da base de conhecimento')
    }
  }
  if (a.conexoes && a.conexoes.length > 0) {
    const { data, error } = await db
      .from('cb_channels')
      .select('id, kind')
      .eq('account_id', accountId)
      .in('id', a.conexoes)
    if (error) throw new ErroDoAgente('banco', error.message)
    if ((data ?? []).length !== a.conexoes.length) {
      throw new ErroDoAgente('conexao_de_outra_conta', 'conexão que não é desta conta')
    }
    if ((data ?? []).some((c) => ehInstagram(c as { kind: string | null }))) {
      throw new ErroDoAgente('conexao_instagram', 'o agente não atende no Instagram')
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
 * Apagar é ARQUIVAR (o uso antigo mantém o nome). Desliga o agente; quem o
 * tira das listas "pode passar para" dos outros agentes é um GATILHO da 1043,
 * num UPDATE só (ler e regravar o array aqui perderia uma edição concorrente).
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
}
