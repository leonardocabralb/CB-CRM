"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, FileSignature, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CartaoDoZapSign, EventoDoZapSign } from "@/lib/zapsign/cartao";
import { CASADO_POR, EVENTOS_POR_PAGINA, RESULTADOS_DO_EVENTO, RESULTADOS_REPROCESSAVEIS } from "@/lib/zapsign/log";
import { cn } from "@/lib/utils";

import { SettingsChip } from "./settings-chip";

/**
 * O cartão "ZapSign" da aba Integrações (1057). O operador COLA o token da
 * API (o campo nasce vazio sempre — nenhum token volta da rota); o CRM o
 * prova, lê o plano e cria o webhook `doc_signed`. Mostra o estado do
 * webhook (com "Reativar"), os modelos da conta e o log de assinaturas com o
 * que aconteceu a cada uma — é por ele que "o cliente assinou e o card não
 * andou" tem resposta, e é dele que sai o "Processar de novo".
 *
 * Mesmo esqueleto do `calendly-card.tsx`: só admin chega aqui.
 */

interface Resposta {
  cartao: CartaoDoZapSign;
  eventos: EventoDoZapSign[];
  totalEventos: number;
  webhookUrl: string | null;
  origemAlcancavel: boolean;
  podeCriarAqui: boolean;
}

/**
 * ⚠️ Lista FECHADA: código fora dela cai no texto genérico. Código novo em
 * `conexao.ts`/`cliente.ts`/`cartao.ts` entra aqui E nos dois dicionários
 * (`zapsign.motivo.<código>`, chave montada — há teste cobrando).
 */
export const CODIGOS_CONHECIDOS = [
  "token_invalido",
  "sem_plano",
  "nao_encontrado",
  "limite",
  "rede",
  "zapsign_error",
  "url_inalcancavel",
  "fora_do_host",
  "db_error",
  "nao_conectado",
  "token_ilegivel",
  "webhook_ausente",
] as const;

const CODIGOS = new Set<string>(CODIGOS_CONHECIDOS);
const RESULTADOS = new Set<string>(RESULTADOS_DO_EVENTO);
const POR = new Set<string>(CASADO_POR);

interface Modelos {
  modelos: { token: string; nome: string; ativo: boolean }[];
  truncado: boolean;
}

