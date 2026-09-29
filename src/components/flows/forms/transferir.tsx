"use client";

/**
 * Formulário do nó "Transferir para atendente" (handoff): a nota interna e o
 * "Atribuir a" (item 2.7 do plano do previdenciário, CB, 26/09/2026).
 *
 * O padrão é "Ninguém": a conversa vira "pendente" SEM responsável e cai na
 * fila de quem está sem dono — é como o robô do previdenciário nasce (A7).
 * Quando houver um closer, escolhe-se o nome aqui.
 *
 * Os membros vêm do contexto do editor (`membrosDoRobo`, recortado pela conta
 * DO ROBÔ). Enquanto carregam — ou se a leitura falhou — o que está gravado
 * aparece como "a pessoa escolhida", nunca como o UUID cru.
 *
 * ⚠️ Quem não é mais membro aparece DITO (aviso âmbar): a rota de ativação
 * recusa o robô por isso, e o motor não atribuiria.
 *
 * ⚠️ "Ninguém" é um item com valor sentinela: o `<Select>` (base-ui) não
 * aceita item de valor vazio. Escolhê-lo TIRA o `assign_to` do nó.
 */

import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { membroEscolhidoNoHandoff } from "@/lib/flows/atribuir-no-handoff";
import { useFlowEditor } from "../flow-editor-state";
import type { MembrosDoRobo } from "../membros-do-robo";
import { TextRow } from "./fields";

const NINGUEM = "__ninguem__";

export function TransferirForm({
  cfg,
  onUpdateConfig,
}: {
  cfg: { note?: string; assign_to?: string };
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const { membrosDoRobo, recarregarMembrosDoRobo } = useFlowEditor();
  return (
    <CamposDoTransferir
      cfg={cfg}
      onUpdateConfig={onUpdateConfig}
      membrosDoRobo={membrosDoRobo}
      recarregarMembrosDoRobo={recarregarMembrosDoRobo}
    />
  );
}

/** A tela, sem o contexto do editor — separada para o teste desenhar os estados. */
export function CamposDoTransferir({
  cfg,
  onUpdateConfig,
  membrosDoRobo,
  recarregarMembrosDoRobo,
}: {
  cfg: { note?: string; assign_to?: string };
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  membrosDoRobo: MembrosDoRobo;
  recarregarMembrosDoRobo: () => void;
}) {
  const t = useTranslations("Flows.builder.form");

  const escolhido = membroEscolhidoNoHandoff(cfg);
  const pronto = membrosDoRobo.status === "pronto";
  const membros = pronto ? membrosDoRobo.membros : [];
  const conhecido = escolhido ? membros.some((m) => m.userId === escolhido) : true;
  const saiu = pronto && escolhido !== null && !conhecido;

  return (
    <>
      <TextRow
        label={t("internalNote")}
        value={cfg.note ?? ""}
        onChange={(v) => onUpdateConfig({ note: v })}
        rows={2}
      />
      <div className="min-w-0">
        <label className="mb-1 block text-xs text-muted-foreground">{t("handoffAssignLabel")}</label>
        <Select
          value={escolhido ?? NINGUEM}
          onValueChange={(v) =>
            onUpdateConfig({
              assign_to: typeof v === "string" && v !== NINGUEM ? v : undefined,
            })
          }
        >
          <SelectTrigger className="bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NINGUEM}>{t("handoffAssignNobody")}</SelectItem>
            {/* 1062: suspenso sai das opções, menos o já escolhido — que
                aparece marcado (o robô o trata como fora da equipe). */}
            {membros
              .filter((m) => !m.suspenso || m.userId === escolhido)
              .map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.suspenso
                    ? t("handoffAssignSuspended", { name: m.nome || t("handoffAssignNoName") })
                    : m.nome || t("handoffAssignNoName")}
                </SelectItem>
              ))}
            {/* O gravado precisa de um item enquanto a lista não chega (ou
                se a pessoa saiu da conta) — sem ele o gatilho mostraria o
                UUID cru. */}
            {escolhido !== null && !conhecido && (
              <SelectItem value={escolhido}>
                {saiu ? t("handoffAssignGone") : t("handoffAssignChosen")}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {membrosDoRobo.status === "carregando" && (
        <p className="text-[10px] text-muted-foreground">{t("handoffAssignLoading")}</p>
      )}
      {membrosDoRobo.status === "falhou" && (
        <p className="text-[10px] text-red-700 dark:text-red-300">
          {t("handoffAssignLoadError")}{" "}
          <button
            type="button"
            onClick={recarregarMembrosDoRobo}
            className="font-medium underline underline-offset-2 hover:opacity-80"
          >
            {t("moveLoadRetry")}
          </button>
        </p>
      )}
      {saiu && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300">{t("handoffAssignGoneHelp")}</p>
      )}
      <p className="text-[10px] text-muted-foreground">
        {escolhido ? t("handoffAssignHelpSomeone") : t("handoffAssignHelpNobody")}
      </p>
    </>
  );
}
