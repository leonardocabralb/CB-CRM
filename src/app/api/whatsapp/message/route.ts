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
import { EvolutionApiError, EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';
import { resolveEngineChannelPreferring } from '@/lib/cb-channels/engine-send';
import { atualizarPreviaDaConversa } from '@/lib/inbox/conversation-preview';
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
  /**
   * Endereço `@lid` da conversa, quando ela migrou. É por ELE que se revoga
   * e se edita — ver `chaveBaileys` e a migration 917.
   */
  remote_jid_lid: string | null;
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
      'id, message_id, sender_type, content_text, created_at, conversation_id, remote_jid, remote_jid_lid, deleted_at, delete_requested_at, channel_id, from_me',
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
    // ⚠️ O `@lid` VEM PRIMEIRO, e a ordem é o conserto.
    //
    // `remote_jid` é o endereço por onde RECONHECEMOS a conversa (a Evolution
    // o reescreve de `@lid` para telefone, e é isso que faz a mensagem
    // aparecer no CRM). Mas no WhatsApp a conversa migrada continua
    // endereçada por `@lid` — e revogar é procurar a mensagem NAQUELE
    // endereço.
    //
    // Medido em produção em 28/07/2026: apagar pelo CRM uma mensagem enviada
    // pelo CELULAR não fazia nada, porque a revogação ia para a conversa
    // "telefone" e a mensagem vive na "@lid". Mensagem enviada pelo CRM
    // apagava normalmente — essa vive na conversa "telefone" dos dois lados.
    // Ver migration 917.
    remoteJid: alvo.remote_jid_lid ?? alvo.remote_jid,
    // `from_me` é o que o PROVEDOR disse quando gravamos a mensagem — é o
    // mesmo campo que a rota de reação já usa. Deduzir de `sender_type` é
    // aproximação: bate hoje, mas erra no dia em que existir mensagem
    // gravada por um caminho que não distinga os dois. Só cai na dedução
    // quando a coluna é nula (mensagem anterior à coluna existir).
    fromMe: alvo.from_me ?? alvo.sender_type !== 'customer',
  };
}


const minutosDesde = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60_000;

/** DELETE — apagar para todos. */
export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const r = await resolverAlvo(body?.message_id);
    if ('erro' in r) return r.erro;
    const { alvo, cliente } = r;

    // Só a exclusão CONFIRMADA encerra o assunto. Um pedido sem confirmação
    // pode ser repetido de propósito: a revogação da Evolution falha em
    // silêncio com frequência conhecida, e sem uma segunda tentativa o
    // operador ficaria sem saída dentro do prazo do WhatsApp. Revogar duas
    // vezes a mesma mensagem é inócuo.
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

    // ⚠️ REGISTRA O PEDIDO **ANTES** DE CHAMAR A EVOLUTION.
    //
    // Abortar do nosso lado não cancela nada do outro: se o teto de tempo
    // estourar depois de a revogação já ter saído, a mensagem pode ter sido
    // revogada de verdade e o CRM não teria rastro nenhum — nem para o
    // operador, nem para o webhook casar quando a confirmação chegasse.
    // (É a mesma assimetria que obrigou o teto folgado no envio de mídia.)
    //
    // Gravar antes troca "posso perder o registro de algo que aconteceu" por
    // "posso registrar um pedido que a Evolution recusou". O segundo é
    // reversível e está tratado logo abaixo; o primeiro, não.
    //
    // E o que se grava é um PEDIDO, não um fato: a Evolution responde 2xx ao
    // escrever a revogação no socket, e o WhatsApp não emite confirmação de
    // revogação. Só o webhook `messages.delete` preenche `deleted_at`.
    const marcadoEm = new Date().toISOString();
    const { error } = await admin()
      .from('messages')
      .update({ delete_requested_at: marcadoEm, deleted_by: 'agent' })
      .eq('id', alvo.id);
    if (error) {
      console.error('[whatsapp/message] registrar pedido de exclusão falhou:', error.message);
      return NextResponse.json(
        { error: 'O CRM não conseguiu registrar o pedido. Nada foi enviado.' },
        { status: 500 },
      );
    }

    /** Desfaz a marca quando fica provado que nada saiu. */
    const desfazerMarca = async () => {
      const { error: erroVolta } = await admin()
        .from('messages')
        .update({ delete_requested_at: null, deleted_by: null })
        .eq('id', alvo.id)
        .eq('delete_requested_at', marcadoEm);
      if (erroVolta) {
        console.error('[whatsapp/message] desfazer pedido falhou:', erroVolta.message);
      }
    };

    let resposta;
    try {
      resposta = await cliente.deleteMessageForEveryone(chaveBaileys(alvo));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      // Recusa da Evolution (4xx) = validação dela; a revogação NÃO saiu,
      // então a marca some e o operador vê a bolha intacta.
      if (err instanceof EvolutionApiError && err.status >= 400 && err.status < 500) {
        await desfazerMarca();
        console.error('[whatsapp/message] Evolution recusou a revogação:', msg);
        return NextResponse.json({ error: `Erro da Evolution: ${msg}` }, { status: 400 });
      }
      // Timeout (504) ou erro do servidor dela (5xx): NÃO sabemos se a
      // revogação saiu. A marca FICA — "solicitada" é verdade nos dois
      // desfechos, e apagar o rastro de algo que pode ter acontecido é o
      // único erro irrecuperável aqui. `talvez_enviado` avisa a interface a
      // não desfazer a marca.
      console.error('[whatsapp/message] revogação sem confirmação:', msg);
      return NextResponse.json(
        {
          error: 'Não deu para confirmar com o WhatsApp. O pedido pode ter saído — confira a conversa.',
          code: 'talvez_enviado',
        },
        { status: 502 },
      );
    }

    // A Evolution devolve a revogação que MONTOU. Se ela aponta para outro
    // id, mandamos apagar a mensagem errada — isso é falha, não sucesso.
    const alvoDaRevogacao = resposta?.message?.protocolMessage?.key?.id;
    if (alvoDaRevogacao && alvoDaRevogacao !== alvo.message_id) {
      console.error(
        '[whatsapp/message] revogação apontou para outra mensagem:',
        alvoDaRevogacao,
        '≠',
        alvo.message_id,
      );
      // A marca fica: uma revogação saiu, ainda que para o alvo errado.
      return NextResponse.json(
        { error: 'O WhatsApp respondeu sobre outra mensagem. Confira a conversa.' },
        { status: 502 },
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

    await atualizarPreviaDaConversa(admin(), alvo.conversation_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[whatsapp/message] PATCH falhou:', msg);
    return NextResponse.json({ error: `Erro da Evolution: ${msg}` }, { status: 502 });
  }
}
