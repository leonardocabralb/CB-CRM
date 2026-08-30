"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import type { CamposDoCard } from "@/lib/pipelines/campos-do-card";

/** Ordem das linhas = ordem em que os campos aparecem no card. */
const LINHAS: { chave: keyof CamposDoCard; rotulo: string }[] = [
  { chave: "canal", rotulo: "fieldChannel" },
  { chave: "etiquetas", rotulo: "fieldTags" },
  { chave: "ultimaMensagem", rotulo: "fieldLastMessage" },
  { chave: "naoLidas", rotulo: "fieldUnread" },
  { chave: "valor", rotulo: "fieldValue" },
  { chave: "dataPrevista", rotulo: "fieldExpectedDate" },
  { chave: "responsavel", rotulo: "fieldAssignee" },
];

/**
 * O que aparece nos cards do quadro. Título e contato são fixos — sem eles o
 * card não identifica ninguém; o resto liga/desliga aqui.
 */
export function CamposDoCardPopover({
  campos,
  onChange,
}: {
  campos: CamposDoCard;
  onChange: (campos: CamposDoCard) => void;
}) {
  const t = useTranslations("Pipelines.board");

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("cardFields")}
        title={t("cardFields")}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted"
      >
        <SlidersHorizontal className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-64">
        <p className="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("cardFieldsTitle")}
        </p>
        <div className="flex flex-col">
          {LINHAS.map(({ chave, rotulo }) => (
            <label
              key={chave}
              className="flex cursor-pointer items-center gap-2 rounded-md px-0.5 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={campos[chave]}
                onCheckedChange={(checked) =>
                  onChange({ ...campos, [chave]: checked === true })
                }
              />
              <span>{t(rotulo)}</span>
            </label>
          ))}
        </div>
        {/* Sem esta linha, quem configura no desktop e abre o celular acha
            que a escolha se perdeu. */}
        <p className="px-0.5 text-[11px] text-muted-foreground">
          {t("cardFieldsHint")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
