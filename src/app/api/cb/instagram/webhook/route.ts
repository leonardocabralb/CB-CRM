// ============================================================
// /api/cb/instagram/webhook — a porta por onde o Direct entra.
//
//   GET  — o aperto de mão da Meta (`hub.verify_token`), varrendo o verify
//          token CIFRADO de cada conexão do Instagram.
//   POST — as entregas. Corpo CRU primeiro (o HMAC é sobre os bytes), a
//          conta pelo `entry.id`, a assinatura conferida com o Instagram App
//          Secret DAQUELE canal, e o processamento em `after()`.
//
// O que morde código novo (tudo medido na Fase 0, 09/09/2026):
//
// · Quem assina é o Instagram App Secret da aba do produto — por canal,
//   cifrado em `cb_channels.ig_app_secret`. `META_APP_SECRET` não serve.
// · Assinatura que NÃO casa é 401: é a única barreira entre um POST anônimo
//   e uma mensagem falsa na caixa. Todo o resto é 200 — `object` errado,
//   conta desconhecida, forma estranha —, porque 4xx repetido faz a Meta
//   desativar a assinatura e as DMs reais somem sem erro em lugar nenhum
//   (a lição do Calendly, 977).
// · Uma entrega pode trazer várias `entry` (contas do mesmo app). O
//   segredo é do APP, então uma conexão que assine vale para o corpo
//   inteiro; cada entry é persistida no contexto do SEU canal.
// · D1: nada aqui chama automação, fluxo ou IA — `persistir.ts` não os
//   importa, e há teste lendo o fonte.
// ============================================================

import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { resolveInboundInstagramChannel } from '@/lib/cb-channels/resolve-inbound';
import { assinaturaCasa } from '@/lib/instagram/assinatura';
import { salvarMidiaDoInstagram } from '@/lib/instagram/midia';
import { completarPerfilDoContato } from '@/lib/instagram/perfil';
import { persistirEventoDoInstagram } from '@/lib/instagram/persistir';
import {
  interpretarWebhook,
  type EventoDoInstagram,
} from '@/lib/instagram/webhook';
import { decrypt } from '@/lib/whatsapp/encryption';

const TAG = '[instagram/webhook]';

/** Service-role: a ingestão ignora RLS, e o filtro por conta é explícito. */
function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get('hub.mode');
  const challenge = params.get('hub.challenge');
  const recebido = params.get('hub.verify_token');
  if (mode !== 'subscribe' || !challenge || !recebido) {
    return NextResponse.json(
      { error: 'missing_verification_params' },
      { status: 400 }
    );
  }

  const { data: canais, error } = await supabaseAdmin()
    .from('cb_channels')
    .select('id, verify_token')
    .eq('kind', 'instagram')
    .not('verify_token', 'is', null);
  if (error) {
    console.error(
      `${TAG} varrer conexões na verificação falhou:`,
      error.message
    );
    return NextResponse.json({ error: 'verification_failed' }, { status: 403 });
  }

  for (const c of canais ?? []) {
    try {
      if (c.verify_token && decrypt(c.verify_token) === recebido) {
        // A Meta exige o challenge de volta como TEXTO.
        return new Response(challenge, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    } catch {
      // Linha cifrada com outra chave — pula e segue.
    }
  }
  console.warn(
    `${TAG} aperto de mão recusado: verify token não é de nenhuma conexão.`
  );
  return NextResponse.json({ error: 'verify_token_mismatch' }, { status: 403 });
}

export async function POST(request: Request) {
  const corpoCru = await request.text();
  const assinatura = request.headers.get('x-hub-signature-256');

  let payload: unknown;
  try {
    payload = JSON.parse(corpoCru);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { ehInstagram, eventos } = interpretarWebhook(payload);
  if (!ehInstagram) return NextResponse.json({ ok: true, ignorado: 'object' });
  if (eventos.length === 0)
    return NextResponse.json({ ok: true, ignorado: 'sem_eventos' });

  const db = supabaseAdmin();

  // Uma rota por conta que aparece no corpo. Conta desconhecida = 200 e
  // log: pode ser um app que recebe por várias contas, uma delas ainda não
  // cadastrada aqui.
  const porConta = new Map<string, EventoDoInstagram[]>();
  for (const ev of eventos) {
    porConta.set(ev.igUserId, [...(porConta.get(ev.igUserId) ?? []), ev]);
  }
  const rotas = new Map<
    string,
    Awaited<ReturnType<typeof resolveInboundInstagramChannel>>
  >();
  for (const igUserId of porConta.keys()) {
    rotas.set(igUserId, await resolveInboundInstagramChannel(db, igUserId));
  }
  const conhecidas = [...rotas.values()].filter((r) => r !== null);
  if (conhecidas.length === 0) {
    console.warn(
      `${TAG} entrega para conta(s) sem conexão: ${[...porConta.keys()].join(', ')}`
    );
    return NextResponse.json({ ok: true, ignorado: 'conta_desconhecida' });
  }

  // O segredo é do APP: basta que UMA das conexões do corpo assine.
  const assinou = conhecidas.some((r) => {
    try {
      return assinaturaCasa(
        assinatura,
        corpoCru,
        decrypt(r.igAppSecretCifrado)
      );
    } catch {
      return false;
    }
  });
  if (!assinou) {
    console.warn(`${TAG} assinatura NÃO casa — entrega recusada.`);
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  // 200 já; o trabalho (download de mídia, perfil) fica para depois.
  after(async () => {
    for (const [igUserId, lista] of porConta) {
      const rota = rotas.get(igUserId);
      if (!rota) continue;
      const ctx = {
        accountId: rota.accountId,
        ownerUserId: rota.ownerUserId,
        channelId: rota.channelId,
      };
      const salvarMidia = (
        anexo: Parameters<typeof salvarMidiaDoInstagram>[0]['anexo'],
        mid: string
      ) =>
        salvarMidiaDoInstagram({
          storage: db.storage,
          accountId: rota.accountId,
          anexo,
          mid,
          timestampMs: null,
        });

      for (const ev of lista) {
        if (ev.tipo === 'ignorado') {
          console.log(`${TAG} ignorado: ${ev.motivo}`);
          continue;
        }
        try {
          const r = await persistirEventoDoInstagram(db, ctx, ev, salvarMidia);
          if (r.resultado !== 'gravada') continue;
          // Perfil (nome, @, foto) só quando falta — e nunca antes da mensagem
          // estar gravada: a leitura do perfil pode falhar sem custo.
          const c = r.contato;
          if (!c.wasCreated && c.instagram_username && c.avatar_url) continue;
          if (!rota.accessTokenCifrado) continue;
          await completarPerfilDoContato({
            db,
            accountId: rota.accountId,
            contactId: c.id,
            igsid:
              ev.tipo === 'mensagem' && ev.ehEco
                ? ev.destinatario
                : ev.remetente,
            token: decrypt(rota.accessTokenCifrado),
            temNome: Boolean(c.name),
          });
        } catch (err) {
          console.error(
            `${TAG} persistir falhou:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  });

  return NextResponse.json({ ok: true });
}
