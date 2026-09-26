// ============================================================
// Ligação de WhatsApp → bolha no fio da conversa (1044).
//
// Cada aviso do evento CALL da Evolution chega num POST próprio. Este módulo
// (1) grava o aviso na linha da ligação em `cb_ligacoes` e (2) depois de uma
// pausa, tenta DECIDIR o desfecho. Quem decide primeiro reivindica a linha e
// grava UMA mensagem `content_type = 'call'` na conversa do cliente:
//
//   perdida  → `sender_type = 'customer'`: conta como contato do cliente. Soma
//              não lida, sobe a conversa, reabre a encerrada e, pelo gatilho
//              da 972, acende o selo "em atraso" até alguém responder.
//   atendida → `sender_type = 'agent'` + `from_device`: alguém do escritório
//              falou com o cliente pelo celular. Não soma não lida, e o
//              gatilho da 972 apaga o "em atraso" (é resposta de gente).
//
// A bolha entra na hora REAL em que a ligação acabou (ou foi atendida). Se já
// houver mensagem depois dela na conversa — a perdida é decidida só depois da
// folga, e a ligação atendida logo em seguida já entrou —, ela é HISTÓRIA:
// entra no lugar certo do fio e só assenta a espera e a não lida
// (`cb_assentar_mensagem_historica`, a mesma da 1010).
//
// Nas duas: a ficha, a conversa e o card no funil nascem se o número nunca
// escreveu (decisão do operador, 25/09/2026), e a conversa segue o número que
// recebeu a ligação. ⚠️ As esperas "parar se o cliente responder" NÃO param:
// só mensagem escrita é resposta (decisão do operador, 26/09/2026), e a
// retomada (`clienteRespondeuDesde`) também ignora a ligação.
//
// ⚠️ O que NÃO roda, de propósito, e há teste estrutural cobrando
// (`ligacoes.chamadores.test.ts`): robô, automações, IA, o cancelamento das
// esperas e o webhook de saída `message.received`. A ligação não tem texto a responder, e um robô que
// respondesse "não entendi" a uma chamada é o pior dos mundos.
//
// ⚠️ Grupo fica de fora (chamada de grupo não é de um cliente), e a ligação
// feita por um número do PRÓPRIO escritório também (a conexão ligando para
// outra, ou o aparelho da conexão aparecendo como quem ligou).
//
// NUNCA lança: roda no `after()` do webhook, e a Evolution já recebeu 200.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolverDestinatario } from '@/lib/automations/destinatario';
import { routeContactToPipeline } from '@/lib/cb-channels/pipeline-routing';
import { followConversationChannel, gravarComCanal } from '@/lib/cb-channels/stamp';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { telefoneCanonico } from '@/lib/contacts/telefone';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { consultarTelefoneDoLid } from '@/lib/whatsapp/sem-telefone/resolver-lid';

import {
  FOLGA_DO_DESFECHO_MS,
  desfechoDaLigacao,
  segundosTocando,
  type DesfechoDaLigacao,
} from './desfecho';
import type { EventoDeLigacao } from './evento';
import { PREVIA_DA_LIGACAO } from './previa';
import { ehLid, lidSemAparelho, telefoneDoCallerPn, telefoneDoJid } from './telefone';

/**
 * Depois do `accept`, espera só o `offer` gravar (os dois podem correr juntos).
 * Depois do fim e do `offer`, a folga inteira: o `accept` do mesmo segundo pode
 * estar noutro POST, e o fim que chegou antes do `offer` não sabia quem ligou.
 */
const ESPERA_DEPOIS_DO_ATENDIMENTO_MS = 2_000;
const ESPERA_DEPOIS_DO_FIM_MS = FOLGA_DO_DESFECHO_MS + 1_000;

const COLUNAS =
  'id, channel_id, call_id, quem_ligou, telefone_informado, video, oferta_em, atendida_em, encerrada_em, encerramento, encerramento_gravado_em, desfecho';

interface LinhaDaLigacao {
  id: string;
  channel_id: string | null;
  call_id: string;
  quem_ligou: string | null;
  telefone_informado: string | null;
  video: boolean;
  oferta_em: string | null;
  atendida_em: string | null;
  encerrada_em: string | null;
  encerramento: string | null;
  encerramento_gravado_em: string | null;
  desfecho: string | null;
}

export interface RotaDaLigacao {
  accountId: string;
  /** A conexão que recebeu a ligação; nula no legado `whatsapp_config`. */
  channelId: string | null;
  /** O LID do próprio aparelho da conexão (916), quando já foi aprendido. */
  ownLid: string | null;
}

