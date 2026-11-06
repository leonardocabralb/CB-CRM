"use client";

// ============================================================
// O PORQUÊ do cliente ideal no painel do cliente (1124, Fase 2).
//
// Só aparece quando o contato É ideal ou possível: cada critério do perfil
// que casou (com o valor gravado), o que falta no "ICP?" e o RETRATO do
// contato (D5 — o "respondeu" saiu da regra e virou informação: quem nunca
// respondeu pelo WhatsApp é justamente quem a equipe deve LIGAR).
//
// Carregando ou leitura que falhou = nada na tela, nunca "não é cliente
// ideal" (lista vazia não vira afirmação, seção 8c da raiz).
//
// ⚠️ RECOLHIDO por padrão (pedido do operador, 06/11/2026: "pode ocupar menos
// espaço"): fechado, só o selo, o título e o perfil; os critérios e o retrato
// abrem no clique. O aberto é carimbado com o CONTATO: o próximo cliente
// abre fechado, sem remontar o painel (efeito passivo, seção 8c da raiz).
// ============================================================

import { useState } from "react";
import { Check, ChevronDown, CircleHelp, MessageSquare, Phone } from "lucide-react";
import { useTranslations } from "next-intl";

import { SeloDeClienteIdeal } from "@/components/contacts/selo-de-cliente-ideal";
import { useClienteIdealDoContato } from "@/hooks/use-clientes-ideais";
import { camposQueFaltam } from "@/lib/contacts/cliente-ideal";
import { cn } from "@/lib/utils";

export function BlocoDoClienteIdeal({
  contactId,
  resyncToken = 0,
}: {
  contactId: string | null;
  resyncToken?: number;
}) {
  const t = useTranslations("ClienteIdeal");
  const { carregando, detalhe } = useClienteIdealDoContato(contactId, resyncToken);
  // De QUAL contato o bloco está aberto; nulo = fechado.
  const [abertoDe, setAbertoDe] = useState<string | null>(null);
  if (carregando || !detalhe || !detalhe.nivel) return null;

  const aberto = contactId !== null && abertoDe === contactId;
  const ideal = detalhe.nivel === "ideal";
  const faltam = camposQueFaltam(detalhe);
  const { doCliente, nossas, naoSairam } = detalhe.retrato;

  return (
    <div className="border-border shrink-0 border-b px-3 py-2">
      <div
        className={cn(
          "rounded-lg border",
          ideal ? "border-yellow-400 bg-yellow-400/10" : "border-dashed border-yellow-500",
        )}
      >
        <button
          type="button"
          onClick={() => setAbertoDe(aberto ? null : contactId)}
          aria-expanded={aberto}
          title={aberto ? t("esconderPorque") : t("verPorque")}
          className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left"
        >
          <SeloDeClienteIdeal nivel={detalhe.nivel} />
          <span className="text-foreground shrink-0 text-xs font-semibold">
            {ideal ? t("tituloIdeal") : t("tituloPossivel")}
          </span>
          {detalhe.perfil ? (
            <span className="text-muted-foreground min-w-0 truncate text-xs">
              {t("perfil", { nome: detalhe.perfil.nome })}
            </span>
          ) : null}
          <ChevronDown
            className={cn(
              "text-muted-foreground ml-auto h-3.5 w-3.5 shrink-0 transition-transform",
              aberto && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        {aberto ? (
          <div className="px-3 pb-2">
            <ul className="text-muted-foreground space-y-0.5 text-xs">
              {detalhe.criterios
                .filter((c) => c.valor !== null)
                .map((c) => (
                  <li key={c.campoId} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
                    <span className="min-w-0 break-words">
                      <span className="text-foreground">{c.campo}:</span> {c.valor}
                    </span>
                  </li>
                ))}
              {faltam.map((campo) => (
                <li key={campo} className="text-foreground flex items-start gap-1.5 font-medium">
                  <CircleHelp className="mt-0.5 h-3 w-3 shrink-0 text-yellow-500" aria-hidden="true" />
                  <span className="min-w-0 break-words">{t("falta", { campo })}</span>
                </li>
              ))}
            </ul>
            {doCliente === 0 ? (
              // Texto `foreground` e só o ícone e a borda em laranja: o `dark:`
              // está inerte, e texto laranja sobre fundo escuro não se lê.
              <p className="text-foreground mt-1.5 flex items-start gap-1.5 rounded-md border border-orange-500/60 bg-orange-500/10 px-2 py-1 text-xs">
                <Phone className="mt-0.5 h-3 w-3 shrink-0 text-orange-500" aria-hidden="true" />
                <span>
                  <span className="font-semibold">{t("nuncaRespondeu")}</span>
                  {" · "}
                  {t("mensagensNossas", { n: nossas })}
                  {naoSairam > 0 ? ` · ${t("naoSairam", { n: naoSairam })}` : null}
                </span>
              </p>
            ) : (
              <p className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
                <MessageSquare className="h-3 w-3 shrink-0" aria-hidden="true" />
                {t("respondeu", { n: doCliente })}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
