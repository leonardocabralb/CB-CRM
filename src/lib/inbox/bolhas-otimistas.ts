// ============================================================
// A bolha OTIMISTA do envio (`temp-…`) e o que a tira da tela.
//
// O fio desenha a mensagem antes de o servidor responder (`temp-<ms>`,
// `sending`); ela vira `sent` em `marcarEnviada` ou `failed` na recusa, e a
// linha gravada chega depois pelo tempo real, com outro id. ⚠️ O envio de
// GENTE não grava linha quando nada saiu (`whatsapp-envio.md`): a bolha
// falhada é a ÚNICA marca de que a mensagem não chegou ao cliente.
//
// Antes (o mesmo no original até o #677): QUALQUER INSERT da conversa aberta
// tirava TODAS as otimistas — a mensagem do cliente, do colega ou do robô
// apagava a falha da tela —, e a recarga silenciosa (`visibilitychange`,
// reconexão, o botão atualizar) trocava a lista inteira pela do banco.
//
// A régua daqui (adaptada do #677, que casa só pelo texto):
// · INSERT do tempo real: só a linha do ATENDENTE DESTA TELA (`agent` com
//   `sender_id` = o login) tira otimista, e UMA, das que não falharam: a de
//   mesmo tipo e mesmo texto; senão a MAIS ANTIGA do mesmo tipo. O texto
//   diverge de verdade: a otimista nasce assinada pela TELA
//   (`aplicarAssinatura`) e o servidor assina de novo — até `marcarEnviada`,
//   a bolha tem o texto da tela. A que falhou NUNCA sai por INSERT.
// · Recarga: a lista do banco MAIS as falhadas desta conversa. As pendentes
//   saem, como antes: a linha delas pode já estar no banco, e mantê-las
//   desenharia a mensagem duas vezes.
// · Republicar a mesma otimista como falhada (o 409 "o cliente trocou de
//   número") VIRA a bolha em falhada. Antes o id repetido era descartado e
//   ela ficava em `sending` até o próximo INSERT a varrer; agora que só o
//   INSERT do próprio atendente varre, ela ficaria "enviando" e seria
//   confundida com o reenvio.
//
// ⚠️ "A mais antiga" é a primeira da LISTA: as otimistas entram no fim, na
// ordem em que nasceram, e nenhuma régua daqui as reordena.
//
// Puro. Sem mudança, a lista volta sem cópia (o React não re-renderiza).
// ============================================================

import type { Message } from '@/types';

/** O prefixo do id provisório que o fio dá à bolha otimista. */
const PREFIXO_DA_OTIMISTA = 'temp-';

export function ehOtimista(mensagem: Pick<Message, 'id'>): boolean {
  return mensagem.id.startsWith(PREFIXO_DA_OTIMISTA);
}

/** Otimista de pé (esperando o servidor ou já confirmada) da conversa e do tipo. */
function deTroca(m: Message, linha: Message): boolean {
  return (
    ehOtimista(m) &&
    (m.status === 'sending' || m.status === 'sent') &&
    m.conversation_id === linha.conversation_id &&
    m.content_type === linha.content_type
  );
}

/**
 * O INSERT do tempo real na conversa aberta. `quemEstaNaTela` é o id do LOGIN
 * (`useAuth().user.id`) — o mesmo que a rota de envio grava em
 * `messages.sender_id`. Nulo (sessão ainda não chegou): nada é trocado.
 */
export function comLinhaDoTempoReal(
  lista: Message[],
  linha: Message,
  quemEstaNaTela: string | null
): Message[] {
  if (lista.some((m) => m.id === linha.id)) return lista;
  const doAtendenteDaTela =
    quemEstaNaTela !== null &&
    linha.sender_type === 'agent' &&
    linha.sender_id === quemEstaNaTela;
  if (!doAtendenteDaTela) return [...lista, linha];

  const texto = linha.content_text ?? '';
  let alvo = lista.findIndex(
    (m) => deTroca(m, linha) && (m.content_text ?? '') === texto
  );
  if (alvo < 0) alvo = lista.findIndex((m) => deTroca(m, linha));
  const sem = alvo < 0 ? lista : lista.filter((_, i) => i !== alvo);
  return [...sem, linha];
}

/**
 * A recarga do fio (`onMessagesLoaded`): o que veio do banco, mais as
 * otimistas que FALHARAM nesta conversa. A conversa é a da TELA, conferida
 * bolha a bolha — nada de uma conversa vaza para a outra.
 */
export function recargaComFalhadas(
  carregadas: Message[],
  naTela: readonly Message[],
  conversationId: string | null
): Message[] {
  if (!conversationId) return carregadas;
  const falhadas = naTela.filter(
    (m) =>
      ehOtimista(m) &&
      m.status === 'failed' &&
      m.conversation_id === conversationId
  );
  return falhadas.length === 0 ? carregadas : [...carregadas, ...falhadas];
}

/**
 * A bolha que o fio publica (`onNewMessage`): nova entra no fim; id que já
 * está na lista é descartado, exceto a MESMA otimista republicada como
 * falhada, que vira falhada no lugar.
 */
export function comBolhaPublicada(lista: Message[], bolha: Message): Message[] {
  const i = lista.findIndex((m) => m.id === bolha.id);
  if (i < 0) return [...lista, bolha];
  if (
    ehOtimista(bolha) &&
    bolha.status === 'failed' &&
    lista[i].status !== 'failed'
  ) {
    return lista.map((m, j) => (j === i ? { ...m, status: 'failed' } : m));
  }
  return lista;
}
