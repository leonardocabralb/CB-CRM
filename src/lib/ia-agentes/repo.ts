// ============================================================
// Agentes de IA no banco (1048). Servidor, com o cliente de SERVIÇO.
//
// ⚠️ `cb_ia_agentes` só dá SELECT ao ADMINISTRADOR (D14) e nenhuma escrita ao
// navegador: toda escrita passa por aqui, e toda consulta leva a conta
// (`.eq('account_id', …)`) — o cliente de serviço ignora a RLS. Quem chama já
// conferiu o papel (`requireRole('admin')`).
//
// As ETAPAS em que o agente atua (D24) moram em `cb_ia_agente_etapas`, uma
// linha por etapa (a etapa é a chave: no máximo um agente por etapa). A tela
// manda a lista inteira; as que ficam mantêm o `desde` (D27).
//
// Os DOCUMENTOS da base que o agente usa (F3, D20) moram em
// `cb_ia_agente_documentos` (1052), fechada ao navegador. Nada marcado =
// nenhuma base.
//
// As FERRAMENTAS (F4, D28) moram em `cb_ia_agentes.ferramentas`: cada item
// liberado é conferido ao salvar (`conferirFerramentas`) — da conta, e dentro
// da D5 — e de novo na hora de executar.
// ============================================================

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { ehInstagram } from '@/lib/cb-channels/transporte'
import { lerEstado } from '@/lib/ia-chaves/repo'

