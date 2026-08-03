// ============================================================
// Disparo das mensagens agendadas (migration 925).
//
// Duas entradas, com regras deliberadamente diferentes:
//
//  · `dispararVencidas` — o worker. Roda sem ninguém na tela, a cada ciclo
//    do agendador. É conservador: recusa o que está atrasado demais.
//  · `dispararUma` — "Executar agora" e "Tentar de novo". Uma pessoa está
//    pedindo, olhando a conversa. Não tem guarda de atraso: a hora marcada
//    deixou de importar no instante em que alguém clicou.
//
// Módulo próprio, fora de `lib/whatsapp/`, porque não é um jeito novo de
// enviar — é uma fila em cima do envio que já existe. O envio continua sendo
// `sendMessageToConversation`, com dois parâmetros a mais.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import { citacaoAindaVale, temAnexo } from './midia';
import type { ScheduledMessage } from '@/types';

/**
 * Quantas linhas um ciclo processa.
 *
 * Cada uma é uma chamada de rede à Meta/Evolution — o teto existe para o
 * ciclo caber no orçamento de uma requisição, não porque haja volume. Com o
 * ciclo de 15 minutos isto são 80 mensagens por hora. Folgado para o uso real
 * (o pico histórico desta conta é 25 mensagens de atendente numa hora, e só
 * se agenda uma por vez, à mão), mas é MENOS folga do que o ciclo de 1 minuto
 * dava — se um dia houver criação em lote de agendadas, este número tem de
 * subir junto.
 */
const POR_CICLO = 20;

/**
 * A partir de quanto tempo de atraso a mensagem deixa de sair sozinha.
 *
 * ⚠️ Esta guarda é a peça mais importante deste arquivo, e ela existe por um
 * cenário que este projeto JÁ VIVEU: o cron das automações nunca rodou em
 * produção e ninguém percebeu, porque nada dependia dele. Aqui vai depender.
 * Se o agendador ficar dias fora do ar, o conserto dispararia toda a fila de
 * uma vez — dezenas de mensagens de "bom dia" chegando às 2 da manhã, para
 * clientes de um escritório de advocacia.
 *
 * Uma hora é a linha: um envio marcado para as 9h saindo às 9h45 continua
 * fazendo sentido; às 11h já não. Passado o prazo a linha vira `failed` com
 * o motivo escrito, e a pessoa decide — que é exatamente o que a P4.9 pediu
 * para o caso de falha.
 */
const ATRASO_MAXIMO_MS = 60 * 60_000;

/** Teto do texto do erro guardado — a coluna é `text` e sem limite. */
const MAX_ERRO = 500;

/**
 * A partir de quantos minutos em `sending` a linha é dada como perdida.
 *
 * ⚠️ ISTO CONSERTA O ÚNICO CAMINHO DE MENSAGEM DUPLICADA QUE EXISTE.
 * `sending` significa "o worker reivindicou e ainda não devolveu". Se o
 * processo morre no meio — e ele morre A CADA PUBLICAÇÃO DE CÓDIGO, que
 * reinicia o contêiner —, a linha ficava ali para sempre: a tela mostrava
 * "Enviando", que parece progresso; o aviso de atraso não acendia (ele só
 * olha `pending`); não havia botão; e a linha ainda travava a remoção daquela
 * conexão de WhatsApp, com um erro que ninguém liga à causa. A saída que
 * sobrava era alguém mexer no banco à mão para "destravar" — e aí TUDO que já
 * tinha saído sairia de novo, para clientes do escritório.
 *
 * ⚠️ Dez minutos é folgado de propósito: um ciclo inteiro é limitado por 20
 * envios, cada um com o tempo de espera do transporte (~15s), ou seja ~5
 * minutos no pior caso. O número tem de ficar ACIMA disso, senão um ciclo
 * lento recolheria uma linha que está sendo enviada NESTE instante.
 *
 * E o desfecho é sempre `entrega_incerta` (926): a mensagem PODE ter chegado
 * ao cliente. A tela então mostra o motivo e NÃO oferece "Tentar de novo" —
 * quem decide é gente, olhando a conversa.
 */
const TRAVADA_MINUTOS = 10;

