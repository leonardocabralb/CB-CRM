import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { sincronizarMetaAds } from "@/lib/meta-ads/sincronizar";

/**
 * GET /api/cb/meta-ads/cron — sincroniza o gasto de TODAS as contas
 * conectadas. Entra no laço LENTO do `docker-stack.yml` (`for rota in
 * cb/scheduled flows cb/radar cb/meta-ads`), com o mesmo
 * `AUTOMATION_CRON_SECRET` das rotas irmãs.
 *
 * ⚠️ Como nas outras rotas de cron: sem alguém batendo aqui, nada
 * sincroniza — e o CI NÃO relê o `command` do agendador: incluir a rota no
 * laço só vale depois de `docker stack deploy` manual na VPS, com o
 * `crm.env` carregado (as três linhas do CLAUDE.md).
 *
 * Teto: o `-m 120` do curl. O laço para de abrir contas novas depois de
 * 90s — a que ficou entra no ciclo seguinte (15 min).
 */
export const maxDuration = 120;

const ORCAMENTO_MS = 90_000;

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const supplied = request.headers.get("x-cron-secret") ?? "";
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const inicio = Date.now();
  // Pagina: é a consulta que decide QUEM sincroniza, e o teto de 1000 do
  // PostgREST deixaria a cauda sem sincronizar para sempre, em silêncio.
  const contas: { account_id: string }[] = [];
  for (let pagina = 0; pagina < 20; pagina++) {
    const { data, error } = await admin
      .from("cb_meta_ads_config")
      .select("account_id")
      .order("account_id")
      .range(pagina * 1000, pagina * 1000 + 999);
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!data) break;
    contas.push(...(data as { account_id: string }[]));
    if (data.length < 1000) break;
  }

  let ok = 0;
  let falhas = 0;
  let adiadas = 0;
  for (const conta of contas ?? []) {
    if (Date.now() - inicio > ORCAMENTO_MS) {
      adiadas++;
      continue;
    }
    const r = await sincronizarMetaAds(admin, conta.account_id);
    if (r.ok) ok++;
    else falhas++;
  }
  if (ok || falhas || adiadas) {
    console.log(`[meta-ads] ciclo: ${ok} ok, ${falhas} falha(s), ${adiadas} adiada(s)`);
  }
  return NextResponse.json({ ok, falhas, adiadas });
}