export function ZapSignCard() {
  const t = useTranslations("Settings.integracoes");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [reativando, setReativando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [modelos, setModelos] = useState<Modelos | "carregando" | "falhou" | null>(null);
  const [logAberto, setLogAberto] = useState(false);
  const [eventoAberto, setEventoAberto] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [paginaCarregada, setPaginaCarregada] = useState<{ pagina: number; eventos: EventoDoZapSign[] } | null>(null);
  const [carregandoPagina, setCarregandoPagina] = useState(false);
  const [reprocessando, setReprocessando] = useState<string | null>(null);
  const vivoRef = useRef(true);
  const dadosRef = useRef<Resposta | null>(null);
  dadosRef.current = dados;

  const motivo = (codigo: string) =>
    CODIGOS.has(codigo)
      ? // chave montada: `zapsign.motivo.<codigo>` — lista fechada acima
        t(`zapsign.motivo.${codigo}` as Parameters<typeof t>[0])
      : t("zapsign.motivo.zapsign_error");
  const rotuloDoResultado = (r: string) => (RESULTADOS.has(r) ? t(`zapsign.resultado.${r}` as Parameters<typeof t>[0]) : r);
  const rotuloDoCasamento = (c: string | null) => (c && POR.has(c) ? t(`zapsign.casadoPor.${c}` as Parameters<typeof t>[0]) : "—");

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/cb/zapsign");
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as Resposta;
      if (vivoRef.current) {
        setDados(corpo);
        setPagina(1);
        setPaginaCarregada(null);
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

  const carregarModelos = async () => {
    setModelos("carregando");
    try {
      const res = await fetch("/api/cb/zapsign/modelos");
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as Modelos;
      if (vivoRef.current) setModelos(corpo);
    } catch {
      if (vivoRef.current) setModelos("falhou");
    }
  };

  const conectar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cb/zapsign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string; webhookErro?: string | null };
      if (!res.ok) {
        setErro(motivo(corpo.error ?? "zapsign_error"));
        return;
      }
      setToken("");
      if (corpo.webhookErro) toast.warning(t("zapsign.conectadoSemWebhook"));
      else toast.success(t("zapsign.conectado"));
      await carregar();
    } finally {
      if (vivoRef.current) setSalvando(false);
    }
  };

  const reativar = async () => {
    setReativando(true);
    try {
      const res = await fetch("/api/cb/zapsign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "reativar_webhook" }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(t("falha", { motivo: motivo(corpo.error ?? "zapsign_error") }));
      else toast.success(t("zapsign.reativado"));
      await carregar();
    } finally {
      if (vivoRef.current) setReativando(false);
    }
  };

  const desconectar = async () => {
    if (desconectando) return;
    if (!window.confirm(t("zapsign.confirmarDesconectar"))) return;
    setDesconectando(true);
    try {
      const res = await fetch("/api/cb/zapsign", { method: "DELETE" });
      const corpo = (await res.json().catch(() => ({}))) as { webhookNaoApagado?: boolean };
      if (!res.ok) {
        toast.error(t("salvarFalhou"));
        return;
      }
      if (corpo.webhookNaoApagado) toast.warning(t("zapsign.webhookNaoApagado"));
      setModelos(null);
      await carregar();
    } finally {
      if (vivoRef.current) setDesconectando(false);
    }
  };

  const irParaPagina = async (n: number) => {
    if (n < 1) return;
    if (n === 1) {
      setPagina(1);
      setPaginaCarregada(null);
      return;
    }
    setCarregandoPagina(true);
    try {
      const res = await fetch(`/api/cb/zapsign/eventos?pagina=${n}`);
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as { eventos: EventoDoZapSign[]; pagina: number };
      if (vivoRef.current) {
        setPagina(corpo.pagina);
        setPaginaCarregada({ pagina: corpo.pagina, eventos: corpo.eventos });
        setEventoAberto(null);
      }
    } catch {
      if (vivoRef.current) toast.error(t("recarregarFalhou"));
    } finally {
      if (vivoRef.current) setCarregandoPagina(false);
    }
  };

  /**
   * "Processar de novo": o motivo de uma assinatura não ter movido o card
   * costuma ser externo e passageiro — a ficha sem o telefone, dois clientes
   * com o mesmo, a automação que ainda não existia. Depois de arrumar, é
   * aqui que o operador pede a repetição.
   */
  const reprocessar = async (id: string) => {
    setReprocessando(id);
    try {
      const res = await fetch(`/api/cb/zapsign/eventos/${id}/reprocessar`, { method: "POST" });
      const corpo = (await res.json().catch(() => null)) as { resultado?: string; error?: string } | null;
      if (!res.ok) {
        toast.error(
          corpo?.error === "ja_processado"
            ? t("zapsign.jaProcessado")
            : corpo?.error === "ainda_processando"
              ? t("zapsign.aindaProcessando")
              : t("zapsign.reprocessarFalhou"),
        );
      } else {
        toast.success(t("zapsign.reprocessado", { resultado: rotuloDoResultado(corpo?.resultado ?? "") }));
      }
      // A lista é uma foto de antes do clique: o resultado da linha mudou.
      await carregar();
    } catch {
      toast.error(t("zapsign.reprocessarFalhou"));
    } finally {
      if (vivoRef.current) setReprocessando(null);
    }
  };

  const cartao = dados?.cartao;
  const estado = cartao?.estado ?? "nao_conectado";
  // ⚠️ O chip é uma AFIRMAÇÃO no cabeçalho: enquanto não se sabe, "Conferindo"
  // — nunca "Não conectada" sobre uma integração que pode estar de pé.
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

  const eventos = pagina === 1 || !paginaCarregada ? (dados?.eventos ?? []) : paginaCarregada.eventos;
  const total = dados?.totalEventos ?? 0;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto} className="flex w-full items-center gap-3 p-4 text-left">
        <FileSignature className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">ZapSign</span>
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
            <p className="text-muted-foreground">{t("zapsign.carregando")}</p>
          ) : cartao.estado === "nao_conectado" ? (
            <>
              <p className="max-w-[62ch] text-muted-foreground">{t("zapsign.desc")}</p>
              {dados && !dados.origemAlcancavel && <p className="text-xs text-destructive">{t("zapsign.motivo.url_inalcancavel")}</p>}
              <div className="grid gap-3 sm:max-w-md">
                <div className="space-y-1">
                  <Label htmlFor="zapsign-token">{t("zapsign.campoToken")}</Label>
                  <Input
                    id="zapsign-token"
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={t("zapsign.tokenVazio")}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">{t("zapsign.tokenDica")}</p>
                  <p className="text-xs text-muted-foreground">{t("zapsign.planoDica")}</p>
                </div>
                {erro && <p className="text-xs text-destructive">{t("falha", { motivo: erro })}</p>}
                <div>
                  <Button type="button" size="sm" onClick={() => void conectar()} disabled={salvando || !token.trim()}>
                    {salvando ? t("zapsign.conectando") : t("zapsign.conectar")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-muted-foreground">
                  {cartao.plano ? t("zapsign.plano", { nome: cartao.plano }) : t("zapsign.semPlanoInfo")}
                  {cartao.ultimoEvento && <> · {t("zapsign.ultimaAssinatura", { quando: quando(cartao.ultimoEvento) })}</>}
                </div>
                <div className="flex items-center gap-2">
                  {cartao.webhook !== "ativo" && (
                    <Button type="button" variant="outline" size="sm" onClick={() => void reativar()} disabled={reativando || !dados?.podeCriarAqui}>
                      <RefreshCw className={cn("size-4", reativando && "animate-spin")} />
                      {reativando ? t("zapsign.reativando") : t("zapsign.reativar")}
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => void desconectar()} disabled={desconectando}>
                    {t("zapsign.desconectar")}
                  </Button>
                </div>
              </div>

              {cartao.webhook === "ativo" ? (
                <p className="text-xs text-muted-foreground">{t("zapsign.webhookAtivo")}</p>
              ) : (
                <p className="text-xs text-destructive">{t("zapsign.webhookInativo")}</p>
              )}
              {cartao.erro && <p className="text-xs text-destructive">{t("falha", { motivo: motivo(cartao.erro) })}</p>}
              {cartao.webhook !== "ativo" && dados && !dados.podeCriarAqui && (
                <p className="text-xs text-muted-foreground">{t("zapsign.reativarSoNoEndereco")}</p>
              )}
              {dados?.webhookUrl && (
                <div className="space-y-1">
                  <Label>{t("zapsign.urlLabel")}</Label>
                  <Input value={dados.webhookUrl} readOnly className="text-xs" />
                  <p className="text-xs text-muted-foreground">{t("zapsign.urlHint")}</p>
                </div>
              )}
              <p className="max-w-[62ch] text-xs text-muted-foreground">{t("zapsign.comoFunciona")}</p>

              <ListaDeModelos modelos={modelos} onCarregar={() => void carregarModelos()} t={t} />

              <LogDeAssinaturas
                eventos={eventos}
                total={total}
                pagina={pagina}
                carregando={carregandoPagina}
                onPagina={(n) => void irParaPagina(n)}
                cartao={cartao}
                aberto={logAberto}
                onToggle={() => setLogAberto((a) => !a)}
                eventoAberto={eventoAberto}
                onAbrirEvento={(id) => setEventoAberto((atual) => (atual === id ? null : id))}
                onReprocessar={(id) => void reprocessar(id)}
                reprocessando={reprocessando}
                t={t}
                rotuloDoResultado={rotuloDoResultado}
                rotuloDoCasamento={rotuloDoCasamento}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function quando(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

type Tradutor = ReturnType<typeof useTranslations>;

/** Os modelos da conta: carregados sob demanda (cada carga é uma ida ao ZapSign). */
function ListaDeModelos({
  modelos,
  onCarregar,
  t,
}: {
  modelos: Modelos | "carregando" | "falhou" | null;
  onCarregar: () => void;
  t: Tradutor;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{t("zapsign.modelosTitulo")}</p>
        <Button type="button" variant="outline" size="sm" onClick={onCarregar} disabled={modelos === "carregando"}>
          {modelos === null ? t("zapsign.verModelos") : t("zapsign.recarregarModelos")}
        </Button>
      </div>
      {modelos === "carregando" ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("zapsign.modelosCarregando")}</p>
      ) : modelos === "falhou" ? (
        <p className="mt-2 text-xs text-destructive">{t("zapsign.modelosFalhou")}</p>
      ) : modelos === null ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("zapsign.modelosAjuda")}</p>
      ) : modelos.modelos.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("zapsign.semModelos")}</p>
      ) : (
        <>
          <ul className="mt-2 space-y-0.5 text-xs">
            {modelos.modelos.map((m) => (
              <li key={m.token} className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate" title={m.nome}>
                  {m.nome}
                </span>
                {!m.ativo && <span className="shrink-0 text-muted-foreground">({t("zapsign.modeloInativo")})</span>}
              </li>
            ))}
          </ul>
          {modelos.truncado && (
            <p className="mt-1 text-[11px] text-muted-foreground">{t("zapsign.modelosTruncado", { n: modelos.modelos.length })}</p>
          )}
        </>
      )}
    </div>
  );
}

