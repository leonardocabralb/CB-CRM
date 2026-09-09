import { NextResponse, after } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { lerAvisoDoWebhook } from "@/lib/tldv/leitura";
import { importarReuniaoDoTldv } from "@/lib/tldv/sincronizar";

/**
 * POST /api/cb/tldv/webhook/[token] — o tl;dv avisa que uma reunião
 * (`MeetingReady`) ou a transcrição dela (`TranscriptReady`) ficou pronta.
 *
 * ⚠️ O tl;dv NÃO assina a entrega (não há cabeçalho de assinatura na doc),
 * então o token na URL é a única barreira — e por isso o corpo é tratado
 * como AVISO, nunca como dado: só o id da reunião é lido, e a reunião é
 * buscada na API do tl;dv com a NOSSA chave. Uma entrega forjada consegue,
 * no máximo, fazer o CRM consultar o tl;dv por um id — e o tl;dv só devolve
 * o que a chave da conta enxerga. Nada do corpo vai para o banco.
 *
 * Responde 200 ANTES de trabalhar (`after()`): buscar reunião + transcrição
 * + notas são três pedidos, e um provedor que espera a resposta desativa o
 * webhook quando ela demora. Evento que não interessa também responde 200,
 * pelo mesmo motivo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const limit = checkRateLimit(`tldv:webhook:${token}`, RATE_LIMITS.tldvWebhook);
  if (!limit.success) return rateLimitResponse(limit);

  const admin = supabaseAdmin();
  const { data: config, error } = await admin.from("cb_tldv_config").select("account_id").eq("webhook_token", token).maybeSingle();
  if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
  if (!config) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const accountId = config.account_id as string;

  const corpo: unknown = await request.json().catch(() => null);
  const aviso = lerAvisoDoWebhook(corpo);
  const agora = new Date().toISOString();
  await admin.from("cb_tldv_config").update({ last_event_at: agora, updated_at: agora }).eq("account_id", accountId);
  if (!aviso) return NextResponse.json({ ok: true, ignorado: true });

  after(async () => {
    const r = await importarReuniaoDoTldv(supabaseAdmin(), accountId, aviso.meetingId);
    if (!r.ok) console.warn(`[tldv] webhook ${aviso.evento} da reunião ${aviso.meetingId}: ${r.codigo}`);
  });
  return NextResponse.json({ ok: true, evento: aviso.evento });
}