export interface ResultadoDoCiclo {
  /** Quantas saíram para o WhatsApp. */
  enviadas: number;
  /** Quantas tentaram e falharam. */
  falhas: number;
  /** Quantas foram recusadas por atraso, sem sequer tentar. */
  atrasadas: number;
  /** Quantas estavam travadas em `sending` e foram recolhidas. */
  travadas: number;
}

type LinhaAgendada = Pick<
  ScheduledMessage,
  | 'id'
  | 'account_id'
  | 'conversation_id'
  | 'channel_id'
  | 'body'
  | 'created_by'
  | 'media_url'
  | 'media_path'
  | 'media_kind'
  | 'media_filename'
  | 'reply_to_message_id'
>;

const COLUNAS =
  'id, account_id, conversation_id, channel_id, body, created_by, media_url, media_path, media_kind, media_filename, reply_to_message_id';

/**
 * O que o operador lê quando o arquivo sumiu do bucket entre agendar e enviar.
 *
 * ⚠️ Recado escrito à mão, e não a mensagem crua do Storage ("Object not
 * found"), porque quem lê isto é quem atende — e a ação certa (reanexar e
 * reagendar) não sai de um erro técnico.
 */
const ANEXO_SUMIU =
  'O arquivo anexado não está mais disponível e a mensagem não foi enviada. Anexe o arquivo de novo e reagende.';

/**
 * Códigos de erro que significam "o WhatsApp JÁ ACEITOU a mensagem".
 *
 * ⚠️ São os dois casos em que 'falhou' mente. `db_error` é lançado depois do
 * envio — a própria mensagem dele diz "sent to Meta but failed to save to
 * DB". `evolution_error` cobre o tempo esgotado, e abortar do nosso lado NÃO
 * cancela o envio já em curso, coisa que este projeto já registrou.
 *
 * `evolution_error` também aparece em falhas honestas (instância caída), e
 * marcar essas como incertas é o erro BARATO: o operador perde o botão de um
 * clique e manda de novo pelo campo normal. O erro caro é o contrário — o
 * cliente do escritório recebendo a mesma mensagem duas vezes.
 *
 * ⚠️ `evolution_rejected` fica DE FORA, e a 932 é quem criou a distinção: um
 * 4xx é a Evolution processando o pedido e recusando ANTES de mandar (mime que
 * o WhatsApp não aceita, arquivo grande demais, URL do anexo que ela não
 * conseguiu baixar). Nada saiu — e chamar isso de "pode ter chegado" esconde o
 * botão de tentar de novo sobre uma mensagem que comprovadamente não foi.
 * Com texto puro isso quase não acontecia; com anexo é o modo de falha comum.
 */
const CODIGOS_POS_ENTREGA = new Set(['db_error', 'evolution_error']);

/**
 * Um ciclo do agendador: recusa o que envelheceu, dispara o que venceu.
 *
 * `agora` entra por parâmetro para o teste poder mover o relógio.
 */
