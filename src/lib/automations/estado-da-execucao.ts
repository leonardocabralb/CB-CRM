// ============================================================
// O DESFECHO de uma execução de automação (migration 985) — puro, testável.
//
// Existe porque `automation_logs.status` não responde "como isto terminou?":
//
//   * ele nasce `'failed'` no INSERT, ANTES do primeiro passo rodar (semente
//     pessimista da issue #409 — execução que morre no meio não pode parecer
//     sucesso), então "failed" também significa "acabou de começar";
//   * quando uma condição desvia para um ramo VAZIO, o log termina
//     `'success'`. A execução que uma trava por etiqueta barrou é registrada
//     como "concluída com sucesso" — a mentira que fez esta feature nascer.
//
// A régua mora aqui, e não dentro do motor, porque a pergunta é de negócio e
// tem um caso de borda que só se enxerga escrito: o que conta como "barrada".
// ============================================================

export type Desfecho = 'concluida' | 'barrada' | 'falhou'

export interface EstadoDoEscopo {
  /** Algum passo estourou — aqui ou num ramo abaixo. */
  falhou: boolean
  /** Alguma condição desviou para um ramo SEM passo nenhum. */
  barrouPorCondicao: boolean
  /**
   * A execução fez algo além de avaliar condições: um passo comum rodou sem
   * erro, ou um ramo tinha passos e rodou.
   */
  fezTrabalho: boolean
}

/**
 * ⚠️ `barrada` é ESTREITA de propósito: só quando a execução **não fez
 * trabalho nenhum**. `[condição de ramo vazio]` sozinha é barrada;
 * `[enviar mensagem][condição de ramo vazio]` é `concluida`, porque a
 * mensagem SAIU — chamar isso de "interrompida" seria trocar uma mentira por
 * outra, e a nova seria pior: o operador leria "não rodou" sobre uma
 * automação que já falou com o cliente.
 *
 * ⚠️ O critério é "fez trabalho?", nunca "em que ORDEM os passos aparecem?".
 * Não é preciosismo: `steps_executed` NÃO é cronológico quando há ramo cheio
 * — o ramo faz seu próprio `appendResults` de dentro da recursão, antes de o
 * escopo de fora gravar o dele. Uma régua baseada no último elemento do array
 * (`at(-1)`) responde certo em `[condição vazia]` e errado em
 * `[condição vazia][condição cheia]`, onde a condição barrada desaparece.
 */
export function desfechoDoEscopo(estado: EstadoDoEscopo): Desfecho {
  if (estado.falhou) return 'falhou'
  if (!estado.fezTrabalho && estado.barrouPorCondicao) return 'barrada'
  return 'concluida'
}

/**
 * O desfecho a gravar quando o que se tem em mão é o STATUS de retorno do
 * escopo — o caso do resume, que acorda no meio da automação e não viu as
 * condições que já foram avaliadas.
 *
 * `null` quer dizer "não feche": ou a execução parou noutro "Aguardar"
 * (`partial`), ou não há o que afirmar. Nunca inventa `barrada` aqui: quem
 * sabe que houve barreira é o escopo que avaliou a condição, e o resume não
 * estava lá.
 */
export function desfechoDoRetorno(
  status: 'success' | 'partial' | 'failed' | null,
): Desfecho | null {
  if (status === 'failed') return 'falhou'
  if (status === 'partial') return null
  return 'concluida'
}

/**
 * Os mesmos dois sinais, lidos do REGISTRO PERSISTIDO (`steps_executed`).
 *
 * ⚠️⚠️ Existe porque as variáveis do motor vivem numa CHAMADA, e uma execução
 * com "Aguardar" atravessa várias: quem retoma a espera acorda no meio da
 * automação com os contadores zerados e só enxerga o trecho DEPOIS da espera.
 * Medido no desenho de `[enviar][aguardar][condição de ramo vazio]` — que é a
 * forma do follow-up de no-show: a retomada não fez trabalho, achou a
 * barreira, e fechava o log como `barrada`, ou seja, "a automação não fez
 * nada" sobre uma execução que já tinha falado com o cliente. É o inverso
 * exato do que `desfechoDoEscopo` promete (Codex, PR #155).
 *
 * O histórico atravessa as chamadas porque `appendResults` acumula na coluna
 * — os ramos inclusive, que gravam de dentro da recursão.
 *
 * ⚠️ Não SUBSTITUI os contadores do motor, soma-se a eles: a leitura do log
 * pode voltar vazia (o `appendResults` ignora erro de leitura e regrava só o
 * trecho novo), e o trecho em curso é o único que a memória conhece com
 * certeza. Cada fonte cobre um pedaço do tempo; a régua é o OU.
 *
 * ⚠️ `wait` não conta como trabalho: esperar não é efeito no mundo. `condition`
 * também não — avaliar não é agir, e é justamente essa distinção que faz
 * `barrada` existir.
 */
export function sinaisDoHistorico(
  passos: unknown,
): { fezTrabalho: boolean; barrouPorCondicao: boolean } {
  // JSONB: pode ter sido gravado por uma versão que não conhecia um campo de
  // hoje, e a coluna é nula em todo log que ainda não rodou passo nenhum.
  if (!Array.isArray(passos)) return { fezTrabalho: false, barrouPorCondicao: false }

  let fezTrabalho = false
  let barrouPorCondicao = false

  for (const bruto of passos) {
    if (!bruto || typeof bruto !== 'object') continue
    const passo = bruto as { step_type?: unknown; status?: unknown }
    const tipo = typeof passo.step_type === 'string' ? passo.step_type : ''
    const status = typeof passo.status === 'string' ? passo.status : ''

    if (tipo === 'condition') {
      // O motor marca `skipped` na entrada da condição quando o ramo escolhido
      // não tinha passo nenhum. É a assinatura da barreira.
      if (status === 'skipped') barrouPorCondicao = true
      continue
    }
    if (tipo === 'wait') continue
    if (status === 'success') fezTrabalho = true
  }

  return { fezTrabalho, barrouPorCondicao }
}
