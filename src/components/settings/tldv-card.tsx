"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, FileAudio, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { SeletorDeCliente } from "@/components/agenda/seletor-de-cliente";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FUSO_PADRAO, diaNoFuso, horaNoFuso } from "@/lib/agenda/fuso";
import type { CartaoDoTldv } from "@/lib/tldv/cartao";
import { formatarDuracao } from "@/lib/tldv/texto";
import { cn } from "@/lib/utils";

import { SettingsChip } from "./settings-chip";

/**
 * O cartão "tl;dv" da aba Integrações (987). Conecta a chave da API
 * (testada e guardada cifrada pela rota), mostra a última sincronização, a
 * URL do webhook para colar no tl;dv e as últimas reuniões importadas — com
 * o cliente de cada uma, que o operador vincula aqui quando o e-mail do
 * convidado não bastou.
 *
 * Só admin chega aqui (a aba inteira é admin). Nenhuma chave volta da rota;
 * o campo nasce vazio sempre.
 */

interface ReuniaoNoCartao {
  id: string;
  titulo: string;
  realizada_em: string;
  duracao_seg: number | null;
  status: string;
  contact_id: string | null;
  contato_nome: string | null;
  url: string | null;
  vinculo_origem: string | null;
  erro: string | null;
  participantes: { nome: string; email: string }[];
}

interface Resposta {
  cartao: CartaoDoTldv;
  reunioes: ReuniaoNoCartao[];
  webhookUrl: string | null;
  origemAlcancavel: boolean;
}

const CODIGOS_CONHECIDOS = new Set(["chave_invalida", "sem_permissao", "limite", "rede", "tldv_error", "db_error", "chave_ilegivel", "nao_conectado"]);
const STATUS_CONHECIDOS = new Set(["pendente", "pronta", "sem_transcricao", "falhou"]);

