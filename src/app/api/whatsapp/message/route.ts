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

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';
import { resolveEngineChannelPreferring } from '@/lib/cb-channels/engine-send';
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
  delete_requested_at: string | null;
  /**
   * Canal por onde a mensagem SAIU. Numa conta com dois números, resolver o
   * canal pela CONVERSA manda a revogação pela instância errada — e a
   * Evolution responde 2xx assim mesmo, então o CRM riscaria a bolha e nada
   * aconteceria no aparelho do cliente.
   */
  channel_id: string | null;
  /** O que o PROVEDOR disse, quando disse. Melhor que deduzir do papel. */
  from_me: boolean | null;
}

/** Sessão + PAPEL + conta + mensagem, com tudo validado. */
async function resolverAlvo(messageId: unknown) {
  // `requireRole('agent')`, não só "tem sessão".
  //
  // Estas duas rotas são DESTRUTIVAS e irreversíveis: apagam e reescrevem
  // mensagem no WhatsApp de um cliente real. Sem esta linha, um convidado
  // com papel `viewer` — estagiário, cliente olhando o histórico — via os
  // botões e conseguia apagar a comunicação do escritório.
  //
  // A RLS não cobria: `messages_select` aceita viewer (é leitura), e as
  // gravações usam service-role, que a ignora por definição. Pior, a
  // chamada irreversível à Evolution acontece ANTES de qualquer escrita —
  // então nenhuma policy do banco jamais entraria no caminho.
  //
  // O try/catch fica AQUI de propósito: os catch de DELETE/PATCH traduzem
  // qualquer throw em `502 Erro da Evolution`, o que transformaria um 403
  // de permissão numa mensagem errada com status errado.
  let ctx;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return { erro: toErrorResponse(err) };
  }
  const { supabase, userId, accountId } = ctx;

  const limite = checkRateLimit(`msgedit:${userId}`, RATE_LIMITS.react);
  if (!limite.success) return { erro: rateLimitResponse(limite) };

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
      'id, message_id, sender_type, content_text, created_at, conversation_id, remote_jid, deleted_at, delete_requested_at, channel_id, from_me',
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

  // Sem endereço da conversa não há o que revogar. A validação da Evolution
  // ACEITA `remoteJid` vazio (o schema só exige que o campo exista) e o erro
  // só aparece lá dentro, como um 500 que chega ao operador na forma
  // "Erro da Evolution: Cannot destructure property 'user' of undefined".
  // Barrar aqui troca isso por uma frase que diz o que aconteceu.
  if (!alvo.remote_jid) {
    return {
      erro: NextResponse.json(
        { error: 'Esta mensagem não guarda o endereço da conversa no WhatsApp.' },
        { status: 409 },
      ),
    };
  }

  // Canal DA MENSAGEM, não o da conversa. Uma conversa pode ter migrado de
  // número; revogar por outra instância não apaga nada e ainda responde 2xx.
  // Cai no canal da conversa quando a mensagem é anterior à 903.
  const canal = await resolveEngineChannelPreferring(
    admin(),
    accountId,
    alvo.conversation_id,
    alvo.channel_id,
  );
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

  // As duas guardas acima já provaram que estes dois campos não são nulos;
  // repeti-los aqui é o que leva essa prova para o sistema de tipos, sem
  // `!` espalhado pelas rotas.
  const pronto: AlvoPronto = {
    ...alvo,
    message_id: alvo.message_id,
    remote_jid: alvo.remote_jid,
  };

  return { alvo: pronto, cliente, accountId };
}

/**
 * Alvo já validado: passou pelas guardas de `resolverAlvo`, então os dois
 * campos sem os quais não há revogação possível são garantidamente strings.
 */
type AlvoPronto = Alvo & { message_id: string; remote_jid: string };

/** Chave Baileys da mensagem, para a Evolution localizá-la. */
function chaveBaileys(alvo: AlvoPronto) {
  return {
    id: alvo.message_id,
    remoteJid: alvo.remote_jid,
    // `from_me` é o que o PROVEDOR disse quando gravamos a mensagem — é o
    // mesmo campo que a rota de reação já usa. Deduzir de `sender_type` é
    // aproximação: bate hoje, mas erra no dia em que existir mensagem
    // gravada por um caminho que não distinga os dois. Só cai na dedução
    // quando a coluna é nula (mensagem anterior à coluna existir).
    fromMe: alvo.from_me ?? alvo.sender_type !== 'customer',
  };
}