function LogDeAssinaturas({
  eventos,
  total,
  pagina,
  carregando,
  onPagina,
  cartao,
  aberto,
  onToggle,
  eventoAberto,
  onAbrirEvento,
  onReprocessar,
  reprocessando,
  t,
  rotuloDoResultado,
  rotuloDoCasamento,
}: {
  eventos: EventoDoZapSign[];
  total: number;
  pagina: number;
  carregando: boolean;
  onPagina: (n: number) => void;
  cartao: CartaoDoZapSign;
  aberto: boolean;
  onToggle: () => void;
  eventoAberto: string | null;
  onAbrirEvento: (id: string) => void;
  onReprocessar: (id: string) => void;
  /** id da linha em processamento, ou null. */
  reprocessando: string | null;
  t: Tradutor;
  rotuloDoResultado: (r: string) => string;
  rotuloDoCasamento: (c: string | null) => string;
}) {
  return (
    <div className="rounded-md border border-border">
      <button type="button" onClick={onToggle} aria-expanded={aberto} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs">
        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
        <span className="font-medium text-foreground">{t("zapsign.log", { n: total })}</span>
        <span className="ml-auto truncate text-muted-foreground">
          {t("zapsign.contagem", {
            disparados: cartao.contagem.disparado,
            semContato: cartao.contagem.sem_contato,
            incompletos: cartao.contagem.incompleto,
          })}
        </span>
      </button>
      {aberto ? (
        <div className="space-y-2 border-t border-border p-3">
          <p className="text-[11px] text-muted-foreground">{t("zapsign.logAjuda")}</p>
          {total === 0 ? (
            <p className="text-xs text-muted-foreground">{t("zapsign.semEventos")}</p>
          ) : (
            <div className={cn("overflow-x-auto", carregando && "opacity-60")}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">{t("zapsign.colQuando")}</th>
                    <th className="py-1 pr-2 font-medium">{t("zapsign.colDocumento")}</th>
                    <th className="py-1 pr-2 font-medium">{t("zapsign.colSignatario")}</th>
                    <th className="py-1 pr-2 font-medium">{t("zapsign.colCasadoPor")}</th>
                    <th className="py-1 font-medium">{t("zapsign.colResultado")}</th>
                  </tr>
                </thead>
                <tbody>
                  {eventos.map((e) => {
                    const abertoAqui = eventoAberto === e.id;
                    return (
                      <React.Fragment key={e.id}>
                        <tr className="cursor-pointer border-t border-border align-top hover:bg-muted/40" onClick={() => onAbrirEvento(e.id)} aria-expanded={abertoAqui}>
                          <td className="whitespace-nowrap py-1.5 pr-2 text-muted-foreground">{quando(e.recebido_em)}</td>
                          <td className="max-w-[14rem] truncate py-1.5 pr-2" title={e.documento_nome ?? ""}>
                            {e.documento_nome ?? "—"}
                          </td>
                          <td className="max-w-[12rem] truncate py-1.5 pr-2" title={e.signatario_nome ?? ""}>
                            {e.signatario_nome ?? "—"}
                          </td>
                          <td className="whitespace-nowrap py-1.5 pr-2">{rotuloDoCasamento(e.casado_por)}</td>
                          <td
                            className={cn(
                              "py-1.5",
                              e.resultado === "disparado"
                                ? "text-emerald-700 dark:text-emerald-400"
                                : e.resultado === "falhou"
                                  ? "text-destructive"
                                  : e.resultado === "recebido" || e.resultado === "em_espera" || e.resultado === "incompleto"
                                    ? "text-muted-foreground"
                                    : "text-amber-700 dark:text-amber-400",
                            )}
                          >
                            {rotuloDoResultado(e.resultado)}
                          </td>
                        </tr>
                        {abertoAqui && (
                          <tr className="border-t border-border/60 bg-muted/30">
                            <td colSpan={5} className="px-2 py-2">
                              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
                                <dt className="text-muted-foreground">{t("zapsign.detResultado")}</dt>
                                <dd>
                                  {rotuloDoResultado(e.resultado)}
                                  {e.detalhe && <span className="text-muted-foreground"> · {e.detalhe}</span>}
                                  <span className="text-muted-foreground">
                                    {" "}
                                    · {e.processado_em ? t("zapsign.detProcessado", { quando: quando(e.processado_em) }) : t("zapsign.detNaoProcessado")}
                                  </span>
                                </dd>
                                <dt className="text-muted-foreground">{t("zapsign.detContato")}</dt>
                                <dd>
                                  {e.contact_id ? (
                                    <a href={`/contacts?contact=${e.contact_id}`} className="underline">
                                      {t("zapsign.abrirNoCrm")}
                                    </a>
                                  ) : (
                                    "—"
                                  )}
                                </dd>
                              </dl>
                              {(RESULTADOS_REPROCESSAVEIS as readonly string[]).includes(e.resultado) && (
                                <div className="mt-2 flex items-center gap-2">
                                  <Button type="button" variant="outline" size="sm" onClick={() => onReprocessar(e.id)} disabled={reprocessando !== null}>
                                    {reprocessando === e.id ? t("zapsign.reprocessando") : t("zapsign.reprocessar")}
                                  </Button>
                                  <span className="text-xs text-muted-foreground">{t("zapsign.reprocessarAjuda")}</span>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {total > EVENTOS_POR_PAGINA && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <Button type="button" variant="outline" size="sm" onClick={() => onPagina(pagina - 1)} disabled={carregando || pagina <= 1}>
                {t("zapsign.logMaisRecentes")}
              </Button>
              <span className="text-muted-foreground">
                {t("zapsign.logPagina", { pagina, total: Math.max(1, Math.ceil(total / EVENTOS_POR_PAGINA)) })}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => onPagina(pagina + 1)} disabled={carregando || pagina * EVENTOS_POR_PAGINA >= total}>
                {t("zapsign.logMaisAntigos")}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
