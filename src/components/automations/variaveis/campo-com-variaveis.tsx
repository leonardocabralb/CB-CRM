"use client"

/**
 * Um campo de texto do construtor que aceita variáveis: o rótulo com o botão
 * "Inserir campo", o editor com etiquetas e, quando o texto cita alguma
 * variável, a PRÉVIA com o cliente escolhido.
 *
 * ⚠️ `modo` é o do `interpolate` NAQUELE campo, e vale para o painel e para a
 * prévia: "mensagem" nos textos que GENTE lê (o motor formata data e moeda),
 * "cru" nos que vão como dado ("Atualizar campo", corpo do webhook, final do
 * botão de URL do modelo). `previa={false}` onde o bloco mentiria: o corpo do
 * webhook (o motor ainda escapa para JSON) e o botão de URL (ainda codifica).
 */

import { useRef, type ReactNode } from "react"
import { useTranslations } from "next-intl"

import { SeletorDeContatoRemoto } from "@/components/contacts/seletor-de-contato-remoto"
import { useAuth } from "@/hooks/use-auth"
import { codigosDoTexto, pedacosDoTexto, textoDoCodigo } from "@/lib/automations/variaveis/codigos"
import { cn } from "@/lib/utils"

import { useVariaveis, type ModoDoValor } from "./contexto"
import { comoTexto, EditorComEtiquetas, type EditorComEtiquetasApi } from "./editor-com-etiquetas"
import { BotaoInserirCampo } from "./painel"

export function CampoComVariaveis({
  rotulo,
  value,
  onChange,
  placeholder,
  linhaUnica = false,
  modo = "mensagem",
  previa,
  monoespacado = false,
  ajuda,
  className,
}: {
  rotulo: string
  value: string
  onChange: (texto: string) => void
  placeholder?: string
  linhaUnica?: boolean
  modo?: ModoDoValor
  /**
   * Sem valor: prévia nos campos de várias linhas (os textos que vão ao
   * cliente) e nenhuma nos de uma linha — um bloco de prévia em cada valor de
   * modelo seria ruído.
   */
  previa?: boolean
  /** JSON (corpo do webhook): letra monoespaçada. */
  monoespacado?: boolean
  /** O que vai logo abaixo do editor (a dica de antes, um aviso). */
  ajuda?: ReactNode
  className?: string
}) {
  const editor = useRef<EditorComEtiquetasApi>(null)
  const v = useVariaveis()
  const comPrevia = previa ?? !linhaUnica
  const texto = comoTexto(value)
  return (
    <div className={cn("mb-2 last:mb-0", className)}>
      <div className="mb-1 flex items-end justify-between gap-2">
        <span className="block text-xs font-medium text-muted-foreground">{rotulo}</span>
        <BotaoInserirCampo modo={modo} onEscolher={(codigo) => editor.current?.inserir(textoDoCodigo(codigo))} />
      </div>
      <EditorComEtiquetas
        ref={editor}
        value={value}
        onChange={onChange}
        resolver={v.resolver}
        placeholder={placeholder}
        ariaLabel={rotulo}
        linhaUnica={linhaUnica}
        monoespacado={monoespacado}
      />
      {ajuda}
      {comPrevia && v.podePrevia && codigosDoTexto(texto).length > 0 && <PreviaDoTexto texto={texto} modo={modo} />}
    </div>
  )
}

/**
 * O texto como ele sairia: cada código trocado pelo valor do cliente (ou pelo
 * exemplo, marcado), vazio em âmbar. Sem cliente escolhido, o código aparece
 * com o nome do campo.
 */
