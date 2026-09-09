"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"

/**
 * Config do gatilho `webhook_received` (982): QUAL webhook de entrada
 * dispara, e as variáveis que os passos podem usar.
 *
 * ⚠️ A lista de variáveis sai do ÚLTIMO ACIONAMENTO REAL daquele webhook,
 * não de uma lista fixa. É a diferença para o painel do Calendly, e ela é o
 * ponto: o payload aqui é arbitrário, então ninguém — nem o CRM — sabe de
 * antemão o que vem dentro. Mostrando o que chegou de verdade, o operador
 * copia o nome certo em vez de adivinhar, e descobre na hora que o campo
 * que ele procurava chegou com outro nome.
 *
 * Sem nenhum webhook criado (lista vazia) a tela diz isso com o link, em
 * vez de um select vazio: select vazio parece "não há opção", e o operador
 * iria caçar defeito no lugar errado. Vazio = QUALQUER webhook (convenção
 * do projeto), e o nome do escolhido é gravado junto com o id, para o
 * cartão continuar legível se o webhook for apagado.
 */

interface WebhookDaLista {
  id: string
  nome: string
}

type Carga =
  | { estado: "carregando" }
  | { estado: "pronto"; webhooks: WebhookDaLista[] }
  | { estado: "sem_webhooks" }
  | { estado: "falhou" }

/** As mesmas de qualquer passo de texto — repetidas aqui porque é aqui que o operador monta a mensagem. */
const VARIAVEIS_DO_CONTATO = [
  "{{contact.name}}",
  "{{contact.phone}}",
  "{{contact.campo.<chave_do_campo>}}",
  "{{contact.origem}}",
  "{{conversation.link}}",
  "{{contact.link}}",
]

const SELECT_CLASS =
  "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"

export function WebhookTriggerConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}) {
  const t = useTranslations("Automations.builder.webhook")
  const [carga, setCarga] = useState<Carga>({ estado: "carregando" })
  // ⚠️ Guarda de QUEM são as variáveis, não só as variáveis: a resposta
  // é comparada contra o `webhookId` do render ATUAL. Sem o carimbo, trocar
  // de webhook mostraria as variáveis do anterior sob o nome do novo até a
  // busca voltar — a armadilha do efeito passivo, que neste projeto já
  // mordeu quatro vezes. É também o que tira o `setState` síncrono de
  // dentro do efeito (regra do React Compiler que o lint reprova).
  const [carregadas, setCarregadas] = useState<{
    de: string
    chaves: string[]
  } | null>(null)

  const webhookId = typeof config.webhook_id === "string" ? config.webhook_id : ""
  const nomeGravado = typeof config.webhook_nome === "string" ? config.webhook_nome : ""

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const res = await fetch("/api/cb/webhooks")
        if (!vivo) return
        if (!res.ok) return setCarga({ estado: "falhou" })
        const corpo = (await res.json()) as { webhooks?: WebhookDaLista[] }
        const lista = corpo.webhooks ?? []
        if (vivo) {
          setCarga(
            lista.length === 0
              ? { estado: "sem_webhooks" }
              : { estado: "pronto", webhooks: lista }
          )
        }
      } catch {
        if (vivo) setCarga({ estado: "falhou" })
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  // As variáveis do último acionamento do webhook escolhido. Sem webhook
  // escolhido não há o que mostrar: "qualquer webhook" significa payloads
  // de formatos diferentes, e listar o de um deles afirmaria que os outros
  // têm os mesmos campos.
  useEffect(() => {
    if (!webhookId) return
    let vivo = true
    ;(async () => {
      try {
        const res = await fetch(`/api/cb/webhooks/${webhookId}/eventos?pagina=1`)
        if (!vivo) return
        if (!res.ok) return setCarregadas({ de: webhookId, chaves: [] })
        const corpo = (await res.json()) as {
          eventos?: { variaveis?: Record<string, string> }[]
        }
        const ultimo = corpo.eventos?.[0]?.variaveis ?? {}
        if (vivo) setCarregadas({ de: webhookId, chaves: Object.keys(ultimo) })
      } catch {
        if (vivo) setCarregadas({ de: webhookId, chaves: [] })
      }
    })()
    return () => {
      vivo = false
    }
  }, [webhookId])

  // Três estados, e eles são diferentes: sem webhook escolhido não há o que
  // mostrar; escolhido e ainda buscando não é "sem variáveis"; buscado e
  // vazio é "este webhook nunca foi acionado".
  const variaveis: string[] | null | undefined = !webhookId
    ? null
    : carregadas?.de === webhookId
      ? carregadas.chaves
      : undefined

  const webhooks = carga.estado === "pronto" ? carga.webhooks : []
  // O webhook gravado que a lista não trouxe (apagado) continua como opção —
  // senão o `<select>` mostraria o primeiro da lista e a tela afirmaria uma
  // escolha que ninguém fez.
  const orfao = webhookId && !webhooks.some((w) => w.id === webhookId)

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          {t("webhookLabel")}
        </label>
        {carga.estado === "sem_webhooks" ? (
          <p className="text-xs text-destructive">
            {t("semWebhooks")}{" "}
            <Link href="/settings?tab=webhooks" className="underline">
              {t("abrirWebhooks")}
            </Link>
          </p>
        ) : (
          <select
            value={webhookId}
            onChange={(e) => {
              const escolhido = webhooks.find((w) => w.id === e.target.value)
              onChange({
                ...config,
                webhook_id: e.target.value,
                webhook_nome:
                  escolhido?.nome ?? (e.target.value ? nomeGravado : ""),
              })
            }}
            className={SELECT_CLASS}
            disabled={carga.estado === "carregando"}
          >
            <option value="">
              {carga.estado === "carregando" ? t("carregando") : t("qualquerWebhook")}
            </option>
            {orfao && <option value={webhookId}>{nomeGravado || webhookId}</option>}
            {webhooks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.nome}
              </option>
            ))}
          </select>
        )}
        {carga.estado === "falhou" && (
          <p className="mt-1 text-[11px] text-destructive">{t("falhou")}</p>
        )}
      </div>
      <div className="rounded-md border border-border bg-muted/40 p-2">
        <p className="text-[11px] font-medium text-muted-foreground">
          {t("variaveisTitulo")}
        </p>
        {variaveis === null ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("variaveisEscolhaWebhook")}
          </p>
        ) : variaveis === undefined ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("carregando")}
          </p>
        ) : variaveis.length === 0 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("variaveisSemAcionamento")}
          </p>
        ) : (
          <p className="mt-1 font-mono text-[11px] leading-5 text-foreground">
            {variaveis.map((v) => `{{vars.${v}}}`).join("  ")}
          </p>
        )}
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">
          {t("variaveisDoContatoTitulo")}
        </p>
        <p className="mt-1 font-mono text-[11px] leading-5 text-foreground">
          {VARIAVEIS_DO_CONTATO.join("  ")}
        </p>
      </div>
    </div>
  )
}
