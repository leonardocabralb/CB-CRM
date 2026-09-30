// ============================================================
// As PENDÊNCIAS que impedem ligar uma automação, apontadas no PASSO.
//
// Nasceu de um caso real (29/09/2026): ao ligar a automação "Contrato
// fechado", a tela mostrou só o toast "task assignee is required · at
// steps[0].no.steps[9].responsavel_user_id" — em inglês, e com um endereço
// que o operador não tem como achar numa automação de dezenas de passos. Ele
// pediu o passo destacado em vermelho, dizendo o que ajustar.
//
// A validação (`validate.ts`) continua sendo a régua: é ela que a rota roda
// antes de ligar, e o `path`/`message` dela são CONTRATO da API (o 400 os
// devolve). Este módulo só TRADUZ o resultado para a tela:
//
// - `lerCaminho` desmonta o `path` ("steps[0].no.steps[9].campo");
// - `localizarPendencias` casa cada pendência com o PASSO da árvore do
//   construtor, pelo `cid` — e o que não casa vai para `gerais`, NUNCA some
//   (uma pendência engolida é a automação que não liga sem ninguém saber por
//   quê, que é o defeito que isto existe para acabar);
// - `localDoPasso` diz onde o passo está ("Passo 10 · ramo NÃO da condição
//   do passo 1");
// - `chaveDaPendencia` dá a frase no idioma do app, pelo `codigo`;
// - `avisosDaAutomacao` aponta o que NÃO impede ligar mas quebra em execução
//   (acionar automação desligada ou apagada, iniciar robô inativo).
//
// Puro, sem React e sem I/O: testável no ambiente node dos testes.
//
// ⚠️ Localize com a MESMA árvore que foi mandada ao servidor (a do
// salvamento): o `path` é posicional. Daí em diante a marca segue o passo
// pelo `cid`, mesmo que ele mude de lugar — é por isso que a chave do mapa é
// o `cid`, e não o índice.
// ============================================================

import type { ValidationIssue } from './validate'
import { ehGatilhoDaRegua } from '@/lib/asaas/regua'
import { GATILHO_DO_ATLAS } from './so-pelo-disparador'

/** O mínimo da árvore do construtor que este módulo precisa. */
export interface NoDaArvore<T> {
  cid: string
  step_type: string
  branches?: { yes: T[]; no: T[] }
}

export type Ramo = 'yes' | 'no'

/** Um nível do endereço: o índice na lista, e (fora da raiz) de qual ramo. */
export interface DegrauDoCaminho {
  indice: number
  ramo?: Ramo
}

export type Caminho =
  | { alvo: 'automacao' }
  | { alvo: 'gatilho'; campo: string }
  | { alvo: 'passo'; passos: DegrauDoCaminho[]; campo: string | null }

// Os endereços saem de `validate.ts`: `${prefixo}steps[${i}]` e, dentro de uma
// condição, `${path}.yes.` / `${path}.no.` antes do próximo `steps[...]`. O
// campo vem depois de um ponto e pode ter pontos (`variables.1`).
const RE_PASSO = /^steps\[(\d+)\]((?:\.(?:yes|no)\.steps\[\d+\])*)(?:\.([A-Za-z_]\w*(?:\.\w+)*))?$/
const RE_DEGRAU = /\.(yes|no)\.steps\[(\d+)\]/g
const RE_GATILHO = /^trigger\.([A-Za-z_]\w*)$/

/**
 * Desmonta o `path` de uma pendência. Forma desconhecida devolve `null` — e
 * quem chama a manda para `gerais`, nunca a descarta.
 */
export function lerCaminho(path: string): Caminho | null {
  if (typeof path !== 'string') return null
  if (path === 'steps') return { alvo: 'automacao' }
  const gatilho = RE_GATILHO.exec(path)
  if (gatilho) return { alvo: 'gatilho', campo: gatilho[1] }
  const passo = RE_PASSO.exec(path)
  if (!passo) return null
  const passos: DegrauDoCaminho[] = [{ indice: Number(passo[1]) }]
  for (const d of passo[2].matchAll(RE_DEGRAU)) {
    passos.push({ ramo: d[1] as Ramo, indice: Number(d[2]) })
  }
  return { alvo: 'passo', passos, campo: passo[3] ?? null }
}

export interface PendenciasLocalizadas {
  /** Por `cid` do passo, na ordem em que chegaram. */
  porPasso: Map<string, ValidationIssue[]>
  doGatilho: ValidationIssue[]
  /** As da automação inteira ("precisa de um passo") e as que não casaram. */
  gerais: ValidationIssue[]
}

/**
 * O nó que o endereço aponta, ou `null`. Só desce pelo ramo de uma
 * CONDIÇÃO — é a regra de `validate.ts`, que só anda dentro dos ramos dela;
 * um endereço que desce por outro tipo de passo não saiu de lá.
 */
