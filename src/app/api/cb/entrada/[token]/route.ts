// ============================================================
// POST /api/cb/entrada/{token} — a porta dos webhooks de entrada (982).
//
// Um sistema de fora (Typebot, n8n) faz POST aqui com um JSON qualquer. O
// CRM registra o acionamento, acha o cliente pelo telefone que o payload
// traz e dispara o gatilho `webhook_received` das automações.
//
// A ordem abaixo é deliberada, e é a mesma da rota do Calendly:
//
//   1. FORMA do token antes de tocar no banco — um caractere fora do
//      alfabeto base64url não pode virar consulta.
//   2. Rate limit POR TOKEN, não por IP: quem abusa tem o token.
//   3. Achar o webhook. Token desconhecido → 404, sem dizer mais nada.
//   4. Conferir o SEGREDO do cabeçalho, em tempo constante. Falhou →
//      401 e NADA é gravado (senão um token vazado encheria o log).
//   5. Só então ler o corpo.
//   6. Gravar a linha com o cadeado JÁ dentro dela, e responder 200
//      ANTES de processar. Quem chama espera segundos; a automação pode
//      levar mais que isso.
//
// ⚠️ Webhook DESLIGADO grava a linha e responde 200. Recusar com 4xx faria
// o sistema de fora tratar como erro e, dependendo dele, desativar a
// integração — e o operador perderia o registro de que o acionamento
// chegou enquanto estava desligado, que é justamente o que ele vai querer
// ver ao religar.
// ============================================================

import { NextResponse } from "next/server";
import { after } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { segredoDoHeader } from "@/lib/cb-channels/webhook-url";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { achatarPayload, valorDoCampo } from "@/lib/webhooks-de-entrada/achatar";
import {
  comTetoDeProcessamento,
  TETO_DE_PROCESSAMENTO_MS,
} from "@/lib/webhooks-de-entrada/claim";
import {
  gravarResultado,
  processarAcionamento,
} from "@/lib/webhooks-de-entrada/processar";
import { segredoConfere, segredoEmClaro } from "@/lib/webhooks-de-entrada/repo";

/** O alfabeto do `randomBytes(24).toString('base64url')`. */
const FORMA_DO_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!FORMA_DO_TOKEN.test(token)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const limite = checkRateLimit(
    `cb:entrada:${token}`,
    RATE_LIMITS.webhookDeEntrada
  );
  if (!limite.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const admin = supabaseAdmin();
  const { data: webhook, error: erroBusca } = await admin
    .from("cb_webhooks")
    .select(
      "id, account_id, nome, segredo, sem_segredo, is_active, campo_telefone, campo_nome, campo_id"
    )
    .eq("token", token)
    .maybeSingle();

  if (erroBusca) {
    console.error("[cb/entrada] busca do webhook:", erroBusca);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!webhook) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ── segredo ────────────────────────────────────────────────
  let esperado: string | null;
  try {
    esperado = segredoEmClaro(webhook);
  } catch (err) {
    // Chave de criptografia rotacionada, ou linha mexida por fora. Recusar
    // é o certo: não dá para provar que quem chamou é quem diz ser.
    console.error("[cb/entrada] segredo ilegível:", err);
    return NextResponse.json({ error: "secret_unreadable" }, { status: 500 });
  }
  if (esperado !== null) {
    const recebido = segredoDoHeader(request.headers.get("authorization"));
    if (!segredoConfere(recebido, esperado)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // ── corpo ──────────────────────────────────────────────────
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const variaveis = achatarPayload(corpo);
  const idExterno = valorDoCampo(variaveis, webhook.campo_id);

  // O cadeado nasce COM a linha: fecha a corrida contra um "Processar de
  // novo" clicado enquanto o `after()` abaixo ainda roda.
  const claimIso = new Date().toISOString();

  const { data: gravado, error: erroInsert } = await admin
    .from("cb_webhook_eventos")
    .upsert(
      {
        account_id: webhook.account_id,
        webhook_id: webhook.id,
        // Ausente = o DEFAULT do banco gera um id único, e cada acionamento
        // é um evento novo. Presente = a reentrega do mesmo id é descartada
        // pelo UNIQUE, antes de disparar automação.
        ...(idExterno ? { id_externo: idExterno } : {}),
        nome: valorDoCampo(variaveis, webhook.campo_nome),
        telefone: valorDoCampo(variaveis, webhook.campo_telefone),
        variaveis,
        resultado: "recebido",
        processando_desde: claimIso,
      },
      { onConflict: "webhook_id,id_externo", ignoreDuplicates: true }
    )
    .select("id");

  if (erroInsert) {
    console.error("[cb/entrada] gravar acionamento:", erroInsert);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const eventoId = gravado?.[0]?.id as string | undefined;
  if (!eventoId) {
    // O UNIQUE agiu: é reentrega do mesmo `id_externo`. Responder 200 para
    // o sistema de fora parar de retentar, sem disparar nada de novo.
    return NextResponse.json({ ok: true, duplicado: true });
  }

  // Acionamento chegando é prova de vida do webhook. Falhar aqui não
  // derruba a entrega — o log já provou o recebimento —, mas não pode ser
  // silencioso: a tela passaria a dizer "nunca acionado" enquanto os
  // acionamentos entram, e o operador iria caçar defeito na origem.
  const { error: erroVida } = await admin
    .from("cb_webhooks")
    .update({ last_event_at: new Date().toISOString() })
    .eq("id", webhook.id);
  if (erroVida) {
    console.error("[cb/entrada] last_event_at:", erroVida);
  }

  after(async () => {
    const db = supabaseAdmin();
    try {
      const r = await comTetoDeProcessamento(
        processarAcionamento(
          db,
          webhook.account_id,
          webhook,
          { variaveis }
        )
      );
      if (r.pronto) {
        await gravarResultado(db, eventoId, r.valor, claimIso);
      } else {
        await gravarResultado(
          db,
          eventoId,
          {
            resultado: "falhou",
            detalhe: `o processamento passou de ${Math.round(TETO_DE_PROCESSAMENTO_MS / 60000)} minutos e foi interrompido`,
            contactId: null,
          },
          claimIso
        );
      }
    } catch (err) {
      console.error("[cb/entrada] processamento:", err);
      // `falhou` (não reprocessável) em vez de soltar limpo: a automação
      // pode ter enviado antes de morrer, e reprocessar mandaria de novo.
      await gravarResultado(
        db,
        eventoId,
        {
          resultado: "falhou",
          detalhe: "erro inesperado no processamento",
          contactId: null,
        },
        claimIso
      );
    }
  });

  return NextResponse.json({ ok: true, evento: eventoId });
}
