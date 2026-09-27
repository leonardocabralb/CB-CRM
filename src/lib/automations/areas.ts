// ============================================================
// As ÁREAS da tela de Automações (1055): abas que cada conta cria.
//
// Só ORGANIZAM a lista — o motor não lê nada disto. A aba "Geral" é fixa e
// NÃO tem linha: é `automations.area_id` NULO, e o rótulo sai do dicionário
// (o desenho do bloco "Geral" dos campos personalizados, 966). As outras são
// linhas de `cb_areas_de_automacao`, criadas, renomeadas, reordenadas e
// apagadas na tela; nenhum nome de área mora no código, porque cada
// instalação tem as suas.
// ============================================================

/** Espelho do CHECK da 1055 (há teste lendo a migration). */
export const TETO_DO_NOME_DA_AREA = 40

/** O filtro da aba "Geral" (automações sem área). */
export const ABA_GERAL = "__geral__"

export interface AreaDeAutomacao {
  id: string
  nome: string
  posicao: number
}

function chave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Os rótulos da aba "Geral" nos dicionários (e o plural), sem caixa e sem acento. */
const NOMES_DA_ABA_FIXA = new Set(["geral", "gerais", "general"])

export type NomeDaArea =
  | { ok: true; nome: string }
  | { ok: false; motivo: "vazio" | "longo" | "reservado" | "repetido" }

/**
 * O nome digitado para uma aba. Apara e colapsa os espaços; recusa vazio,
 * acima do teto, "Geral" (a aba fixa) e nome que já existe na conta —
 * comparado sem caixa e sem acento, senão "tributario" e "Tributário" seriam
 * duas abas com o mesmo nome para quem lê. `ignorarId` é a própria aba, ao
 * renomear.
 */
export function lerNomeDaArea(
  digitado: string,
  areas: readonly AreaDeAutomacao[],
  ignorarId?: string,
): NomeDaArea {
  const nome = digitado.replace(/\s+/g, " ").trim()
  if (!nome) return { ok: false, motivo: "vazio" }
  if (nome.length > TETO_DO_NOME_DA_AREA) return { ok: false, motivo: "longo" }
  const k = chave(nome)
  // O rótulo da aba fixa em TODO dicionário servido ("Geral", "General"):
  // com outro idioma, uma aba "General" seria gêmea da fixa.
  if (NOMES_DA_ABA_FIXA.has(k)) return { ok: false, motivo: "reservado" }
  if (areas.some((a) => a.id !== ignorarId && chave(a.nome) === k)) return { ok: false, motivo: "repetido" }
  return { ok: true, nome }
}

/** A ordem das abas: a posição gravada, e o nome no empate. */
export function ordenarAreas<T extends AreaDeAutomacao>(areas: readonly T[]): T[] {
  return [...areas].sort((a, b) => a.posicao - b.posicao || a.nome.localeCompare(b.nome, "pt-BR"))
}

/**
 * Em que aba a automação aparece. Área que não está na lista (a leitura das
 * áreas ainda não voltou, ou foi apagada com a tela aberta) cai em "Geral" —
 * é o que o banco faz ao apagar (SET NULL), e sumir da lista seria pior.
 */
export function abaDaAutomacao(areaId: string | null | undefined, idsDasAreas: ReadonlySet<string>): string {
  return areaId && idsDasAreas.has(areaId) ? areaId : ABA_GERAL
}

/** Quantas automações há em cada aba (`ABA_GERAL` incluída, zero incluído). */
export function contarPorAba(
  automacoes: readonly { area_id?: string | null }[],
  areas: readonly AreaDeAutomacao[],
): Map<string, number> {
  const ids = new Set(areas.map((a) => a.id))
  const contagem = new Map<string, number>([[ABA_GERAL, 0], ...areas.map((a) => [a.id, 0] as [string, number])])
  for (const a of automacoes) {
    const aba = abaDaAutomacao(a.area_id, ids)
    contagem.set(aba, (contagem.get(aba) ?? 0) + 1)
  }
  return contagem
}

/**
 * A aba sugerida pelo NOME do funil, para a automação criada pela aba
 * Automações de um funil: "Bancário - Comercial" sugere a aba "Bancário".
 * Casa quando o nome do funil É o nome da aba ou COMEÇA por ele seguido de
 * espaço; havendo mais de uma, vence a mais longa. Sem aba que case, `null`
 * (a automação nasce em "Geral").
 */
export function areaDoFunil(
  nomeDoFunil: string | null | undefined,
  areas: readonly AreaDeAutomacao[],
): string | null {
  if (!nomeDoFunil) return null
  const funil = chave(nomeDoFunil)
  let melhor: AreaDeAutomacao | null = null
  for (const a of areas) {
    const k = chave(a.nome)
    if (!k) continue
    if (funil === k || funil.startsWith(`${k} `)) {
      if (!melhor || k.length > chave(melhor.nome).length) melhor = a
    }
  }
  return melhor?.id ?? null
}

/**
 * Move uma aba uma casa (`-1` para a esquerda, `+1` para a direita) e devolve
 * TODAS com a posição reescrita 0..N-1 — as posições gravadas podem ter
 * buraco ou empate, e mexer só nas duas vizinhas manteria o empate. `null` =
 * não há para onde mover.
 */
export function moverArea(
  areas: readonly AreaDeAutomacao[],
  id: string,
  delta: -1 | 1,
): AreaDeAutomacao[] | null {
  const ordem = ordenarAreas(areas)
  const i = ordem.findIndex((a) => a.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= ordem.length) return null
  ;[ordem[i], ordem[j]] = [ordem[j], ordem[i]]
  return ordem.map((a, posicao) => ({ ...a, posicao }))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * O `area_id` que chega no corpo da API: id de área, ou `null`/"" = "Geral".
 * `undefined` = forma inválida (400). Se a área é DA CONTA quem responde é a
 * FK composta da 1055 — ver `ehAreaDeOutraConta`.
 */
export function lerIdDaArea(valor: unknown): string | null | undefined {
  if (valor === null || valor === "") return null
  if (typeof valor === "string" && UUID.test(valor.trim())) return valor.trim()
  return undefined
}

/** O erro do banco é a FK da área (área de outra conta, ou apagada no meio). */
export function ehAreaDeOutraConta(erro: { code?: string; message?: string } | null | undefined): boolean {
  return erro?.code === "23503" && (erro.message ?? "").includes("automations_area_fkey")
}
