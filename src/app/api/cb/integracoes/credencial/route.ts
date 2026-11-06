import { NextResponse } from "next/server";

import { conferirChave as conferirAsaas } from "@/lib/asaas/conexao";
import { conferirConexao as conferirAtlas } from "@/lib/atlas/conexao";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { conferirToken as conferirCalendly } from "@/lib/calendly/conexao";
import { credencialDoProvedor, ehProvedor } from "@/lib/ia-chaves/repo";
import { ehIntegracao, lerCredencial, nomeDoAutor, type Credencial, type Integracao, type ResultadoDoTeste } from "@/lib/integracoes/credencial";
import { conferirMetaAds } from "@/lib/meta-ads/conexao";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { conferirTldv } from "@/lib/tldv/conexao";
import { conferirToken as conferirZapSign } from "@/lib/zapsign/conexao";

/**
 * /api/cb/integracoes/credencial?de=<integração>  (admin+) — o bloco "Chave
 * guardada" dos cartões de Integrações (1127; plano em
 * `docs/PLANO-credencial-das-integracoes.md`).
 *
 * `de` = `tldv` | `calendly` | `meta_ads` | `asaas` | `zapsign` | `atlas`, ou
 * `ia_<provedor>` (`ia_openai`, `ia_gemini`, `ia_anthropic`).
 *
 * GET — `{ credencial }`: os 4 ÚLTIMOS caracteres da chave guardada (nunca
 *   mais que isso), quando foi gravada, por quem e quando respondeu pela
 *   última vez; `null` = não conectada. Erro de leitura é 500, nunca "não
 *   conectada".
 * POST — "Testar agora" com a chave GUARDADA: uma leitura no provedor (nada é
 *   gravado lá), e o resultado vai para a conexão (`registrarTeste` e os
 *   `registrarConferencia` do Atlas e do ZapSign). Falha volta como CÓDIGO,
 *   que o cartão de cada integração traduz. As chaves de IA não passam por
 *   aqui: o cartão delas tem o próprio "Testar" (cada ping é geração paga).
 */

const TESTES: Record<Integracao, (accountId: string) => Promise<ResultadoDoTeste>> = {
  tldv: (id) => conferirTldv(supabaseAdmin(), id),
  calendly: (id) => conferirCalendly(supabaseAdmin(), id),
  meta_ads: (id) => conferirMetaAds(supabaseAdmin(), id),
  asaas: (id) => conferirAsaas(supabaseAdmin(), id),
  zapsign: (id) => conferirZapSign(supabaseAdmin(), id),
  // O "Conferir de novo" do Atlas (`whoami`), que já respeitava o ambiente.
  atlas: async (id) => {
    const r = await conferirAtlas(supabaseAdmin(), id);
    return r.ok ? { ok: true } : { ok: false, codigo: r.codigo, ...(r.faltando ? { faltando: r.faltando } : {}) };
  },
};

function provedorDe(de: string | null) {
  const provedor = de?.startsWith("ia_") ? de.slice(3) : null;
  return ehProvedor(provedor) ? provedor : null;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:credencial:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const de = new URL(request.url).searchParams.get("de");
    const provedor = provedorDe(de);
    if (provedor) {
      let lida: Awaited<ReturnType<typeof credencialDoProvedor>>;
      try {
        lida = await credencialDoProvedor(ctx.accountId, provedor);
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "db_error" }, { status: 500 });
      }
      const credencial: Credencial | null = lida
        ? {
            final: lida.final,
            ilegivel: lida.ilegivel,
            gravadaEm: lida.gravadaEm,
            gravadaPor: await nomeDoAutor(supabaseAdmin(), ctx.accountId, lida.autorId),
            conferidaEm: null,
          }
        : null;
      return NextResponse.json({ credencial });
    }
    if (!ehIntegracao(de)) return NextResponse.json({ error: "integracao_invalida" }, { status: 400 });

    const credencial = await lerCredencial(supabaseAdmin(), ctx.accountId, de);
    if (credencial === "db_error") return NextResponse.json({ error: "db_error" }, { status: 500 });
    return NextResponse.json({ credencial });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:credencial:teste:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const de = new URL(request.url).searchParams.get("de");
    if (!ehIntegracao(de)) return NextResponse.json({ error: "integracao_invalida" }, { status: 400 });

    const r = await TESTES[de](ctx.accountId);
    if (!r.ok) {
      const status = r.codigo === "db_error" ? 500 : r.codigo === "nao_conectado" ? 404 : 400;
      return NextResponse.json({ error: r.codigo, ...(r.faltando ? { faltando: r.faltando } : {}) }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
