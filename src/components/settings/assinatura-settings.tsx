"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { SettingsPanelHead } from "@/components/settings/settings-panel-head";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import {
  nomeDePessoa,
  prefixoDeAssinatura,
  saneiaNome,
} from "@/lib/assinatura/assinatura";

/**
 * Assinatura do remetente (migration 923).
 *
 * ⚠️ É a única tela de configuração do projeto que muda o TEXTO QUE O CLIENTE
 * RECEBE — por isso ela mostra a prévia exata antes de qualquer clique. O
 * operador não deveria precisar mandar uma mensagem para um cliente real para
 * descobrir como a assinatura fica.
 *
 * Escreve direto em `accounts` sob RLS, no molde da `deals-settings`: a
 * policy `accounts_update` (017) já restringe a escrita a admin+, então não há
 * gate próprio aqui além de esconder os controles de quem não pode salvar.
 */
export function AssinaturaSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings, profile } = useAuth();
  const t = useTranslations("Settings.assinatura");

  const [ativa, setAtiva] = useState(false);
  const [nomeAutomatico, setNomeAutomatico] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let vivo = true;
    void (async () => {
      const { data } = await supabase
        .from("accounts")
        .select("assinatura_ativa, assinatura_nome_automatica")
        .eq("id", accountId)
        .maybeSingle();
      if (!vivo) return;
      setAtiva(Boolean(data?.assinatura_ativa));
      setNomeAutomatico((data?.assinatura_nome_automatica as string) ?? "");
      setCarregando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [accountId, supabase]);

  const salvar = useCallback(async () => {
    if (!accountId) return;
    setSalvando(true);
    const { error } = await supabase
      .from("accounts")
      .update({
        assinatura_ativa: ativa,
        // Vazio vira NULL: a coluna nula significa "não assina mensagem
        // automática", e string vazia geraria `*:*` se algum caminho novo
        // esquecesse de sanear.
        assinatura_nome_automatica: saneiaNome(nomeAutomatico),
      })
      .eq("id", accountId);
    setSalvando(false);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("saveSuccess"));
  }, [accountId, ativa, nomeAutomatico, supabase, t]);

  // A prévia usa exatamente as mesmas funções puras do envio — se a regra
  // mudar, a tela muda junto, sem ninguém lembrar de atualizar o exemplo.
  const nomeDaPessoa = nomeDePessoa(profile?.full_name, profile?.email);
  const previaPessoa = prefixoDeAssinatura(nomeDaPessoa) + t("previewBody");
  const previaAutomatica =
    prefixoDeAssinatura(saneiaNome(nomeAutomatico)) + t("previewBodyAuto");

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      {carregando ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : (
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("toggleLabel")}</p>
              <p className="text-xs text-muted-foreground">{t("toggleHint")}</p>
            </div>
            <Switch
              checked={ativa}
              onCheckedChange={setAtiva}
              disabled={!canEditSettings}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="nome-automatico">
              {t("autoNameLabel")}
            </label>
            {/* ⚠️ O texto explica POR QUE não é o nome de uma pessoa. Sem
                isso alguém digitaria o próprio nome aqui, e toda resposta
                automática de madrugada sairia assinada por quem estava
                dormindo. */}
            <p className="text-xs text-muted-foreground">{t("autoNameHint")}</p>
            <Input
              id="nome-automatico"
              value={nomeAutomatico}
              onChange={(e) => setNomeAutomatico(e.target.value)}
              placeholder={t("autoNamePlaceholder")}
              disabled={!canEditSettings}
              maxLength={60}
            />
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("previewTitle")}
            </p>
            {ativa ? (
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">
                    {t("previewPersonLabel")}
                  </p>
                  <p className="whitespace-pre-wrap rounded-lg bg-background p-3 text-sm">
                    {previaPessoa}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">
                    {t("previewAutoLabel")}
                  </p>
                  <p className="whitespace-pre-wrap rounded-lg bg-background p-3 text-sm">
                    {previaAutomatica}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("previewOff")}</p>
            )}
          </div>

          {canEditSettings && (
            <Button onClick={() => void salvar()} disabled={salvando}>
              {salvando ? t("saving") : t("save")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