function noDoCaminho<T extends NoDaArvore<T>>(
  steps: readonly T[],
  passos: readonly DegrauDoCaminho[],
): T | null {
  let lista: readonly T[] | undefined = steps
  let no: T | undefined
  for (const [i, degrau] of passos.entries()) {
    if (i > 0) {
      if (!no || no.step_type !== 'condition' || !degrau.ramo) return null
      lista = no.branches?.[degrau.ramo]
    }
    no = lista?.[degrau.indice]
    if (!no) return null
  }
  return no ?? null
}

/**
 * Reparte as pendências entre os passos (pelo `cid`), o gatilho e as gerais.
 * Toda pendência sai em exatamente um dos três.
 */
export function localizarPendencias<T extends NoDaArvore<T>>(
  steps: readonly T[],
  issues: readonly ValidationIssue[],
): PendenciasLocalizadas {
  const porPasso = new Map<string, ValidationIssue[]>()
  const doGatilho: ValidationIssue[] = []
  const gerais: ValidationIssue[] = []
  for (const issue of issues) {
    const caminho = lerCaminho(issue.path)
    if (caminho?.alvo === 'gatilho') {
      doGatilho.push(issue)
      continue
    }
    const no = caminho?.alvo === 'passo' ? noDoCaminho(steps, caminho.passos) : null
    if (!no) {
      gerais.push(issue)
      continue
    }
    const lista = porPasso.get(no.cid)
    if (lista) lista.push(issue)
    else porPasso.set(no.cid, [issue])
  }
  return { porPasso, doGatilho, gerais }
}

/** Um nível do local: o número (1-based) na sua lista e o ramo (null na raiz). */
export interface DegrauDoLocal {
  cid: string
  numero: number
  ramo: Ramo | null
}

export interface LocalDoPasso {
  /** O número do passo na SUA lista (1-based): dentro do ramo, conta do 1. */
  numero: number
  /** Em qual ramo da condição-mãe ele está; `null` na raiz. */
  ramo: Ramo | null
  /** A condição dona do ramo; `null` na raiz. */
  pai: DegrauDoLocal | null
  /** Da raiz até o próprio passo, inclusive — para "ramo SIM do passo 3, ramo NÃO do passo 1". */
  cadeia: DegrauDoLocal[]
}

/**
 * Onde o passo está, para a tela escrever "Passo 10 · ramo NÃO da condição
 * do passo 1". `null` quando o `cid` não está na árvore.
 */
export function localDoPasso<T extends NoDaArvore<T>>(
  steps: readonly T[],
  cid: string,
): LocalDoPasso | null {
  const procurar = (
    lista: readonly T[],
    ramo: Ramo | null,
    acima: DegrauDoLocal[],
  ): DegrauDoLocal[] | null => {
    for (const [i, no] of lista.entries()) {
      const degrau: DegrauDoLocal = { cid: no.cid, numero: i + 1, ramo }
      const cadeia = [...acima, degrau]
      if (no.cid === cid) return cadeia
      if (no.step_type === 'condition' && no.branches) {
        const achado =
          procurar(no.branches.yes, 'yes', cadeia) ?? procurar(no.branches.no, 'no', cadeia)
        if (achado) return achado
      }
    }
    return null
  }
  const cadeia = procurar(steps, null, [])
  if (!cadeia) return null
  const proprio = cadeia[cadeia.length - 1]
  return {
    numero: proprio.numero,
    ramo: proprio.ramo,
    pai: cadeia.length > 1 ? cadeia[cadeia.length - 2] : null,
    cadeia,
  }
}

/**
 * Todo `codigo` que `validate.ts` e `avisosDaAutomacao` produzem. É o que
 * `chaveDaPendencia` aceita: código FORA daqui devolve `null` e a tela mostra
 * o `message` — é o caso do deploy em curso, com a aba aberta num bundle
 * antigo recebendo de um servidor novo um código que o dicionário dela não
 * tem (sem a lista, apareceria a chave crua na tela).
 *
 * ⚠️ `pendencias.test.ts` colhe os literais dos dois arquivos e cobra que esta
 * lista seja EXATAMENTE eles, e que cada um tenha a frase nos dois
 * dicionários. Código novo: o literal no `push`, aqui, e as duas frases.
 */
