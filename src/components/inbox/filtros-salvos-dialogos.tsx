"use client";

// ============================================================
// Os diálogos dos filtros salvos — "Salvar filtro atual" e "Gerenciar
// filtros" (renomear/apagar). Saíram do `filtros-salvos-menu.tsx` em
// 2026-09-03, quando o menu atrás do ícone de marcador deu lugar à FILEIRA
// DE CHIPS (`visoes-salvas.tsx`): os diálogos são os mesmos; só o gatilho
// mudou de casa.
//
// 974: filtro salvo é DE CADA MEMBRO — não há mais gate de admin aqui.
// ============================================================

import { useState } from "react";
import { Check, Loader2, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { FiltrosDoInbox } from "@/lib/inbox/filtros";
import type { FiltroSalvo } from "@/lib/inbox/filtros-salvos";

export function DialogoSalvar({
  aberto,
  onFechar,
  resumo,
  salvos,
  onCriar,
  onRegravar,
}: {
  aberto: boolean;
  onFechar: () => void;
  resumo: string;
  salvos: FiltroSalvo[];
  onCriar: (nome: string) => Promise<boolean>;
  onRegravar: (id: string) => Promise<boolean>;
}) {
  const t = useTranslations("Inbox.conversationList");
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);

  /**
   * O homônimo, se houver — mesma regra do índice único (aparado, minúsculas).
   *
   * ⚠️ Achá-lo ANTES de tentar gravar é o que transforma o `23505` numa
   * pergunta em vez de num erro. Salvar por cima do filtro de mesmo nome é
   * quase sempre a intenção de quem está ali.
   */
  const homonimo = salvos.find(
    (f) => f.nome.trim().toLowerCase() === nome.trim().toLowerCase(),
  );

  const fechar = () => {
    setNome("");
    onFechar();
  };

  const gravar = async () => {
    if (!nome.trim() || salvando) return;
    setSalvando(true);
    const ok = homonimo ? await onRegravar(homonimo.id) : await onCriar(nome);
    setSalvando(false);
    if (ok) fechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? undefined : fechar())}>
      {/* min-w-0: filho direto do DialogContent (que é grid) nasce com
          min-width:auto, e o `truncate` do resumo estouraria a largura. */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("saveFilterTitle")}</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void gravar();
              }
            }}
            maxLength={60}
            placeholder={t("saveFilterNamePlaceholder")}
            autoFocus
          />
          {/* O que está sendo gravado, por escrito. Sem isto o operador salva
              "SDR" sem saber que o recorte ainda tem "Favoritas" ligado de uma
              hora atrás. */}
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">{t("saveFilterWhat")}</span> {resumo}
          </p>
          {homonimo && (
            <p className="text-xs text-amber-500">
              {t("saveFilterOverwriteHint", { nome: homonimo.nome })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={fechar}>
              {t("saveFilterCancel")}
            </Button>
            <Button size="sm" onClick={() => void gravar()} disabled={!nome.trim() || salvando}>
              {salvando && <Loader2 className="size-3.5 animate-spin" />}
              {homonimo ? t("saveFilterOverwrite") : t("saveFilterConfirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Renomear e apagar
// ------------------------------------------------------------

export function DialogoGerir({
  aberto,
  onFechar,
  salvos,
  resumir,
  onRenomear,
  onApagar,
}: {
  aberto: boolean;
  onFechar: () => void;
  salvos: FiltroSalvo[];
  resumir: (f: FiltrosDoInbox) => string;
  onRenomear: (id: string, nome: string) => Promise<boolean>;
  onApagar: (id: string) => Promise<boolean>;
}) {
  const t = useTranslations("Inbox.conversationList");
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const fechar = () => {
    setEditando(null);
    setConfirmando(null);
    onFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? undefined : fechar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("manageSavedFilters")}</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-2">
          {salvos.map((f) => (
            <div key={f.id} className="min-w-0 rounded-md border border-border p-2">
              {editando === f.id ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={rascunho}
                    onChange={(e) => setRascunho(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (!rascunho.trim() || ocupado) return;
                        setOcupado(true);
                        void onRenomear(f.id, rascunho).then((ok) => {
                          setOcupado(false);
                          if (ok) setEditando(null);
                        });
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditando(null);
                      }
                    }}
                    maxLength={60}
                    className="h-8 text-sm"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    disabled={!rascunho.trim() || ocupado}
                    onClick={() => {
                      setOcupado(true);
                      void onRenomear(f.id, rascunho).then((ok) => {
                        setOcupado(false);
                        if (ok) setEditando(null);
                      });
                    }}
                  >
                    <Check className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{f.nome}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {resumir(f.filtros)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRascunho(f.nome);
                      setEditando(f.id);
                    }}
                    title={t("savedFilterRename")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmando(f.id)}
                    title={t("savedFilterDelete")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Confirmação inline: apagar tira o atalho de TODO MUNDO, e um
                  clique errado num ícone de 28px não pode ser definitivo. */}
              {confirmando === f.id && (
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {t("savedFilterDeleteConfirm")}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmando(null)}>
                    {t("saveFilterCancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={ocupado}
                    onClick={() => {
                      setOcupado(true);
                      void onApagar(f.id).then(() => {
                        setOcupado(false);
                        setConfirmando(null);
                      });
                    }}
                  >
                    {t("savedFilterDelete")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
