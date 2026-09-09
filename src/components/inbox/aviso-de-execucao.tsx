"use client";

// ============================================================
// O aviso de execução de automação DENTRO do fio (985).
//
// Pedido do operador: "quero que essas falhas e esses sucessos apareçam
// dentro das mensagens mesmo. O sucesso pode ser mais discreto do que a
// falha. Caso a gente queira mais informações detalhadas, aí sim a gente
// entra na aba específica de execuções."
//
// Daí três pesos, e não um:
//
//   concluida → pílula igual à do evento do lead (`LeadEventLine`): cinza,
//               centralizada, 11px. É informação de fundo.
//   barrada   → a mesma pílula em âmbar. Não é erro, mas MUDA a leitura:
//               "a automação não rodou porque o cliente já tinha a etiqueta".
//   falhou    → CARTÃO, alinhado à esquerda como uma mensagem, com o passo
//               que parou e o caminho para a aba. É o único que interrompe a
//               leitura, e é o único que precisa.
//
// ⚠️ O motivo CRU do motor não aparece aqui. Ele vem em inglês, com UUID e
// wamid dentro ("send_webhook: destination not allowed" são as 4 falhas reais
// da conta), e o fio é onde a equipe conversa com o cliente. O texto técnico
// fica na aba, numa expansão que o operador abre de propósito.
// ============================================================

import { AlertTriangle, CheckCircle2, GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { ItemDeExecucao } from "@/lib/execucoes/desfecho";

/** `HH:mm` no fuso de quem lê — a mesma forma da linha de evento do lead. */
function hora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function AvisoDeExecucao({
  item,
  aoAbrirDetalhes,
}: {
  item: ItemDeExecucao;
  /** Abre a aba Automações do painel. Ausente = o cartão não oferece o link. */
  aoAbrirDetalhes?: () => void;
}) {
  const t = useTranslations("Inbox.execucoes");
  const nome = item.nome ?? t("semNome");
  const texto = t(`aviso.${item.desfecho}` as Parameters<typeof t>[0], { nome });
  const repetido = item.vezes > 1 ? ` ${t("vezes", { vezes: item.vezes })}` : "";

  if (item.desfecho === "falhou") {
    return (
      // ⚠️ `max-w-full` no filho de flex: o pai alinha com `items-start`, que
      // dimensiona por conteúdo, e `max-width` não se herda — sem isto um
      // motivo longo estoura a largura e acende barra horizontal na conversa
      // inteira (a armadilha que a bolha do fio já documenta).
      <div className="flex max-w-full justify-start py-1.5">
        <div className="max-w-[85%] min-w-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
            <div className="min-w-0">
              <p className="text-xs font-medium break-words text-red-300">
                {texto}
                {repetido}
              </p>
              {item.passoQueParou && (
                <p className="mt-0.5 text-[11px] break-words text-red-300/80">
                  {t("no_passo", { passo: item.passoQueParou })}
                </p>
              )}
              <p className="mt-0.5 text-[11px] text-muted-foreground">{hora(item.quando)}</p>
              {aoAbrirDetalhes && (
                <button
                  type="button"
                  onClick={aoAbrirDetalhes}
                  className="mt-1 text-[11px] font-medium text-red-300 underline underline-offset-2 hover:text-red-200"
                >
                  {t("verDetalhes")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const barrada = item.desfecho === "barrada";
  const Icone = barrada ? GitBranch : CheckCircle2;

  return (
    <div className="flex justify-center py-1">
      <span
        className={cn(
          "inline-flex max-w-[85%] items-center gap-1.5 rounded-full px-3 py-1 text-center text-[11px]",
          barrada
            ? "bg-amber-500/10 text-amber-300"
            : "bg-muted/80 text-muted-foreground",
        )}
      >
        <Icone className="h-3 w-3 shrink-0" />
        <span className="min-w-0">
          {texto}
          {repetido}
          {" · "}
          {hora(item.quando)}
        </span>
      </span>
    </div>
  );
}
