// ============================================================
// Os indicadores por CONEXÃO do Meu dia (pedido do operador, 29/09/2026): em
// cada conexão que a pessoa enxerga, quantos clientes estão com mensagem não
// lida e quantos esperam resposta em atraso.
//
// ⚠️ A RÉGUA É A DA CAIXA DE ENTRADA, para o indicador e a caixa filtrada
// para onde ele leva dizerem o mesmo número:
//   · "não lidos" = `unread_count > 0` (o filtro "Não lidas"), da CONTA
//     inteira — quem abre a conversa zera para todo mundo;
//   · "em atraso" = `atrasoDeResposta` (10 min sobre `aguardando_desde`), e
//     "críticos" os que passaram de 30 min (o vermelho do selo da linha).
// Uma cópia da conta aqui acenderia o indicador sobre caixa sem selo.
//
// Só conversa 1:1 ATIVA (aberta ou pendente): encerrar é tirar da caixa, e
// grupo não é cliente (nem tem `channel_id`, nem espera). Conversa sem
// conexão carimbada (anterior ao multicanal) vai para uma conta PRÓPRIA — a
// caixa a mostra sob qualquer recorte, e somá-la a uma conexão seria inventar
// de onde ela veio.
// ============================================================

import { atrasoDeResposta } from '@/lib/inbox/atraso';
import type { Conversation } from '@/types';

/** Só as colunas que a conta lê. */
export type ConversaDaConexao = Pick<
  Conversation,
  | 'id'
  | 'channel_id'
  | 'status'
  | 'group_id'
  | 'unread_count'
  | 'aguardando_desde'
>;

export interface NumerosDaConexao {
  naoLidos: number;
  emAtraso: number;
  /** Dos em atraso, os que esperam há 30 min ou mais. */
  criticos: number;
}

export interface ContagemPorConexao {
  /** Uma entrada para CADA conexão pedida, inclusive as zeradas. */
  porConexao: Map<string, NumerosDaConexao>;
  /** Conversas sem conexão carimbada. */
  semConexao: NumerosDaConexao;
}

const zerado = (): NumerosDaConexao => ({
  naoLidos: 0,
  emAtraso: 0,
  criticos: 0,
});

/**
 * Conta as conversas por conexão.
 *
 * `conexoes` são as que a pessoa ENXERGA (`canaisVisiveis`, com a lente):
 * conversa de outra conexão fica de fora — a caixa de entrada também a
 * esconde de quem não tem aquela conexão no perfil.
 */
export function contarPorConexao(
  conversas: readonly ConversaDaConexao[],
  conexoes: readonly string[],
  agoraMs: number,
): ContagemPorConexao {
  const porConexao = new Map<string, NumerosDaConexao>(
    conexoes.map((id) => [id, zerado()]),
  );
  const semConexao = zerado();
  for (const c of conversas) {
    if (c.group_id || c.status === 'closed') continue;
    const alvo = c.channel_id ? porConexao.get(c.channel_id) : semConexao;
    if (!alvo) continue;
    if ((c.unread_count ?? 0) > 0) alvo.naoLidos++;
    const atraso = atrasoDeResposta(c, agoraMs);
    if (atraso) {
      alvo.emAtraso++;
      if (atraso.critico) alvo.criticos++;
    }
  }
  return { porConexao, semConexao };
}
