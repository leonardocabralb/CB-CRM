"use client";

// ============================================================
// Painel lateral de uma conversa de GRUPO.
//
// Componente separado do `contact-sidebar.tsx` de propósito: aquele é
// contato de ponta a ponta (etiquetas, negócios, anotações, histórico do
// lead) e nada disso existe num grupo. Enfiar ramos de `if (grupo)` lá
// deixaria os dois piores.
// ============================================================

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Users, RefreshCw, Pencil, Megaphone, ShieldCheck, Check, X } from "lucide-react";

import type { CbGroup } from "@/types";
import { useChannels } from "@/hooks/use-channels";
import { nomeDoGrupo, podeRenomearNoWhatsApp } from "@/lib/cb-groups/display";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface GroupSidebarProps {
  grupo: CbGroup | null;
  /** Reflete no estado do pai o que a rota devolveu. */
  onGrupoAtualizado?: (patch: Partial<CbGroup>) => void;
}

export function GroupSidebar({ grupo, onGrupoAtualizado }: GroupSidebarProps) {
  const t = useTranslations("Inbox.groupSidebar");
  const { channels } = useChannels();

  const [editandoApelido, setEditandoApelido] = useState(false);
  const [apelido, setApelido] = useState("");
  const [editandoNomeReal, setEditandoNomeReal] = useState(false);
  const [nomeReal, setNomeReal] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  const patch = useCallback(
    async (corpo: Record<string, unknown>) => {
      if (!grupo) return;
      setSalvando(true);
      try {
        const res = await fetch(`/api/cb/groups/${grupo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload.error ?? t("saveFailed"));
          return false;
        }
        onGrupoAtualizado?.(payload.group ?? {});
        return true;
      } catch {
        toast.error(t("saveFailed"));
        return false;
      } finally {
        setSalvando(false);
      }
    },
    [grupo, onGrupoAtualizado, t],
  );

  const sincronizar = useCallback(async () => {
    if (!grupo?.channel_id) return;
    setSincronizando(true);
    try {
      const res = await fetch("/api/cb/groups/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: grupo.channel_id }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error ?? t("syncFailed"));
        return;
      }
      // A parte lenta roda em segundo plano na rota — dizer "pronto" seria
      // mentira: participantes e admin ainda estão chegando.
      toast.success(t("syncStarted"));
    } catch {
      toast.error(t("syncFailed"));
    } finally {
      setSincronizando(false);
    }
  }, [grupo, t]);

  if (!grupo) {
    return (
      <div className="flex h-full w-70 flex-col items-center justify-center border-l border-border bg-card p-4 text-center">
        <Users className="h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-xs text-muted-foreground">{t("empty")}</p>
      </div>
    );
  }

  const nome = nomeDoGrupo(grupo, t("noName"));
  const canal = channels.find((c) => c.id === grupo.channel_id);
  const podeRenomear = podeRenomearNoWhatsApp(grupo);

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              {grupo.picture_url ? (
                <img
                  src={grupo.picture_url}
                  alt={nome}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <Users className="h-7 w-7 text-muted-foreground" />
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">{nome}</h3>
            {/* Com apelido, o nome REAL vira legenda: o operador precisa
                conseguir dizer a que grupo do WhatsApp aquele apelido
                corresponde. */}
            {grupo.alias && grupo.subject && (
              <p className="text-xs text-muted-foreground">{grupo.subject}</p>
            )}
            {grupo.participant_count != null && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("participants", { count: grupo.participant_count })}
              </p>
            )}
            <div className="mt-2 flex flex-wrap justify-center gap-1">
              {grupo.is_announce && (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Megaphone className="h-3 w-3" />
                  {t("announceOnly")}
                </Badge>
              )}
              {grupo.we_are_admin && (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <ShieldCheck className="h-3 w-3" />
                  {t("weAreAdmin")}
                </Badge>
              )}
            </div>
          </div>

          {/* Apelido interno */}
          <Secao titulo={t("aliasTitle")}>
            <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
              {t("aliasHint")}
            </p>
            {editandoApelido ? (
              <LinhaDeEdicao
                valor={apelido}
                onChange={setApelido}
                placeholder={t("aliasPlaceholder")}
                salvando={salvando}
                onCancelar={() => setEditandoApelido(false)}
                onSalvar={async () => {
                  if (await patch({ alias: apelido })) setEditandoApelido(false);
                }}
              />
            ) : (
              <button
                onClick={() => {
                  setApelido(grupo.alias ?? "");
                  setEditandoApelido(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Pencil className="h-3.5 w-3.5" />
                {grupo.alias || t("aliasEmpty")}
              </button>
            )}
          </Secao>

          {/* Nome no WhatsApp */}
          <Secao titulo={t("realNameTitle")}>
            <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
              {podeRenomear ? t("realNameHint") : t("realNameBlocked")}
            </p>
            {editandoNomeReal ? (
              <LinhaDeEdicao
                valor={nomeReal}
                onChange={setNomeReal}
                placeholder={t("realNamePlaceholder")}
                salvando={salvando}
                onCancelar={() => setEditandoNomeReal(false)}
                onSalvar={async () => {
                  const ok = await patch({
                    subject: nomeReal,
                    renomear_no_whatsapp: true,
                  });
                  if (ok) {
                    setEditandoNomeReal(false);
                    toast.success(t("realNameDone"));
                  }
                }}
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={!podeRenomear}
                onClick={() => {
                  setNomeReal(grupo.subject ?? "");
                  setEditandoNomeReal(true);
                }}
              >
                {t("realNameAction")}
              </Button>
            )}
          </Secao>

          {/* Conexão + sincronizar */}
          <Secao titulo={t("channelTitle")}>
            <p className="mb-2 text-sm text-foreground">
              {canal?.label ?? t("channelUnknown")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              disabled={sincronizando || !grupo.channel_id}
              onClick={sincronizar}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", sincronizando && "animate-spin")} />
              {sincronizando ? t("syncing") : t("syncAction")}
            </Button>
          </Secao>
        </div>
      </ScrollArea>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h4>
      {children}
    </div>
  );
}

function LinhaDeEdicao({
  valor,
  onChange,
  placeholder,
  salvando,
  onSalvar,
  onCancelar,
}: {
  valor: string;
  onChange: (v: string) => void;
  placeholder: string;
  salvando: boolean;
  onSalvar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm"
        autoFocus
      />
      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={salvando} onClick={onSalvar}>
        <Check className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onCancelar}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