function PreviaDoTexto({ texto, modo }: { texto: string; modo: ModoDoValor }) {
  const t = useTranslations("Automations.variaveis")
  const v = useVariaveis()
  const { accountId } = useAuth()
  const pedacos = pedacosDoTexto(texto)
  // Algum valor é EXEMPLO (ou do último acionamento)? Então a legenda do
  // sublinhado vai embaixo: sem ela, "Olá, Maria!" parece dado de verdade.
  const temMarcado = pedacos.some((p) => {
    if (p.tipo !== "codigo") return false
    const origem = v.valorDe(p.codigo, modo)?.origem
    return origem === "exemplo" || origem === "ultimo"
  })
  // No DADO ("Atualizar campo"), valor que sai INTEIRO vazio não grava nada
  // (regra do motor): diz isso, em vez de "sairia em branco". Só quando todo
  // código tem valor conhecido — sem cliente, não há o que afirmar.
  const valores = pedacos.map((p) => {
    if (p.tipo === "texto") return p.texto
    const r = v.valorDe(p.codigo, modo)
    return r && r.origem !== "evento" ? r.texto : undefined
  })
  const dadoVazio =
    modo === "cru" && valores.every((x) => x !== undefined) && valores.join("").trim() === ""
  return (
    <div className="mt-1.5 rounded-lg border border-dashed border-border p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-muted-foreground">{t("previa.com")}</span>
        <SeletorDeContatoRemoto
          className="h-7 min-w-0 flex-1 text-xs"
          value={v.contatoDaPrevia}
          onChange={v.escolherContato}
          placeholder={t("previa.escolher")}
          searchPlaceholder={t("previa.buscar")}
          hintText={t("previa.dica")}
          loadingText={t("previa.carregandoBusca")}
          emptyText={t("previa.nenhumCliente")}
          failedText={t("previa.falhouBusca")}
          moreText={t("previa.mais")}
          ariaLabel={t("previa.com")}
          accountId={accountId ?? undefined}
        />
      </div>
      {v.previa === "sem-cliente" && <p className="mb-1 text-[11px] text-muted-foreground">{t("previa.semCliente")}</p>}
      {v.previa === "carregando" && <p className="mb-1 text-[11px] text-muted-foreground">{t("previa.calculando")}</p>}
      {v.previa === "falhou" && <p className="mb-1 text-[11px] text-destructive">{t("previa.falhou")}</p>}
      <div
        className={cn(
          "max-w-full rounded-md px-2.5 py-1.5 text-sm break-words whitespace-pre-wrap text-foreground",
          modo === "mensagem" ? "bg-emerald-500/10" : "bg-muted",
        )}
      >
        {pedacos.map((p, i) => {
          if (p.tipo === "texto") return <span key={i}>{p.texto}</span>
          const valor = v.valorDe(p.codigo, modo)
          const info = v.resolver(p.codigo)
          if (!valor) {
            // Sem cliente (ou sem exemplo): o nome do campo no lugar.
            return (
              <span key={i} className="rounded bg-primary/10 px-1 text-primary" title={p.bruto}>
                {info.rotulo ?? p.bruto}
              </span>
            )
          }
          if (valor.origem === "evento") {
            return (
              <span key={i} className="text-muted-foreground italic" title={p.bruto}>
                [{info.rotulo ?? p.bruto} · {t("previa.doEvento")}]
              </span>
            )
          }
          if (valor.texto.trim() === "") {
            return (
              <span
                key={i}
                className="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300"
                title={`${info.rotulo ?? p.bruto} — ${
                  valor.origem === "nenhum"
                    ? (info.alerta ?? t("alerta.vazio"))
                    : modo === "cru"
                      ? t("previa.vazioAjudaDado")
                      : t("previa.vazioAjuda")
                }`}
              >
                {t("previa.vazio")}
              </span>
            )
          }
          const marcado = valor.origem === "exemplo" || valor.origem === "ultimo"
          return (
            <span
              key={i}
              className={cn(
                "font-medium",
                marcado && "underline decoration-amber-600 decoration-dashed underline-offset-2",
              )}
              title={`${info.rotulo ?? p.bruto}${
                valor.origem === "exemplo"
                  ? ` — ${t("previa.exemploAjuda")}`
                  : valor.origem === "ultimo"
                    ? ` — ${t("previa.ultimoAcionamento")}`
                    : ""
              }`}
            >
              {valor.texto}
            </span>
          )
        })}
      </div>
      {temMarcado && <p className="mt-1 text-[10px] text-muted-foreground">{t("previa.legenda")}</p>}
      {dadoVazio && (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{t("previa.dadoVazio")}</p>
      )}
    </div>
  )
}
