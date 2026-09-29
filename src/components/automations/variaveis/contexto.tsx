"use client"

/**
 * O que os campos com variáveis do construtor dividem: o NOME de cada código
 * (a etiqueta), a lista do botão "Inserir campo", e a PRÉVIA — o cliente
 * escolhido UMA vez vale para a automação inteira (não é gravado).
 *
 * De onde vem cada valor, e por que cada um diz a origem na tela:
 * - contato, campos da ficha, negócio, links e `now`: do cliente escolhido,
 *   pela rota `/api/automations/previa` — as MESMAS funções do envio;
 * - `{{vars.*}}` do Asaas, do Calendly e do ZapSign: EXEMPLO gerado pelas
 *   funções reais (`exemplos.ts`), com o nome do cliente escolhido;
 * - `{{vars.*}}` do webhook de entrada: o último acionamento REAL (a mesma
 *   leitura que o cartão do gatilho faz);
 * - `message.text` e `channel.id`: do evento, sem valor na prévia.
 *
 * ⚠️ Os estados são CARIMBADOS com a entrada que os produziu (`de`) e
 * comparados com a do render atual: o primeiro render depois de trocar de
 * cliente ainda tem o estado do anterior (efeito passivo, CLAUDE.md 8c).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"

import { useCamposDaConta } from "@/components/automations/condicao-por-campo-fields"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import {
  classificarCodigo,
  familiaDoEvento,
  gatilhoDeMensagem,
  PREFIXO_DO_CAMPO,
  PREFIXO_DO_EVENTO,
  VARIAVEIS_FIXAS,
  type FamiliaDoEvento,
  type GrupoFixo,
} from "@/lib/automations/variaveis/catalogo"
import { exemplosDoGatilho, NOMES_DO_EVENTO, type FamiliaComExemplo } from "@/lib/automations/variaveis/exemplos"
import { agruparCampos } from "@/lib/contacts/grupos-de-campos"
import { PREFIXO_DA_RESPOSTA } from "@/lib/zapsign/variaveis"

import type { InfoDaEtiqueta, ResolverDeEtiqueta } from "./editor-com-etiquetas"

/** Texto para gente (mensagem) ou dado ("Atualizar campo", webhook). */
export type ModoDoValor = "mensagem" | "cru"

export interface ItemDoPainel {
  codigo: string
  rotulo: string
  legenda: string | null
}

export interface GrupoDoPainel {
  id: string
  titulo: string
  itens: ItemDoPainel[]
}

/**
 * - `cliente`: calculado para o cliente escolhido (vazio = sai em branco);
 * - `exemplo`: gerado pelo código real, com dado fictício;
 * - `ultimo`: veio no último acionamento do webhook;
 * - `evento`: só existe no disparo, sem valor na prévia;
 * - `nenhum`: o motor deixa este código em branco, sempre.
 */
export type OrigemDoValor = "cliente" | "exemplo" | "ultimo" | "evento" | "nenhum"

export interface ValorParaMostrar {
  texto: string
  origem: OrigemDoValor
}

export type EstadoDaPrevia = "sem-cliente" | "carregando" | "pronto" | "falhou"

interface VariaveisDoConstrutor {
  grupos: GrupoDoPainel[]
  /** Os campos da ficha ainda não chegaram (ou falharam): a lista está incompleta. */
  camposEstado: "carregando" | "pronto" | "falhou"
  /** Uma frase sob o grupo do evento (respostas do ZapSign, webhook sem acionamento). */
  notaDoEvento: string | null
  resolver: ResolverDeEtiqueta
  /** `null` = não há o que mostrar (sem cliente escolhido, sem exemplo). */
  valorDe: (codigo: string, modo: ModoDoValor) => ValorParaMostrar | null
  /** A prévia é de admin (a rota lê em service role). */
  podePrevia: boolean
  contatoDaPrevia: string
  escolherContato: (id: string) => void
  previa: EstadoDaPrevia
  /** O nome do cliente da prévia, quando já carregado. */
  nomeDaPrevia: string | null
}

