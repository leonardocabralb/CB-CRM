// ============================================================
// Sincronização do espelho no sentido LEGADO → cb_channels.
//
// A rota legada /api/whatsapp/config mexe só em whatsapp_config. Como o
// ENVIO e a MÍDIA resolvem credenciais pelo canal padrão em cb_channels
// (Fases 1/4a), o DELETE legado deixaria no painel um canal padrão Meta
// "conectado" sem lastro — o helper abaixo o marca desconectado,
// best-effort e deploy-safe (pré-901: tabela ausente → warn).
//
// Só toca o canal padrão quando ele é kind='meta' (os filtros do UPDATE
// garantem 0 linhas num padrão Evolution — o espelho whatsapp_config de um
// padrão Evolution pertence às rotas da Evolution, não a esta).
//
// ⚠️ O par dele, `syncDefaultMetaChannelFromConfig` (o POST legado
// gravando no canal padrão), SAIU com a aposentadoria do POST na Fase 7 do
// plano do merge do upstream (24/09/2026): quem conecta número oficial é
// POST /api/cb/channels.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** A rota legada apagou whatsapp_config — marca o canal padrão Meta como
 *  desconectado para o painel não exibir um canal "conectado" sem lastro. */
export async function flagDefaultMetaChannelRemoved(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  try {
    const { error } = await db
      .from('cb_channels')
      .update({
        status: 'disconnected',
        connected_at: null,
        last_error: 'Configuração removida pela rota legada /api/whatsapp/config',
      })
      .eq('account_id', accountId)
      .eq('kind', 'meta')
      .eq('is_default', true);
    if (error) {
      console.warn(
        '[cb-channels] flag de remoção legada falhou (best-effort):',
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      '[cb-channels] flag de remoção legada lançou (best-effort):',
      err instanceof Error ? err.message : err,
    );
  }
}
