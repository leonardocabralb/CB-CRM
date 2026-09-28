"use client";

// ============================================================
// A faixa POSSÍVEL NO-SHOW, logo acima do compositor (Fase 2 de
// docs/PLANO-reunioes-e-no-show.md). Pedido do operador (27/09/2026): quando
// um lead marca reunião nova e já faltou antes — ou marcou antes e não
// avançou —, um aviso pequeno, só para quem atende saber. A decisão de onde
// mostrar foi dele (D1): só aqui, no fio.
//
// ⚠️ O texto é FACTUAL ("foi para No Show em…", "teve reunião em… e não
// avançou"), nunca "vai faltar": o aviso é tão bom quanto o funil, e enquanto
// a equipe move os cards na Kommo o CRM não vê as faltas recentes.
//
// Some quando a nova reunião TERMINA (pelo fim, no relógio de um minuto do
// cabeçalho) e cala com `aviso` nulo — que também é "não sei": nada aqui
// afirma "vai comparecer".
//
// ⚠️ Cor em par claro/escuro, mas a PRIMEIRA vale nos dois (o `dark:` está
// inerte, `.claude/rules/ui.md`): `amber-700` passa nos dois modos.
// ============================================================

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import type { AvisoDeNoShow } from "@/lib/agenda/aviso-de-no-show";
import { FUSO_PADRAO, horaNoFuso } from "@/lib/agenda/fuso";
import { reuniaoTerminou } from "@/lib/agenda/reunioes-externas";

/** "30/09" no fuso do escritório (o da agenda), no formato de quem lê. */
function dia(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: FUSO_PADRAO, day: "2-digit", month: "2-digit" });
}

export function FaixaDeNoShow({ aviso, agora }: { aviso: AvisoDeNoShow | null; agora: Date }) {
  const t = useTranslations("Inbox.noShow");
  if (!aviso || reuniaoTerminou(aviso.proxima, agora)) return null;

  const quando = dia(aviso.em);
  const motivo =
    aviso.motivo === "sem_avanco"
      ? t("semAvanco", { dia: quando })
      : aviso.etapa
        ? t("faltouNaEtapa", { etapa: aviso.etapa, dia: quando })
        : t("faltouNaAgenda", { dia: quando });
  const inicio = new Date(aviso.proxima.inicio);

  return (
    <div
      role="status"
      className="mx-3 mt-2 flex max-w-full items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words">
        <span className="font-medium">{t("titulo")}</span>
        {" — "}
        {motivo} {t("proxima", { dia: dia(aviso.proxima.inicio), hora: horaNoFuso(inicio, FUSO_PADRAO) })}
      </p>
    </div>
  );
}
