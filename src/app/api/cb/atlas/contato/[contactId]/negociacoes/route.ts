import { NextResponse } from "next/server";

import { AtlasError, criarClienteAtlas } from "@/lib/atlas/cliente";
import { lerChaveDoAtlas, registrarConferencia } from "@/lib/atlas/conexao";
import { ambienteDoAtlas, noAmbiente } from "@/lib/atlas/enderecos";
import { contarNegociacoes, NEGOCIACOES_POR_CONTA, NEGOCIACOES_POR_USUARIO } from "@/lib/atlas/negociacoes";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/cb/atlas/contato/[contactId]/negociacoes — a seção "Negociação"
 * da aba Atlas (Fase 3): bancos, contratos, propostas e acordos do cliente do
 * Atlas ligado a esta ficha, lidos NA HORA (`get_client_negotiations`). Nada
 * é gravado no CRM; a resposta passa pela allowlist de `negociacoes.ts`.
 *
 * Qualquer membro que vê a conversa lê (decisão do operador, 30/09/2026, como
 * as Cobranças). ⚠️ Pela API a chave do ESCRITÓRIO vê tudo: o recorte por
 * time do Atlas (squad) não vale aqui.
 *
 * - ⚠️ Dois baldes, POR USUÁRIO e POR CONTA (`negociacoes.ts`, fora de
 *   `rate-limit.ts`, que é do upstream): a cota do Atlas (60/min) é do
 *   escritório, dividida com o n8n, a leitura periódica e o passo "Criar
 *   cliente", que não repete um 429.
 * - O vínculo é o DESTE ambiente e DESTE escritório (`noAmbiente`,
 *   `atlas_tenant_id` da conexão); o de outro escritório é "sem vínculo".
 * - ⚠️ `read_negotiations` desligada NÃO marca a conexão (a permissão é
 *   opcional; marcar faria o cartão acusar erro com o passo funcionando):
 *   `registrarConferencia` só com chave recusada, plano sem API e
 *   `sem_permissao` de `read_client` (obrigatória). O sucesso limpa só os
 *   códigos da chave.
 * - O `not_found` (lixeira, restaurável por 7 dias) é 404 e NUNCA mexe no
 *   vínculo: a leitura periódica e o passo cuidam da lixeira.
 * - O log leva só contagens e códigos — nunca valor, nome de banco nem texto
 *   do Atlas.
 *
 * Sem configuração de cache: no Next 16 (sem Cache Components) o GET de rota
 * não é cacheado, e a rota lê cookies (`getCurrentAccount`) — dinâmica, como
 * as irmãs `cb/asaas/contato/[contactId]`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const ctx = await getCurrentAccount();
    const porUsuario = checkRateLimit(`cb:atlas:neg:u:${ctx.userId}`, NEGOCIACOES_POR_USUARIO);
    if (!porUsuario.success) return rateLimitResponse(porUsuario);
    const porConta = checkRateLimit(`cb:atlas:neg:${ctx.accountId}`, NEGOCIACOES_POR_CONTA);
    if (!porConta.success) return rateLimitResponse(porConta);

    const { contactId } = await params;
    if (!UUID.test(contactId)) return NextResponse.json({ error: "sem_vinculo" }, { status: 404 });

    const admin = supabaseAdmin();
    const ambiente = ambienteDoAtlas();
    const conexao = await lerChaveDoAtlas(admin, ctx.accountId, ambiente);
    if (!conexao.ok) {
      if (conexao.codigo === "db_error") return NextResponse.json({ error: "db_error" }, { status: 500 });
      // A conexão de OUTRO ambiente é, para esta instância, "não conectado".
      const codigo = conexao.codigo === "outro_ambiente" ? "nao_conectado" : conexao.codigo;
      return NextResponse.json({ error: codigo }, { status: 409 });
    }

    const { data: vinculo, error: erroVinculo } = await noAmbiente(
      admin.from("cb_atlas_clientes").select("atlas_client_id, atlas_tenant_id").eq("account_id", ctx.accountId).eq("contact_id", contactId),
      ambiente,
    ).maybeSingle();
    if (erroVinculo) {
      console.error("[atlas/negociacoes] leitura do vínculo falhou:", erroVinculo.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    if (!vinculo || String(vinculo.atlas_tenant_id) !== conexao.tenantId) {
      return NextResponse.json({ error: "sem_vinculo" }, { status: 404 });
    }

    try {
      const negociacoes = await criarClienteAtlas(conexao.chave).negociacoes(String(vinculo.atlas_client_id));
      await registrarConferencia(admin, ctx.accountId, null, ambiente);
      const n = contarNegociacoes(negociacoes);
      console.info(`[atlas/negociacoes] lidas: ${n.bancos} bancos, ${n.contratos} contratos, ${n.propostas} propostas${negociacoes.truncated ? " (cortada)" : ""}`);
      return NextResponse.json(negociacoes);
    } catch (e) {
      if (!(e instanceof AtlasError)) throw e;
      console.warn(`[atlas/negociacoes] o Atlas recusou (${e.codigo}${e.status ? `, HTTP ${e.status}` : ""})`);
      switch (e.codigo) {
        case "sem_permissao":
          // Só a permissão OBRIGATÓRIA marca a conexão; `read_negotiations` é opcional.
          if (e.permissao === "read_client") await registrarConferencia(admin, ctx.accountId, "sem_permissao", ambiente);
          return NextResponse.json({ error: "sem_permissao", permissao: e.permissao }, { status: 403 });
        case "nao_encontrado":
          return NextResponse.json({ error: "nao_encontrado" }, { status: 404 });
        case "limite":
          return NextResponse.json({ error: "limite", retryAfter: e.esperaSegundos }, { status: 429 });
        case "chave_invalida":
        case "api_fora_do_plano":
          await registrarConferencia(admin, ctx.accountId, e.codigo, ambiente);
          return NextResponse.json({ error: e.codigo }, { status: 409 });
        default:
          // Inclui `acao_desconhecida`, sem estado próprio de propósito: a
          // API ANTES da promoção nem conecta (não tem `whoami`; a rota
          // responde 409 `nao_conectado` acima), e ela responde a ação ausente
          // com 400 SEM `code`. Só uma promoção parcial daria o código, e o
          // contrato (§13) promove as entregas juntas.
          return NextResponse.json({ error: "indisponivel" }, { status: 502 });
      }
    }
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      console.error("[atlas/negociacoes] falhou:", err.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