export const CODIGOS_DE_PENDENCIA = [
  // A automação inteira
  'sem_passos',
  // Passos
  'mover_card_sem_etapa',
  'status_do_negocio_invalido',
  'acionar_sem_automacao',
  'parar_sem_automacao',
  'iniciar_robo_sem_robo',
  'ia_sem_escolha',
  'midia_sem_arquivo',
  'midia_tipo_invalido',
  'audio_com_legenda',
  'legenda_longa',
  'mensagem_sem_texto',
  'interativa_invalida',
  'modelo_nao_escolhido',
  'modelo_valores_invalidos',
  'modelo_valor_fora_de_posicao',
  'modelo_posicao_acima_do_teto',
  'modelo_valor_sem_texto',
  'modelo_botoes_invalidos',
  'modelo_cabecalho_invalido',
  'etiqueta_nao_escolhida',
  'atribuir_sem_atendente',
  'campo_nao_escolhido',
  'campo_sem_valor',
  'criar_card_sem_funil',
  'criar_card_sem_etapa',
  'criar_card_sem_titulo',
  'espera_modo_invalido',
  'espera_janela_invalida',
  'espera_sem_tempo',
  'espera_unidade_invalida',
  'espera_dias_uteis_invalido',
  'espera_parar_se_responder_invalido',
  'condicao_sem_criterio',
  'condicao_sem_texto',
  'condicao_sem_valor',
  'condicao_sem_etiqueta',
  'condicao_sem_campo_do_contato',
  'condicao_sem_etapa',
  'condicao_sem_status',
  'condicao_sem_conexao',
  'condicao_horario_invalido',
  'condicao_dias_uteis_invalido',
  'webhook_sem_endereco',
  'webhook_endereco_invalido',
  'numero_sem_telefone',
  'numero_telefone_curto',
  'numero_telefone_invalido',
  'tarefa_sem_titulo',
  'tarefa_titulo_longo',
  'tarefa_modo_invalido',
  'tarefa_sem_responsavel',
  'tarefa_sem_reserva',
  'tarefa_descricao_longa',
  'tarefa_prazo_invalido',
  'tarefa_hora_invalida',
  'fixar_sem_conexao',
  'atlas_tipo_de_contrato_invalido',
  'atlas_campo_invalido',
  // O nó "Atlas" (30/09/2026)
  'atlas_situacao_invalida',
  'atlas_atualizar_sem_campos',
  'atlas_tarefa_sem_titulo',
  'atlas_tarefa_prioridade_invalida',
  'atlas_tarefa_prazo_invalido',
  'atlas_transcricao_idade_invalida',
  'atlas_transcricao_notas_invalido',
  'atlas_transcricao_email_invalido',
  'atlas_onboarding_sem_item',
  'atlas_onboarding_item_com_variavel',
  'atlas_onboarding_situacao_invalida',
  'atlas_onboarding_sem_mudanca',
  'passo_desconhecido',
  // Gatilho
  'gatilho_sem_palavras',
  'gatilho_palavra_vazia',
  'gatilho_tipo_de_busca_invalido',
  'gatilho_sem_agenda',
  'gatilho_sem_etiqueta',
  'gatilho_sem_respostas',
  'gatilho_resposta_vazia',
  'gatilho_etapas_invalidas',
  'gatilho_parar_ao_sair_invalido',
  'gatilho_evento_invalido',
  'gatilho_reagendamento_invalido',
  'gatilho_webhook_invalido',
  'gatilho_dias_de_atraso_invalido',
  'gatilho_hora_de_envio_invalida',
  'gatilho_dias_uteis_invalido',
  'gatilho_status_invalidos',
  // Situação mudou no Atlas (1073)
  'gatilho_atlas_sem_situacao',
  'gatilho_atlas_situacao_invalida',
  'gatilho_atlas_sem_funil',
  'atlas_gatilho_com_criar_cliente',
  'atlas_gatilho_com_atualizar_cliente',
  'atlas_gatilho_aciona_outra',
  // Régua de cobrança do Asaas
  'regua_com_espera',
  'regua_aciona_outra',
  'regua_so_texto',
  'regua_sem_conexao',
  'regua_conexao_diferente',
  'regua_sem_mensagem',
  // Avisos (não impedem ligar)
  'acionar_automacao_desligada',
  'acionar_automacao_apagada',
  'acionar_automacao_da_regua',
  'acionar_automacao_do_atlas',
  'iniciar_robo_desligado',
  'iniciar_robo_apagado',
] as const

const CONHECIDOS: ReadonlySet<string> = new Set(CODIGOS_DE_PENDENCIA)

/**
 * A chave da frase, RELATIVA ao namespace `Automations.builder`
 * (`pendencias.codigos.<codigo>`), ou `null` quando não há código conhecido —
 * aí a tela mostra o `message` da pendência (as que já nascem em português
 * não têm código).
 */
export function chaveDaPendencia(issue: { codigo?: unknown }): string | null {
  const codigo = issue.codigo
  return typeof codigo === 'string' && CONHECIDOS.has(codigo)
    ? `pendencias.codigos.${codigo}`
    : null
}

