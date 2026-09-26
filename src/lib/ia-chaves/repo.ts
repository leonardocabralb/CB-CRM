// ============================================================
// Chaves de IA por PROVEDOR (migration 1047, D1 do
// docs/PLANO-agentes-de-ia.md): uma chave por provedor para a conta
// inteira, em `cb_ia_chaves`, cifrada com `ENCRYPTION_KEY`.
//
// ⚠️ A tabela é FECHADA ao navegador (RLS sem policy, REVOKE de anon e
// authenticated). Toda leitura e escrita daqui vai pelo cliente de
// SERVIÇO: com o cliente da sessão do usuário, a consulta volta ZERO
// linhas com `error: null` — "sem chave" com cara de resposta certa. Por
// isso as funções não recebem o cliente: quem chama passa só a conta, que
// já conferiu (requireRole, webhook, cron).
//
// ⚠️ A chave decifrada nunca sai de rota nenhuma, nem mascarada: `lerEstado`
// devolve só se existe e quando mudou.
// ============================================================

import { supabaseAdmin } from '@/lib/ai/admin-client'
import type { AiProvider } from '@/lib/ai/types'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'

export const PROVEDORES: readonly AiProvider[] = ['gemini', 'openai', 'anthropic']

export function ehProvedor(valor: unknown): valor is AiProvider {
  return valor === 'openai' || valor === 'anthropic' || valor === 'gemini'
}

/**
 * A chave decifrada do provedor, para USO no servidor.
 * - `chave: null, ilegivel: false` = não há chave cadastrada;
 * - `chave: null, ilegivel: true` = há chave, mas ela não decifra
 *   (`ENCRYPTION_KEY` trocada) — quem chama avisa em vez de dizer "sem chave".
 *
 * Erro de LEITURA lança: "não consegui ler" não é "não há chave" (o Radar
 * gravaria `sem_ia` sobre uma conta configurada).
 */
export async function lerChave(
  accountId: string,
  provedor: AiProvider,
): Promise<{ chave: string | null; ilegivel: boolean }> {
  const { data, error } = await supabaseAdmin()
    .from('cb_ia_chaves')
    .select('api_key')
    .eq('account_id', accountId)
    .eq('provedor', provedor)
    .maybeSingle()
  if (error) throw new Error(`[ia-chaves] leitura falhou: ${error.message}`)
  if (!data?.api_key) return { chave: null, ilegivel: false }
  try {
    return { chave: decrypt(data.api_key as string), ilegivel: false }
  } catch {
    console.error(
      `[ia-chaves] a chave ${provedor} da conta ${accountId} não decifra — confira a ENCRYPTION_KEY; cadastre a chave de novo em Integrações.`,
    )
    return { chave: null, ilegivel: true }
  }
}

/**
 * A chave da OpenAI para os EMBEDDINGS da base de conhecimento:
 * 1. a chave PRÓPRIA dos embeddings (`embeddings_api_key`), quando a conta
 *    tinha uma diferente da do chat no app anterior (a 1047 a guardou);
 * 2. senão a chave da OpenAI (`api_key`), menos quando a OpenAI RECUSOU o
 *    embedding ao gravá-la (`serve_embeddings = false`, chave de projeto
 *    restrita): aí `chave: null` e `recusada: true`, e a base usa a busca
 *    por palavras em vez de tentar (e falhar) a cada resposta e indexação.
 * NULL em `serve_embeddings` (não conferida) vale como "serve", como antes.
 */
export async function lerChaveDeEmbeddings(
  accountId: string,
): Promise<{ chave: string | null; ilegivel: boolean; recusada: boolean }> {
  const { data, error } = await supabaseAdmin()
    .from('cb_ia_chaves')
    .select('api_key, serve_embeddings, embeddings_api_key')
    .eq('account_id', accountId)
    .eq('provedor', 'openai')
    .maybeSingle()
  if (error) throw new Error(`[ia-chaves] leitura falhou: ${error.message}`)
  if (!data?.api_key) return { chave: null, ilegivel: false, recusada: false }
  const propria = typeof data.embeddings_api_key === 'string' && data.embeddings_api_key !== ''
  if (!propria && data.serve_embeddings === false) {
    return { chave: null, ilegivel: false, recusada: true }
  }
  try {
    return {
      chave: decrypt((propria ? data.embeddings_api_key : data.api_key) as string),
      ilegivel: false,
      recusada: false,
    }
  } catch {
    console.error(
      `[ia-chaves] a chave openai da conta ${accountId} não decifra — confira a ENCRYPTION_KEY; cadastre a chave de novo em Integrações.`,
    )
    return { chave: null, ilegivel: true, recusada: false }
  }
}