export interface RegistroDeLigacao {
  db: SupabaseClient;
  rota: RotaDaLigacao;
  evento: EventoDeLigacao;
  /** Injetáveis nos testes. */
  esperar?: (ms: number) => Promise<void>;
  agora?: () => number;
}

const pausa = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

function mensagemDe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

export async function registrarEventoDeLigacao(args: RegistroDeLigacao): Promise<void> {
  const { db, rota, evento } = args;
  const esperar = args.esperar ?? pausa;
  const agora = args.agora ?? Date.now;
  try {
    if (evento.grupo) return;
    if (!(await gravarAviso(db, rota, evento, agora))) return;
    await esperar(
      evento.situacao === 'accept' ? ESPERA_DEPOIS_DO_ATENDIMENTO_MS : ESPERA_DEPOIS_DO_FIM_MS,
    );
    await decidir(db, rota, evento.callId, agora);
  } catch (err) {
    console.error('[ligacoes] aviso de ligação falhou:', evento.callId, mensagemDe(err));
  }
}

/**
 * A linha da ligação e o que ESTE aviso sabe. Cada situação escreve só as
 * suas colunas, e só se ainda estiverem vazias: avisos repetidos (a Evolution
 * reentrega) e fora de ordem não se atropelam.
 */
async function gravarAviso(
  db: SupabaseClient,
  rota: RotaDaLigacao,
  evento: EventoDeLigacao,
  agora: () => number,
): Promise<boolean> {
  // A conexão pode ter sido apagada no meio (FK composta): grava sem ela.
  const { resultado: base } = await gravarComCanal(rota.channelId, (canal) =>
    db
      .from('cb_ligacoes')
      .upsert(
        { account_id: rota.accountId, channel_id: canal, call_id: evento.callId },
        { onConflict: 'account_id,call_id', ignoreDuplicates: true },
      ),
  );
  if (base.error) {
    console.error('[ligacoes] gravar a ligação falhou:', evento.callId, base.error.message);
    return false;
  }

  const em = new Date(evento.em).toISOString();
  let patch: Record<string, unknown>;
  let vazia: string;
  switch (evento.situacao) {
    case 'offer':
      patch = {
        quem_ligou: evento.de,
        telefone_informado: evento.telefoneInformado,
        video: evento.video,
        oferta_em: em,
      };
      vazia = 'oferta_em';
      break;
    case 'accept':
      patch = { atendida_em: em };
      vazia = 'atendida_em';
      break;
    default:
      patch = {
        encerrada_em: em,
        encerramento: evento.situacao,
        encerramento_gravado_em: new Date(agora()).toISOString(),
      };
      vazia = 'encerrada_em';
  }

  const { error } = await db
    .from('cb_ligacoes')
    .update(patch)
    .eq('account_id', rota.accountId)
    .eq('call_id', evento.callId)
    .is(vazia, null);
  if (error) {
    console.error('[ligacoes] gravar o aviso falhou:', evento.callId, evento.situacao, error.message);
    return false;
  }
  return true;
}

async function decidir(
  db: SupabaseClient,
  rota: RotaDaLigacao,
  callId: string,
  agora: () => number,
): Promise<void> {
  const { data, error } = await db
    .from('cb_ligacoes')
    .select(COLUNAS)
    .eq('account_id', rota.accountId)
    .eq('call_id', callId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('[ligacoes] ler a ligação falhou:', callId, error.message);
    return;
  }
  const linha = data as LinhaDaLigacao;
  if (linha.desfecho) return;

  const desfecho = desfechoDaLigacao(linha, agora());
  if (!desfecho) return;
  // Sem o `offer` não se sabe quem ligou. Se ele ainda chegar, a espera DELE
  // decide; se nunca chegar, não há de quem falar.
  const quemLigou = lidSemAparelho(linha.quem_ligou);
  if (!quemLigou) return;

  if (rota.ownLid && lidSemAparelho(rota.ownLid) === quemLigou) {
    await fechar(db, linha.id, 'do_escritorio', null, 'o aparelho da própria conexão');
    return;
  }

  const quem = await telefoneDeQuemLigou(db, rota.accountId, quemLigou, linha.telefone_informado);
  if (quem === 'falhou') {
    // Um soluço do banco NÃO é "o CRM não conhece este número": a ligação de
    // um cliente conhecido ficaria registrada como de ninguém.
    await fechar(db, linha.id, 'falhou', null, 'a consulta ao acervo LID → telefone falhou');
    return;
  }
  if (!quem) {
    await fechar(
      db,
      linha.id,
      'sem_telefone',
      null,
      ehLid(quemLigou)
        ? 'LID sem telefone no acervo e sem callerPn válido'
        : 'endereço de quem ligou não é de telefone',
    );
    return;
  }
  if (await ehNumeroDaConta(db, rota.accountId, quem.telefone)) {
    await fechar(db, linha.id, 'do_escritorio', quem.telefone, 'número de uma conexão da conta');
    return;
  }

  // A reivindicação: só UM dos avisos grava a bolha. O UPDATE condicional é a
  // pergunta "alguém já decidiu?", atômica na linha.
  const { data: minha, error: erroDaPosse } = await db
    .from('cb_ligacoes')
    .update({
      desfecho,
      desfecho_em: new Date(agora()).toISOString(),
      telefone: quem.telefone,
      detalhe: `telefone pelo ${quem.fonte}`,
    })
    .eq('id', linha.id)
    .is('desfecho', null)
    .select('id');
  if (erroDaPosse) {
    console.error('[ligacoes] reivindicar a ligação falhou:', callId, erroDaPosse.message);
    return;
  }
  if (!minha || minha.length === 0) return;

  await gravarNoFio(db, rota, linha, desfecho, quem.telefone, agora);
}

