// ============================================================
// As AÇÕES que o agente devolve JUNTO com a resposta (F4, D28 do
// docs/PLANO-agentes-de-ia.md). PURO, testado.
//
// Não há laço de ferramentas: o modelo escreve a resposta ao cliente e, no
// fim, marcadores no mesmo protocolo do `[[PASSAR:n]]` da F2 —
// `[[MOVER:n]]`, `[[ETIQUETAR:n]]`, `[[TIRAR:n]]`, `[[CAMPO:n=valor]]`,
// `[[TAREFA:n=título]]`, `[[AUTOMACAO:n]]` e, na F5, `[[REUNIAO:n]]` (um dos
// horários livres do Calendly; com o nome completo que o cliente deu,
// `[[REUNIAO:n=Nome]]`, opcional). O `n` é o número de uma opção
// que o SERVIDOR listou no pedido (`OpcoesDeAcao`, com os nomes); o servidor
// traduz o número para o id. Número fora da lista = recusada.
//
// ⚠️⚠️ O marcador NUNCA chega ao cliente: `lerAcoes` tira do texto TODO
// `[[…]]`, inclusive o malformado e o que ficou aberto no fim (resposta
// cortada pelo teto de tokens), e o marcador de ação que o modelo escreveu
// com colchete SIMPLES, acento ou outra caixa (`[MOVER:1]`, `[[AUTOMAÇÃO:1]]`).
//
// Também aqui (puros):
//  - a trava de LINK INVENTADO: toda URL da resposta tem de ter aparecido,
//    como URL, no que foi mandado ao modelo (o pedido montado e as mensagens
//    da conversa) — modelo inventa link de boleto;
//  - a régua da D5 sobre os passos da automação que o AGENTE executa
//    (`motivoForaDaD5`), atravessando as que ela aciona por `run_automation`,
//    com trava de ciclo — e SÓ elas: desde 27/09/2026 a D5 vale só para o
//    que o agente faz, sem a cascata das automações de etapa e de etiqueta;
//  - os campos de DATA vigiados por lembrete (`camposVigiados`);
//  - o formato do valor de cada campo (`formatoDoCampo`, `valorDoCampo`);
//  - o parse do registro das ações do turno (`cb_ia_turnos.acoes`).
// ============================================================

import { paraInstante } from '@/lib/agenda/fuso'
import { FUSO_DO_ESCRITORIO, instanteCanonico, TIPO_DATA } from '@/lib/contacts/campo-data'
import { opcoesDoCampo } from '@/lib/contacts/campo-opcoes'
import { ESPELHO_DO_EMAIL } from '@/lib/contacts/email-espelhado'
import type { CustomField } from '@/types'

import { TIPOS_DE_ACAO, type TipoDeAcao } from './agente'

// ------------------------------------------------------------
// O formato do valor de um campo (o pedido diz, a execução confere)
// ------------------------------------------------------------

/**
 * Como o valor de um campo personalizado tem de vir. O pedido diz ao modelo
 * (`pedido.ts`) e a execução confere (`valorDoCampo`): o campo é TEXT no
 * banco, e um "amanhã" num campo de data ou "R$ 1.500" num campo numérico
 * ficariam gravados sem ninguém ver.
 */
export type FormatoDoCampo =
  | { tipo: 'texto' }
  /** `datetime` (935): no banco, o instante em UTC (`instanteCanonico`). */
  | { tipo: 'data' }
  | { tipo: 'numero' }
  /** `select`: só uma das opções (grava a grafia da opção). */
  | { tipo: 'lista'; opcoes: string[] }
  /** O campo que ESPELHA `contacts.email` (1000). */
  | { tipo: 'email' }

/** O formato pela linha de `custom_fields`. O espelho do e-mail vence o tipo. */
export function formatoDoCampo(campo: {
  field_type: string | null
  field_options?: unknown
  espelho?: string | null
}): FormatoDoCampo {
  if (campo.espelho === ESPELHO_DO_EMAIL) return { tipo: 'email' }
  if (campo.field_type === TIPO_DATA) return { tipo: 'data' }
  if (campo.field_type === 'number') return { tipo: 'numero' }
  if (campo.field_type === 'select') {
    const opcoes =
      campo.field_options && typeof campo.field_options === 'object' && !Array.isArray(campo.field_options)
        ? opcoesDoCampo({ field_options: campo.field_options } as CustomField)
        : []
    return { tipo: 'lista', opcoes }
  }
  return { tipo: 'texto' }
}

/** A forma mínima de um e-mail (a do cadastro por convite). */
const FORMA_DE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** Número: só dígitos, com `.` como separador decimal (a forma do `<input type="number">`). */
const FORMA_DE_NUMERO = /^-?\d+(\.\d+)?$/
/** `YYYY-MM-DD`, com a hora opcional (`HH:MM` ou `HH:MM:SS`), sem fuso: a hora do escritório. */
const DATA_SEM_FUSO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/

/** Um dia e hora de parede, no fuso do escritório → o instante canônico. `null` = não existe. */
function instanteDaParede(texto: string): string | null {
  const m = DATA_SEM_FUSO.exec(texto)
  if (!m) return null
  const [, ano, mes, dia, hora = '00', minuto = '00', segundo = '00'] = m
  // Dia que não existe no mês (31/09) e hora fora do relógio: recusados, como
  // em `instanteCanonico` — o `Date` os empurraria para a frente em silêncio.
  if (new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia))).getUTCDate() !== Number(dia)) return null
  if (Number(mes) < 1 || Number(mes) > 12 || Number(hora) > 23 || Number(minuto) > 59 || Number(segundo) > 59) {
    return null
  }
  const instante = paraInstante(`${ano}-${mes}-${dia}`, `${hora}:${minuto}`, FUSO_DO_ESCRITORIO)
  return Number.isNaN(instante.getTime()) ? null : instante.toISOString()
}