export interface EstadoDaChave {
  provedor: AiProvider
  existe: boolean
  atualizadaEm: string | null
  /** Só da OpenAI: `false` = a OpenAI recusou o embedding ao gravar. */
  serveEmbeddings: boolean | null
  /** Só da OpenAI: há uma chave PRÓPRIA dos embeddings (herdada da 1047). */
  temChaveDeEmbeddings: boolean
  /**
   * Só da OpenAI: a linha nasceu SÓ da chave da base (1047 — as duas colunas
   * com o MESMO texto cifrado). Essa credencial pode ser restrita aos
   * embeddings: pingá-la no modelo de chat mentiria "falhando" (Codex, #294).
   */
  soDaBase: boolean
}

/** O que a TELA pode saber: se cada provedor tem chave, e desde quando. */
export async function lerEstado(accountId: string): Promise<EstadoDaChave[]> {
  const { data, error } = await supabaseAdmin()
    .from('cb_ia_chaves')
    .select('provedor, updated_at, serve_embeddings, api_key, embeddings_api_key')
    .eq('account_id', accountId)
  if (error) throw new Error(`[ia-chaves] leitura do estado falhou: ${error.message}`)
  const porProvedor = new Map(
    (data ?? []).map((l) => [
      l.provedor as string,
      {
        atualizadaEm: l.updated_at as string,
        serveEmbeddings: typeof l.serve_embeddings === 'boolean' ? l.serve_embeddings : null,
        temChaveDeEmbeddings: typeof l.embeddings_api_key === 'string' && l.embeddings_api_key !== '',
        // Só compara os TEXTOS CIFRADOS (a marca de origem); nada é decifrado.
        soDaBase:
          l.provedor === 'openai' &&
          typeof l.embeddings_api_key === 'string' &&
          l.embeddings_api_key !== '' &&
          l.api_key === l.embeddings_api_key,
      },
    ]),
  )
  return PROVEDORES.map((provedor) => ({
    provedor,
    existe: porProvedor.has(provedor),
    atualizadaEm: porProvedor.get(provedor)?.atualizadaEm ?? null,
    serveEmbeddings: porProvedor.get(provedor)?.serveEmbeddings ?? null,
    temChaveDeEmbeddings: porProvedor.get(provedor)?.temChaveDeEmbeddings ?? false,
    soDaBase: porProvedor.get(provedor)?.soDaBase ?? false,
  }))
}

/**
 * Grava (ou troca) a chave do provedor. A chave já foi VALIDADA por quem chama.
 * `serveEmbeddings` (só OpenAI) é o resultado da conferência do embedding
 * feita AGORA, com esta chave: toda gravação o reescreve, senão a recusa da
 * chave antiga valeria para a nova. Com `true`, a chave PRÓPRIA dos
 * embeddings herdada da 1047 sai: a nova serve às duas coisas, e uma chave
 * velha escondida continuaria sendo usada (e cobrada) sem aparecer na tela.
 *
 * ⚠️ E ESPELHA a chave na cópia legada (`ai_configs.api_key` das linhas deste
 * provedor; na OpenAI que serve aos embeddings, também o `embeddings_api_key`
 * da linha padrão), que a 1047 manteve para uma volta atrás do deploy: sem o
 * espelho, o app anterior voltaria com a chave VELHA — quase sempre revogada
 * na troca (Codex, #294). A cópia sai com a limpeza de uma fase posterior. A
 * falha do espelho não derruba a gravação (a chave nova já vale): fica no log.
 */
