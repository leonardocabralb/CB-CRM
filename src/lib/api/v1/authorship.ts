// ============================================================
// Authorship for public-API writes that stamp a human name.
//
// Tasks, notes, meetings and scheduled messages all freeze the
// author's name at write time (the columns survive the member
// leaving the account). An API caller has no logged-in user, so we
// reuse the v1 convention (`resolveAuditUserId`: the account owner)
// and resolve that person's display name once, here, instead of four
// copies.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAuditUserId } from './contacts';

export interface ApiAuthor {
  userId: string;
  /** Display name to freeze into `autor_nome`-style columns. */
  nome: string;
  /**
   * Whether `userId` has a profile in THIS account. The account owner
   * always should; false only if that profile is missing (never seen
   * in practice). Callers that require a member (e.g. a meeting owner)
   * must check this instead of stamping a ghost.
   */
  membro: boolean;
}

/**
 * Resolve the audit user for this account plus the name to stamp.
 * Same cascade the dashboard routes use (`full_name` → `email`). Only
 * if the owner has no profile (never seen in practice) does the name
 * fall back to 'API'.
 */
export async function resolveApiAuthor(
  db: SupabaseClient,
  accountId: string
): Promise<ApiAuthor> {
  const auditUserId = await resolveAuditUserId(db, accountId);
  return (
    (await lookupMember(db, accountId, auditUserId)) ?? {
      userId: auditUserId,
      nome: 'API',
      membro: false,
    }
  );
}

async function lookupMember(
  db: SupabaseClient,
  accountId: string,
  userId: string
): Promise<ApiAuthor | null> {
  const { data: profile } = await db
    .from('profiles')
    .select('full_name, email')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!profile) return null;

  const nome =
    (profile.full_name as string | null)?.trim() ||
    (profile.email as string | null) ||
    'API';
  return { userId, nome, membro: true };
}
