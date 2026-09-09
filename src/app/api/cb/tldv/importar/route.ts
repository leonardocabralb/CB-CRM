import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { idDaReuniaoDoLink } from "@/lib/tldv/leitura";
import { importarReuniaoDoTldv } from "@/lib/tldv/sincronizar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/cb/tldv/importar  (agent+) — "colar o link do tl;dv".
 *
 * Corpo: `{ link, contact_id? }`. O id sai do link (ou é o id cru); a
 * reunião é buscada AGORA no tl;dv (reunião + transcrição + notas) e, com
 * `contact_id`, vinculada ao cliente da ficha de onde o operador colou —
 * vínculo `manual`, que vence o automático por e-mail.
 *
 * Síncrono de propósito: quem cola o link está olhando a ficha e quer ver a
 * reunião aparecer. São 2–3 pedidos ao tl;dv (~segundos).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const limit = checkRateLimit(`cb:tldv:importar:${ctx.userId}`, RATE_LIMITS.reuniaoTranscrita);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { link?: unknown; contact_id?: unknown } | null;
    const meetingId = typeof corpo?.link === "string" ? idDaReuniaoDoLink(corpo.link) : null;
    if (!meetingId) return NextResponse.json({ error: "link_invalido" }, { status: 400 });
    const contactId = typeof corpo?.contact_id === "string" && UUID.test(corpo.contact_id) ? corpo.contact_id : null;

    const admin = supabaseAdmin();
    if (contactId) {
      // ⚠️ Conferido contra a conta: a rota roda em service role.
      const { data: contato } = await admin.from("contacts").select("id").eq("id", contactId).eq("account_id", ctx.accountId).maybeSingle();
      if (!contato) return NextResponse.json({ error: "contato_nao_encontrado" }, { status: 400 });
    }

    const r = await importarReuniaoDoTldv(admin, ctx.accountId, meetingId);
    if (!r.ok) {
      const status = r.codigo === "nao_conectado" || r.codigo === "nao_encontrado" ? 404 : r.codigo === "db_error" ? 500 : 502;
      return NextResponse.json({ error: r.codigo }, { status });
    }

    let contatoFinal = r.contactId;
    if (contactId && contactId !== r.contactId) {
      const agora = new Date().toISOString();
      const { data: atualizada, error } = await admin
        .from("cb_reunioes_transcritas")
        .update({ contact_id: contactId, vinculo_origem: "manual", vinculado_por: ctx.userId, vinculado_em: agora, updated_at: agora })
        .eq("id", r.id)
        .eq("account_id", ctx.accountId)
        .select("id");
      if (error || !atualizada || atualizada.length === 0) return NextResponse.json({ error: "db_error" }, { status: 500 });
      contatoFinal = contactId;
    }
    return NextResponse.json({ ok: true, id: r.id, status: r.status, contact_id: contatoFinal });
  } catch (err) {
    return toErrorResponse(err);
  }
}
