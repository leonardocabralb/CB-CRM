"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Megaphone, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CampanhaDoMetaAds, CartaoDoMetaAds } from "@/lib/meta-ads/cartao";
import { cn } from "@/lib/utils";

import { SettingsChip, type ChipVariant } from "./settings-chip";

/**
 * O cartão "Meta Ads" da aba Integrações (Fase 4 do funil comercial).
 * Conecta a conta de anúncios (id + token de usuário de sistema, testado e
 * guardado cifrado pela rota), mostra a última sincronização e a tabela
 * campanha → funil — é essa atribuição que amarra o gasto ao Desempenho.
 *
 * Só admin chega aqui (a aba inteira é admin). Nenhum token volta da rota;
 * o campo do token nasce vazio sempre.
 */

interface Resposta {
  cartao: CartaoDoMetaAds;
  campanhas: CampanhaDoMetaAds[];
  funis: { id: string; name: string }[];
}

const CHIP: Record<CartaoDoMetaAds["estado"], ChipVariant> = {
  nao_conectado: "muted",
  conectado: "ok",
  erro: "err",
};

const CODIGOS_CONHECIDOS = new Set([
  "token_invalido",
  "sem_permissao",
  "conta_nao_encontrada",
  "conta_invalida",
  "limite",
  "rede",
  "meta_error",
  "db_error",
  "chave_ilegivel",
]);

