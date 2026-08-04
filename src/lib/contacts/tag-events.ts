import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runAutomationsForTrigger,
  type AutomationContext,
} from '@/lib/automations/engine';
import { addContactTagIfAbsent } from './tag-write';
import { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';

export { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';

interface AddContactTagAndDispatchInput {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  tagId: string;
  context?: AutomationContext;
}

export interface AddContactTagResult {
  added: boolean;
  dispatched: boolean;
  reason?: 'duplicate' | 'max_depth';
}

/**
 * Descobre por qual conexão este contato fala, para o disparo de `tag_added`.
 *
 * ⚠️ Sem isto, etiqueta é o ÚNICO gatilho que chega ao motor sem canal — e o
 * motor trata "sem canal" como passe livre (`channelInScope`, falha ABERTA).
 * Numa conta multi-canal isso é a automação restrita ao número Comercial
 * disparando para cliente do número Pessoal, sem erro e sem log. A condição
 * `channel` sofre o contrário: ela é falha FECHADA, então a ramificação
 * "se veio pelo Comercial" nunca era tomada.
 *
 * A conversa mais recente é a leitura honesta de "por onde este contato fala
 * hoje" — a mesma regra que a D9 fixou para os eventos de funil. Conversa de
 * grupo não entra: ela tem `contact_id` nulo (CHECK XOR da 906), então este
 * filtro por contato nunca a alcança — o que é bom, porque grupo tem
 * `conversations.channel_id` NULO e o número real mora em `cb_groups`.
 */
async function canalDoContato(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<string | null> {
  // Best-effort de verdade: quando esta função é chamada a etiqueta JÁ FOI
  // GRAVADA. Deixar qualquer falha subir daqui transformaria uma escrita
  // bem-sucedida num 500 para quem chamou (`/api/contacts/[id]/tags` e a API
  // pública embrulham em try/catch e respondem erro) — o operador veria
  // "falhou", recarregaria, e encontraria a etiqueta lá. O try/catch cobre o
  // que o `error` do PostgREST não cobre: cliente sem `.from`, rede caindo no
  // meio, qualquer throw de dentro do SDK.
  try {
    const { data, error } = await db
      .from('conversations')
      .select('channel_id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .not('channel_id', 'is', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('[automations] tag_added: canal do contato não resolvido', error);
      return null;
    }
    return data?.channel_id ?? null;
  } catch (err) {
    console.warn('[automations] tag_added: busca do canal do contato falhou', err);
    return null;
  }
}

/**
 * Central server-side tag writer. It dispatches tag_added only for a
 * newly-created join and caps chained tag automations to avoid loops.
 */
export async function addContactTagAndDispatch(
  input: AddContactTagAndDispatchInput
): Promise<AddContactTagResult> {
  const added = await addContactTagIfAbsent(input.db, {
    accountId: input.accountId,
    contactId: input.contactId,
    tagId: input.tagId,
  });

  if (!added) return { added: false, dispatched: false, reason: 'duplicate' };

  const depth = getTagChainDepth(input.context);
  if (depth >= MAX_TAG_CHAIN_DEPTH) {
    console.warn('[automations] tag_added chain depth limit reached', {
      accountId: input.accountId,
      contactId: input.contactId,
      tagId: input.tagId,
      depth,
    });
    return { added: true, dispatched: false, reason: 'max_depth' };
  }

  // Só busca quem não sabe. Quem chama de dentro de um motor (automação, fluxo)
  // já traz o canal do disparo/da run, que é mais preciso que a conversa mais
  // recente — e sobrevive ao `wait` de graça, no JSONB do contexto.
  const channelId =
    input.context?.channel_id ??
    (await canalDoContato(input.db, input.accountId, input.contactId));

  await runAutomationsForTrigger({
    accountId: input.accountId,
    triggerType: 'tag_added',
    contactId: input.contactId,
    context: {
      ...input.context,
      tag_id: input.tagId,
      channel_id: channelId,
      vars: {
        ...(input.context?.vars ?? {}),
        _tag_chain_depth: depth + 1,
      },
    },
  });

  return { added: true, dispatched: true };
}
