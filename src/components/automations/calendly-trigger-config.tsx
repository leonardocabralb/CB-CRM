"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"

import { VARIAVEIS_DO_AGENDAMENTO } from "@/lib/calendly/variaveis"

/**
 * Config do gatilho `calendly_booking` (977): QUAL evento do Calendly
 * dispara, e a lista das variáveis que os passos podem usar.
 *
 * O select vem de `GET /api/cb/calendly/event-types` — a conexão feita em
 * Integrações. Sem conexão (404) a tela diz isso com o link, em vez de um
 * select vazio: um select vazio parece "não há eventos", e o operador iria
 * caçar o defeito no Calendly. Vazio = QUALQUER evento (convenção do
 * projeto), e o nome do evento escolhido é gravado junto com a URI, para a
 * automação continuar legível quando a API não responde.
 */

interface TipoDeEvento {
  uri: string
  nome: string
  ativo: boolean
}

type Carga =
  | { estado: "carregando" }
  | { estado: "pronto"; tipos: TipoDeEvento[] }
  | { estado: "nao_conectado" }
  | { estado: "falhou" }

/** As mesmas de qualquer passo de texto — repetidas aqui porque é aqui que o operador monta a mensagem do aviso. */
const VARIAVEIS_DO_CONTATO = [
  "{{contact.name}}",
  "{{contact.phone}}",
  "{{contact.campo.<chave_do_campo>}}",
  "{{conversation.link}}",
  "{{contact.link}}",
]

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

export function CalendlyTriggerConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}) {
  const t = useTranslations("Automations.builder.calendly")
  const [carga, setCarga] = useState<Carga>({ estado: "carregando" })

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const res = await fetch("/api/cb/calendly/event-types")
        if (!vivo) return
        if (res.status === 404) return setCarga({ estado: "nao_conectado" })
        if (!res.ok) return setCarga({ estado: "falhou" })
        const corpo = (await res.json()) as { tipos?: TipoDeEvento[] }
        if (vivo) setCarga({ estado: "pronto", tipos: corpo.tipos ?? [] })
      } catch {
        if (vivo) setCarga({ estado: "falhou" })
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  const uri = typeof config.event_type_uri === "string" ? config.event_type_uri : ""
  const nomeGravado = typeof config.event_type_nome === "string" ? config.event_type_nome : ""
  // O evento gravado que a lista não trouxe (apagado no Calendly, ou lista
  // que falhou) continua como opção — senão o `<select>` mostraria a
  // primeira da lista e a tela afirmaria uma escolha que ninguém fez.
  const tipos = carga.estado === "pronto" ? carga.tipos : []
  const orfao = uri && !tipos.some((tp) => tp.uri === uri)

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("eventoLabel")}</label>
        {carga.estado === "nao_conectado" ? (
          <p className="text-xs text-destructive">
            {t("naoConectado")}{" "}
            <Link href="/settings?tab=integracoes" className="underline">
              {t("abrirIntegracoes")}
            </Link>
          </p>
        ) : (
          <select
            value={uri}
            onChange={(e) => {
              const escolhido = tipos.find((tp) => tp.uri === e.target.value)
              onChange({
                ...config,
                event_type_uri: e.target.value,
                event_type_nome: escolhido?.nome ?? (e.target.value ? nomeGravado : ""),
              })
            }}
            className={SELECT_CLASS}
            disabled={carga.estado === "carregando"}
          >
            <option value="">{carga.estado === "carregando" ? t("carregando") : t("qualquerEvento")}</option>
            {orfao && <option value={uri}>{nomeGravado || uri}</option>}
            {tipos.map((tp) => (
              <option key={tp.uri} value={tp.uri}>
                {tp.ativo ? tp.nome : t("inativo", { nome: tp.nome })}
              </option>
            ))}
          </select>
        )}
        {carga.estado === "falhou" && <p className="mt-1 text-[11px] text-destructive">{t("falhou")}</p>}
      </div>
      <div className="rounded-md border border-border bg-muted/40 p-2">
        <p className="text-[11px] font-medium text-muted-foreground">{t("variaveisTitulo")}</p>
        <p className="mt-1 font-mono text-[11px] leading-5 text-foreground">
          {VARIAVEIS_DO_AGENDAMENTO.map((v) => `{{vars.${v}}}`).join("  ")}
        </p>
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">{t("variaveisDoContatoTitulo")}</p>
        <p className="mt-1 font-mono text-[11px] leading-5 text-foreground">
          {VARIAVEIS_DO_CONTATO.join("  ")}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {/* As chaves entram por VALOR: escritas no dicionário, as chaves
              duplas quebrariam o parser ICU e a frase sairia como o caminho
              da chave (icu-safety.test.ts). */}
          {t("variaveisAjuda", {
            nome: "{{vars.agendamento_nome}}",
            data: "{{vars.agendamento_data}}",
            inicio: "{{vars.agendamento_inicio}}",
          })}
        </p>
      </div>
    </div>
  )
}
