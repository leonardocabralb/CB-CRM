"use client"

import { useCallback, useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { ordenarAreas, type AreaDeAutomacao } from "@/lib/automations/areas"

/**
 * As abas da tela de Automações (1055), lidas sob RLS (qualquer membro lê).
 *
 * `areas: null` = ainda não se sabe (carregando, ou a leitura falhou — aí
 * `falhou` diz qual). Lista vazia é resposta: a conta não criou aba nenhuma e
 * tudo está em "Geral". Quem desenha abas espera a leitura: com `[]` durante
 * a carga, toda automação apareceria em "Geral" por um instante e a tela
 * piscaria.
 */
export function useAreasDeAutomacao(): {
  areas: AreaDeAutomacao[] | null
  falhou: boolean
  recarregar: () => Promise<void>
} {
  const [areas, setAreas] = useState<AreaDeAutomacao[] | null>(null)
  const [falhou, setFalhou] = useState(false)

  const recarregar = useCallback(async () => {
    const { data, error } = await createClient()
      .from("cb_areas_de_automacao")
      .select("id, nome, posicao")
      .order("posicao")
      .order("nome")
    if (error) {
      console.error("[automacoes] abas não carregaram:", error.message)
      setFalhou(true)
      return
    }
    setFalhou(false)
    setAreas(ordenarAreas((data ?? []) as AreaDeAutomacao[]))
  }, [])

  useEffect(() => {
    let vivo = true
    createClient()
      .from("cb_areas_de_automacao")
      .select("id, nome, posicao")
      .order("posicao")
      .order("nome")
      .then(({ data, error }) => {
        if (!vivo) return
        if (error) {
          console.error("[automacoes] abas não carregaram:", error.message)
          setFalhou(true)
          return
        }
        setAreas(ordenarAreas((data ?? []) as AreaDeAutomacao[]))
      })
    return () => {
      vivo = false
    }
  }, [])

  return { areas, falhou, recarregar }
}
