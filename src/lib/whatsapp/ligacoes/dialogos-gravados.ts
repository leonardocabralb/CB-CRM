// ============================================================
// O diálogo GRAVADO de uma ligação pelo CRM (4d): a leitura de
// `cb_ligacoes.transcricao` e `resumo` para quem só lê — o contexto do
// agente de IA e a rota da tela. Leve de propósito: não puxa os provedores
// nem a máquina (`transcricao.ts` é quem escreve).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Trecho } from './dialogo';

export type DialogoGravado = { trechos: Trecho[]; resumo: string | null };

/** O jsonb gravado → trechos válidos (o que veio fora da forma fica de fora). */
export function trechosGravados(valor: unknown): Trecho[] {
  if (!Array.isArray(valor)) return [];
  const trechos: Trecho[] = [];
  for (const item of valor) {
    const t = item as { quem?: unknown; inicio?: unknown; texto?: unknown } | null;
    if ((t?.quem !== 'cliente' && t?.quem !== 'atendente') || typeof t.inicio !== 'number' || typeof t.texto !== 'string') {
      continue;
    }
    trechos.push({ quem: t.quem, inicio: t.inicio, texto: t.texto });
  }
  return trechos;
}

/**
 * O diálogo de UMA ligação da conta, para a rota da tela. `null` = não existe,
 * não está pronto ou já expirou. Quem chama confere antes que a pessoa vê a
 * conversa (a mesma régua do ▶).
 */
export async function lerTranscricao(
  db: SupabaseClient,
  accountId: string,
  ligacaoId: string,
): Promise<(DialogoGravado & { conversationId: string | null }) | null | 'falhou'> {
  const { data, error } = await db
    .from('cb_ligacoes')
    .select('conversation_id, transcricao_status, transcricao, resumo, gravacao_expirada_em')
    .eq('id', ligacaoId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) return 'falhou';
  if (!data || data.transcricao_status !== 'pronta' || data.gravacao_expirada_em) return null;
  return {
    conversationId: (data.conversation_id as string | null) ?? null,
    trechos: trechosGravados(data.transcricao),
    resumo: (data.resumo as string | null) ?? null,
  };
}

/**
 * Os diálogos das ligações de UMA conversa (o contexto do agente de IA lê as
 * faixas da janela de uma vez; a conversa recorta a conta). Só as prontas; a
 * expirada entra só com o resumo. Erro de leitura = `null` (quem chama segue
 * sem os diálogos).
 */
export async function lerDialogos(
  db: SupabaseClient,
  conversationId: string,
  ligacaoIds: string[],
): Promise<Map<string, DialogoGravado> | null> {
  const mapa = new Map<string, DialogoGravado>();
  if (ligacaoIds.length === 0) return mapa;
  const { data, error } = await db
    .from('cb_ligacoes')
    .select('id, transcricao_status, transcricao, resumo, gravacao_expirada_em')
    .eq('conversation_id', conversationId)
    .in('id', ligacaoIds);
  if (error) return null;
  for (const l of data ?? []) {
    const resumo = (l.resumo as string | null) ?? null;
    if (l.gravacao_expirada_em) {
      if (resumo) mapa.set(l.id as string, { trechos: [], resumo });
      continue;
    }
    if (l.transcricao_status !== 'pronta') continue;
    mapa.set(l.id as string, { trechos: trechosGravados(l.transcricao), resumo });
  }
  return mapa;
}