/**
 * O valor que o modelo mandou, conferido contra o formato do campo, e a forma
 * em que ele é GRAVADO. `null` = não serve (`valor_invalido`).
 *  - data: com fuso escrito, o instante canônico (a regra do passo
 *    `update_contact_field`); sem fuso, o dia (e a hora) no fuso do
 *    escritório. Ilegível ou dia que não existe = `null`;
 *  - número: só dígitos e ponto decimal;
 *  - lista: uma das opções, sem caixa e sem espaço nas pontas — grava a
 *    grafia da OPÇÃO;
 *  - e-mail: a forma de um e-mail.
 */
export function valorDoCampo(valor: string, formato: FormatoDoCampo): string | null {
  const v = valor.trim()
  if (!v) return null
  switch (formato.tipo) {
    case 'texto':
      return v
    case 'data':
      return instanteCanonico(v) ?? instanteDaParede(v)
    case 'numero':
      return FORMA_DE_NUMERO.test(v) ? v : null
    case 'lista': {
      const chave = v.toLocaleLowerCase('pt-BR')
      return formato.opcoes.find((o) => o.trim().toLocaleLowerCase('pt-BR') === chave) ?? null
    }
    case 'email':
      return FORMA_DE_EMAIL.test(v) ? v : null
    default: {
      const nunca: never = formato
      throw new Error(`formato desconhecido: ${String(nunca)}`)
    }
  }
}

/**
 * O valor que a ficha JÁ tem (`atual`, o `contact_custom_values.value`) é o
 * mesmo que se vai gravar (`novo`, a saída de `valorDoCampo`)? Aparado e sem
 * caixa; na data, pelo INSTANTE (o gravado por outro escritor pode estar em
 * outra forma do mesmo horário). O modelo repete em cada resposta as ações
 * das anteriores, e regravar o mesmo valor deixaria uma anotação a cada
 * resposta. Sem valor gravado = não é o mesmo.
 */
export function mesmoValorDoCampo(atual: unknown, novo: string, formato: FormatoDoCampo): boolean {
  if (typeof atual !== 'string' || !atual.trim()) return false
  const chave = (v: string): string => {
    const aparado = v.trim()
    return (formato.tipo === 'data' ? (instanteCanonico(aparado) ?? aparado) : aparado).toLocaleLowerCase('pt-BR')
  }
  return chave(atual) === chave(novo)
}

// ------------------------------------------------------------
// As opções e os marcadores
// ------------------------------------------------------------

/**
 * Uma opção que o servidor oferece ao modelo, numerada a partir de 1 na ordem
 * da lista. Na reunião (`marcar_reuniao`, F5): `id` = o `start_time` do
 * horário livre (ISO, UTC), `nome` = o horário para GENTE ler ("28/09/2026
 * 15:15", no fuso do escritório — vai ao registro do turno, ao Playground e
 * à anotação) e `textoNoPedido` = o horário para o MODELO ("Mon 28/09 15:15",
 * com o dia da semana em inglês — `reuniao.ts`).
 */
export interface OpcaoDeAcao {
  id: string
  nome: string
  /** O texto da linha no PEDIDO, quando não é o `nome` (a reunião). */
  textoNoPedido?: string
  /** Só nos campos (`preencher_campo`): o formato do valor, que o pedido diz ao modelo. */
  formato?: FormatoDoCampo
}

/** As opções de cada tipo liberado NAQUELE agente. Tipo ausente ou vazio = não oferecido. */
export type OpcoesDeAcao = Partial<Record<TipoDeAcao, OpcaoDeAcao[]>>

/** O marcador de cada tipo, como o modelo o escreve. */
export const MARCADOR_DA_ACAO: Record<TipoDeAcao, string> = {
  mover_etapa: 'MOVER',
  etiquetar: 'ETIQUETAR',
  tirar_etiqueta: 'TIRAR',
  preencher_campo: 'CAMPO',
  criar_tarefa: 'TAREFA',
  executar_automacao: 'AUTOMACAO',
  // `[[REUNIÃO:n]]` também: o nome é lido sem acento (`nomeNormalizado`).
  marcar_reuniao: 'REUNIAO',
}

/** Os tipos que levam `=valor` (o valor do campo, o título da tarefa). */
export const ACOES_COM_VALOR: ReadonlySet<TipoDeAcao> = new Set(['preencher_campo', 'criar_tarefa'])

/**
 * Os tipos em que o `=valor` é OPCIONAL: a reunião, `[[REUNIAO:n=Nome
 * Completo]]` — o nome que o cliente deu na conversa (`nomeDoConvidado`).
 * Nome que não serve é ignorado (a reunião vai com o nome da ficha), nunca
 * recusa a reunião.
 */
export const ACOES_COM_VALOR_OPCIONAL: ReadonlySet<TipoDeAcao> = new Set(['marcar_reuniao'])

export const LIMITES_DAS_ACOES = {
  /** Ações por resposta; o que passar é recusado (`teto`). */
  porResposta: 10,
  /** Valor de campo, depois de aparado. */
  valorDoCampo: 500,
  /** Título da tarefa (o mesmo teto de `cb_tasks`). */
  tituloDaTarefa: 200,
  /** O nome do convidado na reunião (`[[REUNIAO:n=Nome]]`). */
  nomeDoConvidado: 120,
} as const

