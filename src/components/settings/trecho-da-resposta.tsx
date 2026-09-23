"use client";

import { useTranslations } from "next-intl";

import { FONTE_MONO } from "@/components/settings/copiar";
import { Recolhivel } from "@/components/settings/documentacao/pecas";
import {
  TETO_DO_TRECHO,
  type RespostaDoEndereco,
} from "@/lib/webhooks/resultado-do-teste";

/**
 * O começo do que o endereço respondeu ao teste — recolhido: quem só quer o
 * "Entregue" não precisa dele, e no 404 do n8n é ele que diz o motivo.
 *
 * ⚠️ O corpo vem de um sistema de FORA: vai como TEXTO do React (escapado),
 * nunca como HTML. E o `<pre>` quebra em qualquer ponto (`break-all`) dentro
 * de um contêiner `min-w-0`: um JSON numa linha só, sem espaço, estouraria o
 * cartão — a armadilha do texto sem quebra em filho de flex (CLAUDE.md).
 */
export function TrechoDaResposta({ resposta }: { resposta: RespostaDoEndereco }) {
  const t = useTranslations("Settings.webhooks");
  return (
    <Recolhivel titulo={t("testeResposta")} className="basis-full bg-background">
      {resposta.binario ? (
        <p className="text-[11px] text-muted-foreground">
          {t("testeRespostaBinaria")}
        </p>
      ) : resposta.corpo === "" ? (
        <p className="text-[11px] text-muted-foreground">
          {t("testeRespostaVazia")}
        </p>
      ) : (
        <>
          <pre
            className="max-h-48 min-w-0 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-2 text-[11px] text-foreground"
            style={{ fontFamily: FONTE_MONO }}
          >
            {resposta.corpo}
          </pre>
          {resposta.cortado ? (
            <p className="text-[11px] text-muted-foreground">
              {t("testeRespostaCortada", { kb: TETO_DO_TRECHO / 1024 })}
            </p>
          ) : null}
        </>
      )}
    </Recolhivel>
  );
}
