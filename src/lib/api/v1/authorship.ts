// ============================================================
// Authorship for public-API writes that stamp a human name.
//
// Tasks, notes, meetings and scheduled messages all freeze the
// author's name at write time (the columns survive the member
// leaving the account). An API caller has no logged-in user, so we
// reuse the v1 convention (`resolveAuditUserId`: WhatsApp config
// owner, falling back to the account owner) and resolve that
// person's display name once, here, instead of four copies.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAuditUserId } from './contacts';

export interface ApiAuthor {
  userId: string;
  /** Display name to freeze into `autor_nome`-style columns. */
  nome: string;
}

/**
 * Resolve the audit user for this account plus the name to stamp.
 * Same cascade the dashboard routes use (`full_name` → `email`),
 * with a final fallback for a profile that never completed signup.
 */
export async function resolveApiAuthor(
  db: SupabaseClient,
  accountId: string
): Promise<ApiAuthor> {
  const userId = await resolveAuditUserId(db, accountId);

  const { data: profile } = await db
    .from('profiles')
    .select('full_name, email')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle();

  const nome =
    (profile?.full_name as string | null)?.trim() ||
    (profile?.email as string | null) ||
    'API';

  return { userId, nome };
}
