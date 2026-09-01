// ============================================================
// A janela de 24 horas da Meta, num lugar só.
//
// Só a API oficial da Meta tem essa janela: passadas 24h da última mensagem
// DO CLIENTE, a conta não pode mais escrever livremente — só reabre por
// modelo. No transporte Evolution ela não existe (quem decide isso é o
// chamador, não este módulo).
//
// ⚠️ Existe como módulo porque a regra é lida em DOIS momentos com relógios
// diferentes: no render (para a etiqueta do cabeçalho e para travar o
// compositor) e no INSTANTE DO DISPARO (o último portão antes da rede, depois
// dos 5s da janela de desfazer e do tempo que um rascunho de mídia fica
// aberto). Escrita duas vezes, ela divergiria — e a divergência que importa é
// justamente a do caso raro.
// ============================================================

import { differenceInHours } from 'date-fns';

/** O mínimo que a regra precisa de uma mensagem. */
export interface MensagemDaJanela {
  sender_type: string;
  created_at: string;
}

export const HORAS_DA_JANELA = 24;

/**
 * A janela está FECHADA neste instante?
 *
 * ⚠️ Fio VAZIO responde `false`, e isso é load-bearing: é a conversa que o
 * próprio CRM acabou de abrir (PR #79), que ainda não tem mensagem nenhuma.
 * Respondendo "fechada" ali, a primeira mensagem de toda conversa iniciada
 * por nós seria barrada — a feature inteira.
 *
 * ⚠️ Fio COM mensagens e NENHUMA do cliente responde `true`: só o cliente
 * abre a janela, então uma conversa em que só nós falamos nunca esteve
 * aberta.
 *
 * @param agora Injetado pelo chamador — o render passa `new Date()`, o
 *   disparo passa a hora DELE, e o teste passa uma hora fixa.
 */
export function janelaFechada(
  mensagens: readonly MensagemDaJanela[],
  agora: Date
): boolean {
  if (mensagens.length === 0) return false;

  const ultimaDoCliente = [...mensagens]
    .reverse()
    .find((m) => m.sender_type === 'customer');
  if (!ultimaDoCliente) return true;

  return (
    differenceInHours(agora, new Date(ultimaDoCliente.created_at)) >=
    HORAS_DA_JANELA
  );
}

/**
 * Horas INTEIRAS restantes, para a etiqueta do cabeçalho. Negativo nunca sai:
 * quem já expirou não chega aqui (o chamador testa `janelaFechada` antes).
 */
export function horasRestantes(
  mensagens: readonly MensagemDaJanela[],
  agora: Date
): number {
  const ultimaDoCliente = [...mensagens]
    .reverse()
    .find((m) => m.sender_type === 'customer');
  if (!ultimaDoCliente) return 0;
  return (
    HORAS_DA_JANELA -
    differenceInHours(agora, new Date(ultimaDoCliente.created_at))
  );
}
