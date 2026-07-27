// ============================================================
// Apagar e editar uma mensagem já enviada.
//
// Só existe para canal EVOLUTION. A API oficial da Meta não expõe nem
// exclusão nem edição de mensagem enviada — por isso a interface esconde as
// duas ações em canal Meta, e esta rota rejeita explicitamente em vez de
// falhar de um jeito confuso lá na frente.
//
// A marca no banco é de EXIBIÇÃO: o conteúdo permanece em `content_text` e
// a bolha o mostra riscado. É divergência deliberada do WhatsApp, decidida
// pelo operador — o escritório precisa do registro do que foi dito.
// ============================================================

import { NextResponse } from 'next/server';

import { createClient as createServiceClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/whatsapp/encryption';
import { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';
import { resolveEngineChannel } from '@/lib/cb-channels/engine-send';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * Prazos do WHATSAPP, não nossos. Passado o limite, a Evolution recusa.
 * Repetidos aqui para a rota falhar com uma mensagem que explica o motivo,
 * em vez de repassar um erro cru da Evolution.
 */
const MINUTOS_PARA_EDITAR = 15;
const HORAS_PARA_APAGAR = 48;

/** Service-role: escrita e leitura de canal, depois de a RLS já ter
 *  autorizado o acesso à mensagem pelo client da sessão. */
function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface Alvo {
  id: string;
  message_id: string | null;
  sender_type: string;
  content_text: string | null;
  created_at: string;
  conversation_id: string;
  remote_jid: string | null;
  deleted_at: string | null;
}

/** Sessão + conta + mensagem, com tudo validado. */
async function resolverAlvo(request: Request, messageId: unknown) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { erro: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const limite = checkRateLimit(`msgedit:${user.id}`, RATE_LIMITS.react);
  if (!limite.success) return { erro: rateLimitResponse(limite) };

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const accountId = profile?.account_id as string | undefined;
  if (!accountId) {
    return {
      erro: NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      ),
    };
  }

  if (typeof messageId !== 'string' || !messageId) {
    return { erro: NextResponse.json({ error: 'message_id is required' }, { status: 400 }) };
  }

  // A leitura passa pelo client da SESSÃO de propósito: a RLS garante que o
  // operador só alcança mensagem da própria conta. Trocar por service-role
  // aqui abriria a porta para apagar mensagem de outro escritório mandando
  // um uuid adivinhado.
  const { data: msg } = await supabase
    .from('messages')
    .select(
      'id, message_id, sender_type, content_text, created_at, conversation_id, remote_jid, deleted_at',
    )
    .eq('id', messageId)
    .maybeSingle();

  if (!msg) {
    return { erro: NextResponse.json({ error: 'Message not found' }, { status: 404 }) };
  }

  const alvo = msg as Alvo;
  if (!alvo.message_id) {
    return {
      erro: NextResponse.json(
        { error: 'Esta mensagem não tem identificador no WhatsApp.' },
        { status: 409 },
      ),
    };
  }

  const canal = await resolveEngineChannel(admin(), accountId, alvo.conversation_id);
  if (!canal) {
    return { erro: NextResponse.json({ error: 'Canal não encontrado.' }, { status: 409 }) };
  }
  if (canal.provider !== 'evolution') {
    return {
      erro: NextResponse.json(
        {
          error:
            'A API oficial do WhatsApp não permite apagar nem editar mensagem enviada.',
          code: 'not_supported',
        },
        { status: 400 },
      ),
    };
  }
  if (!canal.base_url || !canal.instance_name || !canal.api_key) {
    return {
      erro: NextResponse.json(
        { error: 'Conexão da Evolution incompleta — reconecte em Configurações.' },
        { status: 409 },
      ),
    };
  }

  const cliente = new EvolutionClient({
    baseUrl: canal.base_url,
    instance: canal.instance_name,
    apikey: decrypt(canal.api_key),
  });

  return { alvo, cliente, accountId };
}

/** Chave Baileys da mensagem, para a Evolution localizá-la. */
function chaveBaileys(alvo: Alvo) {
  return {
    id: alvo.message_id!,
    remoteJid: alvo.remote_jid ?? '',
    // Só mensagem NOSSA pode ser apagada para todos ou editada. O
    // `sender_type` é a fonte da verdade: 'customer' nunca chega aqui.
    fromMe: alvo.sender_type !== 'customer',
  };
}

const minutosDesde = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60_000;

/** DELETE — apagar para todos. */
export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const r = await resolverAlvo(request, body?.message_id);
    if ('erro' in r) return r.erro;
    const { alvo, cliente } = r;

    if (alvo.deleted_at) {
      return NextResponse.json({ ok: true, already: true });
    }
    if (alvo.sender_type === 'customer') {
      return NextResponse.json(
        { error: 'Só dá para apagar para todos uma mensagem enviada por você.' },
        { status: 400 },
      );
    }
    if (minutosDesde(alvo.created_at) > HORAS_PARA_APAGAR * 60) {
      return NextResponse.json(
        {
          error: `O WhatsApp só permite apagar para todos até ${HORAS_PARA_APAGAR}h após o envio.`,
          code: 'too_old',
        },
        { status: 400 },
      );
    }

    await cliente.deleteMessageForEveryone(chaveBaileys(alvo));

    // Só marca DEPOIS de a Evolution confirmar. Marcando antes, uma falha
    // deixaria o CRM dizendo "apagada" com a mensagem viva no celular do
    // cliente — a mentira mais cara possível aqui.
    const { error } = await admin()
      .from('messages')
      .update({ deleted_at: new Date().toISOString(), deleted_by: 'agent' })
      .eq('id', alvo.id);
    if (error) {
      console.error('[whatsapp/message] marcar exclusão falhou:', error.message);
      return NextResponse.json(
        { error: 'Apagada no WhatsApp, mas o CRM não registrou. Recarregue.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[whatsapp/message] DELETE falhou:', msg);
    return NextResponse.json({ error: `Erro da Evolution: ${msg}` }, { status: 502 });
  }
}

/** PATCH — editar o texto. */
export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const r = await resolverAlvo(request, body?.message_id);
    if ('erro' in r) return r.erro;
    const { alvo, cliente } = r;

    const texto = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!texto) {
      return NextResponse.json({ error: 'O texto não pode ficar vazio.' }, { status: 400 });
    }
    if (alvo.deleted_at) {
      return NextResponse.json(
        { error: 'Não dá para editar uma mensagem apagada.' },
        { status: 400 },
      );
    }
    if (alvo.sender_type === 'customer') {
      return NextResponse.json(
        { error: 'Só dá para editar uma mensagem enviada por você.' },
        { status: 400 },
      );
    }
    if (minutosDesde(alvo.created_at) > MINUTOS_PARA_EDITAR) {
      return NextResponse.json(
        {
          error: `O WhatsApp só permite editar até ${MINUTOS_PARA_EDITAR} minutos após o envio.`,
          code: 'too_old',
        },
        { status: 400 },
      );
    }

    const numero = (alvo.remote_jid ?? '').split('@')[0];
    await cliente.updateMessage({ number: numero, key: chaveBaileys(alvo), text: texto });

    const { error } = await admin()
      .from('messages')
      .update({
        content_text: texto,
        text_before_edit: alvo.content_text,
        edited_at: new Date().toISOString(),
      })
      .eq('id', alvo.id);
    if (error) {
      console.error('[whatsapp/message] aplicar edição falhou:', error.message);
      return NextResponse.json(
        { error: 'Editada no WhatsApp, mas o CRM não registrou. Recarregue.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[whatsapp/message] PATCH falhou:', msg);
    return NextResponse.json({ error: `Erro da Evolution: ${msg}` }, { status: 502 });
  }
}