export async function dispararVencidas(
  admin: SupabaseClient,
  agora: Date = new Date(),
): Promise<ResultadoDoCiclo> {
  // ⚠️ PRIMEIRO recolhe o que travou, DEPOIS o resto. A ordem importa: uma
  // linha travada em `sending` bloqueia a remoção da conexão e some da tela,
  // e quanto mais cedo ela virar `failed` visível, menor a janela em que
  // alguém tenta "consertar" mexendo no banco.
  const travadas = await recolherTravadas(admin, agora);
  const atrasadas = await recusarAtrasadas(admin, agora);

  const { data, error } = await admin
    .from('cb_scheduled_messages')
    .select(COLUNAS)
    .eq('status', 'pending')
    .lte('scheduled_for', agora.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(POR_CICLO);

  if (error) throw new Error(error.message);

  let enviadas = 0;
  let falhas = 0;

  for (const linha of (data ?? []) as LinhaAgendada[]) {
    // ⚠️ ANTES de reivindicar, e é de propósito (932). Reivindicar põe a linha
    // em `sending`, que é o estado do qual NADA pode ser reenviado — se o
    // arquivo sumiu, a linha ficaria presa lá até o recolhimento de 10
    // minutos e sairia como "entrega incerta", que é mentira: não saiu nada.
    // Falhando antes, ela vira `failed` com motivo legível e o botão de
    // tentar de novo continua valendo depois de reanexar.
    if (!(await anexoAindaExiste(admin, linha))) {
      await falharSemTentar(admin, linha.id, ANEXO_SUMIU);
      falhas++;
      continue;
    }
    // Reivindicação em dois passos, como no cron das automações: o UPDATE
    // condicionado a `status = 'pending'` é o cadeado. Dois ciclos que se
    // sobreponham não mandam a mesma mensagem duas vezes — o segundo não
    // acha linha e segue adiante.
    if (!(await reivindicar(admin, linha.id, ['pending']))) continue;
    const ok = await enviarEFinalizar(admin, linha);
    if (ok) enviadas++;
    else falhas++;
  }

  return { enviadas, falhas, atrasadas, travadas };
}

/**
 * "Executar agora" e "Tentar de novo", os dois pedidos de gente.
 *
 * ⚠️ Aceita `pending` e `failed`, e NÃO aceita `sending`. Linha em `sending`
 * é uma que o worker reivindicou e não devolveu — o processo morreu no meio,
 * e a mensagem pode ter saído. Reenviar dali é a receita para o cliente
 * receber duas vezes; a saída é a pessoa apagar e reagendar, decidindo com o
 * que ela vê na conversa.
 *
 * Devolve `null` quando não havia o que reivindicar (já saiu, já está
 * saindo, ou alguém apagou) — o chamador transforma isso em 409.
 */
export async function dispararUma(
  admin: SupabaseClient,
  accountId: string,
  id: string,
): Promise<{ enviada: boolean; erro: string | null } | null> {
  const { data } = await admin
    .from('cb_scheduled_messages')
    .select(COLUNAS)
    .eq('id', id)
    .eq('account_id', accountId)
    // ⚠️ `entrega_incerta` fora, e é o ponto da 926: aquela linha falhou
    // DEPOIS de o WhatsApp aceitar a mensagem. Reenviar manda duas vezes.
    .eq('entrega_incerta', false)
    .in('status', ['pending', 'failed'])
    .maybeSingle();

  if (!data) return null;

  const linha = data as LinhaAgendada;

  // Mesma conferência do worker (932), e aqui ela vale ainda mais: há alguém
  // esperando o resultado do clique. Sem isto, "Tentar de novo" numa linha
  // cujo arquivo sumiu devolveria erro de provedor, em inglês.
  if (!(await anexoAindaExiste(admin, linha))) {
    await falharSemTentar(admin, id, ANEXO_SUMIU);
    return { enviada: false, erro: ANEXO_SUMIU };
  }

  if (!(await reivindicar(admin, id, ['pending', 'failed'], accountId))) {
    return null;
  }
  const ok = await enviarEFinalizar(admin, linha);
  if (ok) return { enviada: true, erro: null };

  const { data: depois } = await admin
    .from('cb_scheduled_messages')
    .select('error')
    .eq('id', id)
    .maybeSingle();
  return {
    enviada: false,
    erro: (depois as { error?: string | null } | null)?.error ?? null,
  };
}

/**
 * Recolhe as linhas presas em `sending` — ver `TRAVADA_MINUTOS`.
 *
 * ⚠️ Mede pelo carimbo de reivindicação (`sending_desde`, 928) — a única
 * medida correta. As duas aproximações que eu tinha usado antes erravam para
 * lados opostos: `created_at` é anterior demais (recolheria envio EM CURSO) e
 * `scheduled_for` não vale para "Executar agora" (a linha marcada para daqui
 * a 30 dias ficaria travada por 30 dias). Ver a migration 928.
 *
 * ⚠️ `sending_desde` nulo com status `sending` não existe: a 928 carimbou o
 * que havia e `reivindicar` carimba daqui em diante. O filtro por nulo NÃO é
 * acrescentado de propósito — uma linha assim seria um defeito, e escondê-la
 * do recolhimento é o que criou este problema em primeiro lugar.
 */
async function recolherTravadas(
  admin: SupabaseClient,
  agora: Date,
): Promise<number> {
  const limite = new Date(agora.getTime() - TRAVADA_MINUTOS * 60_000).toISOString();
  const { data, error } = await admin
    .from('cb_scheduled_messages')
    .update({
      status: 'failed',
      // Sempre incerta: o processo morreu DEPOIS de reivindicar, e ninguém
      // sabe se foi antes ou depois de o WhatsApp aceitar.
      entrega_incerta: true,
      error:
        'O envio começou e não terminou — o CRM foi reiniciado no meio. A mensagem PODE ter chegado ao cliente: confira a conversa antes de enviar de novo.',
    })
    .eq('status', 'sending')
    .lt('sending_desde', limite)
    .select('id');

  if (error) {
    console.error('[agendadas] recolher travadas falhou:', error.message);
    return 0;
  }
  return (data ?? []).length;
}

/**
 * Marca como falha tudo que passou do prazo, numa tacada só.
 *
 * Em bloco, e antes de qualquer envio, para uma fila represada não consumir
 * o orçamento do ciclo linha a linha.
 */
async function recusarAtrasadas(
  admin: SupabaseClient,
  agora: Date,
): Promise<number> {
  const limite = new Date(agora.getTime() - ATRASO_MAXIMO_MS).toISOString();
  const { data, error } = await admin
    .from('cb_scheduled_messages')
    .update({
      status: 'failed',
      error:
        'Não saiu na hora marcada: o agendador ficou fora do ar e o atraso passou de uma hora. Confira o texto antes de enviar de novo.',
    })
    .eq('status', 'pending')
    .lt('scheduled_for', limite)
    .select('id');

  if (error) {
    console.error('[agendadas] recusa por atraso falhou:', error.message);
    return 0;
  }
  return (data ?? []).length;
}

/**
 * O arquivo anexado ainda está no bucket? (932)
 *
 * ⚠️ Esta pergunta só existe porque passam HORAS entre anexar e enviar. No
 * envio normal o arquivo acabou de subir; aqui ele pode ter sido removido —
 * por limpeza, por engano, por uma rotina futura de retenção — e a falha
 * aconteceria às 3 da manhã, com a mensagem que o cliente esperava.
 *
 * ⚠️ Falha do Storage NÃO conta como "sumiu". Se a consulta em si der erro
 * (rede, indisponibilidade), a resposta é "existe": o pior desfecho de um
 * falso positivo é uma tentativa de envio que falha com o erro de verdade;
 * o de um falso negativo é cancelar uma mensagem que estava perfeita, e
 * escrever na tela que o arquivo sumiu quando ele está lá.
 *
 * Linha sem anexo devolve `true` de imediato — não há o que conferir, e este
 * continua sendo o caso comum.
 */
async function anexoAindaExiste(
  admin: SupabaseClient,
  linha: LinhaAgendada,
): Promise<boolean> {
  if (!temAnexo(linha) || !linha.media_path) return true;
  try {
    const { data, error } = await admin.storage
      .from(CHAT_MEDIA_BUCKET)
      .exists(linha.media_path);

    // ⚠️⚠️ A ORDEM DESTES DOIS `if` É A GUARDA INTEIRA, e ela já esteve
    // invertida — com o `error` primeiro, esta função respondia "existe" para
    // TODO arquivo sumido, que é o único caso para o qual ela existe.
    //
    // O motivo é uma armadilha da própria biblioteca: quando o objeto não
    // está lá, `exists()` devolve **`data: false` E `error` preenchido, ao
    // mesmo tempo** — o 400/404 do HEAD vira `StorageError` e ele volta junto
    // com a resposta. (Ver o `[400, 404].includes(status)` em
    // `storage-js/src/packages/StorageFileApi.ts`; a própria assinatura de
    // tipo tem `{ data: boolean; error: StorageError }`.) Só erro de outra
    // natureza é LANÇADO, e cai no `catch` abaixo.
    //
    // Medido em produção antes do conserto: apaguei o objeto de uma agendada,
    // apertei "Executar agora", e o log disse "não deu para conferir o anexo,
    // seguindo como se existisse" — a mensagem seguiu para a Evolution, que
    // recusou com 400, e a linha terminou como `entrega_incerta`, ou seja
    // afirmando ao operador que a mensagem PODE ter chegado ao cliente. Era o
    // contrário do que esta fase existe para fazer.
    if (data === false) return false;

    if (error) {
      console.warn(
        '[agendadas] não deu para conferir o anexo, seguindo como se existisse:',
        error.message,
      );
      return true;
    }
    return true;
  } catch (err) {
    // Aqui sim é "não deu para saber": rede, Storage fora do ar, 5xx. Falso
    // negativo cancelaria uma mensagem perfeita.
    console.warn('[agendadas] conferência do anexo estourou:', err);
    return true;
  }
}

/**
 * Marca a linha como falha SEM tê-la reivindicado.
 *
 * ⚠️ Condicionada a `pending`/`failed` — a mesma proteção do cadeado. Sem
 * isso, uma linha que outro ciclo acabou de pôr em `sending` (ou que já saiu)
 * seria sobrescrita para `failed`, e o registro passaria a mentir sobre uma
 * mensagem que o cliente recebeu.
 */
async function falharSemTentar(
  admin: SupabaseClient,
  id: string,
  motivo: string,
): Promise<void> {
  const { error } = await admin
    .from('cb_scheduled_messages')
    .update({ status: 'failed', error: motivo.slice(0, MAX_ERRO) })
    .eq('id', id)
    .in('status', ['pending', 'failed']);
  if (error) {
    console.error('[agendadas] não deu para marcar a falha:', error.message);
  }
}

/**
 * A citação ainda vale? Devolve o id a usar (ou `null`) e se ela se perdeu.
 *
 * ⚠️ É a metade "citação" desta fase inteira, e a regra não é óbvia: apagar
 * mensagem NESTE CRM é apagar MOLE (905) — a linha continua no banco, então
 * `send-message.ts` citaria alegremente algo que o cliente vê como "Esta
 * mensagem foi apagada". A decisão do escritório foi **sair sem a citação**,
 * nunca deixar de enviar por causa disso.
 */
async function resolverCitacao(
  admin: SupabaseClient,
  linha: LinhaAgendada,
): Promise<{ citar: string | null; perdida: boolean }> {
  if (!linha.reply_to_message_id) return { citar: null, perdida: false };

  const { data, error } = await admin
    .from('messages')
    .select('id, deleted_at')
    .eq('id', linha.reply_to_message_id)
    .eq('conversation_id', linha.conversation_id)
    .maybeSingle();

  // ⚠️ Erro de leitura cai no lado de NÃO citar, ao contrário da conferência
  // do anexo. A assimetria é deliberada: citar errado é conteúdo errado no
  // WhatsApp do cliente e não tem volta; não citar é uma mensagem que sai
  // completa, só sem a linha de contexto acima.
  if (error) {
    console.warn('[agendadas] não deu para conferir a citação:', error.message);
    return { citar: null, perdida: true };
  }

  const vale = citacaoAindaVale(data as { deleted_at?: string | null } | null);
  return { citar: vale ? linha.reply_to_message_id : null, perdida: !vale };
}

/** O cadeado. `true` = esta chamada é a dona da linha agora. */
async function reivindicar(
  admin: SupabaseClient,
  id: string,
  de: string[],
  /** Escopo de conta. O worker varre todas e não passa; a rota passa. */
  accountId?: string,
): Promise<boolean> {
  let q = admin
    .from('cb_scheduled_messages')
    // ⚠️ O carimbo (928) é o que torna o recolhimento correto. Sem ele a
    // idade do travamento só podia ser estimada, e as duas estimativas
    // possíveis erravam para lados opostos — ver a migration.
    .update({ status: 'sending', sending_desde: new Date().toISOString() })
    .eq('id', id)
    .in('status', de);
  // O `select` anterior já filtrou por conta, mas quem lê esta função não vê
  // aquele bloco — e ela roda em service-role, sem RLS por baixo.
  if (accountId) q = q.eq('account_id', accountId);
  const { data } = await q.select('id').maybeSingle();
  return !!data;
}

/**
 * As recusas do núcleo de envio que uma AGENDADA consegue provocar, em
 * português.
 *
 * ⚠️ `SendMessageError.message` é escrito em inglês, para log e para a API
 * pública. No envio manual isso nunca aparece assim: a rota traduz e o
 * operador está na tela. Aqui o texto vai direto para a coluna `error`, que a
 * faixa da conversa e a tela de agendadas mostram cru — então sem isto o
 * escritório leria "Caption exceeds the 1024-character limit".
 *
 * ⚠️ A do teto de legenda não é hipótese: a validação do agendamento desconta
 * a assinatura VIGENTE, e ela pode ser LIGADA depois — ou quem agendou pode
 * sair da conta, e aí quem assina passa a ser o nome do escritório, que pode
 * ser mais longo que o primeiro nome da pessoa.
 *
 * Devolve `null` quando não reconhece, e aí o inglês original é melhor que um
 * genérico: pelo menos dá para pesquisar.
 */
function traduzirRecusa(mensagem: string): string | null {
  if (mensagem.includes('Caption exceeds')) {
    return 'A legenda ficou longa demais depois de somar a assinatura, e a mensagem não foi enviada. Encurte a legenda e reagende.';
  }
  if (mensagem.includes('reply_to_message_id not found')) {
    return 'A mensagem citada não existe mais nesta conversa.';
  }
  return null;
}

/**
 * Envia e grava o desfecho. Nunca lança: a linha tem de sair de `sending`
 * mesmo quando o envio explode, senão ela trava para sempre.
 */
async function enviarEFinalizar(
  admin: SupabaseClient,
  linha: LinhaAgendada,
): Promise<boolean> {
  const citacao = await resolverCitacao(admin, linha);
  try {
    const r = await sendMessageToConversation(admin, linha.account_id, {
      conversationId: linha.conversation_id,
      // 932: o tipo vem do anexo. Sem anexo continua sendo texto, que é o
      // caso comum e o único que existia até aqui.
      messageType: linha.media_kind ?? 'text',
      // ⚠️ Vazio vira NULO, não string vazia. Com anexo sem legenda o corpo é
      // `''` (o CHECK da 932 permite), e `''` chegaria ao transporte como
      // legenda vazia; nulo é o que o envio normal manda.
      contentText: linha.body || null,
      mediaUrl: linha.media_url,
      filename: linha.media_filename,
      replyToMessageId: citacao.citar,
      // Quem agendou é quem assina (923). A pessoa escreveu o texto; só a
      // hora foi adiada. Nulo quando ela já saiu da conta — que é a verdade,
      // e a 923 cai no nome do escritório.
      senderUserId: linha.created_by,
      // ⚠️ Os dois parâmetros que fazem esta chamada ser diferente do envio
      // manual: o canal é o do agendamento (falha fechada se sumiu) e os
      // fluxos NÃO param, porque não tem gente aqui agora (P4.5).
      channelId: linha.channel_id,
      pauseFlows: false,
    });

    await admin
      .from('cb_scheduled_messages')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        message_id: r.messageId,
        error: null,
        // Fica registrado no acervo: esta saiu sem a citação que tinha.
        citacao_perdida: citacao.perdida,
      })
      .eq('id', linha.id);
    return true;
  } catch (err) {
    const posEntrega =
      err instanceof SendMessageError && CODIGOS_POS_ENTREGA.has(err.code);
    // ⚠️ `db_error` embute a mensagem CRUA do Postgres ("violates constraint
    // cb_..."), e este texto vai para a tela de todo membro, inclusive
    // `viewer`. Nome de constraint e de coluna não dizem nada a quem atende e
    // dizem demais a quem não deveria ver.
    const motivo =
      err instanceof SendMessageError && err.code === 'db_error'
        ? 'O WhatsApp aceitou a mensagem, mas o CRM não conseguiu gravá-la. Confira a conversa.'
        : err instanceof SendMessageError
          ? (traduzirRecusa(err.message) ?? err.message)
          : err instanceof Error
            ? err.message
            : 'Falha desconhecida ao enviar.';
    await admin
      .from('cb_scheduled_messages')
      .update({
        status: 'failed',
        error: motivo.slice(0, MAX_ERRO),
        entrega_incerta: posEntrega,
      })
      .eq('id', linha.id);
    return false;
  }
}
