import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  ABA_GERAL,
  TETO_DO_NOME_DA_AREA,
  abaDaAutomacao,
  areaDoFunil,
  contarPorAba,
  lerNomeDaArea,
  moverArea,
  ordenarAreas,
  type AreaDeAutomacao,
} from "./areas"

const AREAS: AreaDeAutomacao[] = [
  { id: "a1", nome: "Bancário", posicao: 0 },
  { id: "a2", nome: "Trabalhista", posicao: 1 },
  { id: "a3", nome: "Previdenciário", posicao: 2 },
]

describe("lerNomeDaArea", () => {
  it("apara e colapsa os espaços", () => {
    expect(lerNomeDaArea("  Tributário   e fiscal ", AREAS)).toEqual({ ok: true, nome: "Tributário e fiscal" })
  })

  it("recusa vazio, longo, a aba fixa e nome repetido (sem caixa e sem acento)", () => {
    expect(lerNomeDaArea("   ", AREAS)).toEqual({ ok: false, motivo: "vazio" })
    expect(lerNomeDaArea("x".repeat(TETO_DO_NOME_DA_AREA + 1), AREAS)).toEqual({ ok: false, motivo: "longo" })
    expect(lerNomeDaArea("geral", AREAS)).toEqual({ ok: false, motivo: "reservado" })
    expect(lerNomeDaArea("Gerais", AREAS)).toEqual({ ok: false, motivo: "reservado" })
    expect(lerNomeDaArea("General", AREAS)).toEqual({ ok: false, motivo: "reservado" })
    expect(lerNomeDaArea("bancario", AREAS)).toEqual({ ok: false, motivo: "repetido" })
  })

  it("renomear a própria aba não conta como repetido", () => {
    expect(lerNomeDaArea("BANCÁRIO", AREAS, "a1")).toEqual({ ok: true, nome: "BANCÁRIO" })
  })

  it("o teto é o do CHECK da 1055", () => {
    const sql = readFileSync("supabase/migrations/1055_cb_areas_de_automacao.sql", "utf8")
    expect(sql).toContain(`char_length(nome) <= ${TETO_DO_NOME_DA_AREA}`)
  })
})

describe("ordenarAreas", () => {
  it("pela posição e, no empate, pelo nome", () => {
    const r = ordenarAreas([
      { id: "x", nome: "Zeta", posicao: 1 },
      { id: "y", nome: "Alfa", posicao: 1 },
      { id: "z", nome: "Meio", posicao: 0 },
    ])
    expect(r.map((a) => a.id)).toEqual(["z", "y", "x"])
  })
})

describe("abaDaAutomacao e contarPorAba", () => {
  const ids = new Set(AREAS.map((a) => a.id))

  it("sem área, ou área que a tela não conhece, é Geral", () => {
    expect(abaDaAutomacao(null, ids)).toBe(ABA_GERAL)
    expect(abaDaAutomacao("sumiu", ids)).toBe(ABA_GERAL)
    expect(abaDaAutomacao("a2", ids)).toBe("a2")
  })

  it("conta todas as abas, inclusive as vazias", () => {
    const c = contarPorAba([{ area_id: "a1" }, { area_id: "a1" }, { area_id: null }, { area_id: "sumiu" }], AREAS)
    expect(Object.fromEntries(c)).toEqual({ [ABA_GERAL]: 2, a1: 2, a2: 0, a3: 0 })
  })
})

describe("areaDoFunil", () => {
  it("o funil que começa pelo nome da aba a sugere", () => {
    expect(areaDoFunil("Bancário - Comercial", AREAS)).toBe("a1")
    expect(areaDoFunil("trabalhista", AREAS)).toBe("a2")
    expect(areaDoFunil("Previdenciário – Auxílio-Acidente", AREAS)).toBe("a3")
  })

  it("prefixo sem espaço depois não casa, e vence a aba mais longa", () => {
    expect(areaDoFunil("Bancáriox", AREAS)).toBeNull()
    expect(areaDoFunil("Vendas", AREAS)).toBeNull()
    const comDuas = [...AREAS, { id: "a4", nome: "Bancário PJ", posicao: 3 }]
    expect(areaDoFunil("Bancário PJ - Comercial", comDuas)).toBe("a4")
    expect(areaDoFunil(null, AREAS)).toBeNull()
  })
})

describe("moverArea", () => {
  it("troca com a vizinha e reescreve 0..N-1", () => {
    const r = moverArea([{ id: "a1", nome: "A", posicao: 5 }, { id: "a2", nome: "B", posicao: 5 }, { id: "a3", nome: "C", posicao: 9 }], "a3", -1)
    expect(r).toEqual([
      { id: "a1", nome: "A", posicao: 0 },
      { id: "a3", nome: "C", posicao: 1 },
      { id: "a2", nome: "B", posicao: 2 },
    ])
  })

  it("nas pontas não há para onde mover", () => {
    expect(moverArea(AREAS, "a1", -1)).toBeNull()
    expect(moverArea(AREAS, "a3", 1)).toBeNull()
    expect(moverArea(AREAS, "nada", 1)).toBeNull()
  })
})

describe("dicionários", () => {
  it.each(["pt-BR.json", "en.json"])("%s: o rótulo da aba fixa é um nome reservado", (arquivo) => {
    const d = JSON.parse(readFileSync(`messages/${arquivo}`, "utf8"))
    const rotulo = d.Automations.list.abas.geral as string
    expect(lerNomeDaArea(rotulo, [])).toEqual({ ok: false, motivo: "reservado" })
  })

  // A tela pede `erros.<motivo>` por chave MONTADA, que o portão de i18n do
  // CI só conta, não confere.
  it.each(["pt-BR.json", "en.json"])("%s tem uma frase para cada motivo de recusa do nome", (arquivo) => {
    const d = JSON.parse(readFileSync(`messages/${arquivo}`, "utf8"))
    const erros = d.Automations.list.abas.erros
    const motivos: Array<Extract<ReturnType<typeof lerNomeDaArea>, { ok: false }>["motivo"]> = [
      "vazio",
      "longo",
      "reservado",
      "repetido",
    ]
    for (const m of motivos) expect(typeof erros[m]).toBe("string")
  })
})
