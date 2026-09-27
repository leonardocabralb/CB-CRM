import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Builder payload → flat rows for automation_steps.
// Root steps arrive in order. A Condition step carries its children
// under `branches: { yes: [...], no: [...] }`. We walk the tree and
// assign stable UUIDs so parent_step_id references resolve in a
// single INSERT.
//
// NOSSO (26/09/2026): o id que o construtor manda (o do banco, ou um
// UUID gerado na tela para o passo novo) é MANTIDO — a identidade do
// passo é o que a espera estacionada guarda. Ver `replaceSteps`.
// ------------------------------------------------------------

export interface BuilderStepInput {
  id?: string
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: BuilderStepInput[]; no?: BuilderStepInput[] }
  // Legacy flat form (from template seeds):
  branch?: 'yes' | 'no' | null
  parent_index?: number | null
}

interface InsertRow {
  id: string
  automation_id: string
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  step_type: string
  step_config: Record<string, unknown>
  position: number
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * O payload do construtor → as linhas de `automation_steps`, PURO.
 *
 * O id que veio no passo é MANTIDO quando tem forma de UUID, não se repete no
 * payload e `aceitarId` deixa; senão, id novo. Manter é o que preserva a
 * identidade do passo entre um salvamento e outro (ver `replaceSteps`).
 */
export function montarLinhas(
  automationId: string,
  input: BuilderStepInput[],
  aceitarId: (id: string) => boolean = () => true,
): InsertRow[] {
  if (!input || input.length === 0) return []

  const looksFlat = input.some(
    (s) => s.branch !== undefined || s.parent_index !== undefined,
  )
  const tree = looksFlat ? seedsToTree(input) : input

  const rows: InsertRow[] = []
  const usados = new Set<string>()
  function walk(
    steps: BuilderStepInput[],
    parentId: string | null,
    branch: 'yes' | 'no' | null,
  ) {
    steps.forEach((s, idx) => {
      const pedido = typeof s.id === 'string' ? s.id.toLowerCase() : null
      const id =
        pedido && UUID_RE.test(pedido) && !usados.has(pedido) && aceitarId(pedido)
          ? pedido
          : uid()
      usados.add(id)
      rows.push({
        id,
        automation_id: automationId,
        parent_step_id: parentId,
        branch,
        step_type: s.step_type,
        step_config: s.step_config ?? {},
        position: idx,
      })
      if (s.step_type === 'condition' && s.branches) {
        if (s.branches.yes) walk(s.branches.yes, id, 'yes')
        if (s.branches.no) walk(s.branches.no, id, 'no')
      }
    })
  }
  walk(tree, null, null)
  return rows
}

/** Os ids com forma de UUID que o payload pede, em minúsculas e sem repetição. */
function idsPedidos(input: BuilderStepInput[]): string[] {
  const ids = new Set<string>()
  function walk(steps: BuilderStepInput[] | undefined) {
    for (const s of steps ?? []) {
      if (typeof s.id === 'string' && UUID_RE.test(s.id)) ids.add(s.id.toLowerCase())
      walk(s.branches?.yes)
      walk(s.branches?.no)
    }
  }
  walk(input)
  return [...ids]
}

/**
 * Grava os passos de uma automação que JÁ existe, PRESERVANDO a identidade de
 * quem continua: atualiza no lugar os passos cujo id já é desta automação,
 * insere os novos e apaga só os que saíram.
 *
 * ⚠️⚠️ Até 26/09/2026 isto apagava TODOS os passos e reinseria com ids novos.
 * A espera estacionada guarda `parent_step_id` (a condição do ramo), com FK
 * `ON DELETE SET NULL`: todo salvamento zerava a coluna, e a retomada rodava o
 * escopo de FORA a partir da posição do ramo — outro passo, possivelmente outra
 * mensagem ao cliente (medido no e2e). A outra ponta mora em `retomada.ts`: o
 * passo que a espera guarda é conferido ao acordar, e o que foi removido ou
 * mudou de escopo vira falha visível.
 *
 * ⚠️ Id de passo que é de OUTRA automação nunca é aproveitado (vira id novo):
 * com o `upsert` por `id`, aproveitá-lo sobrescreveria o passo alheio — de
 * outra conta, inclusive (a rota roda em service role).
 *
 * ⚠️ ORDEM: apaga primeiro, grava depois — duas instruções, sem transação (uma
 * RPC pediria migration e amarraria a ordem do deploy). Entre as duas, quem ler
 * vê a versão ANTIGA sem os passos removidos: nunca um passo que o operador
 * apagou junto com a versão nova, e nunca a automação vazia, a menos que TODOS
 * os passos tenham saído. O `upsert` troca o resto numa instrução só, atômica.
 * Gravar primeiro deixaria o passo apagado vivo, na posição antiga, ao lado dos
 * novos. (Uma execução que JÁ carregou o escopo antes do salvamento roda a
 * versão que carregou — é inerente, com ou sem transação.)
 */
export async function replaceSteps(
  automationId: string,
  input: BuilderStepInput[],
): Promise<string | null> {
  const admin = supabaseAdmin()

  const pedidos = idsPedidos(input ?? [])
  const deOutra = new Set<string>()
  if (pedidos.length > 0) {
    const { data, error } = await admin
      .from('automation_steps')
      .select('id, automation_id')
      .in('id', pedidos)
    if (error) return error.message
    for (const r of (data ?? []) as { id: string; automation_id: string }[]) {
      // O Postgres devolve o uuid em minúsculas; o id da rota vem da URL.
      if (r.automation_id.toLowerCase() !== automationId.toLowerCase()) {
        deOutra.add(r.id.toLowerCase())
      }
    }
  }
  const rows = montarLinhas(automationId, input, (id) => !deOutra.has(id))

  // O que saiu. A FK de `automation_steps.parent_step_id` é CASCADE: apagar
  // uma condição leva junto os passos dos ramos dela — que saíram também, no
  // construtor (remover um passo remove a subárvore).
  let apagar = admin.from('automation_steps').delete().eq('automation_id', automationId)
  if (rows.length > 0) apagar = apagar.not('id', 'in', `(${rows.map((r) => r.id).join(',')})`)
  const { error: delErr } = await apagar
  if (delErr) return delErr.message
  if (rows.length === 0) return null

  // `id` é a chave primária: índice TOTAL, alvo válido de `on_conflict`.
  const { error } = await admin.from('automation_steps').upsert(rows, { onConflict: 'id' })
  return error?.message ?? null
}

/**
 * Passos de uma automação RECÉM-criada: ids SEMPRE novos. A identidade só
 * importa a partir daqui — o construtor, depois de criar, recarrega pela tela
 * de edição —, e aproveitar o id da tela faria o reenvio de um POST que já
 * tinha gravado (rede que caiu na resposta) estourar a chave primária.
 */
export async function insertSteps(
  automationId: string,
  input: BuilderStepInput[],
): Promise<string | null> {
  const rows = montarLinhas(automationId, input, () => false)
  if (rows.length === 0) return null
  const { error } = await supabaseAdmin().from('automation_steps').insert(rows)
  return error?.message ?? null
}

function seedsToTree(seeds: BuilderStepInput[]): BuilderStepInput[] {
  const nodes: BuilderStepInput[] = seeds.map((s) => ({
    ...s,
    branches: { yes: [], no: [] },
  }))
  const roots: BuilderStepInput[] = []
  nodes.forEach((n, i) => {
    const seed = seeds[i]
    if (seed.parent_index == null) {
      roots.push(n)
    } else {
      const parent = nodes[seed.parent_index]
      parent.branches = parent.branches ?? { yes: [], no: [] }
      const bucket = (seed.branch ?? 'yes') as 'yes' | 'no'
      ;(parent.branches[bucket] ??= []).push(n)
    }
  })
  return roots
}

/**
 * Load the steps for an automation and rebuild the nested tree shape
 * the builder UI expects. One query, O(n) assembly.
 */
export interface BuilderStepNode extends BuilderStepInput {
  id: string
  branches: { yes: BuilderStepNode[]; no: BuilderStepNode[] }
}

interface DbStep {
  id: string
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  step_type: string
  step_config: Record<string, unknown>
  position: number
}

export async function loadStepsTree(automationId: string): Promise<BuilderStepNode[]> {
  const { data, error } = await supabaseAdmin()
    .from('automation_steps')
    .select('*')
    .eq('automation_id', automationId)
    .order('position', { ascending: true })

  if (error) throw new Error(error.message)
  const rows = (data ?? []) as DbStep[]

  const byId = new Map<string, BuilderStepNode>()
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      step_type: row.step_type,
      step_config: row.step_config ?? {},
      branches: { yes: [], no: [] },
    })
  }

  const roots: BuilderStepNode[] = []
  for (const row of rows) {
    const node = byId.get(row.id)!
    if (row.parent_step_id) {
      const parent = byId.get(row.parent_step_id)
      if (parent) {
        const bucket = (row.branch ?? 'yes') as 'yes' | 'no'
        parent.branches[bucket].push(node)
      }
    } else {
      roots.push(node)
    }
  }
  return roots
}
