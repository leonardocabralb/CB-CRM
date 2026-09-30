import { NextResponse } from "next/server";

import { LEITURA_AGORA, PRAZO_DO_LER_AGORA_MS } from "@/lib/atlas/leitura";
import { sincronizarSituacoes } from "@/lib/atlas/situacoes";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/atlas/leitura  (admin+) — "Ler situações agora", do cartão
 * Atlas de Integrações. Corpo opcional: `{ completa: true }` recomeça a
 * listagem completa (o ciclo só a faz uma vez por dia).
 *
 * Roda a MESMA leitura do cron (`sincronizarSituacoes`), só da conta de quem
 * clicou, com prazo de ~45 s, e responde com o que fez — o cartão relê em
 * seguida. O cadeado serializa com o cron (`em_curso`).
 *
 * ⚠️ Dois baldes: o do admin (`adminAction`) e um POR CONTA
 * (`LEITURA_AGORA`, em `src/lib/atlas/`, fora de `rate-limit.ts`, que é do
 * upstream): a cota do Atlas (60/min) é do ESCRITÓRIO, dividida com o n8n e
 * com o passo "Criar cliente", que não repete — dois admins clicando não
 * podem dobrar a leitura.
 * ⚠️ Nunca bater em `/api/cb/asaas/cron` para ler o Atlas no preview: ele
 * sincronizaria o Asaas da PRODUÇÃO e rodaria a régua.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const porAdmin = checkRateLimit(`cb:atlas:leitura:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!porAdmin.success) return rateLimitResponse(porAdmin);
    const porConta = checkRateLimit(`cb:atlas:leitura-da-conta:${ctx.accountId}`, LEITURA_AGORA);
    if (!porConta.success) return rateLimitResponse(porConta);

    const corpo = (await request.json().catch(() => null)) as { completa?: unknown } | null;
    const r = await sincronizarSituacoes(supabaseAdmin(), ctx.accountId, {
      prazoMs: Date.now() + PRAZO_DO_LER_AGORA_MS,
      forcarCompleta: corpo?.completa === true,
    });
    if (r.ok) return NextResponse.json({ ok: true, contagem: r.contagem });
    const status =
      r.codigo === "db_error"
        ? 500
        : r.codigo === "limite"
          ? 429
          : r.codigo === "nao_conectado" || r.codigo === "em_curso" || r.codigo === "cadeado_perdido" || r.codigo === "chave_ilegivel"
            ? 409
            : 502;
    return NextResponse.json({ error: r.codigo }, { status });
  } catch (err) {
    return toErrorResponse(err);
  }
}
