import { NextResponse } from "next/server";

import type { ErroDoVinculo } from "@/lib/atlas/do-contato";
import { desligarVinculo, ligarVinculo } from "@/lib/atlas/vinculo";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O código vira status; o corpo leva sempre o código (a aba o traduz). */
const STATUS: Record<ErroDoVinculo, number> = {
  link_invalido: 400,
  contato_nao_encontrado: 404,
  nao_encontrado: 404,
  sem_vinculo: 404,
  nao_conectado: 409,
  outro_ambiente: 409,
  chave_ilegivel: 409,
  chave_invalida: 409,
  api_fora_do_plano: 409,
  sem_permissao: 409,
  ja_vinculado: 409,
  ligado_a_outra_ficha: 409,
  outro_escritorio: 409,
  ainda_na_lixeira: 409,
  limite: 429,
  indisponivel: 502,
  db_error: 500,
};

/**
 * PUT /api/cb/atlas/contato/[contactId]/vinculo  (admin+) — o vínculo da
 * ficha com o cliente do Atlas feito por GENTE, na aba Atlas (Fase 2, PR B).
 * Corpo: `{ acao: 'ligar', link }` (o link da ficha do Atlas, ou o id solto)
 * ou `{ acao: 'desligar' }`. `ligar` com o id do vínculo que está na LIXEIRA
 * é o "Conferir no Atlas": restaurado lá, a marca sai. A regra está em `src/lib/atlas/vinculo.ts`.
 *
 * ⚠️ Só administradores (decisão do operador, 30/09/2026): o vínculo MANDA
 * no passo "Criar cliente no Atlas" e, na Fase 4, no card. Na tela, o gate
 * é `useCan("edit-settings")` — o mesmo papel.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:atlas:vinculo:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { contactId } = await params;
    if (!UUID.test(contactId)) return NextResponse.json({ error: "contato_nao_encontrado" }, { status: 404 });
    const corpo = (await request.json().catch(() => null)) as { acao?: unknown; link?: unknown } | null;
    const acao = corpo?.acao;
    if (acao !== "ligar" && acao !== "desligar") return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const entrada = { accountId: ctx.accountId, contactId, userId: ctx.userId };
    const r = acao === "ligar" ? await ligarVinculo(supabaseAdmin(), { ...entrada, link: corpo?.link }) : await desligarVinculo(supabaseAdmin(), entrada);
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: STATUS[r.codigo] });
    return NextResponse.json({ ok: true, jaEstava: r.jaEstava });
  } catch (err) {
    return toErrorResponse(err);
  }
}
