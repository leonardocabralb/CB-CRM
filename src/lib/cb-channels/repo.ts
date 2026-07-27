// ============================================================
// Acesso à tabela `cb_channels` — os canais de WhatsApp da conta.
//
// Ver o cabeçalho de supabase/migrations/901_cb_channels.sql para o
// porquê da tabela existir ao lado de `whatsapp_config`.
//
// REGRA DE OURO DESTE MÓDULO
// `access_token` e `api_key` NUNCA saem daqui para o browser. A policy de
// RLS libera a linha inteira para qualquer membro (o Postgres não filtra
// coluna), então a barreira é aqui: consultas destinadas ao client usam
// CB_CHANNEL_SAFE_COLUMNS; só o caminho server-side lê os segredos.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type CbChannelKind = 'meta' | 'evolution';
export type CbChannelStatus = 'disconnected' | 'connecting' | 'connected';

/** O que o browser pode ver. Note a ausência dos segredos. */
// ⚠️ Coluna de configuração por canal que não entrar AQUI salva no banco e
// nunca reaparece na tela — o valor some no reload e o operador conclui que
// não salvou. Já aconteceu com `default_agent_id` (903) e `groups_enabled`
// (906), que até hoje não têm um único leitor em src/.
export const CB_CHANNEL_SAFE_COLUMNS =
  'id, account_id, kind, label, display_phone, is_default, status, ' +
  'connected_at, last_error, phone_number_id, waba_id, server_url, ' +
  'instance_name, default_pipeline_id, default_stage_id, ' +
  'created_at, updated_at';

/** Canal como o client o enxerga. */
export interface CbChannel {
  id: string;
  account_id: string;
  kind: CbChannelKind;
  label: string;
  display_phone: string | null;
  is_default: boolean;
  status: CbChannelStatus;
  connected_at: string | null;
  last_error: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  server_url: string | null;
  instance_name: string | null;
  /**
   * Funil em que cai quem escrever neste número, e a etapa de entrada
   * (migration 908). `null` = a conexão não roteia nada. A etapa é explícita
   * porque a de menor `position` costuma ser faixa de estacionamento
   * ("Contato Avulso"), não a entrada do processo.
   */
  default_pipeline_id: string | null;
  default_stage_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Canal como o servidor o enxerga — inclui os segredos criptografados.
 *  `verify_token` fica de fora de CB_CHANNEL_SAFE_COLUMNS de propósito: é
 *  segredo, e só a verificação do webhook Meta e a promoção a padrão o leem. */
export interface CbChannelWithSecrets extends CbChannel {
  access_token: string | null;
  api_key: string | null;
  verify_token: string | null;
}

/**
 * Lista os canais da conta, sem segredos. Padrão primeiro, depois por
 * data de criação — a ordem em que o operador espera vê-los.
 */
export async function listChannels(
  db: SupabaseClient,
  accountId: string,
): Promise<CbChannel[]> {
  const { data, error } = await db
    .from('cb_channels')
    .select(CB_CHANNEL_SAFE_COLUMNS)
    .eq('account_id', accountId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Falha ao listar canais: ${error.message}`);
  return (data ?? []) as unknown as CbChannel[];
}

/**
 * Um canal da conta, COM os segredos ainda criptografados. Só uso
 * server-side. O filtro por `account_id` é redundante com a RLS de
 * propósito: torna o "0 linhas → 404" preciso e protege caminhos que
 * usem o client de service-role (que ignora RLS).
 */
export async function getChannelWithSecrets(
  db: SupabaseClient,
  accountId: string,
  channelId: string,
): Promise<CbChannelWithSecrets | null> {
  const { data, error } = await db
    .from('cb_channels')
    .select('*')
    .eq('id', channelId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar canal: ${error.message}`);
  return (data as CbChannelWithSecrets) ?? null;
}

/** Quantos canais a conta já tem (para decidir se o novo é o padrão). */
export async function countChannels(
  db: SupabaseClient,
  accountId: string,
): Promise<number> {
  const { count, error } = await db
    .from('cb_channels')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);

  if (error) throw new Error(`Falha ao contar canais: ${error.message}`);
  return count ?? 0;
}

/**
 * Canais da conta no formato mínimo que a validação de ativação precisa
 * (id + rótulo + tipo). Usa o client de service-role dos engines/rotas, e o
 * filtro por `account_id` é a barreira de tenancy.
 *
 * Devolve `[]` (e não lança) quando a tabela ainda não existe — assim um
 * deploy fora de ordem não impede salvar automação.
 */
export async function loadAccountChannelsForValidation(
  db: SupabaseClient,
  accountId: string,
): Promise<{ id: string; label: string; kind: CbChannelKind }[]> {
  const { data, error } = await db
    .from('cb_channels')
    .select('id, label, kind')
    .eq('account_id', accountId);
  if (error) {
    console.warn(
      '[cb-channels] listagem para validação falhou (ignorado):',
      error.message,
    );
    return [];
  }
  return (data ?? []) as { id: string; label: string; kind: CbChannelKind }[];
}
