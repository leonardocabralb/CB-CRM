"use client";

import { useEffect, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { comporHorario, hojeParaInput } from "@/lib/scheduled/display";

interface ScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  /** Texto que estava no compositor quando o relógio foi clicado. */
  textoInicial: string;
  /** Rótulo do número por onde vai sair. Só aparece em conta multi-canal. */
  canalLabel?: string | null;
  /** Agendou — o compositor limpa o campo e a ficha recarrega. */
  onAgendada: () => void;
}

/**
 * Agendar uma mensagem de texto (migration 925).
 *
 * ⚠️ POR QUE UM DIÁLOGO, E NÃO UM "MODO" DO BOTÃO ENVIAR. A janela de
 * desfazer do compositor tem TRÊS saídas que disparam na hora: trocar de
 * conversa, desmontar o componente e apertar Enter de novo. Um modo pendurado
 * no mesmo botão sairia imediatamente por qualquer uma delas — a mensagem
 * "agendada para amanhã" chegaria ao cliente em três segundos. Este caminho
 * não encosta no `setPendente`.
 *
 * Dois campos nativos em vez de um seletor de calendário: é o único
 * precedente do projeto (`deal-form.tsx`) e não acrescenta dependência ao
 * `package.json` para conflitar com o upstream.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  conversationId,
  textoInicial,
  canalLabel,
  onAgendada,
}: ScheduleDialogProps) {
  const t = useTranslations("Inbox.scheduled");
  const [texto, setTexto] = useState(textoInicial);
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Reabrir traz o texto que está no compositor AGORA. Sem isto, quem
  // fechasse o diálogo, editasse o texto e reabrisse agendaria a versão
  // antiga sem perceber.
  useEffect(() => {
    if (!open) return;
    setTexto(textoInicial);
    setData("");
    setHora("");
  }, [open, textoInicial]);

  const quando = data && hora ? comporHorario(data, hora) : null;
  const noPassado = !!quando && quando.getTime() <= Date.now();
  const podeSalvar = !!texto.trim() && !!quando && !noPassado && !salvando;

  async function agendar() {
    if (!quando || !texto.trim()) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/cb/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          body: texto.trim(),
          scheduled_for: quando.toISOString(),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? t("scheduleFailed"));
        return;
      }
      toast.success(t("scheduled"));
      onOpenChange(false);
      onAgendada();
    } catch {
      toast.error(t("scheduleFailed"));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t("scheduleTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("message")}</Label>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={4}
              maxLength={4000}
              className="resize-none rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("date")}</Label>
              <Input
                type="date"
                value={data}
                min={hojeParaInput()}
                onChange={(e) => setData(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("time")}</Label>
              <Input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </div>

          {noPassado && (
            <p className="text-xs text-destructive">{t("inThePast")}</p>
          )}

          {/* O ciclo do agendador é de um minuto (P4.2), e a promessa tem de
              estar escrita: "às 14h" que sai 14h00m40s é o combinado, não uma
              falha. */}
          <p className="text-xs text-muted-foreground">
            {canalLabel ? t("willSendVia", { channel: canalLabel }) : t("withinTheMinute")}
          </p>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
            >
              {t("cancel")}
            </Button>
            <Button size="sm" onClick={agendar} disabled={!podeSalvar}>
              {salvando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Clock className="mr-2 h-4 w-4" />
              )}
              {t("schedule")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
