// ============================================================
// Ordenação e agregação do painel — a resposta a "qual conversa eu olho
// primeiro?". Pura, para o teste fixar as regras de desempate.
//
// A severidade é um score aberto (documentado abaixo) em vez de regras
// encadeadas: o operador precisa que "urgência alta de 4 dias atrás"
// ganhe de "conversa recente sem nada", e um score soma esses fatores de
// forma explicável. A prioridade das últimas 72h (pedido do produto)
// entra como BÔNUS, não como corte: recente sobe, antigo não some.
// ============================================================

import { CICLO_MINUTOS } from '@/lib/scheduled/display'

// As DUAS listas canônicas destes enums no TypeScript — rota, rubrica e
// tela derivam daqui (o CHECK da 941 é o espelho no banco). Valor novo
// entra AQUI + migration no CHECK; redeclarar por camada era o jeito de
// a rota recusar um valor que o banco aceita.
export const URGENCIAS = ['nenhuma', 'baixa', 'media', 'alta'] as const
export type Urgencia = (typeof URGENCIAS)[number]

export const ESTADOS_DO_INSIGHT = ['aberto', 'tratado', 'descartado'] as const
export type EstadoDoInsight = (typeof ESTADOS_DO_INSIGHT)[number]

/** A janela do Radar. Mora AQUI (módulo puro, seguro no cliente) porque
 *  worker E painel precisam dela — o painel esconde insight de conversa
 *  que saiu da janela, senão um "aguardando" de março continuaria vivo e
 *  crescendo na tela em agosto. */
export const JANELA_DIAS = 7

/**
 * Espera mínima entre duas análises da MESMA conversa, mesmo com mensagem
 * nova. DERIVADA da cadência real do agendador (o laço lento bate a cada
 * `CICLO_MINUTOS`): dois ciclos de folga. Amarrar os dois é o que impede
 * o throttle de virar letra morta se a cadência mudar na VPS. Mora aqui
 * (puro, seguro no cliente) porque worker E legenda do painel a usam — a
 * legenda imprime o valor, e um número digitado à mão mentiria na
 * primeira mudança de cadência.
 */
export const THROTTLE_MS = CICLO_MINUTOS * 2 * 60_000

/** Abaixo disso a espera nem é EXIBIDA — meia hora útil de fila é
 *  operação normal. É régua de exibição, não de alarme: o cartão que já
 *  existe por outro motivo mostra "aguardando há 40min" como contexto. */
export const LIMIAR_PENDENCIA_SEG = 30 * 60

/**
 * A espera que, SOZINHA, faz a conversa virar cartão: 24h CORRIDAS.
 *
 * ⚠️ Corridas, não úteis — decisão do operador (2026-08-30). Em horas
 * úteis (seg–sex 08h–19h = 11h/dia) "24h" seriam dois dias e meio de
 * calendário, e "48h" quase uma semana: o alarme dispararia tarde demais
 * para o cliente que escreveu na sexta. A EXIBIÇÃO segue em horas úteis
 * (`LIMIAR_PENDENCIA_SEG`), que é a régua justa com a equipe — as duas
 * réguas convivem de propósito, cada uma respondendo a sua pergunta:
 * "há quanto tempo o cliente espera?" (corrido) e "quanto disso foi
 * expediente?" (útil).
 */
export const LIMIAR_ALARME_MS = 24 * 3_600_000

const MS_72H = 72 * 3_600_000

export interface InsightParaOrdenacao {
  urgencia: Urgencia
  insatisfacao: boolean
  pedidosAbertos: number
  /** Segundos ÚTEIS aguardando resposta AGORA (o chamador calcula ao
   *  vivo com `segundosUteisEntre` — o valor gravado no banco envelhece). */
  aguardandoSegUteis: number | null
  /** Milissegundos CORRIDOS da mesma espera — a régua do ALARME
   *  (`LIMIAR_ALARME_MS`). Separada da de cima porque as duas respondem
   *  perguntas diferentes; ver o comentário do limiar. Null quando não há
   *  pendência viva — inclusive quando a equipe JÁ respondeu e o painel
   *  descobriu isso ao vivo, antes de o worker reanalisar. */
  aguardandoMsCorridos: number | null
  nota: number | null
  estado: EstadoDoInsight
  ultimaAtividade: Date | null
  /** Conversa cuja atividade saiu da janela do Radar, mantida no painel
   *  SÓ porque o cliente segue aguardando resposta (pendência aberta).
   *  A análise dela é congelada — por isso os cartões de urgência/
   *  insatisfação/nota a ignoram; só a pendência conta. */
  foraDaJanela?: boolean
}

