// ============================================================
// A bolha OTIMISTA do envio (`temp-…`) e o que a tira da tela.
//
// O fio desenha a mensagem antes de o servidor responder (`temp-<ms>`,
// `sending`); ela vira `sent` em `marcarEnviada` ou `failed` na recusa, e a
// linha gravada chega depois pelo tempo real, com outro id.
//
// Antes (o mesmo no original até o #677): QUALQUER INSERT da conversa aberta
// tirava TODAS as otimistas. A mensagem do cliente, do colega ou do robô que
// chegasse com o envio ainda em voo levava a bolha dele; se o envio falhasse
// depois, `onUpdateMessage(temp, failed)` não achava mais nada e a falha
// sumia da tela (só o aviso passageiro ficava).
//
// A régua daqui (adaptada do #677, que casa só pelo texto):
// · A otimista EM VOO (`sending`/`sent`) só sai pela linha do ATENDENTE
//   DESTA TELA (`agent` com `sender_id` = o login), e UMA: a de mesmo tipo e
//   mesmo texto; senão a MAIS ANTIGA do mesmo tipo. O texto diverge de
//   verdade: a otimista nasce assinada pela TELA (`aplicarAssinatura`) e o
//   servidor assina de novo — até `marcarEnviada`, a bolha tem o texto da
//   tela.
// · ⚠️ A que FALHOU sai como antes: com QUALQUER linha nova da conversa e na
//   recarga. A tela não sabe se a falha foi recusa comprovada (nada saiu) ou
//   incerta — a rota devolve 502 nos dois casos, e a queda de rede do
//   navegador pode vir com o envio feito e a linha gravada. Manter a bolha
//   "Não entregue… Envie de novo" ao lado do que chegou ao cliente convidaria
//   a mandar em dobro (CLAUDE.md, 8e). Segurá-la só na recusa comprovada
//   depende de a resposta trazer o motivo (o rascunho #417).
// · Republicar a mesma otimista como falhada (o 409 "o cliente trocou de
//   número") VIRA a bolha em falhada. Antes o id repetido era descartado e
//   ela ficava em `sending` até o próximo INSERT a varrer; agora que só o
//   INSERT do próprio atendente varre a pendente, ela ficaria "enviando".
//
// ⚠️ "A mais antiga" é a primeira da LISTA: as otimistas entram no fim, na
// ordem em que nasceram, e nenhuma régua daqui as reordena. E a linha do
// MESMO atendente vinda de outra aba ou aparelho, com texto diferente, leva a
// mais antiga daqui (limite conhecido: o par exato pediria o `message_id` da
// resposta na otimista).
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
 * `messages.sender_id`. Nulo (sessão ainda não chegou): nenhuma pendente é
 * trocada.
 */
export function comLinhaDoTempoReal(
  lista: Message[],
  linha: Message,
  quemEstaNaTela: string | null
): Message[] {
  if (lista.some((m) => m.id === linha.id)) return lista;
  // A falhada da conversa sai com qualquer linha nova (ver o topo).
  const semFalhadas = lista.filter(
    (m) =>
      !(
        ehOtimista(m) &&
        m.status === 'failed' &&
        m.conversation_id === linha.conversation_id
      )
  );
  const doAtendenteDaTela =
    quemEstaNaTela !== null &&
    linha.sender_type === 'agent' &&
    linha.sender_id === quemEstaNaTela;
  if (!doAtendenteDaTela) return [...semFalhadas, linha];

  const texto = linha.content_text ?? '';
  let alvo = semFalhadas.findIndex(
    (m) => deTroca(m, linha) && (m.content_text ?? '') === texto
  );
  if (alvo < 0) alvo = semFalhadas.findIndex((m) => deTroca(m, linha));
  const sem =
    alvo < 0 ? semFalhadas : semFalhadas.filter((_, i) => i !== alvo);
  return [...sem, linha];
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
