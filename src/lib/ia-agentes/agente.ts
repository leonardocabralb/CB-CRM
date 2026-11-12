// ============================================================
// O agente de IA (1048, docs/PLANO-agentes-de-ia.md, 5.2): a forma, a
// leitura da linha e a validação do que a tela manda. PURO, testado.
//
// ⚠️ "Agente" no resto do código quer dizer PESSOA (`assigned_agent_id`, o
// papel `agent`). Tudo que é agente de IA leva `ia_agente`/`IaAgente` no nome.
// ============================================================

import type { AiProvider } from '@/lib/ai/types'

import { lerRetomada, lerRetomadaDoCorpo, type ConfigDaRetomada } from './retomada'

/**
 * Teto da GERAÇÃO da resposta do agente — no turno, na retomada e no
 * Playground —, acima do teto global das outras chamadas de IA
 * (`aiRequestTimeoutMs()`, 30 s: Radar, transcrição, rascunho ✨), que não
 * muda. ⚠️ Medido em 09/11/2026 (comparativo de modelos, pedidos reais de
 * 7 a 12 mil tokens): o Gemini 3.8 Flash ficou em 12–16 s no meio e estourou
 * os 30 s quatro vezes, duas no pedido grande do Previdenciário — e geração
 * que estoura, depois da 2ª tentativa, deixa o cliente SEM resposta (E8).
 * Decisão do operador: 45 s.
 */
export const PRAZO_DA_GERACAO_MS = 45_000

export const LIMITES = {
  nome: 80,
  descricao: 1000,
  instrucoes: 20000,
  regras: 30,
  regra: 500,
  modelo: 100,
  tetoMin: 1,
  tetoMax: 100,
  /** Campos personalizados que um agente pode ver (F3). */
  campos: 50,
  /** Documentos da base marcados para um agente (F3, D20). */
  documentos: 200,
  /** Itens liberados por tipo de ação (F4, D28): etapas, etiquetas, campos… */
  itensPorAcao: 50,
  /** Tipos de evento do Calendly em "Marcar reunião" (F5): UM — o que o agente oferece. */
  tiposDeEvento: 1,
  /** Frases autorizadas por agente (1131): o MESMO teto do CHECK da coluna. */
  frasesAutorizadas: 10,
  /** Caracteres de UMA frase autorizada (1131), já numa linha só e aparada. */
  fraseAutorizada: 400,
  /** Quem recebe o aviso quando o agente passa a conversa (1139): o MESMO teto do CHECK da coluna. */
  avisarAoTransferir: 50,
} as const

/**
 * O que o agente VÊ além da conversa (F3, plano 5.5). Fechado por padrão:
 * nada marcado = só a conversa — é dado de cliente indo a provedor externo,
 * a mesma régua do `radar_enabled`. `campos` são ids de `custom_fields`,
 * escolhidos um a um. O JSON gravado em `cb_ia_agentes.acesso` usa as
 * MESMAS chaves.
 */
export interface AcessoDoAgente {
  ficha: boolean
  campos: string[]
  negocio: boolean
  etiquetas: boolean
  cobrancas: boolean
  reuniao: boolean
}

/** Os blocos do acesso, na ordem em que o pedido os mostra ao modelo. */
export const BLOCOS_DO_ACESSO = ['ficha', 'campos', 'negocio', 'etiquetas', 'cobrancas', 'reuniao'] as const
export type BlocoDoAcesso = (typeof BLOCOS_DO_ACESSO)[number]

/**
 * As AÇÕES que o agente pode fazer junto com a resposta (F4, D28). Cada tipo
 * é ligado por agente, com os itens liberados (parâmetros travados, 5.6): o
 * modelo escolhe só entre eles, por número, e o servidor confere de novo na
 * hora de executar. Fora da D5 por desenho: ganho/perdido, outro número,
 * webhook de saída, qualquer escrita no Asaas — no que o AGENTE faz (a
 * automação que ele executa inclusive); as automações que uma ação dispara
 * (a da etapa, a da etiqueta) rodam como quando gente faz o mesmo (27/09/2026).
 *
 * `marcar_reuniao` (F5, D7 + D28): marca no Calendly um dos horários livres
 * que o servidor leu e numerou no pedido. A automação do tipo de evento roda
 * pelo webhook `invitee.created`, como quando o próprio cliente agenda pelo
 * link.
 */
