"use client"

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Check,
  Loader2,
  Minus,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { useTranslations } from "next-intl"

import { createClient } from "@/lib/supabase/client"
import type {
  Automation,
  AutomationLog,
  AutomationLogStepResult,
} from "@/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/automations/trigger-meta"
import { ChannelCell, ChannelScopeBadge } from "@/components/channels/channel-badge"
import { useChannels } from "@/hooks/use-channels"
import { nomeDoContato } from "@/lib/contacts/identidade"
import {
  idsCitados,
  lotesDeIds,
  textoComNomes,
  type NomesDoRegistro,
  type TipoDoAlvo,
} from "@/lib/automations/registro-legivel"

type ClienteSupabase = ReturnType<typeof createClient>

const SEM_NOMES: NomesDoRegistro = { porId: {}, carregados: new Set() }

/**
 * Nome de cada id que os registros citam (etapa, etiqueta, membro, campo,
 * tarefa) — ver `registro-legivel.ts`. Lido sob RLS, como o resto da tela.
 *
 * Nunca derruba a tela: catálogo cuja consulta falhou só fica fora de
 * `carregados`, e aí o id aparece cru, como aparecia antes.
 */
async function carregarNomes(
  supabase: ClienteSupabase,
  ids: string[],
): Promise<NomesDoRegistro> {
  if (ids.length === 0) return SEM_NOMES
  // Em lotes: a lista vai na URL, e inteira ela passava do limite de tamanho
  // do pedido — todas as consultas falhavam e a tela voltava aos ids crus.
  const lotes = lotesDeIds(ids)
  type Resultado = { data: unknown; error: unknown }
  const emLotes = async (
    consulta: (lote: string[]) => PromiseLike<Resultado>,
  ): Promise<Resultado> => {
    const partes = await Promise.all(lotes.map(consulta))
    return {
      data: partes.flatMap((p) => (Array.isArray(p.data) ? p.data : [])),
      error: partes.find((p) => p.error)?.error ?? null,
    }
  }
  const [tags, etapas, membros, campos, tarefas] = await Promise.all([
    emLotes((l) => supabase.from("tags").select("id, name").in("id", l)),
    emLotes((l) =>
      supabase
        .from("pipeline_stages")
        .select("id, name, pipeline:pipelines(name)")
        .in("id", l),
    ),
    emLotes((l) =>
      supabase.from("profiles").select("user_id, full_name, email").in("user_id", l),
    ),
    emLotes((l) =>
      supabase.from("custom_fields").select("id, field_name").in("id", l),
    ),
    emLotes((l) => supabase.from("cb_tasks").select("id, titulo").in("id", l)),
  ])

  const porId: Record<string, string> = {}
  const carregados = new Set<TipoDoAlvo>()
  const guardar = (
    tipo: TipoDoAlvo,
    res: Resultado,
    linha: (r: Record<string, unknown>) => [unknown, unknown],
  ) => {
    // O que veio dos lotes que responderam vale; mas o catálogo só conta como
    // CARREGADO com todos os lotes de pé — senão um id do lote que falhou
    // apareceria como "(apagado)" sem ter sido procurado.
    if (!res.error) carregados.add(tipo)
    for (const r of (res.data ?? []) as Record<string, unknown>[]) {
      const [id, nome] = linha(r)
      if (typeof id === "string" && typeof nome === "string" && nome.trim()) {
        porId[id.toLowerCase()] = nome.trim()
      }
    }
  }
  guardar("etiqueta", tags, (r) => [r.id, r.name])
  guardar("etapa", etapas, (r) => {
    // Etapa com o funil na frente: "Reunião Agendada" existe em mais de um.
    const funil = (r.pipeline as { name?: unknown } | null)?.name
    return [r.id, typeof funil === "string" && funil ? `${funil} › ${r.name}` : r.name]
  })
  // Perfil com o nome em branco (o gatilho da 0017 grava '' quando o cadastro
  // não trouxe nome) cai no e-mail, como na tela de Membros: descartado, o
  // membro que continua na conta sairia como "(ex-membro)".
  guardar("membro", membros, (r) => [
    r.user_id,
    (typeof r.full_name === "string" && r.full_name.trim()) || r.email,
  ])
  guardar("campo", campos, (r) => [r.id, r.field_name])
  guardar("tarefa", tarefas, (r) => [r.id, r.titulo])
  return { porId, carregados }
}

