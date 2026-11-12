import { ERRO_DA_ESPERA_DO_HORARIO } from './horario'
import { ERRO_DA_ARMACAO_PELA_EQUIPE, ERRO_DA_ESPERA_DA_EQUIPE } from './pausa'

// ============================================================
// O PRÓXIMO PASSO da IA numa conversa (pedido do operador, 12/11/2026): a
// faixa do fio diz, embaixo de "IA · X responde nesta conversa", o que a IA
// vai fazer e quando — o follow-up agendado (tentativa e hora), a resposta
// na fila (a rajada, o horário do agente) ou que ela está respondendo agora.
//
// Puro: recebe as linhas VIVAS de `cb_ia_turnos` da conversa (`aguardando`
// e `rodando`, já recortadas na conta) e decide. A rota da faixa
// (`GET /api/cb/ia/conversa/[id]`) lê e chama.
//
// O que NÃO entra, e por quê:
//   - a resposta que espera a EQUIPE (`ERRO_DA_ESPERA_DA_EQUIPE`, 1138): a
//     faixa da pausa já diz "a IA volta a partir de …" (`voltaEm`);
//   - a PRÉ-ARMAÇÃO do follow-up da equipe ainda não resolvida
//     (`ERRO_DA_ARMACAO_PELA_EQUIPE`, 30 s) não vira linha: a hora dela não
//     é a do follow-up (a conferência a reagenda para o vencimento real). Ela
//     sai como `agendando`, só para a faixa perguntar de novo quando ela
//     resolver — nada mais muda na tela nessa hora (Codex, #515);
//   - o follow-up numa pausa que ele NÃO atravessa (só a `gente` com N > 0
//     atravessa — `ia-retomada.md`): ele seria descartado no vencimento, e a
//     faixa afirmaria um envio que não vai acontecer. Quem decide é a rota
//     (`atravessaRetomada`);
//   - a linha de OUTRO dono: todo turno é amarrado a (agente, card, etapa) e
//     a conferência do motor o descarta quando a decisão de agora é outra
//     (card movido para a etapa de outro agente). Ele fica na fila até vencer,
//     e a faixa prometeria, por horas, um follow-up que não sai (Codex,
//     #515). Só a pré-armação, ainda sem dono, passa sem essa conferência.
// ============================================================

export type ProximoPasso =
  /** Um turno `rodando`: a IA está escrevendo (resposta ou follow-up). */
  | { tipo: 'agora' }
  /** Resposta na fila: a rajada, a repetição ou o horário do agente. */
  | { tipo: 'resposta'; em: string; foraDoHorario: boolean }
  /** O follow-up agendado: a tentativa, de quantas, e a partir de quando. */
  | { tipo: 'retomada'; em: string; tentativa: number; tentativas: number }
  /** A pré-armação do follow-up da equipe, ainda sem hora real: sem linha, só a releitura. */
  | { tipo: 'agendando'; em: string }

/** A linha de `cb_ia_turnos` que a rota lê (colunas cruas). */
export interface TurnoVivo {
  tipo: unknown
  status: unknown
  executar_apos: unknown
  tentativa: unknown
  tentativas: unknown
  erro: unknown
  ia_agente_id: unknown
  deal_id: unknown
  stage_id: unknown
}

/** As colunas que a rota pede (a mesma lista de `TurnoVivo`). */
export const COLUNAS_DO_PROXIMO_PASSO =
  'tipo, status, executar_apos, tentativa, tentativas, erro, ia_agente_id, deal_id, stage_id'

/** Quem atende AGORA (a decisão do motor): o dono que o turno tem de ter. */
export interface DonoDoTurno {
  agenteId: string
  dealId: string
  stageId: string
}

/** A pré-armação do follow-up da equipe: a marca e nenhum dono ainda. */
const ehPreArmacao = (l: TurnoVivo) =>
  l.erro === ERRO_DA_ARMACAO_PELA_EQUIPE && l.ia_agente_id == null && l.deal_id == null && l.stage_id == null

/** A régua da conferência do motor: o MESMO agente, card e etapa da decisão de agora. */
const doDono = (l: TurnoVivo, dono: DonoDoTurno) =>
  l.ia_agente_id === dono.agenteId && l.deal_id === dono.dealId && l.stage_id === dono.stageId

const instante = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null
const inteiro = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null

/**
 * O próximo passo, nesta ordem: escrevendo agora > resposta na fila (a mais
 * cedo) > follow-up agendado (o mais cedo) > pré-armação (`agendando`). Nada
 * aplicável = `null`.
 * `atravessaRetomada` = a conversa sem pausa, ou na pausa `gente` com N > 0.
 */
export function proximoPassoDaIa(
  todas: readonly TurnoVivo[],
  opcoes: { atravessaRetomada: boolean; dono: DonoDoTurno },
): ProximoPasso | null {
  // Só o que a conferência do motor deixaria rodar.
  const linhas = todas.filter((l) => ehPreArmacao(l) || doDono(l, opcoes.dono))
  if (linhas.some((l) => l.status === 'rodando')) return { tipo: 'agora' }
  const aguardando = linhas
    .filter((l) => l.status === 'aguardando' && instante(l.executar_apos))
    .sort((a, b) => Date.parse(a.executar_apos as string) - Date.parse(b.executar_apos as string))

  const resposta = aguardando.find((l) => l.tipo === 'resposta' && l.erro !== ERRO_DA_ESPERA_DA_EQUIPE)
  if (resposta) {
    return {
      tipo: 'resposta',
      em: resposta.executar_apos as string,
      foraDoHorario: resposta.erro === ERRO_DA_ESPERA_DO_HORARIO,
    }
  }
  if (!opcoes.atravessaRetomada) return null
  let armando: string | null = null
  for (const l of aguardando) {
    if (l.tipo !== 'retomada') continue
    if (ehPreArmacao(l)) {
      armando ??= l.executar_apos as string
      continue
    }
    const tentativa = inteiro(l.tentativa)
    const tentativas = inteiro(l.tentativas)
    if (tentativa === null || tentativas === null || tentativa > tentativas) continue
    return { tipo: 'retomada', em: l.executar_apos as string, tentativa, tentativas }
  }
  return armando ? { tipo: 'agendando', em: armando } : null
}