export type TipoDeAcao =
  | 'mover_etapa'
  | 'etiquetar'
  | 'tirar_etiqueta'
  | 'preencher_campo'
  | 'criar_tarefa'
  | 'executar_automacao'
  | 'marcar_reuniao'

export const TIPOS_DE_ACAO: readonly TipoDeAcao[] = [
  'mover_etapa',
  'etiquetar',
  'tirar_etiqueta',
  'preencher_campo',
  'criar_tarefa',
  'executar_automacao',
  'marcar_reuniao',
]

/**
 * `cb_ia_agentes.ferramentas` (jsonb, 1048). Tipo AUSENTE = desligado; nada
 * ligado = o agente só conversa. Ids do servidor: `pipeline_stages`, `tags`,
 * `custom_fields`, `auth.users` (membros) e `automations` — e, na reunião
 * (F5), a URI do tipo de evento do Calendly
 * (`https://api.calendly.com/event_types/<id>`), NO MÁXIMO uma. É lista para
 * caber no código genérico (`LISTA_DA_ACAO`, `itensDaAcao`).
 */
export interface FerramentasDoAgente {
  mover_etapa?: { etapas: string[] }
  etiquetar?: { etiquetas: string[] }
  tirar_etiqueta?: { etiquetas: string[] }
  preencher_campo?: { campos: string[] }
  criar_tarefa?: { membros: string[] }
  executar_automacao?: { automacoes: string[] }
  marcar_reuniao?: { tipos_de_evento: string[] }
}

/** A chave da lista de cada tipo, no JSON gravado. */
export const LISTA_DA_ACAO = {
  mover_etapa: 'etapas',
  etiquetar: 'etiquetas',
  tirar_etiqueta: 'etiquetas',
  preencher_campo: 'campos',
  criar_tarefa: 'membros',
  executar_automacao: 'automacoes',
  marcar_reuniao: 'tipos_de_evento',
} as const satisfies Record<TipoDeAcao, string>

/**
 * A URI de um tipo de evento do Calendly — a ÚNICA forma aceita em
 * `marcar_reuniao`. Host preso a `api.calendly.com` (o token viaja para lá) e
 * o id sem barra, ponto nem consulta.
 */
const URI_DE_TIPO_DE_EVENTO = /^https:\/\/api\.calendly\.com\/event_types\/[A-Za-z0-9_-]{1,64}$/

export function ehUriDeTipoDeEvento(v: unknown): v is string {
  return typeof v === 'string' && URI_DE_TIPO_DE_EVENTO.test(v)
}

/** O item tem a forma do tipo? Uuid em todos, menos na reunião (a URI do Calendly). */
function itemDaAcao(tipo: TipoDeAcao, x: unknown): x is string {
  return tipo === 'marcar_reuniao' ? ehUriDeTipoDeEvento(x) : typeof x === 'string' && UUID.test(x)
}

/** Quantos itens o tipo aceita. */
function tetoDaAcao(tipo: TipoDeAcao): number {
  return tipo === 'marcar_reuniao' ? LIMITES.tiposDeEvento : LIMITES.itensPorAcao
}

/** Os ids liberados para um tipo (vazio = desligado ou sem item). */
export function itensDaAcao(f: FerramentasDoAgente, tipo: TipoDeAcao): string[] {
  const valor = f[tipo] as Record<string, string[]> | undefined
  return valor?.[LISTA_DA_ACAO[tipo]] ?? []
}

/** Horário de funcionamento: dias da semana (0 = domingo) e a janela do dia. */
export interface Horario {
  dias: number[]
  /** "HH:MM", no fuso do escritório. */
  inicio: string
  fim: string
}

