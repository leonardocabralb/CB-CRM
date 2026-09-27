import { NextResponse, after } from "next/server";

import { RE_TOKEN, tokenConfere } from "@/lib/asaas/webhook";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { decrypt } from "@/lib/whatsapp/encryption";
import { cabecalhoDoWebhook } from "@/lib/zapsign/conexao";
import { comTetoDeProcessamento, gravarResultado } from "@/lib/zapsign/claim";
import { EVENTO_ASSINADO, lerAviso } from "@/lib/zapsign/leitura";
import { processarAssinatura } from "@/lib/zapsign/processar";
import { variaveisDasRespostas } from "@/lib/zapsign/variaveis";

/**
 * POST /api/cb/zapsign/webhook/[token]  — PÚBLICO, autenticado pelo cabeçalho.
 *
 * O ZapSign bate aqui a cada assinatura (`doc_signed` — uma entrega POR
 * signatário). Ordem, e o motivo de cada passo:
 *   1. o token da URL diz de QUAL conta é a entrega (404 se não há);
 *   2. `Authorization` é comparado em TEMPO CONSTANTE com o `Bearer
 *      <segredo>` que o CRM informou ao criar o webhook (401 se não bate —
 *      nada é gravado). O ZapSign não assina com HMAC: URL vaza, a
 *      credencial mora no cabeçalho;
 *   3. o corpo é AVISO: dele saem o documento, o evento, quem assinou e as
 *      respostas do formulário; o que decide vem da releitura do documento;
 *   4. a entrega é gravada com `ON CONFLICT DO NOTHING` na chave (conta,
 *      documento, evento, signatário): o ZapSign REPETE a entrega que não
 *      recebeu 200, e a cópia não pode disparar de novo;
 *   5. responde 200 e processa em `after()`.
 *
 * ⚠️ 404 e 401 são as únicas recusas; 429 (o balde por IP, antes de gravar)
 * pede para o ZapSign tentar de novo. Corpo ilegível, outro evento e forma
 * estranha respondem 200 com log: o ZapSign retenta tudo o que não é 200, e
 * retentar um corpo que nunca vai ser lido é só ruído.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!RE_TOKEN.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Antes do banco, um balde por IP de ORIGEM: quem tiver só a URL não força
  // leitura + decifragem sem limite (o molde do Asaas). ⚠️ 429, e não 200:
  // aqui a entrega ainda NÃO foi gravada, e um 200 diria ao ZapSign que ela
  // chegou — sem ciclo de reconciliação, a assinatura se perderia (Codex, PR
  // #329). O ZapSign retenta o que não é 200.
  const ip = (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "desconhecido").slice(0, 64);
  if (!checkRateLimit(`zapsign:webhook:ip:${ip}`, RATE_LIMITS.zapsignWebhookPorIp).success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const admin = supabaseAdmin();
  const { data: config, error } = await admin
    .from("cb_zapsign_config")
    .select("account_id, webhook_secret")
    .eq("webhook_url_token", token)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
  if (!config || typeof config.webhook_secret !== "string") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const accountId = config.account_id as string;

  let segredo: string;
  try {
    segredo = decrypt(config.webhook_secret);
  } catch {
    console.error("[zapsign] credencial do webhook ilegível para a conta", accountId);
    return NextResponse.json({ error: "secret_unreadable" }, { status: 500 });
  }
  if (!tokenConfere(request.headers.get("authorization"), cabecalhoDoWebhook(segredo).valor)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const corpo: unknown = await request.json().catch(() => null);
  const aviso = lerAviso(corpo);
  if (!aviso) {
    console.info(`[zapsign] entrega sem documento/evento reconhecível na conta ${accountId} — ignorada`);
    return NextResponse.json({ ok: true, ignorado: true });
  }
  if (aviso.eventType !== EVENTO_ASSINADO) {
    console.info(`[zapsign] evento ${aviso.eventType} ignorado na conta ${accountId}`);
    return NextResponse.json({ ok: true, ignorado: true });
  }

  // Por CONTA e depois do cabeçalho: estourado, a entrega é GRAVADA sem
  // processar (fica `recebido`, e "Processar de novo" a roda) — não há
  // ciclo que a reconcilie depois, e um 200 sem gravar a perderia.
  const dentroDoBalde = checkRateLimit(`zapsign:webhook:${accountId}`, RATE_LIMITS.zapsignWebhook).success;

  const respostasDeQueda = variaveisDasRespostas(aviso.respostas);
  const claimIso = new Date().toISOString();
  const { data: gravado, error: erroInsert } = await admin
    .from("cb_zapsign_eventos")
    .upsert(
      {
        account_id: accountId,
        doc_token: aviso.docToken,
        event_type: aviso.eventType,
        signer_token: aviso.signerToken,
        documento_nome: aviso.documentoNome,
        signatario_nome: aviso.signatarioNome,
        // As respostas do aviso, já sem documento pessoal: o reprocessamento
        // as reusa quando o documento relido não as traz.
        variaveis: respostasDeQueda,
        resultado: "recebido",
        detalhe: dentroDoBalde ? null : 'adiado pelo limite de entregas por minuto — use "Processar de novo"',
        // ⚠️ O cadeado nasce com a linha: o processamento começa logo abaixo,
        // em `after()`, e sem ele o "Processar de novo" podia correr junto.
        processando_desde: dentroDoBalde ? claimIso : null,
      },
      { onConflict: "account_id,doc_token,event_type,signer_token", ignoreDuplicates: true },
    )
    .select("id");
  if (erroInsert) {
    console.error("[zapsign] não foi possível gravar a entrega:", erroInsert.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  const eventoId = gravado?.[0]?.id as string | undefined;
  if (!eventoId) return NextResponse.json({ ok: true, duplicado: true });

  // Entrega chegando = webhook vivo.
  const agora = new Date().toISOString();
  await admin
    .from("cb_zapsign_config")
    .update({ last_event_at: agora, webhook_estado: "ativo" })
    .eq("account_id", accountId);

  if (!dentroDoBalde) {
    console.warn(`[zapsign] entrega adiada pelo balde na conta ${accountId}`);
    return NextResponse.json({ ok: true, adiado: true });
  }

  after(async () => {
    const db = supabaseAdmin();
    try {
      const r = await comTetoDeProcessamento(
        processarAssinatura(db, accountId, {
          eventoId,
          docToken: aviso.docToken,
          signerToken: aviso.signerToken,
          respostasDeQueda,
        }),
      );
      await gravarResultado(
        db,
        eventoId,
        r.pronto ? r.valor : { resultado: "falhou", detalhe: "o processamento passou do tempo e foi interrompido", contactId: null },
        claimIso,
      );
    } catch (e) {
      console.error("[zapsign] processamento falhou:", e instanceof Error ? e.message : e);
      await gravarResultado(
        db,
        eventoId,
        { resultado: "falhou", detalhe: e instanceof Error ? e.message.slice(0, 500) : "erro desconhecido", contactId: null },
        claimIso,
      );
    }
  });

  return NextResponse.json({ ok: true, evento: eventoId });
}
