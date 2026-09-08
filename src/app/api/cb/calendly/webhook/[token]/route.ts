import { NextResponse, after } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { verificarAssinatura } from "@/lib/calendly/assinatura";
import { eventoDoCorpo, lerAgendamento } from "@/lib/calendly/payload";
import { gravarResultado, processarAgendamento } from "@/lib/calendly/processar";
import { variaveisDoAgendamento } from "@/lib/calendly/variaveis";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { decrypt } from "@/lib/whatsapp/encryption";

/**
 * POST /api/cb/calendly/webhook/[token]  — PÚBLICO, assinado.
 *
 * O Calendly bate aqui a cada horário marcado. Ordem, e o motivo de cada
 * passo:
 *   1. corpo CRU primeiro (`request.text()`): o HMAC é sobre os bytes;
 *   2. o token da URL diz de QUAL conta é a assinatura (404 se não há);
 *   3. a assinatura `Calendly-Webhook-Signature` é conferida com a chave
 *      daquela conta (401 se não bate — nada é gravado);
 *   4. o evento é gravado com `ON CONFLICT DO NOTHING` na chave
 *      (conta, evento, invitee): o Calendly REENVIA a mesma entrega por 24h
 *      enquanto não recebe 2xx, e a cópia não pode disparar a automação de
 *      novo — quem decide é o UNIQUE da 977, não um `if`;
 *   5. responde 200 e processa em `after()`: o Calendly espera 15 s, e a
 *      automação pode mandar WhatsApp (segundos) — segurar a resposta é
 *      convidar a retentativa. ⚠️ O processamento CRIA a ficha do cliente
 *      quando o telefone ainda não é de nenhum contato (08/09/2026) — ver
 *      `processar.ts`.
 *
 * Evento que não é `invitee.created` (assinatura feita à mão com outros
 * eventos) responde 200 e não grava: 4xx faria o Calendly retentar por 24h
 * e desativar a assinatura inteira, inclusive para os agendamentos.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const limit = checkRateLimit(`calendly:webhook:${token}`, RATE_LIMITS.calendlyWebhook);
  if (!limit.success) return rateLimitResponse(limit);

  const corpoCru = await request.text();
  const admin = supabaseAdmin();
  const { data: config, error } = await admin
    .from("cb_calendly_config")
    .select("account_id, signing_key, pergunta_telefone")
    .eq("webhook_token", token)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
  if (!config) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let chave: string;
  try {
    chave = decrypt(config.signing_key);
  } catch {
    console.error("[calendly] chave de assinatura ilegível para a conta", config.account_id);
    return NextResponse.json({ error: "signing_key_unreadable" }, { status: 500 });
  }
  if (!verificarAssinatura(request.headers.get("calendly-webhook-signature"), corpoCru, chave)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoCru);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const evento = eventoDoCorpo(corpo);
  const agendamento = lerAgendamento(corpo, { perguntaTelefone: config.pergunta_telefone });
  if (!agendamento) {
    console.info(`[calendly] evento ignorado (${evento ?? "sem event"}) na conta ${config.account_id}`);
    return NextResponse.json({ ok: true, ignorado: true });
  }

  const { data: gravado, error: erroInsert } = await admin
    .from("cb_calendly_eventos")
    .upsert(
      {
        account_id: config.account_id,
        evento: agendamento.evento,
        invitee_uri: agendamento.inviteeUri,
        event_type_uri: agendamento.eventoUri,
        event_type_nome: agendamento.eventoNome,
        nome: agendamento.nome,
        email: agendamento.email,
        telefone: agendamento.telefone,
        telefone_origem: agendamento.telefoneOrigem,
        inicio: agendamento.inicio,
        fim: agendamento.fim,
        link: agendamento.link,
        perguntas: agendamento.perguntas,
        // As variáveis que ESTE agendamento entregou ao motor (979): é o que
        // torna "Processar de novo" fiel — a linha não guarda local, cancelar,
        // remarcar nem situação em coluna, e remontá-las daria menos do que a
        // primeira vez, em silêncio.
        variaveis: variaveisDoAgendamento(agendamento),
        resultado: "recebido",
        // ⚠️ O cadeado (980) nasce com a linha: o processamento começa logo
        // abaixo, em `after()`, e sem ele o botão "Processar de novo" podia
        // disparar a MESMA automação em paralelo. `gravarResultado` solta.
        processando_desde: new Date().toISOString(),
      },
      { onConflict: "account_id,evento,invitee_uri", ignoreDuplicates: true },
    )
    .select("id");
  if (erroInsert) {
    console.error("[calendly] não foi possível gravar o evento:", erroInsert.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  const eventoId = gravado?.[0]?.id as string | undefined;
  if (!eventoId) {
    // Reentrega: a primeira cópia já está (ou esteve) em processamento.
    return NextResponse.json({ ok: true, duplicado: true });
  }

  // Entrega chegando = assinatura viva: corrige um `disabled` que a
  // conferência do cartão possa ter gravado numa hora ruim.
  await admin
    .from("cb_calendly_config")
    .update({ last_event_at: new Date().toISOString(), webhook_state: "active" })
    .eq("account_id", config.account_id);

  const accountId = config.account_id as string;
  after(async () => {
    const db = supabaseAdmin();
    try {
      const r = await processarAgendamento(db, accountId, agendamento);
      await gravarResultado(db, eventoId, r);
    } catch (e) {
      console.error("[calendly] processamento falhou:", e instanceof Error ? e.message : e);
      await gravarResultado(db, eventoId, {
        resultado: "falhou",
        detalhe: e instanceof Error ? e.message.slice(0, 500) : "erro desconhecido",
        contactId: null,
      });
    }
  });

  return NextResponse.json({ ok: true, evento: eventoId });
}
