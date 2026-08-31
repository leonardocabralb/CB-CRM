import type { AccountMember } from '@/types';

/**
 * Fetch the current account's members from the API (which applies the
 * email-visibility rules — agents/viewers don't see emails). Best-effort:
 * returns `[]` on any error or on an older deployment without the
 * endpoint, so callers can fall back to a queue-only / raw-id picker.
 *
 * Client-side only (uses `fetch` against the relative API route).
 */
export async function fetchAccountMembers(): Promise<AccountMember[]> {
  return (await fetchAccountMembersOrNull()) ?? [];
}

/**
 * A variante que NÃO engole a falha: `null` = "não sei quem está na conta",
 * distinto de `[]`. Existe porque o `[]` do best-effort acima virava
 * afirmação — o formulário de tarefa lia lista vazia como "único membro da
 * conta" e AUTO-ATRIBUÍA a tarefa ao criador numa conta COM equipe, numa
 * simples falha de rede (ledger da revisão 48h, r3).
 */
export async function fetchAccountMembersOrNull(): Promise<AccountMember[] | null> {
  try {
    const res = await fetch('/api/account/members', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as { members?: AccountMember[] };
    return json.members ?? [];
  } catch {
    return null;
  }
}

/** Display label for a member: full name → email → raw id. */
export function memberLabel(m: AccountMember): string {
  return m.full_name || m.email || m.user_id;
}