export async function gravarChave(
  accountId: string,
  provedor: AiProvider,
  chaveCrua: string,
  userId: string | null,
  serveEmbeddings: boolean | null = null,
  opcoes: { soDaBase?: boolean } = {},
): Promise<void> {
  const agora = new Date().toISOString()
  // A chave da OpenAI que só gera embedding é gravada com a MARCA de origem
  // da 1047: o MESMO texto cifrado em `api_key` e em `embeddings_api_key`
  // (`soDaBase` em `lerEstado`). É o que tira a chave da escolha do chat
  // (Codex, #295). Um texto cifrado só, usado nas duas colunas.
  const soDaBase = provedor === 'openai' && opcoes.soDaBase === true
  const cifradaNova = encrypt(chaveCrua)
  // A chave PRÓPRIA dos embeddings só é própria se for OUTRA chave. A 1047 a
  // copiou comparando os textos CIFRADOS, e a cifra é aleatória (AES-GCM com
  // IV sorteado): a mesma chave digitada nos dois campos virou "própria". Na
  // troca, ela seria preservada e continuaria sendo usada — mesmo revogada
  // junto com a antiga (Codex, #294). Decifradas as duas, igual = não é
  // própria, e sai.
  const semPropriaFalsa =
    provedor === 'openai' && serveEmbeddings !== true && (await propriaEhRedundante(accountId, chaveCrua))
      ? { embeddings_api_key: null }
      : {}
  // O UNIQUE (account_id, provedor) é TOTAL: serve de alvo do ON CONFLICT
  // (os índices parciais da 903 em `ai_configs` não serviriam).
  const { error } = await supabaseAdmin()
    .from('cb_ia_chaves')
    .upsert(
      {
        account_id: accountId,
        provedor,
        api_key: cifradaNova,
        serve_embeddings: provedor === 'openai' ? serveEmbeddings : null,
        // Ausente do objeto = o upsert não toca a coluna (a própria continua).
        ...(provedor === 'openai' && serveEmbeddings === true ? { embeddings_api_key: null } : {}),
        ...semPropriaFalsa,
        ...(soDaBase ? { embeddings_api_key: cifradaNova } : {}),
        atualizada_por: userId,
        updated_at: agora,
      },
      { onConflict: 'account_id,provedor' },
    )
  if (error) throw new Error(`[ia-chaves] gravação falhou: ${error.message}`)

  const cifrada = encrypt(chaveCrua)
  const db = supabaseAdmin()
  // A cópia legada da falsa "própria" sai junto: sem isto, a volta atrás do
  // deploy usaria nos embeddings a chave velha — muitas vezes já revogada
  // (Codex, #294). Sem ela, o app anterior cai na busca por palavras.
  if ('embeddings_api_key' in semPropriaFalsa) {
    const { error: erroLimpeza } = await db
      .from('ai_configs')
      .update({ embeddings_api_key: null })
      .eq('account_id', accountId)
      .is('channel_id', null)
    if (erroLimpeza) console.error('[ia-chaves] limpar a cópia legada da chave de embeddings falhou:', erroLimpeza.message)
  }
  const { error: erroLegado } = await db
    .from('ai_configs')
    .update({ api_key: cifrada })
    .eq('account_id', accountId)
    .eq('provider', provedor)
  const { error: erroEmbeddings } =
    provedor === 'openai' && serveEmbeddings === true
      ? await db
          .from('ai_configs')
          .update({ embeddings_api_key: cifrada })
          .eq('account_id', accountId)
          .is('channel_id', null)
      : { error: null }
  if (erroLegado || erroEmbeddings) {
    console.error(
      '[ia-chaves] o espelho na cópia legada falhou (só a volta atrás do deploy depende dele):',
      erroLegado?.message ?? erroEmbeddings?.message,
    )
  }
}

/**
 * A chave "própria" dos embeddings é, decifrada, a MESMA da chave NOVA ou da
 * do chat de antes? Então ela não é própria: sai, e o veredito
 * `serve_embeddings` da gravação passa a valer. Sem comparar com a NOVA, trocar
 * o chat A pela própria B (recusada nos embeddings) guardaria B como própria,
 * e a base seguiria chamando a credencial que acabou de ser recusada (Codex,
 * #295). Leitura que falha ou chave que não decifra = não (fica como está: na
 * dúvida não se apaga credencial).
 */
async function propriaEhRedundante(accountId: string, chaveNova: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from('cb_ia_chaves')
    .select('api_key, embeddings_api_key')
    .eq('account_id', accountId)
    .eq('provedor', 'openai')
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return false
  let propria: string
  try {
    propria = decrypt(data.embeddings_api_key as string)
  } catch {
    return false
  }
  if (propria === chaveNova) return true
  if (!data.api_key) return false
  // Texto cifrado IDÊNTICO é a marca da 1047 para a chave que ERA só da base
  // (a conta usava outro provedor no chat): ela é própria de verdade e fica
  // (Codex, #294). A duplicata falsa tem a mesma chave com cifras diferentes.
  if (data.api_key === data.embeddings_api_key) return false
  try {
    return decrypt(data.api_key as string) === propria
  } catch {
    return false
  }
}

/** Apaga a chave do provedor. Devolve se havia uma. */
export async function apagarChave(accountId: string, provedor: AiProvider): Promise<boolean> {
  const { error, count } = await supabaseAdmin()
    .from('cb_ia_chaves')
    .delete({ count: 'exact' })
    .eq('account_id', accountId)
    .eq('provedor', provedor)
  if (error) throw new Error(`[ia-chaves] exclusão falhou: ${error.message}`)
  return (count ?? 0) > 0
}