export function MetaAdsCard() {
  const t = useTranslations("Settings.integracoes");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [adAccountId, setAdAccountId] = useState("");
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const vivoRef = useRef(true);

  const motivo = (codigo: string) =>
    CODIGOS_CONHECIDOS.has(codigo)
      ? // chave montada: `metaAds.motivo.<codigo>` — lista fechada acima
        t(`metaAds.motivo.${codigo}` as Parameters<typeof t>[0])
      : t("metaAds.motivo.meta_error");

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/cb/meta-ads");
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as Resposta;
      if (vivoRef.current) {
        setDados(corpo);
        setFalhou(false);
      }
    } catch {
      if (vivoRef.current) setFalhou(true);
    }
  }, []);

  useEffect(() => {
    vivoRef.current = true;
    void carregar();
    return () => {
      vivoRef.current = false;
    };
  }, [carregar]);

  const conectar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cb/meta-ads/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: adAccountId, access_token: token }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErro(motivo(corpo.error ?? "meta_error"));
        return;
      }
      setToken("");
      toast.success(t("metaAds.conectado"));
      // a primeira sincronização (90 dias) roda em `after()` na rota
      setTimeout(() => void carregar(), 2500);
      await carregar();
    } finally {
      if (vivoRef.current) setSalvando(false);
    }
  };

  const desconectar = async () => {
    if (!window.confirm(t("metaAds.confirmarDesconectar"))) return;
    const res = await fetch("/api/cb/meta-ads/config", { method: "DELETE" });
    if (!res.ok) {
      toast.error(t("salvarFalhou"));
      return;
    }
    await carregar();
  };

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const res = await fetch("/api/cb/meta-ads/sync", { method: "POST" });
      if (!res.ok) {
        toast.error(t("salvarFalhou"));
        return;
      }
      // 202: o trabalho corre em `after()`; dá um tempo e relê.
      await new Promise((r) => setTimeout(r, 3000));
      await carregar();
    } finally {
      if (vivoRef.current) setSincronizando(false);
    }
  };

  const atribuir = async (campanha: CampanhaDoMetaAds, pipelineId: string | null) => {
    const anterior = dados;
    setDados((d) =>
      d ? { ...d, campanhas: d.campanhas.map((c) => (c.id === campanha.id ? { ...c, pipeline_id: pipelineId } : c)) } : d,
    );
    const res = await fetch(`/api/cb/meta-ads/campanhas/${campanha.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline_id: pipelineId }),
    });
    if (!res.ok) {
      toast.error(t("salvarFalhou"));
      setDados(anterior);
      return;
    }
    await carregar();
  };

  const cartao = dados?.cartao;
  const estado = cartao?.estado ?? "nao_conectado";
  const rotuloDoChip =
    estado === "conectado" ? t("chipOk") : estado === "erro" ? t("chipErro") : t("chipNaoConectado");

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <Megaphone className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">Meta Ads</span>
        <SettingsChip variant={CHIP[estado]}>{rotuloDoChip}</SettingsChip>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
      </button>

      {aberto ? (
        <div className="space-y-4 border-t border-border p-4 text-sm">
          {falhou && !dados ? (
            <p className="text-muted-foreground">
              {t("carregarFalhou")}{" "}
              <button type="button" onClick={() => void carregar()} className="underline">
                {t("tentarDeNovo")}
              </button>
            </p>
          ) : !cartao ? (
            <p className="text-muted-foreground">{t("metaAds.carregando")}</p>
          ) : cartao.estado === "nao_conectado" ? (
            <>
              <p className="max-w-[62ch] text-muted-foreground">{t("metaAds.desc")}</p>
              <div className="grid gap-3 sm:max-w-md">
                <div className="space-y-1">
                  <Label htmlFor="meta-ads-conta">{t("metaAds.campoConta")}</Label>
                  <Input
                    id="meta-ads-conta"
                    value={adAccountId}
                    onChange={(e) => setAdAccountId(e.target.value)}
                    placeholder="act_1234567890"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meta-ads-token">{t("metaAds.campoToken")}</Label>
                  <Input
                    id="meta-ads-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={t("metaAds.tokenVazio")}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">{t("metaAds.tokenDica")}</p>
                </div>
                {erro && <p className="text-xs text-destructive">{t("falha", { motivo: erro })}</p>}
                <div>
                  <Button type="button" size="sm" onClick={() => void conectar()} disabled={salvando || !adAccountId || !token}>
                    {salvando ? t("metaAds.conectando") : t("metaAds.conectar")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-muted-foreground">
                  <span className="font-medium text-foreground">{cartao.conta?.nome}</span>{" "}
                  <span className="tabular-nums">({cartao.conta?.id})</span> · {cartao.conta?.moeda} ·{" "}
                  {t("metaAds.campanhas", { n: cartao.campanhas, ativas: cartao.ativas })}
                  {cartao.ultimaSync && (
                    <>
                      {" "}
                      · {t("metaAds.ultimaSync", { quando: new Date(cartao.ultimaSync).toLocaleString(undefined) })}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void sincronizar()} disabled={sincronizando}>
                    <RefreshCw className={cn("size-4", sincronizando && "animate-spin")} />
                    {sincronizando ? t("metaAds.sincronizando") : t("metaAds.sincronizar")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void desconectar()}>
                    {t("metaAds.desconectar")}
                  </Button>
                </div>
              </div>
              {cartao.erro && <p className="text-xs text-destructive">{t("falha", { motivo: motivo(cartao.erro) })}</p>}
              {cartao.semFunil > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t("metaAds.semFunil", { n: cartao.semFunil })}</p>
              )}
              {dados && dados.campanhas.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="py-1 pr-2 font-medium">{t("metaAds.colCampanha")}</th>
                        <th className="py-1 pr-2 font-medium">{t("metaAds.colStatus")}</th>
                        <th className="py-1 font-medium">{t("metaAds.colFunil")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.campanhas.map((c) => (
                        <tr key={c.id} className="border-t border-border">
                          <td className="max-w-[24rem] truncate py-1.5 pr-2" title={c.nome}>
                            {c.nome}
                          </td>
                          <td className="py-1.5 pr-2 text-muted-foreground">{c.status_meta ?? "—"}</td>
                          <td className="py-1.5">
                            <select
                              value={c.pipeline_id ?? ""}
                              onChange={(e) => void atribuir(c, e.target.value || null)}
                              aria-label={t("metaAds.colFunil")}
                              className="h-7 rounded-md border border-border bg-card px-1 text-xs text-foreground"
                            >
                              <option value="">{t("metaAds.semFunilOpcao")}</option>
                              {dados.funis.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("metaAds.semCampanhas")}</p>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