const SEM_VARIAVEIS: VariaveisDoConstrutor = {
  grupos: [],
  camposEstado: "carregando",
  notaDoEvento: null,
  resolver: () => ({ rotulo: null }),
  valorDe: () => null,
  podePrevia: false,
  contatoDaPrevia: "",
  escolherContato: () => {},
  previa: "sem-cliente",
  nomeDaPrevia: null,
}

const VariaveisContext = createContext<VariaveisDoConstrutor>(SEM_VARIAVEIS)

export function useVariaveis(): VariaveisDoConstrutor {
  return useContext(VariaveisContext)
}

type ValoresDoCliente = Record<string, { mensagem: string; cru: string }>

const ORDEM_DOS_GRUPOS_FIXOS: readonly GrupoFixo[] = ["contato", "negocio", "conversa", "data", "mensagem"]

function familiaComExemplo(f: FamiliaDoEvento | null): FamiliaComExemplo | null {
  return f === "asaas" || f === "calendly" || f === "zapsign" ? f : null
}

/** A família que conhece este nome de variável (para dar nome à etiqueta fora do gatilho dela). */
function familiaDoNome(nome: string): FamiliaComExemplo | null {
  for (const f of ["asaas", "calendly", "zapsign"] as const) {
    if (NOMES_DO_EVENTO[f].includes(nome)) return f
  }
  return null
}

