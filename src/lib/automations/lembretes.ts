import type { DateFieldTriggerConfig } from '@/types'

// ------------------------------------------------------------
// Gatilho de LEMBRETE por data de campo personalizado (migration 935).
//
// "24 horas antes da reunião, mande a confirmação." A hora vem de um campo do
// CONTATO, e é isso que dá alvo ao gatilho — o `time_based` do upstream nunca
// disparou em parte porque "todo dia às 9h" não diz para quem.
//
// A aritmética mora aqui, pura e testável, porque errar por algumas horas é
// exatamente o modo de falha desta feature: o cliente recebe "sua reunião é
// amanhã" depois da reunião, e ninguém percebe que foi o código.
// ------------------------------------------------------------

/**
 * Janela varrida num ciclo: `(de, ate]`.
 *
 * `ate` é o instante-alvo mais recente que ainda deve disparar (agora), e `de`
 * é o mais antigo. A largura é a guarda de atraso — ver `LARGURA_MS`.
 */
export interface Janela {
  de: string
  ate: string
}

/**
 * Quanto para trás o ciclo aceita disparar.
 *
 * ⚠️ É a GUARDA DE ATRASO, no molde da mensagem agendada (925), e o número
 * grande é de propósito: o ciclo normal é de minutos, então 1 hora cobre
 * folgadamente um agendador que tropeçou. O que ela impede é o oposto —
 * agendador fora do ar a noite toda e religado de manhã despejando os
 * lembretes de madrugada inteira de uma vez, cada um chegando ao cliente
 * horas depois de perder a utilidade.
 *
 * Lembrete perdido é ruim; lembrete de uma reunião que já aconteceu é pior,
 * porque afirma algo falso ao cliente.
 */
export const LARGURA_MS = 60 * 60 * 1000

/**
 * Que valores do campo devem ser buscados neste ciclo.
 *
 * O contato deve receber quando `valor + deslocamento` cai na janela.
 * Invertendo: `valor` tem de estar entre `agora - largura - deslocamento` e
 * `agora - deslocamento`.
 *
 * ⚠️ `antes` é deslocamento NEGATIVO. "24 horas antes" quer dizer que o
 * disparo acontece 24h ANTES do valor, logo procuramos valores 24h À FRENTE
 * de agora. Trocar o sinal aqui manda a confirmação de reunião 24h DEPOIS
 * dela — o defeito mais provável desta feature inteira, e o mais silencioso.
 */
export function deslocamentoEmMs(cfg: DateFieldTriggerConfig): number {
  const horas = Number(cfg.offset_hours)
  const minutos = Number(cfg.offset_minutes)
  return (
    (Number.isFinite(horas) ? horas : 0) * 3_600_000 +
    (Number.isFinite(minutos) ? minutos : 0) * 60_000
  )
}

/**
 * A largura da janela deste gatilho.
 *
 * ⚠️ NUNCA MAIOR QUE O PRÓPRIO DESLOCAMENTO, e é isso que torna o lembrete de
 * minutos possível. Com a largura fixa de 1 hora, um gatilho de "10 minutos
 * antes" aceitaria disparar até 50 minutos DEPOIS de a reunião começar — a
 * guarda contra atraso viraria a causa do atraso, e o cliente receberia "sua
 * reunião é em 10 minutos" com ela já em curso.
 *
 * Para os deslocamentos longos (24h, 4h) nada muda: continua 1 hora.
 */
export function larguraDaJanela(cfg: DateFieldTriggerConfig): number {
  const deslocamento = deslocamentoEmMs(cfg)
  if (deslocamento <= 0) return LARGURA_MS
  return Math.min(LARGURA_MS, deslocamento)
}

export function janelaDeBusca(cfg: DateFieldTriggerConfig, agoraMs: number): Janela {
  const deslocamentoMs = deslocamentoEmMs(cfg)
  // `antes`: alvo = valor - deslocamento  →  valor = alvo + deslocamento
  // `depois`: alvo = valor + deslocamento →  valor = alvo - deslocamento
  const sinal = cfg.direction === 'depois' ? -1 : 1
  const ate = agoraMs + sinal * deslocamentoMs
  const de = ate - larguraDaJanela(cfg)
  return { de: new Date(de).toISOString(), ate: new Date(ate).toISOString() }
}

/**
 * A config está utilizável?
 *
 * Devolve o motivo quando não — o cron o registra, para a próxima pessoa não
 * ter de adivinhar por que o lembrete não saiu.
 */
export function motivoDeConfigInvalida(cfg: DateFieldTriggerConfig): string | null {
  // ⚠️ Com a fonte `reuniao` NÃO há campo de data para escolher — a data vem de
  // `cb_meetings.starts_at`. Exigir o campo aqui deixaria o gatilho novo
  // permanentemente inválido, e o cron registraria "sem campo escolhido" para
  // uma configuração correta.
  const fonte = cfg?.fonte ?? 'campo'
  if (fonte === 'campo' && !cfg?.custom_field_id) {
    return 'gatilho sem campo de data escolhido'
  }
  if (fonte !== 'campo' && fonte !== 'reuniao') return 'fonte de data desconhecida'

  // ⚠️ PELO MENOS UM DOS DOIS TEM DE VIR — e "vir" exclui `null` e `''`.
  // Antes da 947 o deslocamento era só `offset_hours`, e a ausência caía em
  // `Number(undefined) = NaN`, que a checagem recusava. Ao dividir em horas +
  // minutos eu troquei a condição por `!== undefined` e abri a porta: config
  // sem deslocamento nenhum passava a ser aceita, com deslocamento ZERO — e a
  // janela `[agora-1h, agora]` avisaria sobre reuniões que JÁ COMEÇARAM, em
  // vez de a automação ser recusada com motivo no log. E `undefined` não
  // basta: campo "limpo" chega como `null` ou `''`, e os dois viram `0` no
  // `Number()` — o mesmo zero disfarçado. O `0` NUMÉRICO explícito continua
  // aceito ("na hora da reunião" é configuração legítima). Pela tela não
  // acontece (o formulário manda 24 por padrão), mas acontece por API, por
  // importação de modelo, ou se alguém limpar os dois campos.
  // `' '` incluído: `Number(' ')` também é 0 — o trim pega a família toda.
  const ausente = (v: unknown) =>
    v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
  if (ausente(cfg.offset_hours) && ausente(cfg.offset_minutes)) {
    return 'gatilho sem deslocamento (informe horas ou minutos)'
  }

  const horas = Number(cfg.offset_hours)
  const minutos = Number(cfg.offset_minutes)
  if (!ausente(cfg.offset_hours) && (!Number.isFinite(horas) || horas < 0)) {
    return 'deslocamento inválido'
  }
  if (!ausente(cfg.offset_minutes) && (!Number.isFinite(minutos) || minutos < 0)) {
    return 'deslocamento inválido'
  }

  // Teto de um ano: o deslocamento é digitado à mão, e um zero a mais faria a
  // janela cair num passado/futuro sem sentido — buscando valores que nunca
  // existirão e escondendo o erro de digitação.
  if (deslocamentoEmMs(cfg) > 365 * 24 * 3_600_000) {
    return 'deslocamento maior que um ano'
  }
  if (cfg.direction !== 'antes' && cfg.direction !== 'depois') {
    return 'direção inválida (use "antes" ou "depois")'
  }
  return null
}
