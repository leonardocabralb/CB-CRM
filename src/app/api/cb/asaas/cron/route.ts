import { timingSafeEqual } from "node:crypto";
import { NextResponse, after } from "next/server";

import { sincronizarAsaas } from "@/lib/asaas/sincronizar";
import { rodarCicloDoAtlas } from "@/lib/atlas/situacoes";
import { varrerRegua } from "@/lib/asaas/varrer-regua";
import { origemPublica } from "@/lib/asaas/webhook";
import { cuidarDoWebhook } from "@/lib/asaas/webhook-asaas";
import { supabaseAdmin } from "@/lib/automations/admin-client";

/**
 * GET /api/cb/asaas/cron — sincroniza TODAS as contas conectadas ao Asaas.
 * Entra no laço LENTO do `docker-stack.yml` (`for rota in cb/scheduled
 * flows cb/radar cb/meta-ads cb/tldv cb/asaas`), com o mesmo
 * `AUTOMATION_CRON_SECRET` das rotas irmãs.
 *
 * ⚠️ Como nas outras rotas de cron: sem alguém batendo aqui, nada
 * sincroniza — e o CI NÃO relê o `command` do agendador: incluir a rota no
 * laço só vale depois de `docker stack deploy` manual na VPS, com o
 * `crm.env` carregado (as três linhas do CLAUDE.md).
 *
 * Teto: o `-m 120` do curl. O laço para de abrir contas novas depois de
 * 90 s — a que ficou entra no ciclo seguinte (15 min), e vem para a frente
 * pelo rodízio de `last_sync_attempt_at`.
 *
 * Depois da sincronização de cada conta, com o espelho recém-atualizado: o
 * webhook (Fase 2) e a RÉGUA de cobrança (Fase 3, `varrerRegua`) — os dois
 * só dentro do orçamento; o que não coube roda no ciclo seguinte, dentro da
 * mesma janela de envio.
 *
 * ⚠️ Esta rota CARREGA também a leitura das situações do ATLAS
 * (`rodarCicloDoAtlas`, Fase 2 de docs/PLANO-integracao-atlas.md): tirá-la
 * do laço cala o Atlas junto, sem erro nenhum (o cartão Atlas mostra a data
 * da última leitura). É esta rota, e não uma nova, porque é NOSSA, é a
 * última do laço lento e já tem a cadência de ~15 min — rota nova no laço
 * exigiria `docker stack deploy` à mão na VPS.
 * O LUGAR é logo depois das duas saídas da autenticação, antes de qualquer
 * outro `return` (a leitura das contas do Asaas que falha sai com 500 e não
 * pode calar o Atlas), com pino em `route.test.ts`.
 * A FORMA é de callback — `after(() => rodarCicloDoAtlas())`, nunca a
 * promessa já começada (`after(rodarRedeDosTurnos())` do laço rápido): o
 * ciclo do Atlas só COMEÇA depois que esta resposta sai, isto é, depois do
 * laço do Asaas (até ~110 s), e corre durante o `sleep 900` do agendador,
 * sem disputar com o `-m 120` do curl nem com a cota de ninguém. O `after`
 * roda mesmo quando a resposta falha. O ciclo tem orçamento próprio
 * (`ORCAMENTO_DO_CICLO_MS`, 60 s) e cadeado por conta, e nunca lança.
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

  // A leitura do Atlas (ver o cabeçalho): depois da resposta, calada em erro.
  after(() => rodarCicloDoAtlas());

  const admin = supabaseAdmin();
  const inicio = Date.now();
  // Pagina, e ordena pelo RODÍZIO: nunca tentada primeiro, depois da
  // tentativa mais antiga para a mais recente — `sincronizarAsaas` carimba
  // `last_sync_attempt_at` no começo de toda varredura (o achado do Codex no
  // PR #163, copiado do tl;dv).
  const contas: { account_id: string }[] = [];
  for (let pagina = 0; pagina < 20; pagina++) {
    const { data, error } = await admin
      .from("cb_asaas_config")
      .select("account_id")
      .order("last_sync_attempt_at", { ascending: true, nullsFirst: true })
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
  // ⚠️ A criação AUTOMÁTICA do webhook (D7) vive só aqui, de propósito: o
  // cron só roda na VPS, onde `NEXT_PUBLIC_SITE_URL` é o endereço que
  // atende de verdade. O preview carrega a mesma URL e NÃO pode registrar
  // o webhook — ele bateria numa rota que só existe depois do deploy.
  const origem = origemPublica();
  for (const conta of contas) {
    if (Date.now() - inicio > ORCAMENTO_MS) {
      adiadas++;
      continue;
    }
    const r = await sincronizarAsaas(admin, conta.account_id, { prazoMs: inicio + ORCAMENTO_MS });
    if (r.ok) {
      ok++;
      console.log(
        `[asaas] ciclo da conta ${conta.account_id}: ${r.clientesListados} clientes listados, ${r.cobrancasGravadas} cobranças, ${r.reconciliadas} reconciliadas, ${r.ligados} ligados, ${r.fichasCriadas} fichas criadas, ${r.adiadas} adiadas`,
      );
      // Com a conta sincronizada, o webhook: confere o que existe, cria o
      // que nunca foi tentado. Falha aqui não é falha do ciclo — e só ENTRA
      // dentro do orçamento (o passo em si pode gastar até ~40 s: duas
      // páginas de listagem e um POST, 20 s de timeout cada; o `-m 120` do
      // curl cobre o pior caso com folga curta).
      if (Date.now() - inicio <= ORCAMENTO_MS) {
        const w = await cuidarDoWebhook(admin, conta.account_id, { origem });
        if (!w.ok && w.codigo !== "url_inalcancavel") console.warn(`[asaas] webhook da conta ${conta.account_id}: ${w.codigo}`);
      }
      // A régua (998): só com o interruptor ligado ela lê alguma coisa; o
      // prazo é o que sobrou do orçamento — a varredura para sozinha
      // (`interrompida: "prazo"`) e o ciclo seguinte continua.
      if (Date.now() - inicio <= ORCAMENTO_MS) {
        const rg = await varrerRegua(admin, conta.account_id, { prazoMs: inicio + ORCAMENTO_MS });
        if (rg.ativa) {
          console.log(
            `[asaas] régua da conta ${conta.account_id}: ${rg.automacoes} automações, ${rg.candidatos} candidatos, ${rg.enviados} enviados, ${rg.naFila} na fila, ${rg.absorvidos} absorvidos, ${rg.barrados} barrados, ${rg.falhas} falhas, ${rg.semConexao} sem conexão${rg.sondaFalhou ? " (a SONDA das conexões falhou)" : ""}, ${rg.conexaoInvalida} conexão inválida, ${rg.orfasRecolhidas} órfãs, ${rg.reconciliadas} reconciliadas${rg.desligadaNoMeio ? ", desligada no meio" : ""}${rg.interrompida ? `, interrompida (${rg.interrompida})` : ""}`,
          );
        }
      }
    } else if (r.codigo === "em_curso" || r.codigo === "cadeado_perdido") adiadas++;
    else falhas++;
  }
  if (ok || falhas || adiadas) {
    console.log(`[asaas] ciclo: ${ok} ok, ${falhas} falha(s), ${adiadas} adiada(s)`);
  }
  return NextResponse.json({ ok, falhas, adiadas });
}
