"use client"

// ============================================================
// As automações que EU marquei com estrela (1079) — na janela "Executar
// automação" da conversa e na tela de Automações, sobem para o topo.
//
// ⚠️ É pessoal, não da conta: a policy de leitura já recorta
// `user_id = auth.uid()`, e a de escrita compara com o `user_id` do insert.
// Escrita direta do navegador sob RLS, o molde das conversas favoritas
// (`use-favoritas.ts`, 924), inclusive a fila `emVoo`.
//
// `favoritas: null` = não sei (carregando, ou a leitura falhou — `falhou`
// diz qual). Ninguém sobe para o topo e nenhuma estrela aparece com `null`:
// estrela apagada sobre favorita que não carregou seria afirmação falsa.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react"

import { useAuth } from "@/hooks/use-auth"
import { createClient } from "@/lib/supabase/client"

/**
 * `ativo = false` adia a leitura (a janela da conversa vive montada com o
 * compositor e só precisa das favoritas quando abre); cada vez que volta a
 * `true`, relê.
 */
export function useAutomacoesFavoritas(ativo = true): {
  favoritas: ReadonlySet<string> | null
  falhou: boolean
  /** Marca ou desmarca. `false` = a gravação falhou (a estrela já voltou). */
  alternar: (automationId: string) => Promise<boolean>
} {
  const { user, accountId } = useAuth()
  // Extraído aqui pelo React Compiler (ver `use-favoritas.ts`).
  const userId = user?.id ?? null
  // Carimbado com o DONO: trocar de login não herda as estrelas do anterior.
  const [lidas, setLidas] = useState<{ de: string; ids: Set<string> } | null>(null)
  const [falhou, setFalhou] = useState(false)
  // O que está em voo, por automação: a leitura que volta DEPOIS de um clique
  // reaplica o clique, e o segundo clique na mesma estrela espera o primeiro
  // (INSERT e DELETE sem ordem garantida divergiriam do banco em silêncio).
  const emVoo = useRef(new Map<string, "marcar" | "desmarcar">())

  useEffect(() => {
    if (!ativo || !userId) return
    let cancelado = false
    createClient()
      .from("cb_automacoes_favoritas")
      .select("automation_id")
      .then(({ data, error }) => {
        if (cancelado) return
        if (error) {
          console.error("[automacoes] favoritas não carregaram:", error.message)
          setFalhou(true)
          return
        }
        setFalhou(false)
        const ids = new Set((data ?? []).map((r) => (r as { automation_id: string }).automation_id))
        for (const [id, acao] of emVoo.current) {
          if (acao === "marcar") ids.add(id)
          else ids.delete(id)
        }
        setLidas({ de: userId, ids })
      })
    return () => {
      cancelado = true
    }
  }, [ativo, userId])

  const favoritas = lidas && lidas.de === userId ? lidas.ids : null

  const alternar = useCallback(
    async (automationId: string): Promise<boolean> => {
      if (!userId || !accountId || !favoritas) return false
      if (emVoo.current.has(automationId)) return true

      const jaEra = favoritas.has(automationId)
      emVoo.current.set(automationId, jaEra ? "desmarcar" : "marcar")
      const trocar = (marcar: boolean) =>
        setLidas((prev) => {
          if (!prev) return prev
          const ids = new Set(prev.ids)
          if (marcar) ids.add(automationId)
          else ids.delete(automationId)
          return { ...prev, ids }
        })
      trocar(!jaEra)

      const supabase = createClient()
      // DELETE com 0 linhas = já não estava marcada: é o estado pedido.
      const { error } = jaEra
        ? await supabase
            .from("cb_automacoes_favoritas")
            .delete()
            .eq("automation_id", automationId)
            .eq("user_id", userId)
        : await supabase.from("cb_automacoes_favoritas").insert({
            user_id: userId,
            automation_id: automationId,
            account_id: accountId,
          })
      emVoo.current.delete(automationId)

      // 23505 = já estava marcada (outra aba marcou): o estado pedido.
      if (error && error.code !== "23505") {
        console.error("[automacoes] favorita não gravou:", error.message)
        trocar(jaEra)
        return false
      }
      return true
    },
    [userId, accountId, favoritas],
  )

  return { favoritas, falhou, alternar }
}