export interface IaAgente {
  id: string
  accountId: string
  nome: string
  descricao: string
  instrucoes: string
  regras: string[]
  provedor: AiProvider
  modelo: string
  ativo: boolean
  /** VAZIO = nenhuma conexão (nunca "todas"). */
  conexoes: string[]
  /** Nulo = sempre. */
  horario: Horario | null
  tetoRespostas: number
  podePassarPara: string[]
  /** Membro que recebe a transferência; nulo = fila sem responsável. */
  transferirPara: string | null
  /**
   * Quem recebe o aviso no sino e na tela quando o agente passa a conversa
   * para a equipe (1139, decisão D1 do operador): ids de LOGIN. Vazia = o
   * dono, os administradores e quem atende o número. O responsável pela
   * conversa recebe sempre (`quemAvisarDaTransferencia`).
   */
  avisarAoTransferir: string[]
  /** O que ele vê além da conversa (F3). */
  acesso: AcessoDoAgente
  /** O que ele pode FAZER junto com a resposta (F4, D28). */
  ferramentas: FerramentasDoAgente
  /** A retomada quando o cliente não responde (1056); `ativa` falso = desligada. */
  retomada: ConfigDaRetomada
  /**
   * "Conduz o fechamento" (1128, decisão do operador de 08/11/2026): troca as
   * regras do sistema `sem_preco` e `sem_compromisso` pelas do fechamento
   * (`regrasDoSistema`). Falso = as regras de sempre.
   */
  conduzFechamento: boolean
  /**
   * As FRASES AUTORIZADAS (1131, decisão do operador 50=c de 04/10/2026,
   * confirmada em 09/11/2026): frases exatas, escritas pelo escritório, que o
   * agente pode dizer mesmo citando custo ou resultado — as regras do sistema
   * ganham a exceção e terminam com a lista (`regrasDoSistema`). Vazia = as
   * regras de sempre.
   */
  frasesAutorizadas: string[]
  /** Quando foi LIGADO pela última vez (gatilho da 1049); nulo = nunca. D27. */
  ativadoEm: string | null
  arquivadoEm: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Uma etapa do funil em que o agente atua (D24, `cb_ia_agente_etapas`).
 * `desde` = quando a etapa foi marcada: só card que ENTROU nela depois disso
 * (e depois de o agente ser ligado) é atendido (D27).
 */
export interface EtapaDoAgente {
  stageId: string
  pipelineId: string
  desde: string
}

/** O agente como as rotas da tela o devolvem: com as etapas em que atua. */
export type AgenteComEtapas = IaAgente & { etapas: EtapaDoAgente[] }

/** Colunas lidas: nomeadas, nunca `*` (uma coluna sem GRANT derrubaria a consulta). */
export const COLUNAS_DO_AGENTE =
  'id, account_id, nome, descricao, instrucoes, regras, provedor, modelo, ativo, conexoes, horario, teto_respostas, pode_passar_para, transferir_para, avisar_ao_transferir, acesso, ferramentas, retomada, conduz_fechamento, frases_autorizadas, ativado_em, arquivado_em, created_at, updated_at'

function ehProvedor(v: unknown): v is AiProvider {
  return v === 'openai' || v === 'anthropic' || v === 'gemini'
}

function listaDeTexto(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lê o `acesso` guardado (ou mandado pela tela) — parse, nunca `as`. Só o
 * booleano `true` liga: do JSONB, `"true"` e `1` são truthy e ligariam um
 * bloco que ninguém marcou. `campos`: só uuids, sem repetição, até
 * `LIMITES.campos`. Forma estranha = nada marcado (fechado), nunca exceção.
 * Id de campo que não existe mais fica aqui e é ignorado na LEITURA.
 */
export function lerAcesso(v: unknown): AcessoDoAgente {
  const a = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const campos = Array.isArray(a.campos)
    ? [...new Set(a.campos.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, LIMITES.campos)
    : []
  return {
    ficha: a.ficha === true,
    campos,
    negocio: a.negocio === true,
    etiquetas: a.etiquetas === true,
    cobrancas: a.cobrancas === true,
    reuniao: a.reuniao === true,
  }
}

/**
 * Lê as `ferramentas` guardadas — parse, nunca `as`. Tipo ausente, que não é
 * objeto ou cuja lista não é lista = desligado; a lista fica só com os itens
 * na forma do tipo (uuids; na reunião, a URI do tipo de evento), sem
 * repetição, até o teto do tipo. Forma estranha nunca lança.
 */
export function lerFerramentas(v: unknown): FerramentasDoAgente {
  const f = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const saida: Record<string, Record<string, string[]>> = {}
  for (const tipo of TIPOS_DE_ACAO) {
    const valor = f[tipo]
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) continue
    const lista = (valor as Record<string, unknown>)[LISTA_DA_ACAO[tipo]]
    if (!Array.isArray(lista)) continue
    saida[tipo] = {
      [LISTA_DA_ACAO[tipo]]: [...new Set(lista.filter((x): x is string => itemDaAcao(tipo, x)))].slice(
        0,
        tetoDaAcao(tipo),
      ),
    }
  }
  return saida as FerramentasDoAgente
}

/** O bloco está marcado? (`campos` = pelo menos um campo escolhido.) */
export function blocoMarcado(acesso: AcessoDoAgente, bloco: BlocoDoAcesso): boolean {
  return bloco === 'campos' ? acesso.campos.length > 0 : acesso[bloco]
}

/**
 * Uma FRASE AUTORIZADA (1131) numa linha só: espaço, tabulação e quebra de
 * linha viram UM espaço, e as pontas saem. O pedido lista uma frase por linha
 * — uma quebra dentro da frase a partiria. A rota grava assim
 * (`lerFrasesAutorizadasDoCorpo`), o bloco das regras monta assim e a tela
 * compara assim (`frasesDoTexto`).
 */
export function normalizarFrase(frase: string): string {
  return frase.replace(/\s+/g, ' ').trim()
}

/**
 * Lê as `frases_autorizadas` guardadas (1131) — parse, nunca `as`. Só a lista
 * de textos não vazios vale (aparados); qualquer outra forma — inclusive um
 * item que não é texto, ou vazio — vira lista VAZIA: as frases liberam o
 * agente a falar de custo e de resultado, então a dúvida fecha (as regras de
 * sempre). Nunca lança.
 */
export function lerFrasesAutorizadas(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const frases = v.map((f) => (typeof f === 'string' ? f.trim() : ''))
  return frases.every((f) => f.length > 0) ? frases : []
}

/**
 * As `frases_autorizadas` do PATCH (1131), ESTRITAS: uma lista de textos,
 * cada um numa linha só (`normalizarFrase`) com 1 a `LIMITES.fraseAutorizada`
 * caracteres, no máximo `LIMITES.frasesAutorizadas`, sem repetir (sem caixa).
 * `null` = forma inválida (a rota responde 400 `corpo_invalido`): descartar em
 * silêncio tiraria do agente uma frase que o administrador acabou de
 * escrever. Lista vazia vale (tira todas). A tela confere com esta mesma
 * função antes do Salvar.
 */
export function lerFrasesAutorizadasDoCorpo(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > LIMITES.frasesAutorizadas) return null
  const frases: string[] = []
  const vistas = new Set<string>()
  for (const item of v) {
    if (typeof item !== 'string') return null
    const frase = normalizarFrase(item)
    if (frase.length === 0 || frase.length > LIMITES.fraseAutorizada) return null
    const chave = frase.toLowerCase()
    if (vistas.has(chave)) return null
    vistas.add(chave)
    frases.push(frase)
  }
  return frases
}

/** Lê o `horario` guardado; forma estranha vira nulo (= sempre), nunca exceção. */
export function lerHorario(v: unknown): Horario | null {
  if (!v || typeof v !== 'object') return null
  const h = v as Record<string, unknown>
  const dias = Array.isArray(h.dias)
    ? [...new Set(h.dias.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort((a, b) => a - b)
    : []
  if (dias.length === 0) return null
  if (typeof h.inicio !== 'string' || typeof h.fim !== 'string') return null
  if (!HORA.test(h.inicio) || !HORA.test(h.fim) || h.inicio >= h.fim) return null
  return { dias, inicio: h.inicio, fim: h.fim }
}

/** Linha do banco → agente. Parse campo a campo, nunca `as`. */
export function lerLinhaDoAgente(linha: Record<string, unknown>): IaAgente | null {
  if (typeof linha.id !== 'string' || typeof linha.account_id !== 'string') return null
  if (!ehProvedor(linha.provedor)) return null
  return {
    id: linha.id,
    accountId: linha.account_id,
    nome: typeof linha.nome === 'string' ? linha.nome : '',
    descricao: typeof linha.descricao === 'string' ? linha.descricao : '',
    instrucoes: typeof linha.instrucoes === 'string' ? linha.instrucoes : '',
    regras: listaDeTexto(linha.regras),
    provedor: linha.provedor,
    modelo: typeof linha.modelo === 'string' ? linha.modelo : '',
    ativo: linha.ativo === true,
    conexoes: listaDeTexto(linha.conexoes),
    horario: lerHorario(linha.horario),
    tetoRespostas: typeof linha.teto_respostas === 'number' ? linha.teto_respostas : 10,
    podePassarPara: listaDeTexto(linha.pode_passar_para),
    transferirPara: typeof linha.transferir_para === 'string' ? linha.transferir_para : null,
    // Ausente (antes da 1139) ou fora da forma = ninguém escolhido (avisa o dono e os admins).
    avisarAoTransferir: listaDeTexto(linha.avisar_ao_transferir).filter((id) => UUID.test(id)),
    acesso: lerAcesso(linha.acesso),
    ferramentas: lerFerramentas(linha.ferramentas),
    retomada: lerRetomada(linha.retomada),
    // Só o booleano `true` liga (a coluna é NOT NULL; do JSON, "true" e 1 não).
    conduzFechamento: linha.conduz_fechamento === true,
    // Ausente (antes da 1131) ou fora da forma = nenhuma frase.
    frasesAutorizadas: lerFrasesAutorizadas(linha.frases_autorizadas),
    ativadoEm: typeof linha.ativado_em === 'string' ? linha.ativado_em : null,
    arquivadoEm: typeof linha.arquivado_em === 'string' ? linha.arquivado_em : null,
    createdAt: typeof linha.created_at === 'string' ? linha.created_at : '',
    updatedAt: typeof linha.updated_at === 'string' ? linha.updated_at : '',
  }
}

/** O que a tela pode gravar. Na edição, campo AUSENTE = não mexe. */
export interface AlteracaoDoAgente {
  nome?: string
  descricao?: string
  instrucoes?: string
  regras?: string[]
  provedor?: AiProvider
  modelo?: string
  ativo?: boolean
  conexoes?: string[]
  horario?: Horario | null
  tetoRespostas?: number
  podePassarPara?: string[]
  transferirPara?: string | null
  /** Quem recebe o aviso da transferência (1139): a lista INTEIRA. */
  avisarAoTransferir?: string[]
  acesso?: AcessoDoAgente
  /** O que ele pode fazer junto com a resposta (F4): o objeto INTEIRO. */
  ferramentas?: FerramentasDoAgente
  /** A retomada (1056): o objeto INTEIRO. */
  retomada?: ConfigDaRetomada
  /** "Conduz o fechamento" (1128). */
  conduzFechamento?: boolean
  /** As frases autorizadas (1131): a lista INTEIRA, na ordem. */
  frasesAutorizadas?: string[]
  /** Ids das etapas em que atua (D24). Não é coluna do agente: vai para `cb_ia_agente_etapas`. */
  etapas?: string[]
}

export type CodigoDeRecusa =
  | 'corpo_invalido'
  | 'nome_vazio'
  | 'nome_longo'
  | 'descricao_longa'
  | 'instrucoes_longas'
  | 'regras_demais'
  | 'regra_longa'
  | 'provedor_invalido'
  | 'modelo_vazio'
  | 'teto_invalido'
  | 'horario_invalido'
  | 'lista_invalida'
  | 'retomada_invalida'

export type LeituraDaAlteracao =
  | { ok: true; valor: AlteracaoDoAgente }
  | { ok: false; codigo: CodigoDeRecusa }

function lerIds(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  if (!v.every((x) => typeof x === 'string' && UUID.test(x))) return null
  return [...new Set(v as string[])]
}

/**
 * Lê o corpo da tela. `criacao` exige nome, provedor e modelo; na edição só
 * valida o que veio. As regras chegam aparadas e sem linha vazia — uma
 * regra em branco viraria um item "3." vazio no pedido ao modelo.
 */
export function lerAlteracao(corpo: unknown, criacao: boolean): LeituraDaAlteracao {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { ok: false, codigo: 'corpo_invalido' }
  }
  const c = corpo as Record<string, unknown>
  const v: AlteracaoDoAgente = {}

  if ('nome' in c || criacao) {
    const nome = typeof c.nome === 'string' ? c.nome.trim() : ''
    if (!nome) return { ok: false, codigo: 'nome_vazio' }
    if (nome.length > LIMITES.nome) return { ok: false, codigo: 'nome_longo' }
    v.nome = nome
  }
  if ('descricao' in c) {
    const d = typeof c.descricao === 'string' ? c.descricao.trim() : ''
    if (d.length > LIMITES.descricao) return { ok: false, codigo: 'descricao_longa' }
    v.descricao = d
  }
  if ('instrucoes' in c) {
    const i = typeof c.instrucoes === 'string' ? c.instrucoes.trim() : ''
    if (i.length > LIMITES.instrucoes) return { ok: false, codigo: 'instrucoes_longas' }
    v.instrucoes = i
  }
  if ('regras' in c) {
    if (!Array.isArray(c.regras)) return { ok: false, codigo: 'lista_invalida' }
    const regras = c.regras
      .filter((r): r is string => typeof r === 'string')
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
    if (regras.length > LIMITES.regras) return { ok: false, codigo: 'regras_demais' }
    if (regras.some((r) => r.length > LIMITES.regra)) return { ok: false, codigo: 'regra_longa' }
    v.regras = regras
  }
  if ('provedor' in c || criacao) {
    if (!ehProvedor(c.provedor)) return { ok: false, codigo: 'provedor_invalido' }
    v.provedor = c.provedor
  }
  if ('modelo' in c || criacao) {
    const m = typeof c.modelo === 'string' ? c.modelo.trim() : ''
    if (!m || m.length > LIMITES.modelo) return { ok: false, codigo: 'modelo_vazio' }
    v.modelo = m
  }
  // Trocar o provedor exige o modelo junto: o modelo guardado é do provedor
  // anterior, e toda geração falharia (Codex, #295). A tela manda os dois.
  if (v.provedor !== undefined && v.modelo === undefined) return { ok: false, codigo: 'modelo_vazio' }
  if ('ativo' in c) v.ativo = c.ativo === true
  if ('conduz_fechamento' in c) {
    // ESTRITO, ao contrário do `ativo`: a opção libera o agente a falar de
    // honorários e a convidar a contratar — só o booleano liga ou desliga;
    // qualquer outra forma ("true", 1, null) recusa em vez de virar falso ou
    // verdadeiro em silêncio.
    if (typeof c.conduz_fechamento !== 'boolean') return { ok: false, codigo: 'corpo_invalido' }
    v.conduzFechamento = c.conduz_fechamento
  }
  if ('frases_autorizadas' in c) {
    // ESTRITO, como o `conduz_fechamento`: as frases liberam o agente a falar
    // de custo e de resultado — forma inválida recusa, nunca vira outra lista.
    const frases = lerFrasesAutorizadasDoCorpo(c.frases_autorizadas)
    if (!frases) return { ok: false, codigo: 'corpo_invalido' }
    v.frasesAutorizadas = frases
  }
  if ('conexoes' in c) {
    const ids = lerIds(c.conexoes)
    if (!ids) return { ok: false, codigo: 'lista_invalida' }
    v.conexoes = ids
  }
  if ('etapas' in c) {
    const ids = lerIds(c.etapas)
    if (!ids) return { ok: false, codigo: 'lista_invalida' }
    v.etapas = ids
  }
  if ('pode_passar_para' in c) {
    const ids = lerIds(c.pode_passar_para)
    if (!ids) return { ok: false, codigo: 'lista_invalida' }
    v.podePassarPara = ids
  }
  if ('transferir_para' in c) {
    if (c.transferir_para === null || c.transferir_para === '') v.transferirPara = null
    else if (typeof c.transferir_para === 'string' && UUID.test(c.transferir_para)) {
      v.transferirPara = c.transferir_para
    } else return { ok: false, codigo: 'lista_invalida' }
  }
  if ('avisar_ao_transferir' in c) {
    // ESTRITO: id fora da forma ou acima do teto recusa — descartar em
    // silêncio tiraria do aviso alguém que o administrador acabou de marcar.
    const ids = lerIds(c.avisar_ao_transferir)
    if (!ids || ids.length > LIMITES.avisarAoTransferir) return { ok: false, codigo: 'lista_invalida' }
    v.avisarAoTransferir = ids
  }
  if ('teto_respostas' in c) {
    const n = Number(c.teto_respostas)
    if (!Number.isInteger(n) || n < LIMITES.tetoMin || n > LIMITES.tetoMax) {
      return { ok: false, codigo: 'teto_invalido' }
    }
    v.tetoRespostas = n
  }
  if ('acesso' in c) {
    // A tela manda o objeto inteiro. `campos` fora da forma (não lista, id
    // que não é uuid, mais que o teto) RECUSA — descartar em silêncio tiraria
    // do agente um campo que o administrador acabou de marcar.
    const a = c.acesso
    if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, codigo: 'lista_invalida' }
    const campos = (a as Record<string, unknown>).campos
    if (campos !== undefined) {
      const ids = lerIds(campos)
      if (!ids || ids.length > LIMITES.campos) return { ok: false, codigo: 'lista_invalida' }
    }
    v.acesso = lerAcesso(a)
  }
  if ('ferramentas' in c) {
    // O objeto inteiro, como o `acesso`. Tipo presente fora da forma (não
    // objeto, lista que não é lista, item fora da forma do tipo, mais que o
    // teto — na reunião, mais de UM tipo de evento) RECUSA — descartar em
    // silêncio tiraria do agente um item que o administrador acabou de
    // liberar. Tipo nulo = desligado.
    const f = c.ferramentas
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ok: false, codigo: 'lista_invalida' }
    for (const tipo of TIPOS_DE_ACAO) {
      const valor = (f as Record<string, unknown>)[tipo]
      if (valor === undefined || valor === null) continue
      if (typeof valor !== 'object' || Array.isArray(valor)) return { ok: false, codigo: 'lista_invalida' }
      const lista = (valor as Record<string, unknown>)[LISTA_DA_ACAO[tipo]]
      if (!Array.isArray(lista) || !lista.every((x) => itemDaAcao(tipo, x))) {
        return { ok: false, codigo: 'lista_invalida' }
      }
      if (new Set(lista).size > tetoDaAcao(tipo)) return { ok: false, codigo: 'lista_invalida' }
    }
    v.ferramentas = lerFerramentas(f)
  }
  if ('retomada' in c) {
    // O objeto inteiro, ESTRITO: cadência ou janela fora da forma recusa —
    // descartar em silêncio mandaria retomadas noutros horários.
    const r = lerRetomadaDoCorpo(c.retomada)
    if (!r) return { ok: false, codigo: 'retomada_invalida' }
    v.retomada = r
  }
  if ('horario' in c) {
    if (c.horario === null) v.horario = null
    else {
      const h = lerHorario(c.horario)
      if (!h) return { ok: false, codigo: 'horario_invalido' }
      v.horario = h
    }
  }
  return { ok: true, valor: v }
}

