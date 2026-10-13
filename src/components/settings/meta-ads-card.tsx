"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Megaphone, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CampanhaDoMetaAds, CartaoDoMetaAds } from "@/lib/meta-ads/cartao";
import type { ContaDisponivel } from "@/lib/meta-ads/cliente";
import { cn } from "@/lib/utils";

import { SettingsChip, StatusDot, type ChipVariant } from "./settings-chip";

/**
 * O cartão "Meta Ads" da aba Integrações (Fase 4 do funil comercial).
 * Conecta a conta de anúncios (token de usuário de sistema → as contas que
 * ele enxerga → a escolhida; o token é testado e guardado cifrado pela
 * rota), mostra a última sincronização e a tabela campanha → funil — é essa
 * atribuição que amarra o gasto ao Desempenho.
 *
 * Só admin chega aqui (a aba inteira é admin). Nenhum token volta da rota;
 * o campo do token nasce vazio sempre.
 */

interface Resposta {
  cartao: CartaoDoMetaAds;
  campanhas: CampanhaDoMetaAds[];
  funis: { id: string; name: string }[];
}

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
  const [token, setToken] = useState("");
  // ⚠️ A lista é DO TOKEN que a buscou (carimbo `de`): trocado o token — ou
  // editado enquanto a busca corria —, ela deixa de valer no mesmo render,
  // sem esperar limpeza, e conectar uma conta de outro token fica impossível.
  const [lista, setLista] = useState<{ de: string; contas: ContaDisponivel[] } | null>(null);
  const [contaEscolhida, setContaEscolhida] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  // Sem trava, dois cliques mandam dois DELETE: o segundo responde sobre uma
  // config que já sumiu e pinta "falhou" em cima de uma desconexão que deu
  // certo (Codex, PR #123).
  const [desconectando, setDesconectando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const vivoRef = useRef(true);
  // Espelho de `dados` para o `carregar` saber se JÁ havia algo na tela sem
  // se re-criar a cada resposta (ele é dependência de um efeito).
  const dadosRef = useRef<Resposta | null>(null);
  dadosRef.current = dados;

  const motivo = (codigo: string) =>
    CODIGOS_CONHECIDOS.has(codigo)
      ? // chave montada: `metaAds.motivo.<codigo>` — lista fechada acima
        t(`metaAds.motivo.${codigo}` as Parameters<typeof t>[0])
      : t("metaAds.motivo.meta_error");

  // O `status` da campanha na Meta → selo da tabela: verde ativa, âmbar
  // pausada, neutro o resto. Chaves literais (sem montar), para os portões
  // de i18n enxergarem; status que a Meta inventar depois aparece cru.
  const statusDaCampanha = (status: string | null): readonly [ChipVariant, string] =>
    status === "ACTIVE"
      ? ["ok", t("metaAds.statusAtiva")]
      : status === "PAUSED"
        ? ["warn", t("metaAds.statusPausada")]
        : status === "ARCHIVED"
          ? ["muted", t("metaAds.statusArquivada")]
          : status === "DELETED"
            ? ["muted", t("metaAds.statusExcluida")]
            : ["muted", status ?? "—"];

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
      if (!vivoRef.current) return;
      setFalhou(true);
      // Já havia dados na tela: o chip e a data continuam desenhados, então
      // a falha precisa de VOZ — senão o operador conclui que a ação não
      // rodou e clica de novo (Codex, PR #123). É o mesmo aviso que o painel
      // de Integrações usa.
      if (dadosRef.current !== null) toast.error(t("recarregarFalhou"));
    }
  }, [t]);

  useEffect(() => {
    vivoRef.current = true;
    void carregar();
    return () => {
      vivoRef.current = false;
    };
  }, [carregar]);

  const tokenLimpo = token.trim();
  const contas = lista && lista.de === tokenLimpo ? lista.contas : null;
  const escolhida = contas?.some((c) => c.id === contaEscolhida) ? contaEscolhida : "";

  const buscarContas = async () => {
    const de = tokenLimpo;
    setBuscando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cb/meta-ads/contas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: de }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { contas?: ContaDisponivel[]; error?: string };
      if (!vivoRef.current) return;
      if (!res.ok || !Array.isArray(corpo.contas)) {
        setErro(motivo(corpo.error ?? "meta_error"));
        return;
      }
      const novas = corpo.contas;
      setLista({ de, contas: novas });
      // Buscando de novo, a escolha feita continua se a conta ainda veio.
      // Senão: uma conta só já vem escolhida; mais de uma, o operador escolhe.
      setContaEscolhida((atual) =>
        novas.some((c) => c.id === atual) ? atual : novas.length === 1 ? novas[0].id : "",
      );
    } catch {
      if (vivoRef.current) setErro(motivo("rede"));
    } finally {
      if (vivoRef.current) setBuscando(false);
    }
  };

  const conectar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cb/meta-ads/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_account_id: escolhida, access_token: tokenLimpo }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErro(motivo(corpo.error ?? "meta_error"));
        return;
      }
      setToken("");
      setLista(null);
      toast.success(t("metaAds.conectado"));
      // a primeira sincronização (90 dias) roda em `after()` na rota
      setTimeout(() => void carregar(), 2500);
      await carregar();
    } finally {
      if (vivoRef.current) setSalvando(false);
    }
  };

  const desconectar = async () => {
    if (desconectando) return;
    if (!window.confirm(t("metaAds.confirmarDesconectar"))) return;
    setDesconectando(true);
    try {
      const res = await fetch("/api/cb/meta-ads/config", { method: "DELETE" });
      if (!res.ok) {
        toast.error(t("salvarFalhou"));
        return;
      }
      await carregar();
    } finally {
      if (vivoRef.current) setDesconectando(false);
    }
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
    // ⚠️ O desfazer é POR CAMPANHA, nunca uma foto do estado inteiro:
    // atribuindo duas em sequência, a falha da segunda revertia também a
    // primeira, que já estava gravada (Codex, PR #123).
    const anterior = dados?.campanhas.find((c) => c.id === campanha.id)?.pipeline_id ?? null;
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
      setDados((d) =>
        d
          ? {
              ...d,
              campanhas: d.campanhas.map((c) => (c.id === campanha.id ? { ...c, pipeline_id: anterior } : c)),
            }
          : d,
      );
      return;
    }
    await carregar();
  };

  const cartao = dados?.cartao;
  const estado = cartao?.estado ?? "nao_conectado";
  // ⚠️ O chip fica no cabeçalho, sempre visível, e é uma AFIRMAÇÃO. Enquanto
  // a carga corre — ou quando ela falha — dizer "Não conectada" acusa de
  // desconexão uma integração que pode estar de pé, e o operador vai
  // recadastrar conta e token para consertar o que não quebrou (Codex,
  // PR #123). Os cartões de IA ao lado já fazem isto: skeleton até saber.
  const [variante, rotuloDoChip] =
    dados === null && !falhou
      ? (["muted", t("chipConferindo")] as const)
      : falhou && !dados
        ? (["err", t("chipErro")] as const)
        : estado === "conectado"
          ? (["ok", t("chipOk")] as const)
          : estado === "erro"
            ? (["err", t("chipErro")] as const)
            : (["muted", t("chipNaoConectado")] as const);

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
        <SettingsChip variant={variante}>{rotuloDoChip}</SettingsChip>
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
                  <Label htmlFor="meta-ads-token">{t("metaAds.campoToken")}</Label>
                  <Input
                    id="meta-ads-token"
                    type="password"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      setErro(null);
                    }}
                    placeholder={t("metaAds.tokenVazio")}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">{t("metaAds.tokenDica")}</p>
                </div>
                {contas && contas.length === 0 && (
                  <p className="text-xs text-amber-600">{t("metaAds.semContas")}</p>
                )}
                {contas && contas.length > 0 && (
                  <div className="space-y-1">
                    <Label htmlFor="meta-ads-conta">{t("metaAds.campoConta")}</Label>
                    <select
                      id="meta-ads-conta"
                      value={escolhida}
                      onChange={(e) => setContaEscolhida(e.target.value)}
                      className="h-8 w-full min-w-0 rounded-lg border border-input bg-card px-2 text-sm text-foreground"
                    >
                      {escolhida === "" && (
                        <option value="" disabled>
                          {t("metaAds.escolherConta")}
                        </option>
                      )}
                      {contas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {`${c.nome} (${c.id}) · ${c.moeda}${c.ativa ? "" : ` · ${t("metaAds.contaInativa")}`}`}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">{t("metaAds.contasDoToken", { n: contas.length })}</p>
                  </div>
                )}
                {erro && <p className="text-xs text-destructive">{t("falha", { motivo: erro })}</p>}
                {/* "Buscar contas" fica mesmo com a lista na tela: a conta
                    atribuída na Meta DEPOIS da busca só aparece buscando de
                    novo, e o campo do id digitado não existe mais (Codex,
                    PR #407). */}
                <div className="flex flex-wrap gap-2">
                  {contas && contas.length > 0 && (
                    <Button type="button" size="sm" onClick={() => void conectar()} disabled={salvando || !escolhida}>
                      {salvando ? t("metaAds.conectando") : t("metaAds.conectar")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={contas && contas.length > 0 ? "outline" : "default"}
                    onClick={() => void buscarContas()}
                    disabled={buscando || salvando || !tokenLimpo}
                  >
                    {buscando ? t("metaAds.buscandoContas") : t("metaAds.buscarContas")}
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
                  <Button type="button" variant="outline" size="sm" onClick={() => void desconectar()}
              disabled={desconectando}>
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
                      {dados.campanhas.map((c) => {
                        const [variante, rotulo] = statusDaCampanha(c.status_meta);
                        const ativa = c.status_meta === "ACTIVE";
                        return (
                          <tr key={c.id} className="border-t border-border">
                            <td
                              className={cn(
                                "max-w-[24rem] truncate py-1.5 pr-2",
                                ativa ? "font-medium text-foreground" : "text-muted-foreground",
                              )}
                              title={c.nome}
                            >
                              {c.nome}
                            </td>
                            <td className="py-1.5 pr-2">
                              <SettingsChip variant={variante}>
                                {ativa && <StatusDot />}
                                {rotulo}
                              </SettingsChip>
                            </td>
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
                        );
                      })}
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