export function VariaveisProvider({
  gatilho,
  webhookId,
  children,
}: {
  /** `trigger_type` da automação em edição. */
  gatilho: string
  /** `trigger_config.webhook_id` do gatilho de webhook; nulo nos outros. */
  webhookId: string | null
  children: ReactNode
}) {
  const t = useTranslations("Automations.variaveis")
  const { accountId, accountRole, account } = useAuth()
  const { estado: campos } = useCamposDaConta(accountId)
  const podePrevia = accountRole !== null && hasMinRole(accountRole, "admin")
  const familia = familiaDoEvento(gatilho)
  const [agora] = useState(() => new Date())

  // --- A prévia do cliente ---
  const [contatoDaPrevia, setContatoDaPrevia] = useState("")
  // Escolher o MESMO cliente de novo refaz a leitura (a anterior pode ter
  // falhado): sem o contador, o React descarta o setState de valor igual.
  const [tentativa, setTentativa] = useState(0)
  const [carregada, setCarregada] = useState<
    { de: string; status: "pronto"; valores: ValoresDoCliente } | { de: string; status: "falhou" } | null
  >(null)
  useEffect(() => {
    if (!contatoDaPrevia || !podePrevia) return
    let vivo = true
    ;(async () => {
      try {
        const res = await fetch(`/api/automations/previa?contato=${encodeURIComponent(contatoDaPrevia)}`, {
          cache: "no-store",
        })
        if (!vivo) return
        if (!res.ok) {
          setCarregada({ de: contatoDaPrevia, status: "falhou" })
          return
        }
        const corpo = (await res.json()) as { valores?: ValoresDoCliente }
        if (vivo) setCarregada({ de: contatoDaPrevia, status: "pronto", valores: corpo.valores ?? {} })
      } catch {
        if (vivo) setCarregada({ de: contatoDaPrevia, status: "falhou" })
      }
    })()
    return () => {
      vivo = false
    }
  }, [contatoDaPrevia, podePrevia, tentativa])
  const atual = carregada && carregada.de === contatoDaPrevia ? carregada : null
  const previa: EstadoDaPrevia = !contatoDaPrevia ? "sem-cliente" : !atual ? "carregando" : atual.status
  const valoresDoCliente = atual?.status === "pronto" ? atual.valores : null
  const nomeDaPrevia = valoresDoCliente?.["contact.name"]?.mensagem || null

  // --- O último acionamento do webhook (a leitura do cartão do gatilho) ---
  const [acionamento, setAcionamento] = useState<{
    de: string
    variaveis: Record<string, string> | null
    falhou: boolean
  } | null>(null)
  useEffect(() => {
    if (familia !== "webhook" || !webhookId) return
    let vivo = true
    ;(async () => {
      try {
        const res = await fetch(`/api/cb/webhooks/${encodeURIComponent(webhookId)}/eventos?pagina=1`, {
          cache: "no-store",
        })
        if (!vivo) return
        if (!res.ok) {
          setAcionamento({ de: webhookId, variaveis: null, falhou: true })
          return
        }
        const corpo = (await res.json()) as { eventos?: { variaveis?: Record<string, string> }[] }
        const ultimo = corpo.eventos?.[0]?.variaveis
        if (vivo) setAcionamento({ de: webhookId, variaveis: ultimo ?? null, falhou: false })
      } catch {
        if (vivo) setAcionamento({ de: webhookId, variaveis: null, falhou: true })
      }
    })()
    return () => {
      vivo = false
    }
  }, [familia, webhookId])
  const ultimo = familia === "webhook" && webhookId && acionamento?.de === webhookId ? acionamento : null

  // --- Os exemplos (o nome do cliente escolhido entra no lugar do fictício) ---
  const exemplos = useMemo(
    () => exemplosDoGatilho(gatilho, { agora, nome: nomeDaPrevia, escritorio: account?.name ?? null }),
    [gatilho, agora, nomeDaPrevia, account?.name],
  )

  const escolherContato = useCallback((id: string) => {
    setContatoDaPrevia(id)
    setTentativa((n) => n + 1)
  }, [])

  const rotuloDoEvento = useCallback(
    (nome: string): { rotulo: string | null; legenda: string | null } => {
      const f = familiaDoNome(nome)
      if (f) return { rotulo: t(`evento.${nome}.rotulo`), legenda: t(`evento.${nome}.legenda`) }
      if (nome.startsWith(PREFIXO_DA_RESPOSTA)) {
        return {
          rotulo: t("resposta.rotulo", { pergunta: nome.slice(PREFIXO_DA_RESPOSTA.length) }),
          legenda: t("resposta.legenda"),
        }
      }
      return { rotulo: null, legenda: null }
    },
    [t],
  )

  const resolver = useMemo<ResolverDeEtiqueta>(
    () =>
      (codigo: string): InfoDaEtiqueta => {
        const c = classificarCodigo(codigo)
        switch (c.tipo) {
          case "fixa":
            return {
              rotulo: t(`fixas.${c.variavel.chave}.rotulo`),
              legenda: t(`fixas.${c.variavel.chave}.legenda`),
              alerta:
                c.variavel.codigo === "message.text" && !gatilhoDeMensagem(gatilho)
                  ? t("alerta.mensagemForaDoGatilho")
                  : null,
            }
          case "campo": {
            // Lista não chegou: só o código, sem afirmar que o campo não existe.
            if (campos.status !== "pronto") return { rotulo: null }
            const campo = campos.todos.find((f) => f.field_key === c.chave)
            return campo
              ? { rotulo: campo.field_name, legenda: null }
              : { rotulo: null, alerta: t("alerta.campoInexistente") }
          }
          case "evento": {
            if (familia === "webhook") return { rotulo: c.nome, legenda: t("webhookLegenda") }
            const { rotulo, legenda } = rotuloDoEvento(c.nome)
            const doGatilho =
              familia === "zapsign"
                ? NOMES_DO_EVENTO.zapsign.includes(c.nome) || c.nome.startsWith(PREFIXO_DA_RESPOSTA)
                : familiaComExemplo(familia) !== null && familiaDoNome(c.nome) === familia
            return { rotulo, legenda, alerta: doGatilho ? null : t("alerta.eventoDeOutroGatilho") }
          }
          case "vazio":
            return { rotulo: null, alerta: t("alerta.vazio") }
        }
      },
    [t, gatilho, familia, campos, rotuloDoEvento],
  )

  const grupos = useMemo<GrupoDoPainel[]>(() => {
    const lista: GrupoDoPainel[] = []
    const comExemplo = familiaComExemplo(familia)
    if (comExemplo) {
      lista.push({
        id: "evento",
        titulo: t(`grupos.${comExemplo}`),
        itens: NOMES_DO_EVENTO[comExemplo].map((nome) => ({
          codigo: `${PREFIXO_DO_EVENTO}${nome}`,
          rotulo: t(`evento.${nome}.rotulo`),
          legenda: t(`evento.${nome}.legenda`),
        })),
      })
    } else if (familia === "webhook" && ultimo?.variaveis) {
      lista.push({
        id: "evento",
        titulo: t("grupos.webhook"),
        itens: Object.keys(ultimo.variaveis).map((nome) => ({
          codigo: `${PREFIXO_DO_EVENTO}${nome}`,
          rotulo: nome,
          legenda: t("webhookLegenda"),
        })),
      })
    }
    const fixos = (grupo: GrupoFixo) =>
      VARIAVEIS_FIXAS.filter((v) => v.grupo === grupo).map((v) => ({
        codigo: v.codigo,
        rotulo: t(`fixas.${v.chave}.rotulo`),
        legenda: t(`fixas.${v.chave}.legenda`),
      }))
    for (const grupo of ORDEM_DOS_GRUPOS_FIXOS) {
      // O texto recebido só existe nos gatilhos de mensagem.
      if (grupo === "mensagem" && !gatilhoDeMensagem(gatilho)) continue
      lista.push({ id: grupo, titulo: t(`grupos.${grupo}`), itens: fixos(grupo) })
      // Os campos da ficha logo depois do contato: é onde o operador os procura.
      if (grupo === "contato" && campos.status === "pronto") {
        for (const bloco of agruparCampos(campos.todos, campos.grupos)) {
          lista.push({
            id: `bloco:${bloco.grupo?.id ?? "geral"}`,
            titulo: t("grupos.campos", { bloco: bloco.grupo?.nome ?? t("blocoGeral") }),
            itens: bloco.campos.map((f) => ({
              codigo: `${PREFIXO_DO_CAMPO}${f.field_key}`,
              rotulo: f.field_name,
              legenda: null,
            })),
          })
        }
      }
    }
    return lista
  }, [t, familia, gatilho, campos, ultimo])

  const notaDoEvento =
    familia === "zapsign"
      ? t("respostasNota", { exemplo: `{{${PREFIXO_DO_EVENTO}${PREFIXO_DA_RESPOSTA}…}}` })
      : familia === "webhook"
        ? !webhookId
          ? t("webhookSemEscolha")
          : ultimo && !ultimo.falhou && !ultimo.variaveis
            ? t("webhookNunca")
            : null
        : null

  const valorDe = useCallback(
    (codigo: string, modo: ModoDoValor): ValorParaMostrar | null => {
      const c = classificarCodigo(codigo)
      switch (c.tipo) {
        case "fixa":
          if (c.variavel.doEvento) return { texto: "", origem: "evento" }
          if (!valoresDoCliente) return null
          return { texto: valoresDoCliente[c.variavel.codigo]?.[modo] ?? "", origem: "cliente" }
        case "campo":
          if (!valoresDoCliente) return null
          // A rota devolve os campos PREENCHIDOS: ausente = vazio.
          return { texto: valoresDoCliente[`${PREFIXO_DO_CAMPO}${c.chave}`]?.[modo] ?? "", origem: "cliente" }
        case "evento": {
          if (familia === "webhook") {
            const v = ultimo?.variaveis?.[c.nome]
            return v === undefined ? null : { texto: v, origem: "ultimo" }
          }
          const v = exemplos?.[c.nome]
          return v === undefined ? null : { texto: v, origem: "exemplo" }
        }
        case "vazio":
          return { texto: "", origem: "nenhum" }
      }
    },
    [valoresDoCliente, familia, ultimo, exemplos],
  )

  const camposEstado = campos.status

  const valor = useMemo<VariaveisDoConstrutor>(
    () => ({
      grupos,
      camposEstado,
      notaDoEvento,
      resolver,
      valorDe,
      podePrevia,
      contatoDaPrevia,
      escolherContato,
      previa,
      nomeDaPrevia,
    }),
    [grupos, camposEstado, notaDoEvento, resolver, valorDe, podePrevia, contatoDaPrevia, escolherContato, previa, nomeDaPrevia],
  )

  return <VariaveisContext.Provider value={valor}>{children}</VariaveisContext.Provider>
}
