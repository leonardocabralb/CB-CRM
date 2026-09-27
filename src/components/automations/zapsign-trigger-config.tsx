"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"

import { PREFIXO_DA_RESPOSTA, VARIAVEIS_DO_DOCUMENTO } from "@/lib/zapsign/variaveis"

/**
 * O gatilho `zapsign_documento_assinado` (1057) NÃO tem configuração: toda
 * assinatura COMPLETA da conta dispara. O "qual contrato" e o "em que etapa"
 * são a CONDIÇÃO da automação ("Negócio está na etapa…"), não o gatilho —
 * por isso aqui só aparecem as variáveis que os passos podem usar e o que a
 * integração faz com o card.
 */
export function ZapSignTriggerConfig() {
  const t = useTranslations("Automations.builder.zapsign")
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        {t("semConfig")}{" "}
        <Link href="/settings?tab=integracoes" className="underline">
          {t("abrirIntegracoes")}
        </Link>
      </p>
      <p className="text-[11px] text-muted-foreground">{t("card")}</p>
      <div className="rounded-md border border-border bg-muted/40 p-2">
        <p className="text-[11px] font-medium text-muted-foreground">{t("variaveisTitulo")}</p>
        <p className="mt-1 break-all font-mono text-[11px] leading-5 text-foreground">
          {VARIAVEIS_DO_DOCUMENTO.map((v) => `{{vars.${v}}}`).join("  ")}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {/* A variável entra por VALOR: com as chaves duplas escritas no
              dicionário, o parser ICU quebraria a frase (icu-safety.test.ts). */}
          {t("respostasAjuda", { exemplo: `{{vars.${PREFIXO_DA_RESPOSTA}nome_completo}}` })}
        </p>
      </div>
    </div>
  )
}
