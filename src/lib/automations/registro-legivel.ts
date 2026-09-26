// ============================================================
// Os REGISTROS DE EXECUÇÃO das automações (`/automations/[id]/logs`) com
// nome no lugar de id.
//
// O motor grava o que fez em `automation_logs.steps_executed[].detail` com o
// id cru do alvo: "negócio movido para 3ab137e6-…", "tag 32f2da4f-… added",
// "assigned to 582aad06-…". Pedido do operador (25/09/2026): ler ali o NOME da
// etapa, da etiqueta, do membro.
//
// ⚠️ A troca é NA TELA, nunca no motor. Três motivos: vale também para os
// registros já gravados; o texto guardado é a fotografia do que rodou (o id
// que o passo USOU, mesmo que a automação tenha sido editada depois); e o
// motor não ganha consulta nenhuma por passo.
//
// ⚠️ Id que não achou nome só vira "(etiqueta apagada)" quando o catálogo
// daquele tipo CARREGOU. Consulta que falhou não autoriza afirmar que a
// etiqueta sumiu — o id cru fica, que é o que aparecia antes.
// ============================================================

/** O que um id citado no registro pode ser. */
export type TipoDoAlvo = 'etiqueta' | 'etapa' | 'membro' | 'campo' | 'tarefa'

export const TIPOS_DO_ALVO: readonly TipoDoAlvo[] = ['etiqueta', 'etapa', 'membro', 'campo', 'tarefa']

/**
 * O tipo do id que o texto de CADA passo cita — é o que decide o rótulo do
 * id órfão. Passo fora da lista não cita alvo com id (ou cita id de coisa sem
 * catálogo aqui), e o id desconhecido dele fica como está.
 */
const ALVO_DO_PASSO: Partial<Record<string, TipoDoAlvo>> = {
  add_tag: 'etiqueta',
  remove_tag: 'etiqueta',
  move_deal_stage: 'etapa',
  assign_conversation: 'membro',
  update_contact_field: 'campo',
  create_task: 'tarefa',
}

export interface NomesDoRegistro {
  /** Nome por id, de qualquer catálogo (os ids não se repetem entre tabelas). */
  porId: Readonly<Record<string, string>>
  /** Os catálogos que responderam — só eles podem dizer "apagado". */
  carregados: ReadonlySet<TipoDoAlvo>
}

const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
// O campo personalizado aparece como `custom:<id>` ("field custom:… not
// writable"): o prefixo sai junto com o id, senão a tela diria
// "custom:"Data e Hora Reunião"".
const RE_ID_NO_TEXTO = /(custom:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi

/** Os ids que os textos citam, sem repetição e em minúsculas. */
/**
 * Quantos ids vão numa consulta `.in(...)`. A lista viaja na URL do
 * PostgREST: com 100 execuções de uma automação que cria tarefa (um id novo
 * por execução), a lista inteira passava do limite de tamanho da linha do
 * pedido, TODAS as consultas de nome falhavam e a tela voltava aos ids crus
 * (Codex, PR #298). 50 UUIDs dão ~1,9 mil caracteres.
 */
export const IDS_POR_CONSULTA = 50

/** Fatia a lista de ids em lotes de `IDS_POR_CONSULTA`, na ordem. */
export function lotesDeIds(ids: readonly string[], tamanho = IDS_POR_CONSULTA): string[][] {
  const lotes: string[][] = []
  for (let i = 0; i < ids.length; i += tamanho) lotes.push(ids.slice(i, i + tamanho))
  return lotes
}

export function idsCitados(textos: ReadonlyArray<string | null | undefined>): string[] {
  const vistos = new Set<string>()
  for (const texto of textos) {
    if (!texto) continue
    for (const m of texto.matchAll(RE_UUID)) vistos.add(m[0].toLowerCase())
  }
  return [...vistos]
}

/**
 * O texto do registro com cada id trocado pelo nome, entre aspas.
 *
 * `tipoDoPasso` é o `step_type` da linha (nulo para o `error_message` da
 * execução, que não diz de qual passo veio): é ele que diz se o id
 * desconhecido é uma etiqueta apagada ou algo que esta tela não conhece.
 */
export function textoComNomes(
  texto: string,
  nomes: NomesDoRegistro,
  tipoDoPasso: string | null,
  rotuloDoOrfao: (tipo: TipoDoAlvo) => string,
): string {
  const alvo = tipoDoPasso ? ALVO_DO_PASSO[tipoDoPasso] : undefined
  return texto.replace(RE_ID_NO_TEXTO, (inteiro, prefixo: string | undefined, id: string) => {
    const nome = nomes.porId[id.toLowerCase()]
    if (nome) return `"${nome}"`
    const tipo: TipoDoAlvo | undefined = prefixo ? 'campo' : alvo
    if (tipo && nomes.carregados.has(tipo)) return rotuloDoOrfao(tipo)
    return inteiro
  })
}