/**
 * O nome completo que o modelo passou na reunião (`[[REUNIAO:n=Nome]]`),
 * aparado e numa linha, com 2 a 120 caracteres e pelo menos uma letra. `null`
 * = não serve: a reunião vai com o nome da ficha (nunca é recusada por isso).
 */
export function nomeDoConvidado(valor: string | null | undefined): string | null {
  const nome = (valor ?? '').replace(/\s+/g, ' ').trim()
  if (nome.length < 2 || nome.length > LIMITES_DAS_ACOES.nomeDoConvidado) return null
  return /\p{L}/u.test(nome) ? nome : null
}

/** Por que uma ação pedida não vai executar. A tela traduz o código. */
export type MotivoDaRecusa =
  /** O marcador não tem a forma (número ilegível, valor vazio ou longo demais). */
  | 'malformada'
  /** Passou de `LIMITES_DAS_ACOES.porResposta`. */
  | 'teto'
  /** O tipo não está liberado neste agente (ou não tem item). */
  | 'nao_liberada'
  /** O número não é de nenhuma opção listada. */
  | 'fora_da_lista'
  /** A resposta foi uma passagem (D25): as ações não executam. */
  | 'passagem'
  /** A resposta transfere para gente: as ações não executam. */
  | 'transferencia'

export interface AcaoPedida {
  tipo: TipoDeAcao
  n: number
  /** O valor do campo ou o título da tarefa, aparado e numa linha. */
  valor?: string
}

export interface RecusaDeAcao {
  tipo: TipoDeAcao
  /** O número pedido (nulo quando nem ele se leu). */
  n: number | null
  motivo: MotivoDaRecusa
}

export interface LeituraDasAcoes {
  /** A resposta ao cliente, SEM nenhum marcador. */
  texto: string
  pedidas: AcaoPedida[]
  /** As que já se recusam na leitura (forma, teto). */
  recusadas: RecusaDeAcao[]
  /**
   * O modelo escreveu o sentinela de transferência numa forma que o
   * `generateReply` não reconhece (`[[ handoff ]]`, `[[Handoff]]`,
   * `[HANDOFF]`) — ou a passagem com colchete simples (`[PASSAR:n]`), que
   * não é passagem: transfere, como o sentinela exato.
   */
  transferir: boolean
}

/** Maiúsculas, sem acento: "Automação" → "AUTOMACAO". */
function nomeNormalizado(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
}

const TIPO_DO_MARCADOR = new Map<string, TipoDeAcao>(
  TIPOS_DE_ACAO.map((t) => [MARCADOR_DA_ACAO[t], t]),
)
/** Marcadores de controle que também saem do texto no colchete simples. */
const MARCADORES_DE_CONTROLE = new Set(['PASSAR', 'HANDOFF'])

/** Onde um marcador estava: o texto o troca por isto antes da limpeza final. */
const LUGAR = '\u0000'

/**
 * Um marcador na resposta:
 *  1. `[[…]]` fechado (com `]` a mais no fim: `[[MOVER:1]]]`), que pode
 *     atravessar linhas mas NÃO atravessa outro `[[` — um `[[` aberto antes
 *     de um marcador válido não engole o texto até ele;
 *  2. `[NOME:…]` com colchete simples (ou um lado dobrado), numa linha — só
 *     vira marcador quando NOME é de ação ou de controle; o resto é texto
 *     ("[Obs: …]" fica). Sem dois-pontos, só o `[HANDOFF]`.
 * `[[HANDOFF]]` sem dois-pontos cai no 1.
 */
