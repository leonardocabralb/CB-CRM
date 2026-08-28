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
  /**
   * Whether `userId` has a profile in THIS account. False in one real
   * scenario: the person who connected WhatsApp (the audit-user
   * convention) later left the account — `whatsapp_config.user_id`
   * survives, their profile doesn't. Callers that require a member
   * (e.g. a meeting owner) must check this instead of stamping a
   * ghost.
   */
  membro: boolean;
}

/**
 * Resolve the audit user for this account plus the name to stamp.
 * Same cascade the dashboard routes use (`full_name` → `email`).
 * When the audit user is no longer a member, fall back to the
 * account owner — the same person `resolveAuditUserId` uses when
 * there's no WhatsApp config at all. Only if even the owner has no
 * profile (never seen in practice) does the name fall back to 'API'.
 */
export async function resolveApiAuthor(
  db: SupabaseClient,
  accountId: string
): Promise<ApiAuthor> {
  const auditUserId = await resolveAuditUserId(db, accountId);

  const primeiro = await lookupMember(db, accountId, auditUserId);
  if (primeiro) return primeiro;

  const { data: account } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  const ownerId = account?.owner_user_id as string | undefined;
  if (ownerId && ownerId !== auditUserId) {
    const dono = await lookupMember(db, accountId, ownerId);
    if (dono) return dono;
  }

  return { userId: auditUserId, nome: 'API', membro: false };
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