/**
 * O ALARME: esta análise merece um cartão no painel?
 *
 * ⚠️ É a regra que separa o Radar de um boletim de todas as conversas.
 * Antes dela (até 2026-08-30) o painel exibia TODA análise concluída, e
 * conversa nota 10 sem sinal nenhum entrava na fila de tratar/descartar
 * junto com o cliente irritado — medido em produção: 7 dos 8 cartões
 * abertos não tinham nada a tratar. O Radar existe para apontar
 * PROBLEMA; a análise de uma conversa saudável continua sendo gravada
 * (a nota média da semana sai dela), só não vira trabalho para ninguém.
 *
 * São os quatro sinais que o escritório nomeou como acionáveis. O que
 * deliberadamente NÃO entra:
 *   - nota baixa sozinha — é julgamento de qualidade, não pendência; o
 *     que houver de concreto já aparece como pedido/insatisfação;
 *   - `mencaoProcesso` sozinha — num escritório bancário quase toda
 *     conversa cita processo. É contexto, e como alarme viraria ruído
 *     universal (3 das 14 primeiras análises acenderiam sem motivo);
 *   - `pontosDeAtencao` — o campo que a IA usa para resumir o CASO do
 *     cliente ("detalhamento de dívidas bancárias"). Segue visível no
 *     cartão expandido, nunca como motivo para abrir um.
 */
export function temGatilho(i: InsightParaOrdenacao): boolean {
  if (i.insatisfacao) return true
  if (i.pedidosAbertos > 0) return true
  if (i.urgencia === 'alta' || i.urgencia === 'media') return true
  return (i.aguardandoMsCorridos ?? 0) >= LIMIAR_ALARME_MS
}

export function pontuacaoDeSeveridade(i: InsightParaOrdenacao, agora: Date): number {
  let score = 0
  if (i.urgencia === 'alta') score += 100
  else if (i.urgencia === 'media') score += 60
  else if (i.urgencia === 'baixa') score += 30

  if (i.insatisfacao) score += 40
  score += Math.min(i.pedidosAbertos, 3) * 15

  // Degraus na régua CORRIDA, a mesma do alarme — com os antigos (4h/1h/
  // 30min ÚTEIS) toda conversa do dia pontuava aqui, e a espera deixava
  // de ordenar coisa alguma justamente quando passava a ser o gatilho.
  const esperaMs = i.aguardandoMsCorridos ?? 0
  if (esperaMs >= 72 * 3_600_000) score += 50
  else if (esperaMs >= 48 * 3_600_000) score += 35
  else if (esperaMs >= LIMIAR_ALARME_MS) score += 20

  if (i.nota !== null) {
    if (i.nota <= 4) score += 20
    else if (i.nota <= 6) score += 10
  }

  // Prioridade às últimas 72h: bônus, nunca critério de corte.
  const atividade = i.ultimaAtividade?.getTime()
  if (atividade && agora.getTime() - atividade <= MS_72H) score += 15

  return score
}

/**
 * Mais grave primeiro; empate vai para a atividade mais recente.
 * Tratado/descartado caem para depois de todo aberto — continuam
 * visíveis (na aba "todos"), mas nunca acima do que ainda pede ação.
 */
export function ordenarPorSeveridade<T>(
  itens: T[],
  chave: (t: T) => InsightParaOrdenacao,
  agora: Date,
): T[] {
  const rank = (e: EstadoDoInsight) => (e === 'aberto' ? 0 : 1)
  // Decora UMA vez por item antes de ordenar (transformada de Schwartz):
  // `chave` roda `segundosUteisEntre` (laço dia a dia) — dentro do
  // comparador ela executaria ~2× por comparação, milhares de vezes numa
  // lista de 200.
  return itens
    .map((item) => {
      const ord = chave(item)
      return {
        item,
        rank: rank(ord.estado),
        score: pontuacaoDeSeveridade(ord, agora),
        atividade: ord.ultimaAtividade?.getTime() ?? 0,
      }
    })
    .sort(
      (a, b) => a.rank - b.rank || b.score - a.score || b.atividade - a.atividade,
    )
    .map((d) => d.item)
}

export interface CartoesDoRadar {
  /** Urgências (média/alta) ainda abertas. */
  urgencias: number
  /** Insatisfações ainda abertas. */
  insatisfacoes: number
  /** Conversas abertas com cliente aguardando além de `LIMIAR_ALARME_MS`. */
  pendencias: number
  /** Média das notas da janela (todas as analisadas, tratadas ou não —
   *  a qualidade da semana não muda porque alguém clicou em "tratado"). */
  notaMedia: number | null
}

export function resumirCartoes(itens: InsightParaOrdenacao[]): CartoesDoRadar {
  const abertos = itens.filter((i) => i.estado === 'aberto')
  // Linha fora da janela entra SÓ na pendência: a urgência/insatisfação/
  // nota dela vêm de uma análise congelada de dias atrás, e o cartão de
  // nota promete "7 dias" — mas a pendência é ESTADO, não evento, e segue
  // verdadeira enquanto ninguém responde.
  const naJanela = abertos.filter((i) => !i.foraDaJanela)
  const notas = itens
    .filter((i) => !i.foraDaJanela)
    .map((i) => i.nota)
    .filter((n): n is number => n !== null)
  return {
    urgencias: naJanela.filter((i) => i.urgencia === 'alta' || i.urgencia === 'media')
      .length,
    insatisfacoes: naJanela.filter((i) => i.insatisfacao).length,
    // O MESMO limiar da lista: contado pela régua de exibição, o cartão
    // dizia "6 sem resposta" sobre uma lista onde nenhuma delas aparecia.
    pendencias: abertos.filter(
      (i) => (i.aguardandoMsCorridos ?? 0) >= LIMIAR_ALARME_MS,
    ).length,
    notaMedia:
      notas.length > 0
        ? Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 10) / 10
        : null,
  }
}
