// ============================================================
// Sincronização do espelho no sentido LEGADO → cb_channels.
//
// A rota legada /api/whatsapp/config grava só em whatsapp_config. Como o
// ENVIO e a MÍDIA resolvem credenciais pelo canal padrão em cb_channels
// (Fases 1/4a), uma rotação de token feita por essa rota deixaria o canal
// com token defasado (achado da revisão da 4a). Estes helpers fecham o
// drift: toda escrita legada bem-sucedida também atualiza o canal padrão
// Meta — best-effort e deploy-safe (pré-901: tabela ausente → warn).
//
// Só toca o canal padrão quando ele é kind='meta' (os filtros do UPDATE
// garantem 0 linhas num padrão Evolution — o espelho whatsapp_config de um
// padrão Evolution pertence às rotas da Evolution, não a esta).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export async function syncDefaultMetaChannelFromConfig(
  db: SupabaseClient,
  accountId: string,
  row: {
    phone_number_id: string;
    waba_id: string | null;
    /** JÁ criptografado (mesmo formato nas duas tabelas). */
    access_token: string;
    /** JÁ criptografado; null não apaga o que o canal tem. */
    verify_token: string | null;
    status: string;
    connected_at: string | null;
    last_registration_error: string | null;
    /** display_phone_number verificado na Meta; null não apaga o salvo. */
    display_phone?: string | null;
  },
): Promise<void> {
  try {
    const { error } = await db
      .from('cb_channels')
      .update({
        phone_number_id: row.phone_number_id,
        ...(row.waba_id ? { waba_id: row.waba_id } : {}),
        access_token: row.access_token,
        ...(row.verify_token ? { verify_token: row.verify_token } : {}),
        ...(row.display_phone ? { display_phone: row.display_phone } : {}),
        status: row.status === 'connected' ? 'connected' : 'disconnected',
        connected_at: row.connected_at,
        last_error: row.last_registration_error,
      })
      .eq('account_id', accountId)
      .eq('kind', 'meta')
      .eq('is_default', true);
    if (error) {
      console.warn(
        '[cb-channels] sync legado → canal padrão Meta falhou (best-effort):',
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      '[cb-channels] sync legado → canal padrão Meta lançou (best-effort):',
      err instanceof Error ? err.message : err,
    );
  }
}

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