import { conferirFerramentas } from './ferramentas'
import {
  COLUNAS_DO_AGENTE,
  colunasDaAlteracao,
  itensDaAcao,
  lerEtapaDoAgente,
  lerLinhaDoAgente,
  planoDasEtapas,
  type AlteracaoDoAgente,
  type EtapaDoAgente,
  type FerramentasDoAgente,
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
      | 'etapa_de_outra_conta'
      | 'etapa_ocupada'
      | 'documento_invalido'
      | 'etapa_de_resultado'
      | 'item_de_outra_conta'
      | 'campo_vigiado'
      | 'automacao_fora_da_d5'
      | 'cascata_fora_da_d5'
      | 'tipo_de_evento_invalido'
      | 'calendly_desconectado'
      | 'banco',
    mensagem: string,
    /** No `etapa_ocupada`: o nome do agente que já atua na etapa (a tela o diz). */
    public readonly outroAgente?: string,
    /** Nas recusas das ferramentas (F4): os ids recusados. */
    public readonly itens?: string[],
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

/**
 * As etapas em que cada agente atua, por agente. Sem `agenteIds`, as da conta
 * inteira (é o que diz à tela quais etapas já têm dono).
 */
export async function etapasDosAgentes(
  accountId: string,
  agenteIds?: string[],
): Promise<Map<string, EtapaDoAgente[]>> {
  let q = supabaseAdmin()
    .from('cb_ia_agente_etapas')
    .select('stage_id, ia_agente_id, desde, pipeline_stages(pipeline_id)')
    .eq('account_id', accountId)
  if (agenteIds) q = q.in('ia_agente_id', agenteIds)
  const { data, error } = await q
  if (error) throw new ErroDoAgente('banco', error.message)
  const porAgente = new Map<string, EtapaDoAgente[]>()
  for (const linha of data ?? []) {
    const e = lerEtapaDoAgente(linha as Record<string, unknown>)
    if (!e) continue
    const { iaAgenteId, ...etapa } = e
    porAgente.set(iaAgenteId, [...(porAgente.get(iaAgenteId) ?? []), etapa])
  }
  return porAgente
}

/** Os agentes não arquivados, cada um com as suas etapas (a lista da tela). */
export async function listarAgentesComEtapas(accountId: string) {
  const [agentes, etapas] = await Promise.all([listarAgentes(accountId), etapasDosAgentes(accountId)])
  return agentes.map((a) => ({ ...a, etapas: etapas.get(a.id) ?? [] }))
}

/** Um agente com as suas etapas (o detalhe da tela). */
export async function obterAgenteComEtapas(accountId: string, id: string) {
  const agente = await obterAgente(accountId, id)
  if (!agente) return null
  const etapas = await etapasDosAgentes(accountId, [id])
  return { ...agente, etapas: etapas.get(id) ?? [] }
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
  /** As ferramentas GRAVADAS (na edição): o tipo de evento que não mudou não vai ao Calendly. */
  ferramentasGravadas?: FerramentasDoAgente,
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
    // A chave da OpenAI que nasceu SÓ da base (1047) pode ser restrita aos
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
  if (a.ferramentas) {
    let r: Awaited<ReturnType<typeof conferirFerramentas>>
    try {
      r = await conferirFerramentas(db, accountId, a.ferramentas, ferramentasGravadas)
    } catch (err) {
      throw new ErroDoAgente('banco', err instanceof Error ? err.message : String(err))
    }
    if (!r.ok) throw new ErroDoAgente(r.codigo, 'ferramenta recusada', undefined, r.itens)
  }
}

/**
 * Confere as etapas pedidas (D24) e devolve as que ENTRAM: toda etapa é de um
 * funil DESTA conta (`pipeline_stages` não tem `account_id` — a conta vem do
 * funil), e nenhuma já é de OUTRO agente (409 com o nome dele). O índice da
 * tabela (a etapa é a chave) é a última palavra numa corrida.
 */
async function conferirEtapas(accountId: string, agenteId: string | null, etapas: string[]): Promise<string[]> {
  if (etapas.length === 0) return []
  const db = supabaseAdmin()
  const { data: daConta, error } = await db
    .from('pipeline_stages')
    .select('id, pipelines!inner(account_id)')
    .eq('pipelines.account_id', accountId)
    .in('id', etapas)
  if (error) throw new ErroDoAgente('banco', error.message)
  if ((daConta ?? []).length !== etapas.length) {
    throw new ErroDoAgente('etapa_de_outra_conta', 'etapa que não é desta conta')
  }
  const { data: marcadas, error: erroDasMarcadas } = await db
    .from('cb_ia_agente_etapas')
    .select('stage_id, ia_agente_id')
    .eq('account_id', accountId)
    .in('stage_id', etapas)
  if (erroDasMarcadas) throw new ErroDoAgente('banco', erroDasMarcadas.message)
  const donoDe = new Map(
    ((marcadas ?? []) as { stage_id: string; ia_agente_id: string }[]).map((l) => [l.stage_id, l.ia_agente_id]),
  )
  const plano = planoDasEtapas(agenteId ?? '', etapas, donoDe)
  if (plano.ocupada) {
    const outro = await obterAgente(accountId, plano.ocupada.agenteId).catch(() => null)
    throw new ErroDoAgente('etapa_ocupada', 'a etapa já tem outro agente', outro?.nome)
  }
  return plano.inserir
}

/**
 * Grava as etapas do agente: insere as novas PRIMEIRO e só depois tira as que
 * saíram (as que ficam mantêm o `desde`). Nessa ordem, a falha que importa —
 * outro agente marcou a etapa entre a conferência e aqui (23505) — não mexe em
 * nada (Codex, #309); quem chama grava as etapas ANTES do resto do agente.
 */
async function gravarEtapas(accountId: string, agenteId: string, etapas: string[], inserir: string[]) {
  const db = supabaseAdmin()
  if (inserir.length > 0) {
    const { error: erroDoInsert } = await db
      .from('cb_ia_agente_etapas')
      .insert(inserir.map((stage_id) => ({ stage_id, account_id: accountId, ia_agente_id: agenteId })))
    // A etapa é a chave: outro agente a marcou entre a conferência e aqui.
    if (erroDoInsert?.code === '23505') throw new ErroDoAgente('etapa_ocupada', 'a etapa já tem outro agente')
    if (erroDoInsert) throw new ErroDoAgente('banco', erroDoInsert.message)
  }
  let apagar = db.from('cb_ia_agente_etapas').delete().eq('account_id', accountId).eq('ia_agente_id', agenteId)
  if (etapas.length > 0) apagar = apagar.not('stage_id', 'in', `(${etapas.join(',')})`)
  const { error } = await apagar
  if (error) throw new ErroDoAgente('banco', error.message)
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
  const inserirEtapas = a.etapas ? await conferirEtapas(accountId, null, a.etapas) : null
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
  if (a.etapas && inserirEtapas) {
    try {
      await gravarEtapas(accountId, agente.id, a.etapas, inserirEtapas)
    } catch (err) {
      // Sem as etapas, o agente recém-criado não fica para trás (Codex, #309):
      // ele não tem uso nem é citado por ninguém ainda.
      await supabaseAdmin().from('cb_ia_agentes').delete().eq('account_id', accountId).eq('id', agente.id)
      throw err
    }
  }
  return agente
}

export async function atualizarAgente(
  accountId: string,
  userId: string,
  id: string,
  a: AlteracaoDoAgente,
): Promise<IaAgente> {
  // LIGAR confere a chave do provedor GUARDADO, mesmo sem trocá-lo: a tela
  // manda só `{ ativo: true }`, e a chave pode ter sido apagada (ou trocada
  // por uma só da base) com o agente desligado — ele ligaria mudo (Codex, #295).
  // Mexer nas ETAPAS também lê o agente: arquivado, ele não pode voltar a
  // ser dono de etapa (o gatilho da 1049 já as soltou ao arquivar).
  // "Marcar reunião" (F5) também lê: o tipo de evento que NÃO mudou não é
  // conferido no Calendly de novo — salvar outra ferramenta com o Calendly
  // fora do ar dava 500.
  let provedorAConferir = a.provedor
  let ferramentasGravadas: FerramentasDoAgente | undefined
  const temReuniao = a.ferramentas !== undefined && itensDaAcao(a.ferramentas, 'marcar_reuniao').length > 0
  if ((a.ativo === true && provedorAConferir === undefined) || a.etapas !== undefined || temReuniao) {
    const atual = await obterAgente(accountId, id)
    if (!atual || atual.arquivadoEm) throw new ErroDoAgente('nao_encontrado', 'agente não encontrado')
    if (a.ativo === true && provedorAConferir === undefined) provedorAConferir = atual.provedor
    ferramentasGravadas = atual.ferramentas
  }
  await conferirReferencias(accountId, { ...a, provedor: provedorAConferir }, id, ferramentasGravadas)
  const inserirEtapas = a.etapas ? await conferirEtapas(accountId, id, a.etapas) : null
  // As etapas ANTES do resto: a etapa tomada por outro agente recusa o
  // salvamento sem ter mudado nada do agente (Codex, #309).
  if (a.etapas && inserirEtapas) await gravarEtapas(accountId, id, a.etapas, inserirEtapas)
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
 * tira das listas "pode passar para" dos outros agentes é um GATILHO da 1048,
 * num UPDATE só (ler e regravar o array aqui perderia uma edição concorrente),
 * e quem solta as etapas dele é outro gatilho (1049).
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

// ------------------------------------------------------------
// A base de conhecimento do agente (F3, D20)
// ------------------------------------------------------------

/**
 * Os ids dos documentos marcados para o agente. Sem paginar: o `PUT` não
 * deixa passar de `LIMITES.documentos` (200), bem abaixo do teto de 1000 do
 * PostgREST. Erro de leitura lança (nunca "nenhum documento").
 */
export async function lerDocumentosDoAgente(accountId: string, agenteId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from('cb_ia_agente_documentos')
    .select('documento_id')
    .eq('account_id', accountId)
    .eq('ia_agente_id', agenteId)
    .order('documento_id', { ascending: true })
  if (error) throw new ErroDoAgente('banco', error.message)
  return ((data ?? []) as { documento_id: string }[]).map((l) => l.documento_id)
}

/**
 * Grava a lista INTEIRA de documentos do agente: confere que o agente é
 * desta conta e não está arquivado, que todo documento é DESTA conta
 * (`documento_invalido` — a FK composta seria a última palavra, mas com erro
 * cru), insere os novos PRIMEIRO e só depois apaga os que saíram (a ordem das
 * etapas: uma falha no meio não deixa o agente sem base). Devolve a lista
 * gravada, relida do banco.
 */
export async function gravarDocumentosDoAgente(
  accountId: string,
  agenteId: string,
  documentoIds: string[],
): Promise<string[]> {
  const agente = await obterAgente(accountId, agenteId)
  if (!agente || agente.arquivadoEm) throw new ErroDoAgente('nao_encontrado', 'agente não encontrado')
  const db = supabaseAdmin()
  if (documentoIds.length > 0) {
    const { data, error } = await db
      .from('ai_knowledge_documents')
      .select('id')
      .eq('account_id', accountId)
      .in('id', documentoIds)
    if (error) throw new ErroDoAgente('banco', error.message)
    if ((data ?? []).length !== documentoIds.length) {
      throw new ErroDoAgente('documento_invalido', 'documento que não é desta conta')
    }
    // `ignoreDuplicates`: o que já estava marcado não se toca (a chave
    // primária é TOTAL, então serve de alvo do ON CONFLICT).
    const { error: erroDoInsert } = await db.from('cb_ia_agente_documentos').upsert(
      documentoIds.map((documento_id) => ({ account_id: accountId, ia_agente_id: agenteId, documento_id })),
      { onConflict: 'ia_agente_id,documento_id', ignoreDuplicates: true },
    )
    // 23503: o documento foi apagado entre a conferência e aqui.
    if (erroDoInsert?.code === '23503') throw new ErroDoAgente('documento_invalido', 'documento apagado')
    if (erroDoInsert) throw new ErroDoAgente('banco', erroDoInsert.message)
  }
  let apagar = db.from('cb_ia_agente_documentos').delete().eq('account_id', accountId).eq('ia_agente_id', agenteId)
  if (documentoIds.length > 0) apagar = apagar.not('documento_id', 'in', `(${documentoIds.join(',')})`)
  const { error } = await apagar
  if (error) throw new ErroDoAgente('banco', error.message)
  return lerDocumentosDoAgente(accountId, agenteId)
}
