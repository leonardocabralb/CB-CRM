// ============================================================
// Chaves de IA por PROVEDOR (migration 1042, D1 do
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

export interface EstadoDaChave {
  provedor: AiProvider
  existe: boolean
  atualizadaEm: string | null
}

/** O que a TELA pode saber: se cada provedor tem chave, e desde quando. */
export async function lerEstado(accountId: string): Promise<EstadoDaChave[]> {
  const { data, error } = await supabaseAdmin()
    .from('cb_ia_chaves')
    .select('provedor, updated_at')
    .eq('account_id', accountId)
  if (error) throw new Error(`[ia-chaves] leitura do estado falhou: ${error.message}`)
  const porProvedor = new Map(
    (data ?? []).map((l) => [l.provedor as string, l.updated_at as string]),
  )
  return PROVEDORES.map((provedor) => ({
    provedor,
    existe: porProvedor.has(provedor),
    atualizadaEm: porProvedor.get(provedor) ?? null,
  }))
}

/** Grava (ou troca) a chave do provedor. A chave já foi VALIDADA por quem chama. */
export async function gravarChave(
  accountId: string,
  provedor: AiProvider,
  chaveCrua: string,
  userId: string | null,
): Promise<void> {
  const agora = new Date().toISOString()
  // O UNIQUE (account_id, provedor) é TOTAL: serve de alvo do ON CONFLICT
  // (os índices parciais da 903 em `ai_configs` não serviriam).
  const { error } = await supabaseAdmin()
    .from('cb_ia_chaves')
    .upsert(
      {
        account_id: accountId,
        provedor,
        api_key: encrypt(chaveCrua),
        atualizada_por: userId,
        updated_at: agora,
      },
      { onConflict: 'account_id,provedor' },
    )
  if (error) throw new Error(`[ia-chaves] gravação falhou: ${error.message}`)
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