type FonteDoTelefone = 'jid' | 'acervo' | 'whatsapp';

/**
 * As três fontes, na ordem de confiança — ver `telefone.ts`. `'falhou'` quando
 * o acervo não respondeu e o `callerPn` não serve: não dá para afirmar "sem
 * telefone".
 */
async function telefoneDeQuemLigou(
  db: SupabaseClient,
  accountId: string,
  quemLigou: string,
  telefoneInformado: string | null,
): Promise<{ telefone: string; fonte: FonteDoTelefone } | null | 'falhou'> {
  const doJid = telefoneDoJid(quemLigou);
  if (doJid) return { telefone: doJid, fonte: 'jid' };

  let acervoFalhou = false;
  if (ehLid(quemLigou)) {
    const achado = await consultarTelefoneDoLid(db, accountId, quemLigou);
    if (achado === 'falhou') {
      acervoFalhou = true;
    } else {
      const doAcervo = telefoneDoJid(achado?.telefoneJid);
      if (doAcervo) return { telefone: doAcervo, fonte: 'acervo' };
    }
  }

  const informado = telefoneDoCallerPn(telefoneInformado);
  if (informado) return { telefone: informado, fonte: 'whatsapp' };
  return acervoFalhou ? 'falhou' : null;
}

/**
 * O número é de uma conexão desta conta? Consulta que falha responde "não":
 * o pior caso é uma conversa com o próprio número, que se apaga à mão — o
 * contrário esconderia a ligação de um cliente.
 */
async function ehNumeroDaConta(
  db: SupabaseClient,
  accountId: string,
  telefone: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('cb_channels')
    .select('display_phone')
    .eq('account_id', accountId);
  if (error) {
    console.error('[ligacoes] conferir os números da conta falhou:', error.message);
    return false;
  }
  const alvo = telefoneCanonico(telefone);
  return (data ?? []).some(
    (c: { display_phone: string | null }) =>
      !!c.display_phone && telefoneCanonico(c.display_phone) === alvo,
  );
}

/** Desfecho sem bolha. Só escreve se ninguém decidiu antes. */
async function fechar(
  db: SupabaseClient,
  id: string,
  desfecho: 'sem_telefone' | 'do_escritorio' | 'falhou',
  telefone: string | null,
  detalhe: string,
): Promise<void> {
  const { error } = await db
    .from('cb_ligacoes')
    .update({
      desfecho,
      desfecho_em: new Date().toISOString(),
      ...(telefone ? { telefone } : {}),
      detalhe,
    })
    .eq('id', id)
    .is('desfecho', null);
  if (error) console.error('[ligacoes] registrar o desfecho falhou:', id, error.message);
}

/** Depois da reivindicação, o desfecho vira "falhou" com o motivo. */
async function falhou(db: SupabaseClient, id: string, detalhe: string): Promise<void> {
  const { error } = await db
    .from('cb_ligacoes')
    .update({ desfecho: 'falhou', detalhe })
    .eq('id', id);
  if (error) console.error('[ligacoes] registrar a falha falhou:', id, error.message);
}

