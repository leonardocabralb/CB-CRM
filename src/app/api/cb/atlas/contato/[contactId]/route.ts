import { NextResponse } from "next/server";

import { COLUNAS_DA_CONFIG, COLUNAS_DO_VINCULO_NA_TELA, conectadoNoAmbiente, LEITURA_DO_CONTATO, respostaDoContato, type ConfigDaTela, type VinculoDaFicha } from "@/lib/atlas/do-contato";
import { ambienteDoAtlas, noAmbiente } from "@/lib/atlas/enderecos";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/cb/atlas/contato/[contactId] — o Atlas de UM contato (Fase 2, PR
 * B): o botão "Abrir no Atlas", a linha do Atlas na faixa e a aba Atlas.
 *
 * `{ conectado, vinculo: { atlasClientId, appUrl, situacao, situacaoDesde,
 * origem, casouPor, excluidoEm, lidaEm, velha } | null, erroDaLeitura }`
 * (a forma em `src/lib/atlas/do-contato.ts`).
 *
 * - Qualquer membro lê (a linha do Atlas aparece a todos que veem a
 *   conversa — decisão do operador). SÓ BANCO: nunca chama o Atlas; a
 *   situação é a que a leitura periódica gravou.
 * - `cb_atlas_config` é fechada ao navegador: é por aqui que a tela sabe se
 *   o Atlas está conectado (a aba some numa conta sem Atlas).
 * - ⚠️ Cerca de AMBIENTE (`noAmbiente`) e de ESCRITÓRIO (o da conexão): o
 *   vínculo do staging e o do escritório anterior não aparecem.
 * - `velha` é calculada AQUI (o React Compiler recusa `Date.now()` no render);
 *   `appUrl` só sai `https:` e com o id do cliente.
 * - Balde próprio (`LEITURA_DO_CONTATO`, 120/min): o fio e o painel leem juntos
 *   a cada troca de conversa.
 * - Erro de leitura responde 500, nunca `{}` nem "sem vínculo" (CLAUDE.md 8b).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(`cb:atlas:contato:${ctx.userId}`, LEITURA_DO_CONTATO);
    if (!limit.success) return rateLimitResponse(limit);

    const { contactId } = await params;
    if (!UUID.test(contactId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const admin = supabaseAdmin();
    const ambiente = ambienteDoAtlas();
    const { data: config, error: erroConfig } = await admin.from("cb_atlas_config").select(COLUNAS_DA_CONFIG).eq("account_id", ctx.accountId).maybeSingle();
    if (erroConfig) {
      console.error("[atlas/contato] leitura da conexão falhou:", erroConfig.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    const conexao = (config ?? null) as ConfigDaTela | null;
    if (!conexao || !conectadoNoAmbiente(conexao, ambiente)) return NextResponse.json(respostaDoContato(null, null, ambiente, new Date()));

    const { data: vinculo, error: erroVinculo } = await noAmbiente(
      admin
        .from("cb_atlas_clientes")
        .select(COLUNAS_DO_VINCULO_NA_TELA)
        .eq("account_id", ctx.accountId)
        .eq("contact_id", contactId)
        .eq("atlas_tenant_id", String(conexao.atlas_tenant_id)),
      ambiente,
    ).maybeSingle();
    if (erroVinculo) {
      console.error("[atlas/contato] leitura do vínculo falhou:", erroVinculo.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    return NextResponse.json(respostaDoContato(conexao, (vinculo ?? null) as VinculoDaFicha | null, ambiente, new Date()));
  } catch (err) {
    return toErrorResponse(err);
  }
}