/**
 * Reescreve a prévia da conversa quando a mensagem alterada é a ÚLTIMA.
 *
 * Sem isto a lista do inbox continua mostrando o texto antigo de uma
 * mensagem editada, ou o conteúdo de uma que foi apagada — e a lista é
 * justamente onde o operador decide qual conversa abrir.
 */
async function atualizarPrevia(conversationId: string) {
  const db = admin();
  const { data: ultima } = await db
    .from('messages')
    .select('content_text, content_type, deleted_at, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ultima) return;
  const previa = ultima.deleted_at
    ? '[mensagem apagada]'
    : ultima.content_text || `[${ultima.content_type}]`;
  await db
    .from('conversations')
    .update({ last_message_text: previa, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
}

const minutosDesde = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60_000;

/** DELETE — apagar para todos. */
export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const r = await resolverAlvo(body?.message_id);
    if ('erro' in r) return r.erro;
    const { alvo, cliente } = r;

    if (alvo.deleted_at || alvo.delete_requested_at) {
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

    const resposta = await cliente.deleteMessageForEveryone(chaveBaileys(alvo));

    // A Evolution devolve a revogação que MONTOU. Se ela aponta para outro
    // id, mandamos apagar a mensagem errada — isso é falha, não sucesso, e
    // precisa parar aqui antes de qualquer marca no banco.
    const alvoDaRevogacao = resposta?.message?.protocolMessage?.key?.id;
    if (alvoDaRevogacao && alvoDaRevogacao !== alvo.message_id) {
      console.error(
        '[whatsapp/message] revogação apontou para outra mensagem:',
        alvoDaRevogacao,
        '≠',
        alvo.message_id,
      );
      return NextResponse.json(
        { error: 'O WhatsApp respondeu sobre outra mensagem. Nada foi apagado.' },
        { status: 502 },
      );
    }

    // ⚠️ AQUI SE REGISTRA UM PEDIDO, NÃO UM FATO.
    //
    // A Evolution responde 2xx assim que escreve a revogação no socket, e o
    // WhatsApp não emite confirmação de revogação. A única confirmação que
    // existe é o webhook `messages.delete` voltar — e é ELE quem preenche
    // `deleted_at`. Enquanto não voltar, tudo o que o CRM pode afirmar com
    // honestidade é "pedimos".
    //
    // A versão anterior gravava `deleted_at` aqui, com um comentário
    // dizendo que só marcava depois da confirmação. Não havia confirmação
    // nenhuma: mensagens apareciam "Apagada" no CRM e seguiam íntegras no
    // celular do cliente. Num escritório, essa é a afirmação mais cara que
    // o sistema pode fazer errado.
    const { error } = await admin()
      .from('messages')
      .update({ delete_requested_at: new Date().toISOString(), deleted_by: 'agent' })
      .eq('id', alvo.id);
    if (error) {
      console.error('[whatsapp/message] registrar pedido de exclusão falhou:', error.message);
      // `whatsapp_done`: o pedido JÁ SAIU para o WhatsApp; só a gravação
      // local falhou. A UI usa este código para não desfazer a marca —
      // desfazer faria a tela afirmar que nada foi pedido.
      return NextResponse.json(
        {
          error: 'Pedido enviado ao WhatsApp, mas o CRM não registrou. Recarregue.',
          code: 'whatsapp_done',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, confirmado: false });
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
    const r = await resolverAlvo(body?.message_id);
    if ('erro' in r) return r.erro;
    const { alvo, cliente } = r;

    const texto = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!texto) {
      return NextResponse.json({ error: 'O texto não pode ficar vazio.' }, { status: 400 });
    }
    // Também barra a que só foi PEDIDA para apagar: editar depois disso
    // deixaria o CRM com um pedido de exclusão e um texto novo ao mesmo
    // tempo, sem ordem definida entre os dois no aparelho do cliente.
    if (alvo.deleted_at || alvo.delete_requested_at) {
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

    const numero = alvo.remote_jid.split('@')[0];
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
        {
          error: 'Editada no WhatsApp, mas o CRM não registrou. Recarregue.',
          code: 'whatsapp_done',
        },
        { status: 500 },
      );
    }

    await atualizarPrevia(alvo.conversation_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[whatsapp/message] PATCH falhou:', msg);
    return NextResponse.json({ error: `Erro da Evolution: ${msg}` }, { status: 502 });
  }
}
