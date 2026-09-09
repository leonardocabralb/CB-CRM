// ============================================================
// "Este cliente tem automação rodando?" — a resposta em LOTE, pura.
//
// O pedido do operador: "se o cliente não aparece na reunião e eu aciono uma
// automação de follow-up que vai mandar mensagem pelos próximos 30 dias, e ele
// retoma o contato comigo, eu preciso saber que tem um robô ali em execução
// para poder lembrar de desativá-lo."
//
// A aba da conversa já responde isso — mas só depois de abrir a conversa E o
// painel. Aqui a resposta vai para onde o olho já está: a linha da lista de
// conversas e o card do funil.
//
// ⚠️ A fonte é a FILA (`automation_pending_executions`), não o log: só a fila
// sabe que AINDA VAI RODAR. E como ela é service-role only (006), a leitura
// passa por rota — do navegador ela devolve 0 linhas com `error: null`, ou
// seja, a marca ficaria permanentemente apagada com cara de resposta certa.
// ============================================================

export interface EsperaDoContato {
  /** Quantas esperas pendentes. */
  esperas: number
  /** ISO da próxima a acordar — a mais cedo. */
  proxima: string
}

export interface ResumoDeEsperas {
  porContato: Record<string, EsperaDoContato>
  /**
   * A rota bateu no teto e a resposta está incompleta.
   *
   * ⚠️ Não é detalhe: sem este sinal, um teto silencioso faria a marca
   * DESAPARECER de parte dos clientes — e ausência de marca é lida como
   * "nada rodando", que é uma afirmação. Quem consome decide o que fazer;
   * hoje a fila tem 3 linhas e o teto é de 2000.
   */
  truncado: boolean
}

export const RESUMO_VAZIO: ResumoDeEsperas = { porContato: {}, truncado: false }

/**
 * Parse DEFENSIVO do corpo da rota — campo a campo, nunca um cast.
 *
 * Um `as ResumoDeEsperas` entregaria `undefined` ao render quando a resposta
 * fosse uma página de erro de proxy ou um corpo truncado, e a lista de
 * conversas quebraria no meio. Corpo estranho vira resumo VAZIO: a marca não
 * aparece, que é o lado seguro (não afirmar) — e é diferente de `null`, que o
 * hook usa para "ainda não sei".
 */
export function lerResumo(json: unknown): ResumoDeEsperas {
  if (!json || typeof json !== 'object') return RESUMO_VAZIO
  const bruto = json as { contatos?: unknown; truncado?: unknown }
  const contatos = bruto.contatos
  if (!contatos || typeof contatos !== 'object' || Array.isArray(contatos)) {
    return RESUMO_VAZIO
  }

  const porContato: Record<string, EsperaDoContato> = {}
  for (const [id, valor] of Object.entries(contatos as Record<string, unknown>)) {
    if (!valor || typeof valor !== 'object') continue
    const v = valor as { esperas?: unknown; proxima?: unknown }
    const esperas = typeof v.esperas === 'number' && Number.isFinite(v.esperas) ? v.esperas : 0
    const proxima = typeof v.proxima === 'string' ? v.proxima : ''
    // Zero espera não é marca. Manter a chave faria a lista acender o ícone
    // para um contato cuja fila esvaziou.
    if (esperas > 0) porContato[id] = { esperas, proxima }
  }

  return { porContato, truncado: bruto.truncado === true }
}
