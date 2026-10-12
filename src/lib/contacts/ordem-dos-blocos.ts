import type { SupabaseClient } from '@supabase/supabase-js';

import { lerOrdemPessoal } from './grupos-de-campos';

// ============================================================
// A ordem PESSOAL dos blocos de campos, no banco (migration 1082).
//
// A regra de ordenação é pura e mora em `grupos-de-campos.ts`; aqui fica só
// a ida e a volta de `cb_ordem_dos_blocos` — UMA linha por pessoa em cada
// conta, escrita direto do navegador sob RLS ("só a minha"), no molde dos
// filtros salvos (974) e das automações favoritas (1079).
//
// ⚠️ Preferência de TELA: nenhum motor lê esta tabela, e nada aqui toca
// `custom_fields` — a API, as automações e o Calendly acham o campo pelo id
// ou pela chave, e continuam achando.
// ============================================================

const TABELA = 'cb_ordem_dos_blocos';

/** De quem é a ordem: o LOGIN (`auth.uid()`), nesta conta. */
export interface DonoDaOrdem {
  userId: string;
  accountId: string;
}

/**
 * `sabe: false` = "não sei" (sem sessão ainda, ou a leitura falhou), e NÃO é
 * "não tem ordem própria": quem recebe mantém o que já tinha. Trocar uma
 * ordem carregada pela da conta por causa de uma leitura que falhou faria as
 * pastilhas pularem de lugar sem ninguém ter mexido.
 */
export type LeituraDaOrdem =
  | { sabe: true; ordem: string[] | null }
  | { sabe: false };

/**
 * A minha ordem nesta conta. Nunca rejeita, e por isso entra no `Promise.all`
 * da ficha sem poder derrubar a carga dos campos: a preferência que não
 * carregou vira a ordem da conta, nunca uma ficha em branco.
 */
export async function lerOrdemDosBlocos(
  supabase: SupabaseClient,
  dono: DonoDaOrdem | null
): Promise<LeituraDaOrdem> {
  if (!dono) return { sabe: false };
  // A RLS já recorta pelo dono; os dois `eq` deixam explícito que é UMA
  // linha (a PK), que é o que o `maybeSingle` exige.
  const { data, error } = await supabase
    .from(TABELA)
    .select('ordem')
    .eq('user_id', dono.userId)
    .eq('account_id', dono.accountId)
    .maybeSingle();
  if (error) {
    console.error('[campos] a ordem dos blocos não carregou:', error.message);
    return { sabe: false };
  }
  return { sabe: true, ordem: lerOrdemPessoal(data?.ordem) };
}

/**
 * Grava a minha ordem (cria ou substitui). `false` = não gravou.
 *
 * ⚠️ Confere a LINHA devolvida: o ramo de UPDATE do upsert, barrado pela RLS,
 * volta 0 linhas com `error: null`, e a tela diria "salvo" sobre nada.
 */
export async function gravarOrdemDosBlocos(
  supabase: SupabaseClient,
  dono: DonoDaOrdem,
  ordem: string[]
): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABELA)
    .upsert(
      { user_id: dono.userId, account_id: dono.accountId, ordem },
      { onConflict: 'user_id,account_id' }
    )
    .select('user_id');
  if (error) {
    console.error('[campos] a ordem dos blocos não gravou:', error.message);
    return false;
  }
  return (data ?? []).length === 1;
}

/**
 * Volta à ordem da conta: APAGA a minha linha. `false` = o banco recusou.
 *
 * ⚠️ ZERO LINHAS É SUCESSO, e não há como medir mais do que isso daqui. O
 * DELETE e o SELECT desta tabela têm o MESMO recorte (a linha é minha E eu
 * sou membro da conta), então "apaguei zero" só acontece quando eu não vejo
 * linha nenhuma — porque ela não existe (outra aba já voltou ao padrão) ou
 * porque perdi o acesso à conta com a tela aberta. Uma releitura responderia
 * "sem linha" nos dois casos (Codex, PR #400), e é exatamente isso que a
 * ficha passa a mostrar: a ordem da conta, a mesma de qualquer recarga.
 *
 * LIMITE CONHECIDO: quem é suspenso ou removido com a ficha aberta e clica
 * "Voltar ao padrão" nos segundos antes de a tela de acesso suspenso entrar
 * vê a ordem da conta, mas a linha fica — e a ordem antiga volta se o acesso
 * for devolvido. Separar os dois casos exigiria uma função SECURITY DEFINER
 * só para isto.
 */
export async function apagarOrdemDosBlocos(
  supabase: SupabaseClient,
  dono: DonoDaOrdem
): Promise<boolean> {
  const { error } = await supabase
    .from(TABELA)
    .delete()
    .eq('user_id', dono.userId)
    .eq('account_id', dono.accountId);
  if (error) {
    console.error('[campos] a ordem dos blocos não foi apagada:', error.message);
    return false;
  }
  return true;
}