const MARCADOR = /\[\[((?:(?!\[\[)[\s\S])*?)\]\]+|\[{1,2}[ \t]*(\p{L}+)[ \t]*(?::([^[\]\n]*))?\]{1,2}/gu
/** O miolo de um marcador de ação: `TIPO : n` e, opcional, `= valor`. */
const MIOLO = /^\s*(\p{L}+)\s*:\s*([^=]*?)\s*(?:=([\s\S]*))?$/u
/** `[NOME:…` de ação ou controle que ficou aberto até o fim (resposta cortada). */
const SIMPLES_ABERTO = /\[{1,2}[ \t]*(\p{L}+)[ \t]*:[^[\]\n]*$/u

function numaLinha(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim()
}

/**
 * Lê os marcadores de ação da resposta do modelo e devolve o texto LIMPO.
 * Tolera espaço, caixa, acento e colchete simples. Tira do texto todo
 * `[[…]]` — o de ação, o `[[PASSAR:n]]`, o sentinela e o que não se
 * reconhece —, o `[[` aberto no FIM (só o do fim: um `[[` solto no meio sai
 * sozinho, sem levar o texto) e as crases que envolviam só o marcador.
 * Marcador de ação com forma errada vira recusada (`malformada`); passado o
 * teto de ações, `teto`.
 */
export function lerAcoes(texto: string): LeituraDasAcoes {
  const pedidas: AcaoPedida[] = []
  const recusadas: RecusaDeAcao[] = []
  let transferir = false

  const ler = (miolo: string): void => {
    if (/^\s*handoff\s*$/i.test(miolo)) {
      transferir = true
      return
    }
    const m = MIOLO.exec(miolo)
    if (!m) return
    const tipo = TIPO_DO_MARCADOR.get(nomeNormalizado(m[1]))
    // PASSAR, HANDOFF e o que não é ação: só saem do texto.
    if (!tipo) return
    const n = /^\d+$/.test(m[2]) ? Number.parseInt(m[2], 10) : Number.NaN
    if (!Number.isSafeInteger(n) || n < 1) {
      recusadas.push({ tipo, n: null, motivo: 'malformada' })
      return
    }
    let valor: string | undefined
    if (ACOES_COM_VALOR.has(tipo)) {
      valor = numaLinha(m[3] ?? '')
      const teto = tipo === 'preencher_campo' ? LIMITES_DAS_ACOES.valorDoCampo : LIMITES_DAS_ACOES.tituloDaTarefa
      if (!valor || valor.length > teto) {
        recusadas.push({ tipo, n, motivo: 'malformada' })
        return
      }
    } else if (ACOES_COM_VALOR_OPCIONAL.has(tipo) && m[3] !== undefined) {
      // Opcional: vazio vale como ausente; quem confere a forma é `resolverAcoes`.
      valor = numaLinha(m[3]) || undefined
    }
    if (pedidas.length >= LIMITES_DAS_ACOES.porResposta) {
      recusadas.push({ tipo, n, motivo: 'teto' })
      return
    }
    pedidas.push(valor === undefined ? { tipo, n } : { tipo, n, valor })
  }

  const conhecido = (nome: string): boolean => {
    const normalizado = nomeNormalizado(nome)
    return TIPO_DO_MARCADOR.has(normalizado) || MARCADORES_DE_CONTROLE.has(normalizado)
  }

  let limpo = texto.replace(MARCADOR, (inteiro, duplo?: string, nome?: string, resto?: string) => {
    if (duplo !== undefined) {
      ler(duplo)
      return LUGAR
    }
    if (!nome) return inteiro
    if (resto === undefined) {
      if (nomeNormalizado(nome) !== 'HANDOFF') return inteiro
      transferir = true
      return LUGAR
    }
    if (!conhecido(nome)) return inteiro
    // `[PASSAR:n]` com colchete simples NÃO é passagem (`lerPassagem` só lê o
    // `[[…]]`); a intenção era entregar a conversa, então transfere para gente
    // — nunca manda ao cliente um "vou te passar" sem passagem nenhuma.
    if (nomeNormalizado(nome) === 'PASSAR') transferir = true
    else ler(`${nome}:${resto}`)
    return LUGAR
  })

  // O que ficou aberto no FIM (a resposta cortada pelo teto de tokens): o
  // último `[[` sem marcador depois dele, e o `[NOME:` de ação sem fechar.
  const ultimo = limpo.lastIndexOf('[[')
  if (ultimo >= 0 && !limpo.slice(ultimo).includes(LUGAR) && !limpo.slice(ultimo).includes(']]')) {
    limpo = limpo.slice(0, ultimo)
  }
  const aberto = SIMPLES_ABERTO.exec(limpo)
  if (aberto && conhecido(aberto[1])) limpo = limpo.slice(0, aberto.index)

  limpo = limpo
    // `[[` solto no meio: sai sozinho (com o espaço que vinha depois dele).
    .replace(/\[\[[ \t]*/g, '')
    // As crases (ou o bloco de código) que envolviam SÓ marcadores: "`[[MOVER:1]]`".
    .replace(new RegExp(`(\`+)\\s*(?:${LUGAR}\\s*)+\\1`, 'g'), LUGAR)
    // O marcador sai com os espaços em volta ("Ok [[MOVER:1]] feito" → "Ok feito").
    .replace(new RegExp(`(^|\\n)(?:[ \\t]*${LUGAR})+[ \\t]*`, 'g'), '$1')
    .replace(new RegExp(`(?:[ \\t]*${LUGAR})+[ \\t]*`, 'g'), ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { texto: limpo, pedidas, recusadas, transferir }
}

/** Uma ação com os IDS do servidor, pronta para executar. */
export interface AcaoResolvida {
  tipo: TipoDeAcao
  id: string
  nome: string
  /** O valor do campo, o título da tarefa ou, na reunião, o nome do convidado (`nomeDoConvidado`). */
  valor?: string
}

/**
 * Número → id, pelas opções que o SERVIDOR listou no pedido. Tipo não
 * liberado ou número fora da lista = recusada. Repetidas colapsam: a mesma
 * etapa, etiqueta ou automação uma vez só; o mesmo campo fica com o ÚLTIMO
 * valor pedido; tarefa repetida só com o mesmo título (títulos diferentes
 * para a mesma pessoa são tarefas diferentes).
 *
 * ⚠️ UMA reunião por resposta (F5): o mesmo horário pedido duas vezes
 * colapsa; um SEGUNDO horário diferente é recusado (`teto`) — só o primeiro
 * é marcado. O número fora dos horários oferecidos é `fora_da_lista`: o
 * modelo nunca marca um horário que o servidor não leu no Calendly.
 */
export function resolverAcoes(
  pedidas: readonly AcaoPedida[],
  opcoes: OpcoesDeAcao,
): { aceitas: AcaoResolvida[]; recusadas: RecusaDeAcao[] } {
  const aceitas: AcaoResolvida[] = []
  const recusadas: RecusaDeAcao[] = []
  const indiceDe = new Map<string, number>()
  for (const p of pedidas) {
    const lista = opcoes[p.tipo] ?? []
    if (lista.length === 0) {
      recusadas.push({ tipo: p.tipo, n: p.n, motivo: 'nao_liberada' })
      continue
    }
    const opcao = lista[p.n - 1]
    if (!opcao) {
      recusadas.push({ tipo: p.tipo, n: p.n, motivo: 'fora_da_lista' })
      continue
    }
    const chave = p.tipo === 'criar_tarefa' ? `${p.tipo}|${opcao.id}|${p.valor}` : `${p.tipo}|${opcao.id}`
    const ja = indiceDe.get(chave)
    if (ja !== undefined) {
      if (p.tipo === 'preencher_campo') aceitas[ja] = { ...aceitas[ja], valor: p.valor }
      continue
    }
    if (p.tipo === 'marcar_reuniao' && aceitas.some((a) => a.tipo === 'marcar_reuniao')) {
      recusadas.push({ tipo: p.tipo, n: p.n, motivo: 'teto' })
      continue
    }
    indiceDe.set(chave, aceitas.length)
    // Na reunião, o nome do convidado só vai quando tem a forma de um nome;
    // senão cai (a reunião vai com o nome da ficha), sem recusar a reunião.
    const valor = p.tipo === 'marcar_reuniao' ? (nomeDoConvidado(p.valor) ?? undefined) : p.valor
    aceitas.push(valor === undefined ? { tipo: p.tipo, id: opcao.id, nome: opcao.nome } : {
      tipo: p.tipo,
      id: opcao.id,
      nome: opcao.nome,
      valor,
    })
  }
  return { aceitas, recusadas }
}

/** Quantas opções há, somando os tipos (zero = o pedido não fala de ações). */
export function totalDeOpcoes(opcoes: OpcoesDeAcao): number {
  return TIPOS_DE_ACAO.reduce((n, t) => n + (opcoes[t]?.length ?? 0), 0)
}

// ------------------------------------------------------------
// A trava de link inventado (5.6)
// ------------------------------------------------------------

/**
 * `http(s)://…` ou `www.…` sem esquema (o modelo escreve assim). O `www.`
 * não pode vir colado a letra, `@`, ponto ou barra: "joao@www.x.com" é e-mail,
 * e o `www.` de "https://www.x.com" já está dentro da URL com esquema.
 */
const URL_NO_TEXTO = /\bhttps?:\/\/[^\s<>"'`]+|(?<![\p{L}\p{N}@./-])www\.[^\s<>"'`]+/giu
/**
 * O que encosta no FIM da URL sem ser dela: pontuação de fim de frase,
 * negrito/itálico do WhatsApp, e as aspas curvas e angulares ("…" ‘…’ «…»),
 * que o regex não corta porque não são as retas.
 */
const PONTUACAO_FINAL = /[.,;:!?)\]}*_~"'“”‘’«»]+$/

/** As URLs do texto, como escritas, sem a pontuação e as aspas que encostam no fim. */
export function urlsDoTexto(texto: string): string[] {
  return [...texto.matchAll(URL_NO_TEXTO)].map((m) => m[0].replace(PONTUACAO_FINAL, '')).filter((u) => u.length > 0)
}

/** A URL sem o esquema: "www.x.com/a" é a mesma de "https://www.x.com/a". */
function chaveDaUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '')
}

/**
 * Os links da resposta que NÃO vieram do que foi mandado ao modelo, como
 * escritos na resposta. `fontes` = o pedido montado (instruções, regras,
 * blocos de acesso, trechos da base) e as mensagens da conversa. A comparação
 * é por URL INTEIRA (sem o esquema), não por pedaço de texto: um link cortado
 * ("…/i/12" de "…/i/123") também é inventado — ele levaria o cliente a outro
 * lugar.
 */
export function linksInventados(texto: string, fontes: readonly string[]): string[] {
  const urls = urlsDoTexto(texto)
  if (urls.length === 0) return []
  const conhecidas = new Set(fontes.flatMap(urlsDoTexto).map(chaveDaUrl))
  return [...new Set(urls.filter((u) => !conhecidas.has(chaveDaUrl(u))))]
}

/** A resposta traz algum link inventado (`linksInventados`)? */
export function linkInventado(texto: string, fontes: readonly string[]): boolean {
  return linksInventados(texto, fontes).length > 0
}

// ------------------------------------------------------------
// A trava da REUNIÃO PROMETIDA (F5, 27/09/2026)
// ------------------------------------------------------------

/**
 * O particípio que afirma a reunião: "confirmada", "agendada", "marcada",
 * "remarcada", "reagendada" (e o plural), "booked", "scheduled",
 * "rescheduled", "confirmed". "Desmarcada" e "agendamento" não casam (o `\b`).
 */
const PARTICIPIO_DA_REUNIAO = /\b(?:confirmad|agendad|marcad|remarcad|reagendad)[ao]s?\b|\b(?:booked|scheduled|rescheduled|confirmed)\b/gi
/**
 * O que amarra o particípio a uma REUNIÃO na mesma frase: a palavra
 * ("reunião", "meeting", "consulta") ou um horário ("15:15", "15h", "15h30",
 * "15 horas", "3 pm") ou uma data com o mês em dois dígitos ("29/09" — não
 * a parcela "1/3"). Sem isso, "e-mail confirmado" não é reunião.
 */
const ANCORA_DA_REUNIAO =
  /reuni|meeting|appointment|consulta|\b\d{1,2}\s*(?::\s*\d{2}|h\s*\d{0,2}|horas?)\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}\/(?:0[1-9]|1[0-2])\b/i
/**
 * Palavras que, entre as QUATRO antes do particípio, fazem dele não-afirmação:
 * negação ("ainda não está marcada"), futuro ("será confirmada", "will be
 * booked"), modal e oferta ("posso deixar agendado", "quer que fique
 * marcado", "can be scheduled") e infinitivo ("para ser confirmada" — mas
 * "acabou DE ser marcada" afirma, ver `naoAfirma`). O "no" do inglês fica de
 * fora: em português é "no dia 29".
 */
const NAO_AFIRMA = new Set([
  'nao', 'nunca', 'nem', 'sera', 'serao', 'seria', 'seriam', 'ficara', 'ficarao', 'ficaria', 'ficariam', 'vai', 'vao',
  'ira', 'irao', 'vou', 'pode', 'podem', 'podera', 'poderia', 'possa', 'possam', 'podemos', 'posso', 'deve', 'devera',
  'deveria', 'precisa', 'ser', 'sendo', 'estar', 'estiver', 'estiverem', 'for', 'forem', 'fique', 'fiquem', 'ficar',
  'seja', 'sejam', 'quer', 'queira', 'gostaria', 'prefere', 'preferir',
  'not', 'never', 'will', 'would', 'can', 'cannot', 'could', 'may', 'might', 'should', 'must', 'be', 'being', 'to',
])
/** Condição ANTES do particípio, na mesma frase: "assim que você escolher, fica agendada". */
const CONDICAO = /(?:^|[^\p{L}])(?:se|caso|quando|assim que|apos|depois que|logo que|if|once|when|after|as soon as|unless)(?![\p{L}])/u
/** Logo DEPOIS do particípio: "marcado por outra pessoa" / "booked by someone else" — o horário tomado. */
const POR_OUTRO = /^\s*(?:por|by)\s+(?:outr|another|someone|other)/i
/** Pergunta de verdade (termina em "?"), menos a de confirmação no fim ("…, tudo bem?"), que afirma. */
const PERGUNTA = /\?[^\p{L}\p{N}]*$/u
const PERGUNTA_DE_CONFIRMACAO = /,\s*(?:tudo bem|ok|okay|certo|combinado|beleza|right|alright)\s*\?[^\p{L}\p{N}]*$/iu

/** Minúsculas e sem acento: "Após" → "apos". */
function semAcento(p: string): string {
  return p.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Uma palavra só com letras e apóstrofo: "Não," → "nao", "won’t" → "won't". */
function palavraNormalizada(p: string): string {
  return semAcento(p).replace(/\u2019/g, "'").replace(/[^a-z']/g, '')
}

/** As quatro palavras antes do particípio dizem que ele NÃO afirma a reunião? */
function naoAfirma(ultimas: readonly string[]): boolean {
  return ultimas.some(
    (p, i) =>
      (NAO_AFIRMA.has(p) && !(p === 'ser' && ultimas[i - 1] === 'de')) || p.endsWith("n't") || p.endsWith("'ll"),
  )
}

/**
 * O texto AFIRMA que uma reunião foi marcada, agendada, confirmada,
 * remarcada ou reagendada? Frase a frase: o particípio com a âncora (reunião
 * ou horário/data) na MESMA frase, sem negação, futuro, modal ou oferta nas
 * quatro palavras antes dele, sem condição antes dele na frase, sem "por
 * outra pessoa" logo depois e fora de pergunta. "Quer que eu marque para
 * terça às 15:15?" e "podemos agendar" não afirmam nada (não têm o
 * particípio). Heurística calibrada para o lado da cautela: o falso positivo
 * leva a conversa a gente; o falso negativo manda ao cliente uma
 * confirmação falsa.
 */
export function afirmaReuniaoMarcada(texto: string): boolean {
  for (const frase of texto.split(/(?<=[.!?…;])\s+|\n+/)) {
    const f = frase.trim()
    if (!f || !ANCORA_DA_REUNIAO.test(f)) continue
    if (PERGUNTA.test(f) && !PERGUNTA_DE_CONFIRMACAO.test(f)) continue
    for (const m of f.matchAll(PARTICIPIO_DA_REUNIAO)) {
      const antes = f.slice(0, m.index)
      if (naoAfirma(antes.split(/\s+/).map(palavraNormalizada).filter(Boolean).slice(-4))) continue
      if (CONDICAO.test(semAcento(antes))) continue
      if (POR_OUTRO.test(f.slice((m.index ?? 0) + m[0].length))) continue
      return true
    }
  }
  return false
}

/**
 * A trava: a resposta vai RETIDA e o turno transfere (`reuniao_prometida`)
 * quando "Marcar reunião" ofereceu horários NESTE turno (`horariosOferecidos`
 * > 0), o texto ao cliente — já sem os marcadores — afirma a reunião
 * (`afirmaReuniaoMarcada`) e nenhuma `marcar_reuniao` foi ACEITA: sem o
 * marcador nada é marcado, e o cliente receberia uma confirmação falsa
 * (medido em 27/09: 2 de 6 gerações). Sem horários oferecidos (reunião
 * desligada, leitura que falhou, cliente que já tem reunião — aí "sua
 * reunião está confirmada" é verdade) a trava não se aplica.
 */
export function reuniaoPrometida(args: {
  texto: string
  horariosOferecidos: number
  aceitas: ReadonlyArray<Pick<AcaoResolvida, 'tipo'>>
}): boolean {
  if (args.horariosOferecidos <= 0) return false
  if (args.aceitas.some((a) => a.tipo === 'marcar_reuniao')) return false
  return afirmaReuniaoMarcada(args.texto)
}

// ------------------------------------------------------------
// A D5 nos passos de uma automação que o AGENTE executa
// ------------------------------------------------------------

/** O passo que tira a automação da D5 (o código vai para a tela). */
export type MotivoForaDaD5 =
  | 'send_to_number'
  | 'send_webhook'
  | 'status_de_resultado'
  | 'etapa_de_resultado'
  | 'run_flow'
  | 'campo_vigiado'
  /** "Aguardar" na automação que a IA EXECUTA: a retomada não confere a pausa nem o agente. */
  | 'aguardar'

/**
 * O que a régua da D5 precisa saber da conta, além dos passos.
 *
 * ⚠️ D5 SÓ PARA O QUE O AGENTE FAZ (decisão do operador, 27/09/2026): a régua
 * NÃO percorre mais a CASCATA — as automações de ENTRADA da etapa para onde o
 * agente move o card e as de etiqueta aplicada rodam como quando alguém da
 * equipe move o card ou etiqueta. Nem as que um passo "Mover card"/"Adicionar
 * etiqueta" da automação executada dispararia.
 */
export interface ReguaDaD5 {
  /** Etapas com `pipeline_stages.resultado` (ganho/perdido). */
  etapasDeResultado: ReadonlySet<string>
  /** Campos de data vigiados por lembrete ligado (`camposVigiados`). */
  camposVigiados: ReadonlySet<string>
}

export interface PassoDaAutomacao {
  tipo: string
  config: Record<string, unknown>
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * O passo sai da D5? Mensagem para outro número, webhook de saída, ganho ou
 * perdido (pelo status ou por etapa com resultado — mover para ela ou criar
 * o card nela), iniciar robô (o `run_flow` não carrega origem nem contexto)
 * e preencher campo de data vigiado por lembrete (o cron dispararia aquela
 * automação depois — 5.6, Codex #292). O "Aguardar" é conferido à parte
 * (`motivoForaDaD5`).
 */
export function motivoDoPasso(p: PassoDaAutomacao, regua: ReguaDaD5): MotivoForaDaD5 | null {
  switch (p.tipo) {
    case 'send_to_number':
      return 'send_to_number'
    case 'send_webhook':
      return 'send_webhook'
    case 'run_flow':
      return 'run_flow'
    case 'set_deal_status':
      return p.config.status === 'won' || p.config.status === 'lost' ? 'status_de_resultado' : null
    case 'move_deal_stage':
    case 'create_deal': {
      const etapa = texto(p.config.stage_id)
      return etapa && regua.etapasDeResultado.has(etapa) ? 'etapa_de_resultado' : null
    }
    case 'update_contact_field': {
      const campo = texto(p.config.field)
      return campo?.startsWith('custom:') && regua.camposVigiados.has(campo.slice('custom:'.length))
        ? 'campo_vigiado'
        : null
    }
    default:
      return null
  }
}

/**
 * Percorre as automações a partir das raízes, seguindo SÓ o `run_automation`
 * (o agente agindo: a automação que ele executa aciona outra), com TRAVA DE
 * CICLO (A aciona B, B aciona A). `aoVisitar` devolve o motivo que para tudo.
 * Automação sem passos no mapa (de outra conta, apagada, ainda não lida) não
 * é percorrida.
 */
function percorrer(
  raizes: readonly string[],
  passosDe: ReadonlyMap<string, readonly PassoDaAutomacao[]>,
  aoVisitar: (id: string, passos: readonly PassoDaAutomacao[] | undefined) => MotivoForaDaD5 | null,
): MotivoForaDaD5 | null {
  const vistas = new Set<string>()
  const pilha = [...raizes].reverse()
  while (pilha.length > 0) {
    const id = pilha.pop() as string
    if (vistas.has(id)) continue
    vistas.add(id)
    const passos = passosDe.get(id)
    const motivo = aoVisitar(id, passos)
    if (motivo) return motivo
    const acionadas = (passos ?? [])
      .filter((p) => p.tipo === 'run_automation')
      .map((p) => texto(p.config.automation_id))
      .filter((alvo): alvo is string => alvo !== null)
    pilha.push(...acionadas.reverse())
  }
  return null
}

/**
 * O primeiro passo fora da D5 da automação `raiz` que a IA EXECUTA e das que
 * ela aciona (`run_automation`), com trava de ciclo — inclusive o "Aguardar"
 * (a retomada não confere a pausa nem o agente). Um "Mover card" ou
 * "Adicionar etiqueta" dela NÃO puxa as automações da etapa ou da etiqueta:
 * a D5 vale só para o que o agente faz (27/09/2026).
 */
export function motivoForaDaD5(
  raiz: string,
  passosDe: ReadonlyMap<string, readonly PassoDaAutomacao[]>,
  regua: ReguaDaD5,
): MotivoForaDaD5 | null {
  return percorrer([raiz], passosDe, (_id, passos) => {
    for (const p of passos ?? []) {
      const motivo = motivoDoPasso(p, regua)
      if (motivo) return motivo
      if (p.tipo === 'wait') return 'aguardar'
    }
    return null
  })
}

/**
 * TODAS as automações que a régua percorreria a partir das raízes, com os
 * passos que já se conhece. Quem lê o banco camada por camada chama de novo
 * até não aparecer automação nova (`ferramentas.ts`): as arestas são as
 * MESMAS da régua (`percorrer`), então o que ela percorre está lido.
 */
export function automacoesAlcancaveis(
  raizes: readonly string[],
  passosDe: ReadonlyMap<string, readonly PassoDaAutomacao[]>,
): Set<string> {
  const alcancadas = new Set<string>()
  percorrer(raizes, passosDe, (id) => {
    alcancadas.add(id)
    return null
  })
  return alcancadas
}

// ------------------------------------------------------------
// Campo de data vigiado por lembrete
// ------------------------------------------------------------

/**
 * Os campos que uma automação de lembrete LIGADA (`date_field_offset` com
 * fonte "campo") vigia. Preencher um deles faria o cron disparar aquela
 * automação depois, fora da D5 (5.6, Codex #292): a IA não o preenche.
 */
export function camposVigiados(
  automacoes: ReadonlyArray<{ trigger_type: string; trigger_config: unknown; is_active: boolean }>,
): Set<string> {
  const vigiados = new Set<string>()
  for (const a of automacoes) {
    if (!a.is_active || a.trigger_type !== 'date_field_offset') continue
    const cfg =
      a.trigger_config && typeof a.trigger_config === 'object' ? (a.trigger_config as Record<string, unknown>) : {}
    if (cfg.fonte !== undefined && cfg.fonte !== null && cfg.fonte !== 'campo') continue
    const campo = texto(cfg.custom_field_id)
    if (campo) vigiados.add(campo)
  }
  return vigiados
}

// ------------------------------------------------------------
// O registro das ações do turno (`cb_ia_turnos.acoes`)
// ------------------------------------------------------------

/**
 * Por que uma ação ACEITA não fez efeito na hora de executar. Lista FECHADA:
 * a aba Turnos traduz cada um (o detalhe cru vai em `detalhe`, nunca no código).
 */
export const CODIGOS_DE_FALHA_DA_ACAO = [
  'sem_card',
  'card_fechado',
  'item_de_outra_conta',
  'etapa_de_resultado',
  'campo_vigiado',
  'valor_vazio',
  'valor_invalido',
  'titulo_invalido',
  'automacao_fora_da_d5',
  // Não é mais produzido (a D5 deixou de percorrer a cascata em 27/09/2026):
  // fica para a aba Turnos traduzir os registros antigos.
  'cascata_fora_da_d5',
  'automacao_desligada',
  'fora_da_conexao',
  'fora_da_etapa',
  // A reunião (F5): sem e-mail na ficha nem no último agendamento; o Calendly
  // recusou o horário (tomado); o Calendly não está conectado (ou o token caiu).
  'sem_email',
  'sem_telefone',
  'horario_indisponivel',
  'calendly_desconectado',
  'envio_falhou',
  'recusado',
  'falhou',
] as const
export type CodigoDeFalhaDaAcao = (typeof CODIGOS_DE_FALHA_DA_ACAO)[number]

/** Uma linha de `cb_ia_turnos.acoes`: o que a ação fez (ou por que não). */
export interface RegistroDeAcao {
  tipo: string
  alvo: { id: string | null; nome: string }
  ok: boolean
  /** Um `MotivoDaRecusa` ou um `CodigoDeFalhaDaAcao` — código, nunca texto livre. */
  erro?: MotivoDaRecusa | CodigoDeFalhaDaAcao
  /** O complemento (o motivo da D5, a recusa da RPC, o texto do motor). Não traduzido. */
  detalhe?: string
}

/** A recusa como linha do registro (o alvo é o número pedido). */
export function registroDaRecusa(r: RecusaDeAcao): RegistroDeAcao {
  return { tipo: r.tipo, alvo: { id: null, nome: r.n === null ? '' : `#${r.n}` }, ok: false, erro: r.motivo }
}

/**
 * O registro como a rota o devolve. `erro` é o código gravado; o de um
 * registro ANTIGO, de antes da lista fechada (o motivo cru do motor), passa
 * como está — a tela trata o código desconhecido com um texto genérico.
 */
export type RegistroDeAcaoLido = Omit<RegistroDeAcao, 'erro'> & { erro?: string }

/** O registro guardado → a forma da rota. Parse, nunca `as`: nulo quando não é lista. */
export function lerRegistrosDasAcoes(v: unknown): RegistroDeAcaoLido[] | null {
  if (!Array.isArray(v)) return null
  const saida: RegistroDeAcaoLido[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const alvo = r.alvo && typeof r.alvo === 'object' ? (r.alvo as Record<string, unknown>) : {}
    if (typeof r.tipo !== 'string' || typeof r.ok !== 'boolean') continue
    saida.push({
      tipo: r.tipo,
      alvo: {
        id: typeof alvo.id === 'string' ? alvo.id : null,
        nome: typeof alvo.nome === 'string' ? alvo.nome : '',
      },
      ok: r.ok,
      ...(typeof r.erro === 'string' && r.erro.length > 0 ? { erro: r.erro } : {}),
      ...(typeof r.detalhe === 'string' && r.detalhe.length > 0 ? { detalhe: r.detalhe } : {}),
    })
  }
  return saida
}

/**
 * A reunião foi PEDIDA e NÃO foi marcada? A resposta ao cliente já saiu —
 * ela provavelmente disse "marquei" —, então o turno transfere para gente
 * (F5). Devolve o código da primeira linha de reunião do registro (a recusa
 * ou a falha) quando nenhuma deu certo; `null` = não pediu, ou marcou.
 */
export function reuniaoNaoMarcada(registros: readonly RegistroDeAcao[] | null): MotivoDaRecusa | CodigoDeFalhaDaAcao | null {
  const daReuniao = (registros ?? []).filter((r) => r.tipo === 'marcar_reuniao')
  if (daReuniao.length === 0 || daReuniao.some((r) => r.ok)) return null
  return daReuniao.find((r) => r.erro)?.erro ?? 'falhou'
}