export function TldvCard() {
  const t = useTranslations("Settings.integracoes");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  /** id da reunião cujo seletor de cliente está aberto */
  const [vinculando, setVinculando] = useState<string | null>(null);
  const vivoRef = useRef(true);
  const dadosRef = useRef<Resposta | null>(null);
  dadosRef.current = dados;

  const motivo = (codigo: string) =>
    CODIGOS_CONHECIDOS.has(codigo)
      ? // chave montada: `tldv.motivo.<codigo>` — lista fechada acima
        t(`tldv.motivo.${codigo}` as Parameters<typeof t>[0])
      : t("tldv.motivo.tldv_error");
  const rotuloDeStatus = (status: string) =>
    STATUS_CONHECIDOS.has(status) ? t(`tldv.status.${status}` as Parameters<typeof t>[0]) : status;

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/cb/tldv");
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as Resposta;
      if (vivoRef.current) {
        setDados(corpo);
        setFalhou(false);
      }
    } catch {
      if (!vivoRef.current) return;
      setFalhou(true);
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

  const conectar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cb/tldv/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: chave }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErro(motivo(corpo.error ?? "tldv_error"));
        return;
      }
      setChave("");
      toast.success(t("tldv.conectado"));
      // a primeira sincronização (30 dias) roda em `after()` na rota
      setTimeout(() => void carregar(), 4000);
      await carregar();
    } finally {
      if (vivoRef.current) setSalvando(false);
    }
  };

  const desconectar = async () => {
    if (desconectando) return;
    if (!window.confirm(t("tldv.confirmarDesconectar"))) return;
    setDesconectando(true);
    try {
      const res = await fetch("/api/cb/tldv/config", { method: "DELETE" });
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
      const res = await fetch("/api/cb/tldv/sync", { method: "POST" });
      if (!res.ok) {
        toast.error(t("salvarFalhou"));
        return;
      }
      // 202: o trabalho corre em `after()`; dá um tempo e relê.
      await new Promise((r) => setTimeout(r, 4000));
      await carregar();
    } finally {
      if (vivoRef.current) setSincronizando(false);
    }
  };

  const vincular = async (reuniaoId: string, contactId: string | null) => {
    const res = await fetch(`/api/cb/reunioes-transcritas/${reuniaoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: contactId }),
    });
    if (!res.ok) {
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(t("falha", { motivo: motivo(corpo.error ?? "db_error") }));
      return;
    }
    setVinculando(null);
    await carregar();
  };

  const copiarUrl = async () => {
    if (!dados?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(dados.webhookUrl);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error(t("salvarFalhou"));
    }
  };

  const cartao = dados?.cartao;
  const estado = cartao?.estado ?? "nao_conectado";
  // ⚠️ O chip fica no cabeçalho, sempre visível, e é uma AFIRMAÇÃO. Enquanto
  // a carga corre — ou quando ela falha — dizer "Não conectada" acusa de
  // desconexão uma integração que pode estar de pé (mesma regra do Meta Ads).
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
      <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto} className="flex w-full items-center gap-3 p-4 text-left">
        <FileAudio className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">tl;dv</span>
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
            <p className="text-muted-foreground">{t("tldv.carregando")}</p>
          ) : cartao.estado === "nao_conectado" ? (
            <>
              <p className="max-w-[62ch] text-muted-foreground">{t("tldv.desc")}</p>
              <div className="grid gap-3 sm:max-w-md">
                <div className="space-y-1">
                  <Label htmlFor="tldv-chave">{t("tldv.campoChave")}</Label>
                  <Input
                    id="tldv-chave"
                    type="password"
                    value={chave}
                    onChange={(e) => setChave(e.target.value)}
                    placeholder={t("tldv.chaveVazia")}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">{t("tldv.chaveDica")}</p>
                </div>
                {erro && <p className="text-xs text-destructive">{t("falha", { motivo: erro })}</p>}
                <div>
                  <Button type="button" size="sm" onClick={() => void conectar()} disabled={salvando || !chave.trim()}>
                    {salvando ? t("tldv.conectando") : t("tldv.conectar")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-muted-foreground">
                  {t("tldv.resumo", { total: cartao.contagem.total, prontas: cartao.contagem.prontas, pendentes: cartao.contagem.pendentes })}
                  {" · "}
                  {cartao.ultimaSync ? t("tldv.ultimaSync", { quando: new Date(cartao.ultimaSync).toLocaleString(undefined) }) : t("tldv.nuncaSincronizado")}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void sincronizar()} disabled={sincronizando}>
                    <RefreshCw className={cn("size-4", sincronizando && "animate-spin")} />
                    {sincronizando ? t("tldv.sincronizando") : t("tldv.sincronizar")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void desconectar()} disabled={desconectando}>
                    {t("tldv.desconectar")}
                  </Button>
                </div>
              </div>
              {cartao.erro && <p className="text-xs text-destructive">{t("falha", { motivo: motivo(cartao.erro) })}</p>}
              {cartao.contagem.semCliente > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{t("tldv.semCliente", { n: cartao.contagem.semCliente })}</p>
              )}

              <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs font-medium">{t("tldv.webhookTitulo")}</p>
                {dados?.webhookUrl ? (
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">{dados.webhookUrl}</code>
                    <Button type="button" variant="outline" size="sm" onClick={() => void copiarUrl()}>
                      {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copiado ? t("tldv.urlCopiada") : t("tldv.copiarUrl")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-destructive">{t("tldv.urlInalcancavel")}</p>
                )}
                <p className="text-xs text-muted-foreground">{t("tldv.webhookAjuda")}</p>
              </div>

              {dados && dados.reunioes.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="py-1 pr-2 font-medium">{t("tldv.colQuando")}</th>
                        <th className="py-1 pr-2 font-medium">{t("tldv.colReuniao")}</th>
                        <th className="py-1 pr-2 font-medium">{t("tldv.colCliente")}</th>
                        <th className="py-1 font-medium">{t("tldv.colTranscricao")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.reunioes.map((r) => {
                        const inicio = new Date(r.realizada_em);
                        return (
                          <tr key={r.id} className="border-t border-border align-top">
                            <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-muted-foreground">
                              {diaNoFuso(inicio, FUSO_PADRAO)} {horaNoFuso(inicio, FUSO_PADRAO)}
                            </td>
                            <td className="max-w-[20rem] py-1.5 pr-2">
                              <p className="truncate" title={r.titulo}>
                                {r.url ? (
                                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                                    {r.titulo}
                                  </a>
                                ) : (
                                  r.titulo
                                )}
                              </p>
                              <p className="truncate text-muted-foreground" title={r.participantes.map((p) => p.email).join(", ")}>
                                {formatarDuracao(r.duracao_seg)}
                                {r.participantes.length > 0 ? ` · ${r.participantes.map((p) => p.nome || p.email).join(", ")}` : ""}
                              </p>
                            </td>
                            <td className="min-w-[12rem] py-1.5 pr-2">
                              {vinculando === r.id ? (
                                <div className="flex items-start gap-1">
                                  <div className="min-w-0 flex-1">
                                    <SeletorDeCliente valor={null} aoEscolher={(c) => c && void vincular(r.id, c.id)} />
                                  </div>
                                  <button type="button" onClick={() => setVinculando(null)} className="mt-2 text-muted-foreground hover:text-foreground" aria-label={t("tldv.cancelarVinculo")}>
                                    <X className="size-3.5" />
                                  </button>
                                </div>
                              ) : r.contact_id ? (
                                <span className="inline-flex items-center gap-1">
                                  <span className="truncate">{r.contato_nome ?? "—"}</span>
                                  {r.vinculo_origem === "email" && <span className="text-muted-foreground">({t("tldv.vinculadoPorEmail")})</span>}
                                  <button type="button" onClick={() => void vincular(r.id, null)} className="text-muted-foreground hover:text-foreground" aria-label={t("tldv.desvincular")} title={t("tldv.desvincular")}>
                                    <X className="size-3.5" />
                                  </button>
                                </span>
                              ) : (
                                <button type="button" onClick={() => setVinculando(r.id)} className="text-primary underline-offset-2 hover:underline">
                                  {t("tldv.vincular")}
                                </button>
                              )}
                            </td>
                            <td className="whitespace-nowrap py-1.5 text-muted-foreground">
                              {rotuloDeStatus(r.status)}
                              {r.erro ? ` — ${motivo(r.erro)}` : ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("tldv.semReunioes")}</p>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
