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
// Nas duas: a ficha, a conversa e o card no funil nascem se o número nunca
// escreveu (decisão do operador, 25/09/2026); a conversa segue o número que
// recebeu a ligação; e as esperas "parar se o cliente responder" do contato
// são canceladas — o cliente procurou o escritório.
//
// ⚠️ O que NÃO roda, de propósito, e há teste estrutural cobrando
// (`ligacoes.chamadores.test.ts`): robô, automações, IA e o webhook de saída
// `message.received`. A ligação não tem texto a responder, e um robô que
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
import { cancelarEsperasPorResposta } from '@/lib/automations/parar-se-responder';
import { routeContactToPipeline } from '@/lib/cb-channels/pipeline-routing';
import { followConversationChannel, gravarComCanal } from '@/lib/cb-channels/stamp';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { telefoneCanonico } from '@/lib/contacts/telefone';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { resolverTelefoneDoLid } from '@/lib/whatsapp/sem-telefone/resolver-lid';

import {
  FOLGA_DO_DESFECHO_MS,
  desfechoDaLigacao,
  segundosTocando,
  type DesfechoDaLigacao,
} from './desfecho';
import type { EventoDeLigacao } from './evento';
import { PREVIA_DA_LIGACAO } from './previa';
import { ehLid, telefoneDoCallerPn, telefoneDoJid } from './telefone';

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
  if (!linha.quem_ligou) return;

  if (rota.ownLid && linha.quem_ligou === rota.ownLid) {
    await fechar(db, linha.id, 'do_escritorio', null, 'o aparelho da própria conexão');
    return;
  }

  const quem = await telefoneDeQuemLigou(db, rota.accountId, linha);
  if (!quem) {
    await fechar(
      db,
      linha.id,
      'sem_telefone',
      null,
      ehLid(linha.quem_ligou)
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

/** As três fontes, na ordem de confiança — ver `telefone.ts`. */
async function telefoneDeQuemLigou(
  db: SupabaseClient,
  accountId: string,
  linha: LinhaDaLigacao,
): Promise<{ telefone: string; fonte: FonteDoTelefone } | null> {
  const doJid = telefoneDoJid(linha.quem_ligou);
  if (doJid) return { telefone: doJid, fonte: 'jid' };

  if (ehLid(linha.quem_ligou)) {
    const achado = await resolverTelefoneDoLid(db, accountId, linha.quem_ligou as string);
    const doAcervo = telefoneDoJid(achado?.telefoneJid);
    if (doAcervo) return { telefone: doAcervo, fonte: 'acervo' };
  }

  const informado = telefoneDoCallerPn(linha.telefone_informado);
  if (informado) return { telefone: informado, fonte: 'whatsapp' };
  return null;
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

  // ⚠️ `created_at` é AGORA, não a hora da ligação: os gatilhos de `messages`
  // (972) decidem pela ORDEM DE INSERÇÃO, e uma linha "no passado" inserida
  // depois de uma resposta acenderia "em atraso" sobre cliente respondido (a
  // lição da 1010). A hora em que tocou vai em `ligacao.inicio`, e é ela que a
  // bolha escreve.
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
        created_at: agoraIso,
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

  // LOGO DEPOIS de gravar (ver `reopen.ts`): a janela entre gravar e reabrir é
  // onde um encerramento posterior seria atropelado. Sem responsável, como a
  // mensagem do cliente e a do celular pareado.
  await reopenClosedConversation(db, { id: destino.conversationId });

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

  // O cliente procurou o escritório: as sequências marcadas "parar se o
  // cliente responder" param. Nunca lança.
  await cancelarEsperasPorResposta({ db, accountId: rota.accountId, contactId: destino.contactId });

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
