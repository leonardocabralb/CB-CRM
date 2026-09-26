// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
//
//   O celular (1046) segue a mesma regra, e com barreira no banco: ver o
//   comentário na leitura, abaixo.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import type { AccountMember } from "@/types";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // RLS on profiles allows reading any row whose account matches
    // the caller's, so this query is naturally account-scoped.
    const { data, error } = await ctx.supabase
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, account_role, created_at")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/account/members] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const canSeeEmails = canManageMembers(ctx.role);

    // O celular de cada membro (1046) segue a regra do e-mail: só para
    // administradores. Aqui a barreira é também o banco — o cliente é o do
    // CHAMADOR, e a RLS de `cb_celulares_dos_membros` só entrega a um
    // administrador o número da própria equipe. Leitura que falha deixa o
    // campo AUSENTE ("não sei"), nunca `null`, que a tela lê como "não
    // informou".
    let celulares: Map<string, string> | null = null;
    if (canSeeEmails) {
      const leitura = await ctx.supabase
        .from("cb_celulares_dos_membros")
        .select("user_id, celular")
        .in(
          "user_id",
          (data as ProfileRow[]).map((row) => row.user_id),
        );
      if (leitura.error) {
        console.error("[GET /api/account/members] celulares:", {
          code: leitura.error.code,
          message: leitura.error.message,
        });
      } else {
        celulares = new Map(
          (leitura.data as { user_id: string; celular: string }[]).map((l) => [
            l.user_id,
            l.celular,
          ]),
        );
      }
    }

    const members: AccountMember[] = (data as ProfileRow[]).flatMap((row) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.account_role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          joined_at: row.created_at,
          ...(celulares ? { celular: celulares.get(row.user_id) ?? null } : {}),
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