/**
 * O agente com o RASCUNHO da tela por cima (o Playground; DC4 da central dos
 * agentes, 26/10/2026): o que a alteração traz vale, o que ela não traz fica
 * como está salvo. PURA — não muda o agente recebido.
 *
 * ⚠️ `ativo` e as conexões ficam os SALVOS, e as etapas não são do agente
 * (outra tabela): no Playground nenhum dos três decide a resposta — quem diz
 * se o agente atenderia um contato é o diagnóstico, não a geração.
 */
export function aplicarAlteracao<A extends IaAgente>(agente: A, a: AlteracaoDoAgente): A {
  return {
    ...agente,
    ...(a.nome !== undefined ? { nome: a.nome } : {}),
    ...(a.descricao !== undefined ? { descricao: a.descricao } : {}),
    ...(a.instrucoes !== undefined ? { instrucoes: a.instrucoes } : {}),
    ...(a.regras !== undefined ? { regras: a.regras } : {}),
    ...(a.provedor !== undefined ? { provedor: a.provedor } : {}),
    ...(a.modelo !== undefined ? { modelo: a.modelo } : {}),
    ...(a.horario !== undefined ? { horario: a.horario } : {}),
    ...(a.tetoRespostas !== undefined ? { tetoRespostas: a.tetoRespostas } : {}),
    ...(a.podePassarPara !== undefined ? { podePassarPara: a.podePassarPara } : {}),
    ...(a.transferirPara !== undefined ? { transferirPara: a.transferirPara } : {}),
    ...(a.avisarAoTransferir !== undefined ? { avisarAoTransferir: a.avisarAoTransferir } : {}),
    ...(a.acesso !== undefined ? { acesso: a.acesso } : {}),
    ...(a.ferramentas !== undefined ? { ferramentas: a.ferramentas } : {}),
    ...(a.retomada !== undefined ? { retomada: a.retomada } : {}),
    // Muda o PEDIDO (as regras do sistema): o Playground testa o do rascunho.
    ...(a.conduzFechamento !== undefined ? { conduzFechamento: a.conduzFechamento } : {}),
    // Também muda o PEDIDO (as exceções e a lista no fim das regras do sistema).
    ...(a.frasesAutorizadas !== undefined ? { frasesAutorizadas: a.frasesAutorizadas } : {}),
  }
}