async function gravarNoFio(
  db: SupabaseClient,
  rota: RotaDaLigacao,
  linha: LinhaDaLigacao,
  desfecho: DesfechoDaLigacao,
  telefone: string,
  agora: () => number,
): Promise<void> {
  // A ficha e a conversa, criadas se o número nunca escreveu — com o dono
  // DURÁVEL da conta, pelo mesmo helper do aviso do Calendly. Lança em falha.
  let destino: Awaited<ReturnType<typeof resolverDestinatario>>;
  try {
    destino = await resolverDestinatario(db, rota.accountId, telefone);
  } catch (err) {
    await falhou(db, linha.id, `ficha ou conversa: ${mensagemDe(err)}`);
    return;
  }

  const perdida = desfecho === 'perdida';
  const fim = perdida ? linha.encerrada_em : linha.atendida_em;
  const agoraIso = new Date(agora()).toISOString();

  // ⚠️⚠️ `created_at` é a hora em que a ligação TERMINOU (perdida) ou foi
  // ATENDIDA, pelo relógio do WhatsApp — o mesmo das mensagens —, nunca a hora
  // da decisão. A perdida só é decidida depois da folga (~11 s) e a atendida
  // em ~2 s: medido no teste real de 26/09/2026, a recusada às 10:21:54 foi
  // gravada DEPOIS da atendida das 10:22:03, e o fio mostrava a ordem trocada,
  // com o "em atraso" aceso sobre um cliente cuja ligação seguinte foi
  // atendida. Com a hora real, a bolha pode entrar ANTES de uma mensagem já
  // gravada — e aí ela é HISTÓRIA (ver abaixo).
  const carimbo = fim && Number.isFinite(Date.parse(fim)) ? new Date(fim).toISOString() : agoraIso;
  // As duas perguntas vêm ANTES do insert, para a reabertura continuar colada
  // nele (`reopen.ts`). A espera de antes é o que `cb_assentar_mensagem_historica`
  // precisa para desfazer o que o gatilho da 972 decidir pela ordem de inserção.
  const [esperaDeAntes, historica] = await Promise.all([
    esperaAntes(db, destino.conversationId),
    haMensagemDepois(db, destino.conversationId, carimbo),
  ]);

  const { resultado, canal } = await gravarComCanal(rota.channelId, (canal) =>
    db
      .from('messages')
      .insert({
        conversation_id: destino.conversationId,
        sender_type: perdida ? 'customer' : 'agent',
        content_type: 'call',
        content_text: null,
        message_id: `call:${linha.call_id}`,
        from_me: !perdida,
        from_device: !perdida,
        status: perdida ? 'delivered' : 'sent',
        channel_id: canal,
        created_at: carimbo,
        ligacao: {
          desfecho,
          video: linha.video === true,
          inicio: linha.oferta_em,
          fim,
          tocou_seg: segundosTocando(linha.oferta_em, fim),
          encerramento: linha.encerramento,
        },
      })
      .select('id')
      .single(),
  );
  const { data: mensagem, error } = resultado;
  if (error || !mensagem) {
    // 23505 = a bolha desta ligação já está nesta conversa.
    if (!isUniqueViolation(error)) {
      await falhou(db, linha.id, `bolha: ${error?.message ?? 'sem retorno'}`);
    }
    return;
  }

  // Não é atômico, e a pergunta se repete DEPOIS do insert (Codex, PR #304):
  // uma resposta gravada entre a primeira pergunta e o insert faria a bolha
  // subir a conversa e somar a não lida sobre um cliente já atendido. A
  // reabertura fica colada no insert (`reopen.ts`); reabrir por uma ligação que
  // afinal não é a última é inofensivo — ela é contato real do cliente, e toda
  // mensagem de gente também reabre. Sobra a janela entre a 2ª pergunta e a
  // escrita na conversa: uma ida ao banco, a mesma que a 1010 aceitou.
  let ehHistorica = historica;
  if (!historica) {
    // LOGO DEPOIS de gravar (ver `reopen.ts`): a janela entre gravar e reabrir é
    // onde um encerramento posterior seria atropelado. Sem responsável, como a
    // mensagem do cliente e a do celular pareado.
    await reopenClosedConversation(db, { id: destino.conversationId });
    ehHistorica = await haMensagemDepois(db, destino.conversationId, carimbo, mensagem.id as string);
  }

  if (ehHistorica) {
    // Já há mensagem DEPOIS da ligação (a atendida que veio logo em seguida,
    // uma resposta): ela é história, como a mensagem recuperada da 1010. Não
    // reabre quando já se sabia antes do insert (quem decidiu a situação da
    // conversa sabia de mais coisa), não mexe na prévia nem na posição da
    // lista (a última é outra) e não segue o canal (o da conversa é o da
    // mensagem mais recente). O que ela faz é assentar a conversa: a espera e
    // a não lida pela hora REAL da ligação.
    const contaNaoLida =
      perdida && !(await genteRespondeuDepois(db, destino.conversationId, carimbo));
    const { error: erroAoAssentar } = await db.rpc('cb_assentar_mensagem_historica', {
      p_conversation_id: destino.conversationId,
      p_carimbo: carimbo,
      p_da_equipe: !perdida,
      p_espera_antes: esperaDeAntes ?? null,
      p_conta_nao_lida: contaNaoLida,
    });
    if (erroAoAssentar) console.error('[ligacoes] assentar a conversa falhou:', erroAoAssentar.message);
  } else {
    if (perdida) {
      // Não lida atômica, prévia e posição na lista numa escrita só.
      const { error: erroDoBump } = await db.rpc('bump_conversation_on_inbound', {
        p_conversation_id: destino.conversationId,
        p_last_message_text: PREVIA_DA_LIGACAO,
      });
      if (erroDoBump) console.error('[ligacoes] subir a conversa falhou:', erroDoBump.message);
    } else {
      const { error: erroDaPrevia } = await db
        .from('conversations')
        .update({
          last_message_text: PREVIA_DA_LIGACAO,
          last_message_at: agoraIso,
          updated_at: agoraIso,
        })
        .eq('id', destino.conversationId);
      if (erroDaPrevia) console.error('[ligacoes] subir a conversa falhou:', erroDaPrevia.message);
    }

    // A conversa segue o número que o cliente escolheu para ligar (nada faz se
    // o atendente fixou o canal).
    await followConversationChannel(db, destino.conversationId, canal);
  }

  // O card no funil padrão da conexão, se o contato ainda não tem (decisão do
  // operador: ligação de número novo também vira card). Nunca lança.
  const { data: contato } = await db
    .from('contacts')
    .select('name')
    .eq('id', destino.contactId)
    .maybeSingle();
  await routeContactToPipeline({
    db,
    accountId: rota.accountId,
    channelId: canal,
    contactId: destino.contactId,
    contactName: (contato?.name as string | null | undefined) ?? telefone,
    conversationId: destino.conversationId,
  });

  const { error: erroDoVinculo } = await db
    .from('cb_ligacoes')
    .update({ conversation_id: destino.conversationId, message_id: mensagem.id })
    .eq('id', linha.id);
  if (erroDoVinculo) console.error('[ligacoes] ligar a bolha à ligação falhou:', erroDoVinculo.message);
}