export default function AutomationLogsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const t = useTranslations("Automations.logs")
  const tAut = useTranslations("Automations")

  const [automation, setAutomation] = useState<Automation | null>(null)
  const [logs, setLogs] = useState<AutomationLog[] | null>(null)
  const [nomes, setNomes] = useState<NomesDoRegistro>(SEM_NOMES)
  const [error, setError] = useState<string | null>(null)
  const [openLogId, setOpenLogId] = useState<string | null>(null)
  const { channels } = useChannels()

  // Rótulo em português do passo e do gatilho. Chave montada: o `has` faz um
  // tipo sem tradução cair no nome técnico, que é o que a tela mostrava.
  const rotuloDoPasso = (tipo: string) => {
    const chave = `builder.steps.${tipo}` as Parameters<typeof tAut>[0]
    return tAut.has(chave) ? tAut(chave) : tipo
  }
  const rotuloDoGatilho = (evento: string) => {
    const chave = `builder.triggers.${evento}.label` as Parameters<typeof tAut>[0]
    return tAut.has(chave) ? tAut(chave) : evento
  }
  const orfao = (tipo: TipoDoAlvo) =>
    t(`orfao.${tipo}` as Parameters<typeof t>[0])

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()
        const [autRes, logRes] = await Promise.all([
          supabase
            .from("automations")
            .select("*")
            .eq("id", id)
            .maybeSingle(),
          supabase
            .from("automation_logs")
            .select("*, contact:contacts(id, name, phone, wa_username, instagram_username)")
            .eq("automation_id", id)
            .order("created_at", { ascending: false })
            .limit(100),
        ])
        if (autRes.error) throw autRes.error
        if (logRes.error) throw logRes.error
        const registros = (logRes.data ?? []) as AutomationLog[]
        // Antes de mostrar a lista, para o id não piscar antes do nome.
        const nomesCarregados = await carregarNomes(
          supabase,
          idsCitados(
            registros.flatMap((l) => [
              l.error_message,
              ...(l.steps_executed ?? []).map((p) => p.detail),
            ]),
          ),
        ).catch(() => SEM_NOMES)
        setAutomation(autRes.data as Automation | null)
        setNomes(nomesCarregados)
        setLogs(registros)
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadError"))
      }
    }
    load()
  }, [id])

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => router.push("/automations")}>
          {t("back")}
        </Button>
      </div>
    )
  }

  if (!automation || logs === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/automations")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("backAria")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{automation.name}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">{t("title")}</p>
            {/* No detalhe mostramos o escopo SEMPRE, inclusive "todos os
                canais": aqui o silêncio seria ambíguo — o operador não
                saberia se a automação vale para tudo ou se ninguém
                configurou. Nas listas a regra é a inversa. */}
            <ChannelScopeBadge
              channels={channels}
              scope={automation.channel_ids}
              hideWhenAll={false}
            />
          </div>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40">
          <p className="text-sm text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("emptyDesc")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => {
            const isOpen = openLogId === log.id
            return (
              <li
                key={log.id}
                className="rounded-xl border border-border bg-card"
              >
                <button
                  type="button"
                  onClick={() => setOpenLogId(isOpen ? null : log.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <StatusBadge status={log.status} desfecho={log.desfecho} t={t} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {nomeDoContato(log.contact, t("unknownContact"))}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {rotuloDoGatilho(log.trigger_event)} · {log.steps_executed?.length ?? 0}{" "}
                      {log.steps_executed?.length === 1 ? t("step", { count: 1 }).replace("1 ", "") : t("stepPlural", { count: log.steps_executed?.length ?? 0 }).replace(/^[0-9]+ /, "")}
                    </div>
                  </div>
                  <ChannelCell
                    channels={channels}
                    channelId={log.channel_id}
                    className="hidden sm:inline-flex"
                  />
                  <div className="text-xs text-muted-foreground">
                    {formatRelative(log.created_at)}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-border px-4 py-3">
                    {log.error_message && (
                      <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                        {textoComNomes(log.error_message, nomes, null, orfao)}
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {(log.steps_executed ?? []).map((r, i) => (
                        <StepRow
                          key={i}
                          result={r}
                          rotulo={rotuloDoPasso(r.step_type)}
                          detalhe={
                            r.detail
                              ? textoComNomes(r.detail, nomes, r.step_type, orfao)
                              : null
                          }
                        />
                      ))}
                      {(log.steps_executed ?? []).length === 0 && (
                        <li className="text-xs text-muted-foreground">{t("noSteps")}</li>
                      )}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * ⚠️ O DESFECHO manda quando existe (985); `status` é a queda.
 *
 * `status` nasce `'failed'` no INSERT, ANTES do primeiro passo (semente
 * pessimista da issue #409), então esta etiqueta pintava VERMELHO toda
 * execução em curso — inclusive uma automação de 30 dias parada num
 * "Aguardar", que fica `partial` mas só depois de enfileirar. E execução
 * BARRADA por uma condição termina `'success'`, ou seja: verde para algo que
 * não rodou.
 *
 * A queda para `status` continua porque as 15 execuções gravadas antes da 985
 * não têm desfecho, e não há backfill possível (ninguém registrou quando cada
 * uma terminou).
 */
function StatusBadge({
  status,
  desfecho,
  t,
}: {
  status: AutomationLog["status"]
  desfecho?: AutomationLog["desfecho"]
  t: ReturnType<typeof useTranslations>
}) {
  const chave = desfecho ? `desfecho.${desfecho}` : `status.${status}`
  const classes = desfecho
    ? desfecho === "concluida"
      ? "border-primary/30 bg-primary/10 text-primary"
      : desfecho === "barrada"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-red-500/30 bg-red-500/10 text-red-300"
    : status === "success"
      ? "border-primary/30 bg-primary/10 text-primary"
      : status === "partial"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-red-500/30 bg-red-500/10 text-red-300"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        classes,
      )}
    >
      {t(chave as Parameters<typeof t>[0])}
    </span>
  )
}

function StepRow({
  result,
  rotulo,
  detalhe,
}: {
  result: AutomationLogStepResult
  rotulo: string
  detalhe: string | null
}) {
  const ok = result.status === "success"
  // ⚠️ `skipped` NÃO é falha: é a condição que desviou para um ramo vazio
  // (985) e a espera interrompida porque o cliente respondeu (18/09/2026).
  // Até aqui tudo que não era `success` ganhava o ✗ vermelho, e "a automação
  // parou porque o cliente respondeu" — que é a regra funcionando — era lido
  // como erro. Classes literais, como o Tailwind exige.
  const pulado = result.status === "skipped"
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full",
          ok
            ? "bg-primary/20 text-primary"
            : pulado
              ? "bg-muted text-muted-foreground"
              : "bg-red-500/20 text-red-400",
        )}
        aria-hidden
      >
        {ok ? (
          <Check className="h-3 w-3" />
        ) : pulado ? (
          <Minus className="h-3 w-3" />
        ) : (
          <X className="h-3 w-3" />
        )}
      </span>
      <span className="shrink-0 text-muted-foreground" title={result.step_type}>
        {rotulo}
      </span>
      {detalhe && (
        <span className="min-w-0 truncate text-muted-foreground" title={detalhe}>
          — {detalhe}
        </span>
      )}
    </li>
  )
}
