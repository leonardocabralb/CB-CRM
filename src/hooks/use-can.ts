"use client";

import { useAuth } from "@/hooks/use-auth";
import {
  canDeleteAccount,
  canDeleteContacts,
  canEditSettings,
  canManageAutomations,
  canManageMembers,
  canSendMessages,
  canTransferOwnership,
  canViewOnly,
  canViewReports,
  canWriteNotes,
} from "@/lib/auth/roles";

/**
 * Typed action keys for `useCan`. Adding a capability = one new
 * entry here + one new case in the switch below + (usually) one
 * new predicate in `@/lib/auth/roles`. Keeping the list closed
 * lets the compiler catch typos at every call site.
 */
export type CanAction =
  | "manage-members"
  | "manage-automations"
  | "edit-settings"
  | "send-messages"
  | "write-notes"
  | "view-only"
  | "delete-account"
  | "transfer-ownership"
  /** As três abas analíticas do funil (lista, desempenho, saúde). */
  | "view-reports"
  /** Apagar contato — destrutivo: leva conversa e mensagens junto. */
  | "delete-contacts";

/**
 * Inline alternative to `<RequireRole>` for places that need a
 * boolean rather than a render conditional — typically disabled-
 * state on buttons, the readOnly flag on inputs, or controlling
 * tooltip copy ("Read-only" vs the action label).
 *
 * Returns `false` while `profileLoading` is true so transient
 * "you can!" flashes never appear to under-privileged users.
 *
 * Example:
 *   const canEdit = useCan("edit-settings");
 *   <Button disabled={!canEdit} title={canEdit ? "Save" : "Read-only"} />
 */
export function useCan(action: CanAction): boolean {
  const { profileLoading, accountRole } = useAuth();
  if (profileLoading || !accountRole) return false;

  switch (action) {
    case "manage-members":
      return canManageMembers(accountRole);
    case "manage-automations":
      return canManageAutomations(accountRole);
    case "edit-settings":
      return canEditSettings(accountRole);
    case "send-messages":
      return canSendMessages(accountRole);
    case "write-notes":
      return canWriteNotes(accountRole);
    case "view-only":
      return canViewOnly(accountRole);
    case "delete-account":
      return canDeleteAccount(accountRole);
    case "transfer-ownership":
      return canTransferOwnership(accountRole);
    case "view-reports":
      return canViewReports(accountRole);
    case "delete-contacts":
      return canDeleteContacts(accountRole);
    default: {
      // Exhaustiveness check — adding a new `CanAction` without a
      // case here fails the typecheck because TS narrows `action`
      // to `never` in this branch. The runtime throw is unreachable
      // for valid inputs; it only fires if someone bypasses the
      // type system at the call site (e.g. with a wrong-typed cast).
      const _exhaustive: never = action;
      throw new Error(`Unknown CanAction: ${String(_exhaustive)}`);
    }
  }
}