/**
 * `aguardando_desde` ANTES do insert — o que o gatilho da 972 pode apagar ao
 * gravar a atendida. `undefined` = não consegui ler (a função então não
 * devolve espera nenhuma: o comportamento de qualquer eco atrasado).
 */
async function esperaAntes(
  db: SupabaseClient,
  conversationId: string,
): Promise<string | null | undefined> {
  const { data, error } = await db
    .from('conversations')
    .select('aguardando_desde')
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !data) return undefined;
  return (data.aguardando_desde as string | null | undefined) ?? null;
}

/**
 * Já há mensagem na conversa DEPOIS da ligação — ou no MESMO segundo? O
 * carimbo da ligação e o das mensagens da Evolution têm resolução de
 * SEGUNDO: com `>` estrito, a resposta dada no segundo em que a ligação
 * terminou passava despercebida, e a perdida subia a conversa por cima dela
 * (Codex, PR #304). Empate conta como "depois" — o lado de menos efeito. Na
 * conferência depois do insert, a própria bolha fica de fora (`excetoId`).
 * Erro responde "não": o caminho de sempre.
 */
async function haMensagemDepois(
  db: SupabaseClient,
  conversationId: string,
  carimboIso: string,
  excetoId?: string,
): Promise<boolean> {
  let consulta = db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .gte('created_at', carimboIso);
  if (excetoId) consulta = consulta.neq('id', excetoId);
  const { data, error } = await consulta.limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

/**
 * Alguém da EQUIPE respondeu depois da ligação (ou no mesmo segundo — ver
 * `haMensagemDepois`)? A régua da 972 e do Radar (`sender_id` OU
 * `from_device`). Erro responde "sim": o único efeito é não somar a não lida —
 * o lado de menos efeito colateral (o mesmo de `historica.ts`).
 */
async function genteRespondeuDepois(
  db: SupabaseClient,
  conversationId: string,
  carimboIso: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'agent')
    .or('sender_id.not.is.null,from_device.is.true')
    .is('deleted_at', null)
    .gte('created_at', carimboIso)
    .limit(1);
  if (error) return true;
  return (data ?? []).length > 0;
}