/** Alteração → colunas do banco (só as presentes). As etapas NÃO: são outra tabela. */
export function colunasDaAlteracao(a: AlteracaoDoAgente): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  if (a.nome !== undefined) c.nome = a.nome
  if (a.descricao !== undefined) c.descricao = a.descricao
  if (a.instrucoes !== undefined) c.instrucoes = a.instrucoes
  if (a.regras !== undefined) c.regras = a.regras
  if (a.provedor !== undefined) c.provedor = a.provedor
  if (a.modelo !== undefined) c.modelo = a.modelo
  if (a.ativo !== undefined) c.ativo = a.ativo
  if (a.conexoes !== undefined) c.conexoes = a.conexoes
  if (a.horario !== undefined) c.horario = a.horario
  if (a.tetoRespostas !== undefined) c.teto_respostas = a.tetoRespostas
  if (a.podePassarPara !== undefined) c.pode_passar_para = a.podePassarPara
  if (a.transferirPara !== undefined) c.transferir_para = a.transferirPara
  if (a.avisarAoTransferir !== undefined) c.avisar_ao_transferir = a.avisarAoTransferir
  if (a.acesso !== undefined) c.acesso = a.acesso
  if (a.ferramentas !== undefined) c.ferramentas = a.ferramentas
  if (a.retomada !== undefined) c.retomada = a.retomada
  if (a.conduzFechamento !== undefined) c.conduz_fechamento = a.conduzFechamento
  if (a.frasesAutorizadas !== undefined) c.frases_autorizadas = a.frasesAutorizadas
  return c
}

