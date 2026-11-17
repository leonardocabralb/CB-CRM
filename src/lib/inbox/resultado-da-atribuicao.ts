// ============================================================
// O que o menu Responsável faz com a resposta do UPDATE — puro, testável.
//
// Dois jeitos de a escrita "dar certo" sem ter dado (1148, porte do #682):
//   · 0 linhas sem erro: a RLS barrou (o Visualizador não altera conversa) ou
//     a conversa sumiu. A tela dizia "atribuída" mesmo assim.
//   · a linha volta com OUTRO responsável: o gatilho
//     `cb_responsavel_tem_de_ser_membro` recusou quem não é mais membro da
//     conta e manteve o anterior (ou deixou sem ninguém). Quem escolheu na
//     lista aberta antes da remoção via a escolha "pegar" sem pegar.
// A tela reflete SEMPRE o gravado, nunca o pedido.
// ============================================================

export type ResultadoDaAtribuicao =
  /** Gravou o que foi pedido. */
  | { tipo: 'ok'; gravado: string | null }
  /** O banco não aceitou a pessoa (não é membro): ficou `gravado`. */
  | { tipo: 'recusada'; gravado: string | null }
  /** Nada foi gravado (0 linhas). */
  | { tipo: 'falhou' }

export function resultadoDaAtribuicao(
  pedido: string | null,
  linhas: ReadonlyArray<{ assigned_agent_id: string | null }> | null,
): ResultadoDaAtribuicao {
  const linha = linhas?.[0]
  if (!linha) return { tipo: 'falhou' }
  const gravado = linha.assigned_agent_id ?? null
  return gravado === pedido ? { tipo: 'ok', gravado } : { tipo: 'recusada', gravado }
}
