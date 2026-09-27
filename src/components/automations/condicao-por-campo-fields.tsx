"use client"

/**
 * Os campos da condição "Campo personalizado da ficha" do construtor de
 * automações (Fase 2.10 do plano do previdenciário, CB, 26/09/2026): o CAMPO
 * (repartido por bloco), a condição (é / contém / está vazio / não está
 * vazio, conforme o tipo) e o valor — as OPÇÕES do campo, quando ele é uma
 * lista. A regra mora em `src/lib/automations/condicao-por-campo.ts`.
 *
 * ⚠️ Os campos vêm REPARTIDOS POR BLOCO (966): o operador procura pelo bloco
 * "Previdenciário". A consulta é da família que REAGRUPA (`posicao`, depois
 * `field_name`), porque `agruparCampos` reparte antes de exibir.
 *
 * ⚠️⚠️ Recortado pela CONTA (a do usuário — é a conta da automação: as rotas
 * de automação só abrem as da conta atual), nunca só pela RLS: a leitura da
 * 1032 devolve os campos de TODA conta de que a pessoa é membro, e o campo de
 * outra conta seria oferecido e recusado na ativação (Codex, PR #314).
 *
 * ⚠️ Três estados, nunca dois: enquanto os campos não chegam (ou se a leitura
 * falhou), o campo gravado aparece como "o campo escolhido", nunca como o
 * UUID nem como "apagado".
 *
 * ⚠️ As chaves de texto são LITERAIS, nunca montadas: chave montada escapa do
 * portão de i18n do CI.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"

import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { createClient } from "@/lib/supabase/client"
import { opcoesDoCampo } from "@/lib/contacts/campo-opcoes"
import { agruparCampos } from "@/lib/contacts/grupos-de-campos"
import {
  operadorDaCondicao,
  operadoresDoTipo,
  operadorPedeValor,
} from "@/lib/automations/condicao-por-campo"
import type { CustomField, GrupoDeCampos, OperadorDoCampo } from "@/types"

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

export type EstadoDosCampos =
  | { status: "carregando" }
  | { status: "falhou" }
  | { status: "pronto"; todos: CustomField[]; grupos: GrupoDeCampos[] }

function useCamposDaConta(contaId: string | null): {
  estado: EstadoDosCampos
  tentarDeNovo: () => void
} {
  const [estado, setEstado] = useState<EstadoDosCampos>({ status: "carregando" })
  const [tentativa, setTentativa] = useState(0)
  useEffect(() => {
    if (!contaId) return
    let vivo = true
    ;(async () => {
      const supabase = createClient()
      const [campos, grupos] = await Promise.all([
        supabase
          .from("custom_fields")
          .select("*")
          .eq("account_id", contaId)
          .order("posicao", { nullsFirst: false })
          .order("field_name"),
        supabase
          .from("cb_grupos_de_campos")
          .select("*")
          .eq("account_id", contaId)
          .order("posicao")
          .order("nome"),
      ])
      if (!vivo) return
      if (campos.error || grupos.error) {
        setEstado({ status: "falhou" })
        return
      }
      setEstado({
        status: "pronto",
        todos: (campos.data ?? []) as CustomField[],
        grupos: (grupos.data ?? []) as GrupoDeCampos[],
      })
    })().catch(() => {
      // Rede que LANÇA não pode deixar o seletor em "carregando" para sempre.
      if (vivo) setEstado({ status: "falhou" })
    })
    return () => {
      vivo = false
    }
  }, [contaId, tentativa])
  // O "carregando" vai no CLIQUE, nunca dentro do efeito (React Compiler).
  const tentarDeNovo = useCallback(() => {
    setEstado({ status: "carregando" })
    setTentativa((n) => n + 1)
  }, [])
  return { estado, tentarDeNovo }
}

export function CondicaoPorCampoFields({
  cfg,
  set,
}: {
  cfg: Record<string, unknown>
  set: (patch: Record<string, unknown>) => void
}) {
  const { accountId } = useAuth()
  const { estado, tentarDeNovo } = useCamposDaConta(accountId)
  return (
    <CamposDaCondicaoPorCampo
      cfg={cfg}
      set={set}
      estado={estado}
      tentarDeNovo={tentarDeNovo}
      mostrarCarregando={!!accountId}
    />
  )
}

/** A tela, sem a carga — separada para o teste desenhar os três estados. */
export function CamposDaCondicaoPorCampo({
  cfg,
  set,
  estado,
  tentarDeNovo,
  mostrarCarregando,
}: {
  cfg: Record<string, unknown>
  set: (patch: Record<string, unknown>) => void
  estado: EstadoDosCampos
  tentarDeNovo: () => void
  mostrarCarregando: boolean
}) {
  const t = useTranslations("Automations.builder")

  const campoId = typeof cfg.operand === "string" ? cfg.operand : ""
  const operador: OperadorDoCampo = operadorDaCondicao(cfg.operator) ?? "equals"
  const valor = typeof cfg.value === "string" ? cfg.value : ""

  const blocos = useMemo(
    () => (estado.status === "pronto" ? agruparCampos(estado.todos, estado.grupos) : []),
    [estado],
  )
  const campo =
    estado.status === "pronto" && campoId ? (estado.todos.find((c) => c.id === campoId) ?? null) : null
  const campoSumiu = estado.status === "pronto" && campoId !== "" && !campo
  const tipo = campo?.field_type ?? "text"
  const operadores = operadoresDoTipo(tipo)
  const opcoes = campo && campo.field_type === "select" ? opcoesDoCampo(campo) : []
  // O gravado que não é EXATAMENTE uma opção precisa de um item para aparecer
  // no seletor; o aviso só vale quando nem aparado e sem maiúsculas ele casa
  // (a régua do motor e da ativação — ver `condicao-por-campo.ts`).
  const valorSemItem =
    campo?.field_type === "select" && valor.trim() !== "" && !opcoes.includes(valor)
  const valorForaDaLista =
    valorSemItem &&
    !opcoes.some((o) => o.trim().toLowerCase() === valor.trim().toLowerCase())

  const rotuloDoOperador: Record<OperadorDoCampo, string> = {
    equals: t("config.campoDaFichaOpEquals"),
    contains: t("config.campoDaFichaOpContains"),
    empty: t("config.campoDaFichaOpEmpty"),
    not_empty: t("config.campoDaFichaOpNotEmpty"),
  }

  const escolherCampo = (id: string) => {
    const novo = estado.status === "pronto" ? estado.todos.find((c) => c.id === id) : undefined
    const aceitos = operadoresDoTipo(novo?.field_type ?? "text")
    // O valor é DAQUELE campo (as opções de uma lista não servem à outra):
    // trocar o campo o apaga, e o operador que o tipo novo não aceita cai no
    // primeiro que ele aceita.
    set({
      operand: id,
      operator: aceitos.includes(operador) ? operador : aceitos[0],
      value: "",
    })
  }

  return (
    <>
      <div className="mb-2">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("config.campoDaFichaLabel")}
        </label>
        <select value={campoId} onChange={(e) => escolherCampo(e.target.value)} className={SELECT_CLASS}>
          <option value="">{t("config.campoDaFichaEscolha")}</option>
          {blocos.map((bloco) => (
            <optgroup key={bloco.grupo?.id ?? "geral"} label={bloco.grupo?.nome ?? t("config.campoDaFichaBlocoGeral")}>
              {bloco.campos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.field_name}
                </option>
              ))}
            </optgroup>
          ))}
          {/* O gravado precisa de um item enquanto os campos não chegam (ou se
              o campo foi apagado) — sem ele o seletor mostraria o placeholder
              e pareceria "ainda não escolhi". */}
          {campoId !== "" && !campo && (
            <option value={campoId}>
              {campoSumiu ? t("config.campoDaFichaApagado") : t("config.campoDaFichaEscolhido")}
            </option>
          )}
        </select>
        {estado.status === "carregando" && mostrarCarregando && (
          <p className="mt-1 text-[11px] text-muted-foreground">{t("config.campoDaFichaCarregando")}</p>
        )}
        {estado.status === "falhou" && (
          <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">
            {t("config.campoDaFichaFalhou")}{" "}
            <button
              type="button"
              onClick={tentarDeNovo}
              className="font-medium underline underline-offset-2 hover:opacity-80"
            >
              {t("config.campoDaFichaTentarDeNovo")}
            </button>
          </p>
        )}
        {campoSumiu && (
          <p className="mt-1 text-xs text-destructive">{t("config.campoDaFichaSumiu")}</p>
        )}
      </div>

      <div className="mb-2">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("config.campoDaFichaOperador")}
        </label>
        <select
          value={operador}
          onChange={(e) => set({ operator: e.target.value })}
          className={SELECT_CLASS}
        >
          {operadores.map((op) => (
            <option key={op} value={op}>
              {rotuloDoOperador[op]}
            </option>
          ))}
          {/* Gravado com um operador que o tipo não aceita (o campo mudou de
              tipo): fica à vista para ser trocado; a ativação o recusa. */}
          {!operadores.includes(operador) && <option value={operador}>{rotuloDoOperador[operador]}</option>}
        </select>
        {tipo === "datetime" && (
          <p className="mt-1 text-[11px] text-muted-foreground">{t("config.campoDaFichaDataHelp")}</p>
        )}
      </div>

      {operadorPedeValor(operador) && (
        <div className="mb-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {t("config.campoDaFichaValor")}
          </label>
          {campo?.field_type === "select" ? (
            <>
              <select value={valor} onChange={(e) => set({ value: e.target.value })} className={SELECT_CLASS}>
                <option value="">{t("config.campoDaFichaEscolhaOpcao")}</option>
                {opcoes.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
                {valorSemItem && (
                  <option value={valor}>
                    {valorForaDaLista ? t("config.campoDaFichaOpcaoSumiu", { valor }) : valor}
                  </option>
                )}
              </select>
              {valorForaDaLista && (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                  {t("config.campoDaFichaOpcaoSumiuHelp")}
                </p>
              )}
            </>
          ) : (
            <Input
              value={valor}
              inputMode={campo?.field_type === "number" ? "decimal" : undefined}
              onChange={(e) => set({ value: e.target.value })}
              className="bg-muted text-foreground"
            />
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">{t("config.campoDaFichaHelp")}</p>
    </>
  )
}
