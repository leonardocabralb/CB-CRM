import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { cartaoDoAtlas, contagemVazia, type ConfigDoAtlas, type ContagemDosVinculos } from "@/lib/atlas/cartao";
import { conectarAtlas, conferirConexao, desconectarAtlas } from "@/lib/atlas/conexao";
import { ambienteDoAtlas, noAmbiente } from "@/lib/atlas/enderecos";
import { CASOU_POR, ORIGENS_DO_VINCULO } from "@/lib/atlas/leitura";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * /api/cb/atlas  (admin+) — o cartão "Atlas" da aba Integrações (1071).
 *
 * GET — o estado da conexão e de qual escritório do Atlas é a chave, a
 *   LEITURA das situações (última, erro, listagem completa) e as fichas
 *   vinculadas por origem e por `casou_por` (1072), deste ambiente e deste
 *   escritório. `ambienteDeTeste` acende o selo — a URL nunca sai.
 *   ⚠️ A chave NÃO sai daqui: a linha é lida com service role SEM a coluna.
 * POST — `{ chave, apagarVinculosAnteriores? }` conecta (ou troca a chave):
 *   prova pelo `whoami` do Atlas, que não grava nada lá; recusa com
 *   `permissoes_faltando` (e a lista) quando o escritório não liberou o que
 *   o passo usa, e com `outro_escritorio` (e `vinculosAnteriores`) quando há
 *   fichas ligadas ao escritório anterior NESTE ambiente — o admin confirma
 *   no cartão e reenvia com `apagarVinculosAnteriores: true`.
 * PATCH — "Conferir de novo": refaz o `whoami` com a chave GUARDADA (nada é
 *   gravado no Atlas). É a saída do aviso de permissão desligada sem colar a
 *   chave outra vez.
 * DELETE — desconecta. Os vínculos das fichas ficam (o mesmo escritório,
 *   reconectado, os reaproveita).
 *
 * ⚠️ A instância apontada para outro ambiente do Atlas (`ATLAS_API_URL`, o
 * preview contra o staging) não conecta por cima nem apaga a conexão de
 * outro ambiente: responde `outro_ambiente` (ver `conexao.ts`).
 */
export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:atlas:status:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("cb_atlas_config")
      .select("api_url, atlas_tenant_id, escritorio, status, last_error, conectado_em, conferido_em, last_sync_at, sync_erro, listagem_completa_em")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    const ambiente = ambienteDoAtlas();
    const cartao = cartaoDoAtlas((data ?? null) as ConfigDoAtlas | null, ambiente);
    // As contagens só fazem sentido para a conexão DESTE ambiente.
    const vinculos = cartao.leitura && data ? await contarVinculos(admin, ctx.accountId, ambiente, String(data.atlas_tenant_id)) : null;
    if (vinculos === "db_error") return NextResponse.json({ error: "db_error" }, { status: 500 });
    return NextResponse.json({ cartao, vinculos });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:atlas:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { chave?: unknown; apagarVinculosAnteriores?: unknown } | null;
    const chave = typeof corpo?.chave === "string" ? corpo.chave.trim() : "";
    // Tamanho plausível (a do Atlas tem ~51 caracteres). Texto com espaço no
    // meio é cola errada: a chave nunca tem. Código PRÓPRIO: o Atlas nem viu.
    if (chave.length < 20 || chave.length > 200 || /\s/.test(chave)) {
      return NextResponse.json({ error: "chave_mal_colada" }, { status: 400 });
    }
    const r = await conectarAtlas(supabaseAdmin(), ctx.accountId, ctx.userId, chave, {
      apagarVinculosAnteriores: corpo?.apagarVinculosAnteriores === true,
    });
    if (!r.ok) {
      const status = r.codigo === "db_error" ? 500 : r.codigo === "outro_ambiente" ? 409 : 400;
      return NextResponse.json(
        {
          error: r.codigo,
          ...(r.faltando ? { faltando: r.faltando } : {}),
          ...(r.vinculosAnteriores !== undefined ? { vinculosAnteriores: r.vinculosAnteriores } : {}),
        },
        { status },
      );
    }
    return NextResponse.json({ ok: true, escritorio: r.escritorio });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:atlas:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const r = await conferirConexao(supabaseAdmin(), ctx.accountId);
    if (!r.ok) {
      const status = r.codigo === "db_error" ? 500 : r.codigo === "outro_ambiente" ? 409 : 400;
      return NextResponse.json({ error: r.codigo, ...(r.faltando ? { faltando: r.faltando } : {}) }, { status });
    }
    return NextResponse.json({ ok: true, escritorio: r.escritorio });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:atlas:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const r = await desconectarAtlas(supabaseAdmin(), ctx.accountId);
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: r.codigo === "outro_ambiente" ? 409 : 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * As fichas vinculadas (com ficha; deste ambiente e escritório), por origem e
 * por `casou_por`. Contagem EXATA pelo cabeçalho (`count: 'exact', head:
 * true`), nunca pelo tamanho de uma lista cortada em 1000.
 */
async function contarVinculos(
  admin: SupabaseClient,
  accountId: string,
  ambiente: string | null,
  tenantId: string,
): Promise<ContagemDosVinculos | "db_error"> {
  const contar = async (coluna: "origem" | "casou_por" | null, valor: string | null): Promise<number | null> => {
    let q = noAmbiente(
      admin.from("cb_atlas_clientes").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("atlas_tenant_id", tenantId),
      ambiente,
    ).not("contact_id", "is", null);
    if (coluna && valor) q = q.eq(coluna, valor);
    const { count, error } = await q;
    return error || typeof count !== "number" ? null : count;
  };
  const [total, ...resto] = await Promise.all([
    contar(null, null),
    ...ORIGENS_DO_VINCULO.map((o) => contar("origem", o)),
    ...CASOU_POR.map((c) => contar("casou_por", c)),
  ]);
  if (total === null || resto.some((n) => n === null)) return "db_error";
  const saida = contagemVazia();
  saida.total = total;
  ORIGENS_DO_VINCULO.forEach((o, i) => (saida.porOrigem[o] = resto[i]!));
  CASOU_POR.forEach((c, i) => (saida.porCasamento[c] = resto[ORIGENS_DO_VINCULO.length + i]!));
  return saida;
}