/** O que a tela carregou das automações e robôs da conta. */
export interface ReferenciasDosPassos {
  /**
   * `null` = a lista não carregou (ou falhou): NADA é afirmado sobre os
   * passos de acionar automação. Lista vazia durante a carga viraria "a
   * automação escolhida foi apagada" em todo passo — a armadilha da lista
   * vazia virando afirmação.
   */
  automacoes: ReadonlyArray<{ id: string; is_active: boolean; trigger_type?: string }> | null
  /** Idem, para os passos de iniciar robô. */
  robos: ReadonlyArray<{ id: string; status: string }> | null
}

interface NoComConfig<T> extends NoDaArvore<T> {
  step_config: Record<string, unknown>
}

function idDoAlvo(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

/**
 * O que NÃO impede ligar, mas quebra em execução — na mesma forma das
 * pendências (`path` + `codigo`), para `localizarPendencias` os pôr no passo.
 *
 * - "Acionar automação" apontando para automação DESLIGADA ou APAGADA: o
 *   motor recusa (`runAutomationById` devolve "automação alvo está
 *   desativada" / "não encontrada"), o passo falha e a execução PARA ali — os
 *   passos seguintes não rodam. A validação não barra isso de propósito: é
 *   estado do banco no DISPARO, e a alvo pode ser ligada depois.
 * - "Acionar automação" apontando para a RÉGUA DO ASAAS: o motor recusa
 *   sempre (ela só roda pela varredura), ligada ou não — por isso este aviso
 *   vem antes do de "desligada", que mandaria ligar o que não resolve.
 * - "Iniciar robô" apontando para robô que não está `active` (rascunho ou
 *   arquivado) ou APAGADO: `startFlowForContact` recusa, e o passo falha do
 *   mesmo jeito.
 *
 * Alvo vazio fica com a validação (é pendência, não aviso).
 */
export function avisosDaAutomacao<T extends NoComConfig<T>>(
  steps: readonly T[],
  referencias: ReferenciasDosPassos,
): ValidationIssue[] {
  const avisos: ValidationIssue[] = []
  const automacoes = referencias.automacoes
    ? new Map(referencias.automacoes.map((a) => [a.id, a]))
    : null
  const robos = referencias.robos ? new Map(referencias.robos.map((r) => [r.id, r])) : null
  // O mesmo percurso e os mesmos endereços de `validate.ts`: só desce pelos
  // ramos de uma condição.
  const visitar = (lista: readonly T[], prefixo: string) => {
    lista.forEach((s, i) => {
      const path = `${prefixo}steps[${i}]`
      const c = s.step_config ?? {}
      if (s.step_type === 'run_automation' && automacoes) {
        const id = idDoAlvo(c.automation_id)
        const alvo = id ? automacoes.get(id) : undefined
        if (id && !alvo) {
          avisos.push({
            path: `${path}.automation_id`,
            message: 'a automação acionada foi apagada: o passo falha e os seguintes não rodam',
            codigo: 'acionar_automacao_apagada',
          })
        } else if (alvo && ehGatilhoDaRegua(alvo.trigger_type)) {
          avisos.push({
            path: `${path}.automation_id`,
            message:
              'a automação acionada é da régua de cobrança do Asaas, que só roda pela varredura: o passo falha e os seguintes não rodam',
            codigo: 'acionar_automacao_da_regua',
          })
        } else if (alvo && alvo.trigger_type === GATILHO_DO_ATLAS) {
          avisos.push({
            path: `${path}.automation_id`,
            message:
              'a automação acionada é do gatilho "Situação mudou no Atlas", que só roda pela leitura do Atlas: o passo falha e os seguintes não rodam',
            codigo: 'acionar_automacao_do_atlas',
          })
        } else if (alvo && alvo.is_active !== true) {
          avisos.push({
            path: `${path}.automation_id`,
            message: 'a automação acionada está desligada: o passo falha e os seguintes não rodam',
            codigo: 'acionar_automacao_desligada',
          })
        }
      }
      if (s.step_type === 'run_flow' && robos) {
        const id = idDoAlvo(c.flow_id)
        const alvo = id ? robos.get(id) : undefined
        if (id && !alvo) {
          avisos.push({
            path: `${path}.flow_id`,
            message: 'o robô iniciado foi apagado: o passo falha e os seguintes não rodam',
            codigo: 'iniciar_robo_apagado',
          })
        } else if (alvo && alvo.status !== 'active') {
          avisos.push({
            path: `${path}.flow_id`,
            message: 'o robô iniciado não está ativo: o passo falha e os seguintes não rodam',
            codigo: 'iniciar_robo_desligado',
          })
        }
      }
      if (s.step_type === 'condition' && s.branches) {
        visitar(s.branches.yes, `${path}.yes.`)
        visitar(s.branches.no, `${path}.no.`)
      }
    })
  }
  visitar(steps, '')
  return avisos
}
