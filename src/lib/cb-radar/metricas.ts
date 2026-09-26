// ============================================================
// Métricas determinísticas de atendimento — SQL/JS puro, sem IA.
//
// Metade do valor do Radar sai daqui: tempo de resposta e "cliente falou
// por último e ninguém respondeu" não precisam de modelo, não alucinam e
// funcionam mesmo sem chave de IA cadastrada. A IA recebe estes números
// como contexto para a nota; o painel os mostra como fato.
//
// Toda duração é em segundos ÚTEIS (ver horario-comercial.ts): mensagem
// de madrugada respondida na abertura do expediente conta minutos, não
// horas. Intervalo negativo (relógio do WhatsApp vs relógio do banco —
// entrada carimba o timestamp do aparelho, saída carimba now()) vira
// zero dentro de `segundosUteisEntre`.
// ============================================================

import { segundosUteisEntre } from './horario-comercial'

export interface MensagemParaMetricas {
  /** 'customer' = cliente; 'agent' e 'bot' = escritório (inclui resposta
   *  dada pelo celular, `from_device` — para o cliente é resposta igual). */
  senderType: 'customer' | 'agent' | 'bot'
  /**
   * Saiu de GENTE respondendo agora?
   *
   * ⚠️ Só isto fecha a pendência do cliente — e quem resolve é o CHAMADOR,
   * porque as colunas não bastam:
   *
   * - Broadcast, automação e fluxo gravam `agent`/`bot` sem `sender_id` e
   *   sem `from_device` → não é gente.
   * - O celular pareado grava `agent` com `sender_id` NULO e `from_device`
   *   true → É gente (948 das 978 respostas da equipe em produção).
   * - ⚠️ A AGENDADA grava `sender_id` — o `created_by` de quem a criou,
   *   dias antes (dispatch → send-message). É atribuição, não resposta:
   *   pela coluna sozinha, um follow-up agendado fechava a pendência do
   *   cliente esquecido (achado do Codex no PR #74). O worker a exclui
   *   pela proveniência (`cb_scheduled_messages.message_id`).
   *
   * Sem isto, um "recebemos seu contato" automático da terça apagava do
   * painel a pendência aberta na segunda — o alarme que o Radar existe
   * para acender. Irrelevante quando `senderType === 'customer'`.
   *
   * ⚠️ Desde a F2 dos agentes de IA, "fecha a pendência" e "conta no tempo
   * de resposta da equipe" são DUAS perguntas: gente responde às duas, o
   * agente de IA só à primeira (ver `porAgenteDeIa`).
   */
  porGente: boolean
  /**
   * Resposta de um AGENTE DE IA (`sender_type = 'bot' AND ia_agente_id IS
   * NOT NULL` — o ramo "respondido" da 1049, D11 do
   * docs/PLANO-agentes-de-ia.md). Fecha a pendência do cliente, como uma
   * resposta de gente, mas NÃO entra no tempo de resposta DA EQUIPE: a IA
   * responde em segundos, e somá-la à mediana diria que o escritório atende
   * em 30 s quando os advogados levam horas.
   *
   * ⚠️ Robô de FLUXO, automação, disparo e agendada continuam de fora: saem
   * sem `ia_agente_id`, e o predicado de quem chama exige a coluna — é o
   * que impede um "recebemos seu contato" de passar por resposta.
   *
   * Opcional, e AUSENTE = `false` de propósito: quem esquecer de passar
   * erra para o lado do ALARME (a pendência continua aberta), nunca para o
   * de apagar o cliente esquecido. Irrelevante quando `senderType ===
   * 'customer'`.
   */
  porAgenteDeIa?: boolean
  createdAt: Date
}

export interface MetricasDaConversa {
  /** Da 1ª mensagem sem resposta do cliente até a 1ª resposta da equipe,
   *  em segundos úteis. Null quando não houve par pergunta→resposta.
   *  Só rodada fechada por GENTE — a do agente de IA não é medida. */
  primeiraRespostaSeg: number | null
  /** Mediana dos tempos de resposta da janela, em segundos úteis (idem:
   *  só gente). */
  respostaMedianaSeg: number | null
  /** O cliente falou por último e nada foi respondido: desde quando.
   *  Null quando a última palavra é da equipe ou do agente de IA (ou não
   *  há mensagens). */
  aguardandoDesde: Date | null
  msgsCliente: number
  msgsEquipe: number
}

/**
 * Percorre a janela em ordem cronológica medindo cada "rodada": a
 * PRIMEIRA mensagem de uma sequência do cliente abre a pendência, e a
 * resposta seguinte de GENTE a fecha (mensagens extras do cliente no
 * meio não reabrem a contagem — quem espera desde a primeira espera mais).
 *
 * ⚠️ "De gente" e não "da equipe": ver `porGente`. Saída automática atravessa
 * a rodada sem fechá-la, e sem entrar no tempo de resposta — um disparo em
 * massa não é resposta a este cliente, e contá-lo como tal faria a métrica
 * dizer que a equipe respondeu em 2 minutos uma pergunta ainda sem resposta.
 * `msgsEquipe` continua contando tudo que saiu: é volume, não atendimento.
 *
 * ⚠️ A resposta do AGENTE DE IA (`porAgenteDeIa`) fecha a rodada SEM
 * medi-la: o cliente foi respondido, mas não pela equipe. Por isso
 * `primeiraRespostaSeg` e `respostaMedianaSeg` falam só das rodadas que
 * GENTE fechou — numa conversa em que a IA respondeu tudo, os dois ficam
 * nulos, e a rodada que a pessoa assume depois de uma transferência é
 * medida a partir da fala do cliente que a abriu.
 */
export function calcularMetricas(
  mensagens: MensagemParaMetricas[],
): MetricasDaConversa {
  const ordenadas = [...mensagens]
    .filter((m) => m.createdAt instanceof Date && !Number.isNaN(m.createdAt.getTime()))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  const temposSeg: number[] = []
  let inicioPendencia: Date | null = null
  let msgsCliente = 0
  let msgsEquipe = 0

  for (const m of ordenadas) {
    if (m.senderType === 'customer') {
      msgsCliente += 1
      if (!inicioPendencia) inicioPendencia = m.createdAt
    } else {
      msgsEquipe += 1
      if (inicioPendencia && m.porGente) {
        temposSeg.push(segundosUteisEntre(inicioPendencia, m.createdAt))
        inicioPendencia = null
      } else if (inicioPendencia && m.porAgenteDeIa === true) {
        // Respondido, mas não pela equipe: fecha sem entrar em `temposSeg`.
        inicioPendencia = null
      }
    }
  }

  return {
    primeiraRespostaSeg: temposSeg.length > 0 ? temposSeg[0] : null,
    respostaMedianaSeg: mediana(temposSeg),
    aguardandoDesde: inicioPendencia,
    msgsCliente,
    msgsEquipe,
  }
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const ord = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(ord.length / 2)
  return ord.length % 2 === 1
    ? ord[meio]
    : Math.round((ord[meio - 1] + ord[meio]) / 2)
}
