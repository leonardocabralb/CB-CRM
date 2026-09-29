// ============================================================
// Os NOMES que as telas de execução mostram no lugar de ids — servidor,
// service role, cada consulta cercada pela CONTA de quem pergunta.
//
// Dois leitores, duas perguntas:
//   - `carregarNomesDosPassos`: os alvos do PLANO (`step_config`), para o
//     rótulo de cada passo (`descreverPasso`). Veio da rota GET das
//     execuções (a linha do tempo de quem está aguardando).
//   - `carregarNomesDoTexto`: os ids que o MOTOR escreveu no texto de cada
//     passo ("negócio movido para 3ab137e6-…"), para `textoComNomes` — a
//     mesma troca da tela de registros (`registro-legivel.ts`), aqui na
//     expansão do "Já rodou".
// ============================================================

import type { supabaseAdmin } from '@/lib/automations/admin-client'
import type { NomesConhecidos } from '@/lib/automations/descrever-passo'
import { lotesDeIds, type TipoDoAlvo } from '@/lib/automations/registro-legivel'
import type { PassoDaAutomacao } from './linha-do-tempo'

type Db = ReturnType<typeof supabaseAdmin>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Ids citados nos `step_config` → nomes legíveis, para o `descreverPasso`
 * não imprimir UUID nem carimbar "(apagado)" em alvo vivo.
 *
 * ⚠️ CADA lookup é cercado pela CONTA, mesmo sendo "só rótulo": o validador
 * de ativação NÃO confere posse do alvo, então um agent pode gravar um UUID
 * alheio no step_config de propósito — sem a cerca, esta rota viraria um
 * oráculo de nomes de outras contas (achado da revisão do Codex no PR #70).
 * `pipeline_stages` não tem account_id; a cerca vai pelo funil pai.
 */
export async function carregarNomesDosPassos(
  db: Db,
  passos: readonly PassoDaAutomacao[],
  accountId: string,
): Promise<NomesConhecidos> {
  const tagIds = new Set<string>()
  const etapaIds = new Set<string>()
  const fluxoIds = new Set<string>()
  const autoIds = new Set<string>()
  const campoIds = new Set<string>()

  for (const p of passos) {
    const cfg = (p.step_config ?? {}) as Record<string, unknown>
    if (typeof cfg.tag_id === 'string') tagIds.add(cfg.tag_id)
    if (typeof cfg.stage_id === 'string') etapaIds.add(cfg.stage_id)
    if (typeof cfg.flow_id === 'string') fluxoIds.add(cfg.flow_id)
    if (typeof cfg.automation_id === 'string') autoIds.add(cfg.automation_id)
    // A condição por campo personalizado (2.10) guarda o campo no `operand`.
    if (
      p.step_type === 'condition' &&
      cfg.subject === 'custom_field' &&
      typeof cfg.operand === 'string' &&
      UUID_RE.test(cfg.operand.trim())
    ) {
      campoIds.add(cfg.operand.trim())
    }
    // "Alterar campo do contato" guarda o campo como "custom:<id>".
    if (p.step_type === 'update_contact_field' && typeof cfg.field === 'string') {
      const id = cfg.field.trim().replace(/^custom:/, '')
      if (id !== cfg.field.trim() && UUID_RE.test(id)) campoIds.add(id)
    }
  }

  const paraMapa = (
    rotulo: string,
    res: { data: unknown; error: { message: string } | null },
  ) => {
    if (res.error) {
      // Rótulo é decorativo: sem ele a linha mostra "(apagado)", que é
      // pior que o certo mas melhor que derrubar a aba inteira.
      console.error(`[execucoes] nomes de ${rotulo} falharam:`, res.error.message)
      return {}
    }
    return Object.fromEntries(
      ((res.data ?? []) as { id: string; name: string }[]).map((r) => [
        r.id,
        r.name,
      ]),
    )
  }

  const vazio = { data: [], error: null } as const
  const [tagsRes, etapasRes, fluxosRes, autosRes, camposRes] = await Promise.all([
    tagIds.size
      ? db.from('tags').select('id, name').in('id', [...tagIds]).eq('account_id', accountId)
      : Promise.resolve(vazio),
    etapaIds.size
      ? db
          .from('pipeline_stages')
          .select('id, name, pipelines!inner(account_id)')
          .in('id', [...etapaIds])
          .eq('pipelines.account_id', accountId)
      : Promise.resolve(vazio),
    fluxoIds.size
      ? db.from('flows').select('id, name').in('id', [...fluxoIds]).eq('account_id', accountId)
      : Promise.resolve(vazio),
    autoIds.size
      ? db.from('automations').select('id, name').in('id', [...autoIds]).eq('account_id', accountId)
      : Promise.resolve(vazio),
    // `field_name` vira `name`: o `paraMapa` lê `name`.
    campoIds.size
      ? db
          .from('custom_fields')
          .select('id, name:field_name')
          .in('id', [...campoIds])
          .eq('account_id', accountId)
      : Promise.resolve(vazio),
  ])

  return {
    tags: paraMapa('tags', tagsRes),
    etapas: paraMapa('pipeline_stages', etapasRes),
    fluxos: paraMapa('flows', fluxosRes),
    automacoes: paraMapa('automations', autosRes),
    campos: paraMapa('custom_fields', camposRes),
  }
}

/** Nomes por id, e os catálogos que RESPONDERAM — só eles podem dizer "(apagada)". */
export interface NomesDoTexto {
  porId: Record<string, string>
  carregados: TipoDoAlvo[]
}

/**
 * Os ids citados nos textos do motor → nomes, pela CONTA.
 *
 * ⚠️ A mesma régua da tela de registros: catálogo cuja consulta FALHOU fica
 * fora de `carregados`, e o id aparece cru — consulta que falhou não autoriza
 * afirmar que a etiqueta sumiu. Em lotes (`lotesDeIds`): a lista viaja na URL
 * do PostgREST.
 *
 * ⚠️ A cerca pela conta vale também aqui: o texto é do motor, mas o id veio de
 * um `step_config` que o validador não confere — sem ela, a expansão viraria
 * um oráculo de nomes de outras contas (a lição do PR #70).
 */
export async function carregarNomesDoTexto(
  db: Db,
  ids: readonly string[],
  accountId: string,
): Promise<NomesDoTexto> {
  if (ids.length === 0) return { porId: {}, carregados: [] }
  const lotes = lotesDeIds([...ids])
  type Linha = Record<string, unknown>
  type Resultado = { data: Linha[]; falhou: boolean }
  const emLotes = async (
    consulta: (lote: string[]) => PromiseLike<{ data: unknown; error: unknown }>,
  ): Promise<Resultado> => {
    const partes = await Promise.all(lotes.map(consulta))
    return {
      data: partes.flatMap((p) => (Array.isArray(p.data) ? (p.data as Linha[]) : [])),
      falhou: partes.some((p) => p.error),
    }
  }

  const [tags, etapas, membros, campos, tarefas] = await Promise.all([
    emLotes((l) => db.from('tags').select('id, name').in('id', l).eq('account_id', accountId)),
    // `pipeline_stages` não tem account_id: a cerca vai pelo funil pai.
    emLotes((l) =>
      db
        .from('pipeline_stages')
        .select('id, name, pipelines!inner(name, account_id)')
        .in('id', l)
        .eq('pipelines.account_id', accountId),
    ),
    // O motor cita o id do LOGIN (`assign_conversation`), nunca `profiles.id`.
    emLotes((l) =>
      db.from('profiles').select('user_id, full_name, email').in('user_id', l).eq('account_id', accountId),
    ),
    emLotes((l) => db.from('custom_fields').select('id, field_name').in('id', l).eq('account_id', accountId)),
    emLotes((l) => db.from('cb_tasks').select('id, titulo').in('id', l).eq('account_id', accountId)),
  ])

  const porId: Record<string, string> = {}
  const carregados: TipoDoAlvo[] = []
  const guardar = (tipo: TipoDoAlvo, res: Resultado, linha: (r: Linha) => [unknown, unknown]) => {
    if (res.falhou) {
      console.error(`[execucoes] nomes do texto (${tipo}) falharam`)
    } else {
      carregados.push(tipo)
    }
    for (const r of res.data) {
      const [id, nome] = linha(r)
      if (typeof id === 'string' && typeof nome === 'string' && nome.trim()) {
        porId[id.toLowerCase()] = nome.trim()
      }
    }
  }
  guardar('etiqueta', tags, (r) => [r.id, r.name])
  guardar('etapa', etapas, (r) => {
    // Etapa com o funil na frente: "Reunião Agendada" existe em mais de um.
    const funil = (Array.isArray(r.pipelines) ? r.pipelines[0] : r.pipelines) as { name?: unknown } | null
    return [r.id, typeof funil?.name === 'string' && funil.name ? `${funil.name} › ${r.name}` : r.name]
  })
  // Perfil com o nome em branco cai no e-mail, como na tela de registros.
  guardar('membro', membros, (r) => [
    r.user_id,
    (typeof r.full_name === 'string' && r.full_name.trim()) || r.email,
  ])
  guardar('campo', campos, (r) => [r.id, r.field_name])
  guardar('tarefa', tarefas, (r) => [r.id, r.titulo])
  return { porId, carregados }
}