/**
 * O corpo do `PUT …/documentos` (D20): `{ documentoIds: string[] }`, a lista
 * INTEIRA. `null` = forma errada (não é lista, id que não é uuid, mais que o
 * teto). Sem repetição.
 */
export function lerDocumentosPedidos(corpo: unknown): string[] | null {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return null
  const ids = lerIds((corpo as Record<string, unknown>).documentoIds)
  return ids && ids.length <= LIMITES.documentos ? ids : null
}

/** Linha de `cb_ia_agente_etapas` (com `pipeline_stages(pipeline_id)` embutido) → etapa. */
export function lerEtapaDoAgente(linha: Record<string, unknown>): (EtapaDoAgente & { iaAgenteId: string }) | null {
  const embutida = linha.pipeline_stages as { pipeline_id?: unknown } | null | undefined
  if (typeof linha.stage_id !== 'string' || typeof linha.ia_agente_id !== 'string') return null
  if (typeof embutida?.pipeline_id !== 'string' || typeof linha.desde !== 'string') return null
  return {
    stageId: linha.stage_id,
    pipelineId: embutida.pipeline_id,
    desde: linha.desde,
    iaAgenteId: linha.ia_agente_id,
  }
}

/**
 * O que gravar quando a tela manda as etapas do agente (D24): as que ficam
 * não se tocam (mantêm o `desde`), as novas entram, e a etapa de OUTRO agente
 * recusa tudo — uma etapa tem no máximo um agente. `donoDe` diz de quem é
 * cada etapa já marcada na conta.
 */
export function planoDasEtapas(
  agenteId: string,
  pedidas: string[],
  donoDe: Map<string, string>,
): { ocupada: { stageId: string; agenteId: string } | null; inserir: string[] } {
  for (const s of pedidas) {
    const dono = donoDe.get(s)
    if (dono && dono !== agenteId) return { ocupada: { stageId: s, agenteId: dono }, inserir: [] }
  }
  return { ocupada: null, inserir: pedidas.filter((s) => donoDe.get(s) !== agenteId) }
}
