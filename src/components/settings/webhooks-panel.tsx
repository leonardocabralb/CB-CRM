"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  Copy,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsChip } from "@/components/settings/settings-chip";
import { cn } from "@/lib/utils";
import { RESULTADOS_REPROCESSAVEIS } from "@/lib/webhooks-de-entrada/log";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events";

/**
 * Configurações → Webhooks (982). DUAS direções, duas abas:
 *
 *  - **Recebidos**: os webhooks de ENTRADA. O operador cria um com nome,
 *    copia a URL, cola no Typebot/n8n, e cada acionamento vira linha de um
 *    LOG — é por essa lista que "configurei e não aconteceu nada" tem
 *    resposta.
 *  - **Enviados**: os `webhook_endpoints` da 028, que existem desde o
 *    upstream e nunca tiveram tela (até aqui, só `curl` com chave de API).
 *
 * ⚠️ O log copia a forma do cartão do Calendly de propósito: `<table>` cru
 * com duas `<tr>` por linha (a linha e o detalhe) e `<dl>` dentro. Nada de
 * `Table`/`Collapsible` do shadcn — é o padrão da casa para log.
 */

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

interface WebhookRecebido {
  id: string;
  nome: string;
  token: string;
  sem_segredo: boolean;
  is_active: boolean;
  campo_telefone: string | null;
  campo_nome: string | null;
  campo_id: string | null;
  last_event_at: string | null;
  created_at: string;
  total: number;
  url: string | null;
}

interface EventoDoLog {
  id: string;
  nome: string | null;
  telefone: string | null;
  variaveis: Record<string, string>;
  contact_id: string | null;
  resultado: string;
  detalhe: string | null;
  recebido_em: string;
  processado_em: string | null;
}

interface EndpointDeSaida {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  last_delivery_at: string | null;
  failure_count: number;
  created_at: string;
}

// ------------------------------------------------------------
// Peças pequenas
// ------------------------------------------------------------

function quando(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** Cores por resultado, nas mesmas 4 faixas do log do Calendly. */
function corDoResultado(r: string): string {
  if (r === "disparado") return "text-emerald-600 dark:text-emerald-400";
  if (r === "falhou") return "text-destructive";
  if (r === "recebido" || r === "em_espera") return "text-muted-foreground";
  return "text-amber-600 dark:text-amber-400";
}

function CampoParaCopiar({ valor }: { valor: string }) {
  const t = useTranslations("Settings.webhooks");
  const [copiou, setCopiou] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input value={valor} readOnly className="font-mono text-xs" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(valor);
            setCopiou(true);
            setTimeout(() => setCopiou(false), 2000);
          } catch {
            toast.error(t("copiaFalhou"));
          }
        }}
      >
        <Copy className="size-3.5" />
        {copiou ? t("copiado") : t("copiar")}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------
// O log de um webhook
// ------------------------------------------------------------

function LogDoWebhook({ webhookId }: { webhookId: string }) {
  const t = useTranslations("Settings.webhooks");
  const [eventos, setEventos] = useState<EventoDoLog[]>([]);
  const [total, setTotal] = useState(0);
  const [contagem, setContagem] = useState<Record<string, number> | null>(null);
  const [pagina, setPagina] = useState(1);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [reprocessando, setReprocessando] = useState<string | null>(null);
  const [porPagina, setPorPagina] = useState(20);

  const carregar = useCallback(
    async (n: number) => {
      setCarregando(true);
      try {
        const res = await fetch(
          `/api/cb/webhooks/${webhookId}/eventos?pagina=${n}`
        );
        if (!res.ok) throw new Error("falhou");
        const corpo = (await res.json()) as {
          eventos: EventoDoLog[];
          total: number;
          porPagina: number;
          contagem: Record<string, number> | null;
        };
        setEventos(corpo.eventos);
        setTotal(corpo.total);
        setPorPagina(corpo.porPagina);
        if (corpo.contagem) setContagem(corpo.contagem);
      } catch {
        toast.error(t("logFalhou"));
      } finally {
        setCarregando(false);
      }
    },
    [webhookId, t]
  );

  useEffect(() => {
    void carregar(pagina);
  }, [carregar, pagina]);

  const reprocessar = async (eventoId: string) => {
    setReprocessando(eventoId);
    try {
      const res = await fetch(
        `/api/cb/webhooks/${webhookId}/eventos/${eventoId}/reprocessar`,
        { method: "POST" }
      );
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // "espere, está rodando" e "não insista, já rodou" são conselhos
        // diferentes, e a rota os distingue.
        toast.error(
          corpo.error === "ainda_processando"
            ? t("aindaProcessando")
            : corpo.error === "ja_processado"
              ? t("jaProcessado")
              : t("reprocessarFalhou")
        );
      } else {
        toast.success(t("reprocessado"));
      }
    } catch {
      toast.error(t("reprocessarFalhou"));
    } finally {
      setReprocessando(null);
      // A lista na tela é uma foto de antes do clique — recarrega sempre.
      void carregar(pagina);
    }
  };

  const paginas = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div className="mt-3 rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-foreground">
          {t("logTitulo", { n: total })}
        </span>
        {contagem ? (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {t("logResumo", {
              disparado: contagem.disparado ?? 0,
              semAutomacao: contagem.sem_automacao ?? 0,
              semTelefone: contagem.sem_telefone ?? 0,
              falhou: contagem.falhou ?? 0,
            })}
          </span>
        ) : null}
      </div>

      <div className="p-3">
        {total === 0 && !carregando ? (
          <p className="text-xs text-muted-foreground">{t("logVazio")}</p>
        ) : (
          <div className={cn("overflow-x-auto", carregando && "opacity-60")}>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-1 font-medium">{t("colQuando")}</th>
                  <th className="pb-1 font-medium">{t("colNome")}</th>
                  <th className="pb-1 font-medium">{t("colTelefone")}</th>
                  <th className="pb-1 font-medium">{t("colResultado")}</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e) => {
                  const abertoAqui = aberto === e.id;
                  const chaves = Object.keys(e.variaveis ?? {});
                  return (
                    <tr
                      key={e.id}
                      className="border-t border-border align-top"
                    >
                      <td colSpan={4} className="p-0">
                        <button
                          type="button"
                          onClick={() => setAberto(abertoAqui ? null : e.id)}
                          aria-expanded={abertoAqui}
                          className="grid w-full grid-cols-4 gap-2 py-1.5 text-left hover:bg-muted/40"
                        >
                          <span className="whitespace-nowrap">
                            {quando(e.recebido_em)}
                          </span>
                          <span
                            className="max-w-[12rem] truncate"
                            title={e.nome ?? ""}
                          >
                            {e.nome || "—"}
                          </span>
                          <span className="whitespace-nowrap">
                            {e.telefone || "—"}
                          </span>
                          <span
                            className={cn("font-medium", corDoResultado(e.resultado))}
                          >
                            {t(`resultado.${e.resultado}` as "resultado.disparado")}
                          </span>
                        </button>

                        {abertoAqui ? (
                          <div className="border-t border-border/60 bg-muted/30 p-3">
                            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
                              <dt className="text-muted-foreground">
                                {t("detDetalhe")}
                              </dt>
                              <dd>
                                {e.detalhe || "—"}
                                {e.processado_em
                                  ? ` · ${t("detProcessadoEm", { quando: quando(e.processado_em) })}`
                                  : ` · ${t("detNaoProcessado")}`}
                              </dd>

                              <dt className="text-muted-foreground">
                                {t("detVariaveis")}
                              </dt>
                              <dd>
                                {chaves.length === 0 ? (
                                  <span className="text-muted-foreground">
                                    {t("detSemVariaveis")}
                                  </span>
                                ) : (
                                  <ul className="space-y-0.5">
                                    {chaves.map((k) => (
                                      <li key={k} className="font-mono text-[11px]">
                                        <span className="text-muted-foreground">
                                          {`{{vars.${k}}}`}
                                        </span>{" "}
                                        {e.variaveis[k] || (
                                          <span className="text-muted-foreground">
                                            {t("detVazio")}
                                          </span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </dd>

                              {e.contact_id ? (
                                <>
                                  <dt className="text-muted-foreground">
                                    {t("detContato")}
                                  </dt>
                                  <dd>
                                    <a
                                      href={`/contacts?contact=${e.contact_id}`}
                                      className="underline"
                                    >
                                      {t("detAbrirContato")}
                                    </a>
                                  </dd>
                                </>
                              ) : null}
                            </dl>

                            {(RESULTADOS_REPROCESSAVEIS as readonly string[]).includes(
                              e.resultado
                            ) ? (
                              <div className="mt-2 flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={reprocessando !== null}
                                  onClick={() => void reprocessar(e.id)}
                                >
                                  <RefreshCw
                                    className={cn(
                                      "size-3.5",
                                      reprocessando === e.id && "animate-spin"
                                    )}
                                  />
                                  {reprocessando === e.id
                                    ? t("reprocessando")
                                    : t("reprocessar")}
                                </Button>
                                <span className="text-[11px] text-muted-foreground">
                                  {t("reprocessarAjuda")}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > porPagina ? (
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={carregando || pagina <= 1}
              onClick={() => setPagina((n) => Math.max(1, n - 1))}
            >
              {t("maisRecentes")}
            </Button>
            <span className="text-muted-foreground">
              {t("logPagina", { pagina, total: paginas })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={carregando || pagina * porPagina >= total}
              onClick={() => setPagina((n) => n + 1)}
            >
              {t("maisAntigos")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Aba "Recebidos"
// ------------------------------------------------------------

function AbaRecebidos() {
  const t = useTranslations("Settings.webhooks");
  const [webhooks, setWebhooks] = useState<WebhookRecebido[] | null>(null);
  const [origemAlcancavel, setOrigemAlcancavel] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [segredoNovo, setSegredoNovo] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [campoTelefone, setCampoTelefone] = useState("telefone");
  const [campoNome, setCampoNome] = useState("nome");
  const [campoId, setCampoId] = useState("");
  const [semSegredo, setSemSegredo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/cb/webhooks");
      if (!res.ok) throw new Error("falhou");
      const corpo = (await res.json()) as {
        webhooks: WebhookRecebido[];
        origemAlcancavel: boolean;
      };
      setWebhooks(corpo.webhooks);
      setOrigemAlcancavel(corpo.origemAlcancavel);
      setFalhou(false);
    } catch {
      setFalhou(true);
      setWebhooks([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const criar = async () => {
    if (!nome.trim()) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/cb/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          sem_segredo: semSegredo,
          campo_telefone: campoTelefone,
          campo_nome: campoNome,
          campo_id: campoId,
        }),
      });
      const corpo = (await res.json().catch(() => ({}))) as {
        error?: string;
        segredo?: string | null;
      };
      if (!res.ok) {
        toast.error(
          corpo.error === "nome_repetido" ? t("nomeRepetido") : t("criarFalhou")
        );
        return;
      }
      // O segredo só existe em claro AQUI. Some ao fechar o aviso.
      if (corpo.segredo) setSegredoNovo(corpo.segredo);
      setNome("");
      setCampoId("");
      setSemSegredo(false);
      setCriando(false);
      await carregar();
      toast.success(t("criado"));
    } catch {
      toast.error(t("criarFalhou"));
    } finally {
      setSalvando(false);
    }
  };

  const alternar = async (w: WebhookRecebido) => {
    try {
      const res = await fetch(`/api/cb/webhooks/${w.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !w.is_active }),
      });
      if (!res.ok) throw new Error("falhou");
      await carregar();
    } catch {
      toast.error(t("salvarFalhou"));
    }
  };

  const apagar = async (w: WebhookRecebido) => {
    // ⚠️ Apagar leva o LOG junto (a FK é CASCADE). O número vai na pergunta:
    // "apagar" e "apagar 340 registros de acionamento" são decisões
    // diferentes.
    if (!confirm(t("apagarConfirma", { nome: w.nome, n: w.total }))) return;
    try {
      const res = await fetch(`/api/cb/webhooks/${w.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("falhou");
      await carregar();
      toast.success(t("apagado"));
    } catch {
      toast.error(t("apagarFalhou"));
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("recebidosAjuda")}</p>

      {segredoNovo ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-xs font-medium text-foreground">
            {t("segredoTitulo")}
          </p>
          <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
            {t("segredoAviso")}
          </p>
          <CampoParaCopiar valor={segredoNovo} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setSegredoNovo(null)}
          >
            {t("segredoGuardei")}
          </Button>
        </div>
      ) : null}

      {!origemAlcancavel ? (
        <p className="text-xs text-destructive">{t("origemLocal")}</p>
      ) : null}

      {criando ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <Label className="text-xs">{t("campoNomeDoWebhook")}</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("campoNomePlaceholder")}
              maxLength={60}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">{t("campoTelefone")}</Label>
              <Input
                value={campoTelefone}
                onChange={(e) => setCampoTelefone(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">{t("campoNomeDoContato")}</Label>
              <Input
                value={campoNome}
                onChange={(e) => setCampoNome(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">{t("campoId")}</Label>
              <Input
                value={campoId}
                onChange={(e) => setCampoId(e.target.value)}
                placeholder={t("campoIdPlaceholder")}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("camposAjuda")}
          </p>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={semSegredo}
              onChange={(e) => setSemSegredo(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-foreground">
                {t("semSegredo")}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {t("semSegredoAjuda")}
              </span>
            </span>
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void criar()}
              disabled={salvando || !nome.trim()}
            >
              {salvando ? t("criando") : t("criar")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCriando(false)}
            >
              {t("cancelar")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" onClick={() => setCriando(true)}>
          <Plus className="size-3.5" />
          {t("novoWebhook")}
        </Button>
      )}

      {falhou ? (
        <p className="text-xs text-destructive">{t("listaFalhou")}</p>
      ) : null}

      {webhooks === null ? (
        <p className="text-xs text-muted-foreground">{t("carregando")}</p>
      ) : webhooks.length === 0 && !falhou ? (
        <p className="text-xs text-muted-foreground">{t("recebidosVazio")}</p>
      ) : (
        <div className="space-y-2">
          {webhooks.map((w) => {
            const abertoAqui = aberto === w.id;
            return (
              <div key={w.id} className="rounded-lg border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setAberto(abertoAqui ? null : w.id)}
                  aria-expanded={abertoAqui}
                  className="flex w-full items-center gap-3 p-3 text-left"
                >
                  <Webhook className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {w.nome}
                  </span>
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">
                    {w.last_event_at
                      ? t("ultimoAcionamento", { quando: quando(w.last_event_at) })
                      : t("nuncaAcionado")}
                  </span>
                  <SettingsChip variant={w.is_active ? "ok" : "muted"}>
                    {w.is_active ? t("ligado") : t("desligado")}
                  </SettingsChip>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      abertoAqui && "rotate-180"
                    )}
                  />
                </button>

                {abertoAqui ? (
                  <div className="space-y-3 border-t border-border p-3">
                    <div>
                      <Label className="text-xs">{t("urlLabel")}</Label>
                      {w.url ? (
                        <CampoParaCopiar valor={w.url} />
                      ) : (
                        <p className="text-xs text-destructive">
                          {t("origemLocal")}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {w.sem_segredo ? t("urlAjudaSemSegredo") : t("urlAjuda")}
                      </p>
                    </div>

                    {w.sem_segredo ? (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">
                        {t("semSegredoAviso")}
                      </p>
                    ) : null}

                    <dl className="grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-[max-content_1fr]">
                      <dt className="text-muted-foreground">
                        {t("campoTelefone")}
                      </dt>
                      <dd className="font-mono">{w.campo_telefone || "—"}</dd>
                      <dt className="text-muted-foreground">
                        {t("campoNomeDoContato")}
                      </dt>
                      <dd className="font-mono">{w.campo_nome || "—"}</dd>
                      <dt className="text-muted-foreground">{t("campoId")}</dt>
                      <dd className="font-mono">{w.campo_id || "—"}</dd>
                    </dl>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void alternar(w)}
                      >
                        {w.is_active ? t("desligar") : t("ligar")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void apagar(w)}
                      >
                        <Trash2 className="size-3.5" />
                        {t("apagar")}
                      </Button>
                    </div>

                    <LogDoWebhook webhookId={w.id} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Aba "Enviados"
// ------------------------------------------------------------

function AbaEnviados() {
  const t = useTranslations("Settings.webhooks");
  const [endpoints, setEndpoints] = useState<EndpointDeSaida[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [url, setUrl] = useState("");
  const [eventos, setEventos] = useState<string[]>([...WEBHOOK_EVENTS]);
  const [segredoNovo, setSegredoNovo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/cb/webhooks-de-saida");
      if (!res.ok) throw new Error("falhou");
      const corpo = (await res.json()) as { endpoints: EndpointDeSaida[] };
      setEndpoints(corpo.endpoints);
      setFalhou(false);
    } catch {
      setFalhou(true);
      setEndpoints([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const criar = async () => {
    setSalvando(true);
    try {
      const res = await fetch("/api/cb/webhooks-de-saida", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, events: eventos }),
      });
      const corpo = (await res.json().catch(() => ({}))) as {
        error?: string;
        segredo?: string;
      };
      if (!res.ok) {
        toast.error(
          corpo.error === "url_invalida"
            ? t("urlInvalida")
            : corpo.error === "eventos_invalidos"
              ? t("eventosInvalidos")
              : t("criarFalhou")
        );
        return;
      }
      if (corpo.segredo) setSegredoNovo(corpo.segredo);
      setUrl("");
      setCriando(false);
      await carregar();
      toast.success(t("criado"));
    } catch {
      toast.error(t("criarFalhou"));
    } finally {
      setSalvando(false);
    }
  };

  const alternar = async (e: EndpointDeSaida) => {
    try {
      const res = await fetch(`/api/cb/webhooks-de-saida/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !e.is_active }),
      });
      if (!res.ok) throw new Error("falhou");
      await carregar();
    } catch {
      toast.error(t("salvarFalhou"));
    }
  };

  const apagar = async (e: EndpointDeSaida) => {
    if (!confirm(t("apagarEndpointConfirma", { url: e.url }))) return;
    try {
      const res = await fetch(`/api/cb/webhooks-de-saida/${e.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("falhou");
      await carregar();
      toast.success(t("apagado"));
    } catch {
      toast.error(t("apagarFalhou"));
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("enviadosAjuda")}</p>
      {/* ⚠️ As duas limitações precisam estar na TELA: a entrega é
          best-effort (uma tentativa, 5s, sem retry) e o vocabulário tem três
          eventos. Sem isso o operador conta com garantia que não existe. */}
      <p className="text-[11px] text-muted-foreground">{t("enviadosLimites")}</p>

      {segredoNovo ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-xs font-medium text-foreground">
            {t("segredoTitulo")}
          </p>
          <p className="mb-2 mt-1 text-[11px] text-muted-foreground">
            {t("segredoAvisoSaida")}
          </p>
          <CampoParaCopiar valor={segredoNovo} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setSegredoNovo(null)}
          >
            {t("segredoGuardei")}
          </Button>
        </div>
      ) : null}

      {criando ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div>
            <Label className="text-xs">{t("urlDeDestino")}</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="font-mono text-xs"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("urlDeDestinoAjuda")}
            </p>
          </div>
          <div>
            <Label className="text-xs">{t("eventos")}</Label>
            <div className="mt-1 space-y-1">
              {WEBHOOK_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={eventos.includes(ev)}
                    onChange={(e) =>
                      setEventos((atual) =>
                        e.target.checked
                          ? [...atual, ev]
                          : atual.filter((x) => x !== ev)
                      )
                    }
                  />
                  <span className="font-mono">{ev}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void criar()}
              disabled={salvando || !url.trim() || eventos.length === 0}
            >
              {salvando ? t("criando") : t("criar")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCriando(false)}
            >
              {t("cancelar")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" onClick={() => setCriando(true)}>
          <Plus className="size-3.5" />
          {t("novoEndpoint")}
        </Button>
      )}

      {falhou ? (
        <p className="text-xs text-destructive">{t("listaFalhou")}</p>
      ) : null}

      {endpoints === null ? (
        <p className="text-xs text-muted-foreground">{t("carregando")}</p>
      ) : endpoints.length === 0 && !falhou ? (
        <p className="text-xs text-muted-foreground">{t("enviadosVazio")}</p>
      ) : (
        <div className="space-y-2">
          {endpoints.map((e) => (
            <div
              key={e.id}
              className="space-y-2 rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {e.url}
                </span>
                <SettingsChip
                  variant={e.is_active ? "ok" : e.failure_count > 0 ? "err" : "muted"}
                >
                  {e.is_active ? t("ligado") : t("desligado")}
                </SettingsChip>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {e.events.join(" · ")}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("ultimaEntrega", { quando: quando(e.last_delivery_at) })}
                {e.failure_count > 0
                  ? ` · ${t("falhasSeguidas", { n: e.failure_count })}`
                  : ""}
              </p>
              {!e.is_active && e.failure_count > 0 ? (
                <p className="text-[11px] text-destructive">
                  {t("desativadoPorFalhas")}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void alternar(e)}
                >
                  {e.is_active ? t("desligar") : t("religar")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void apagar(e)}
                >
                  <Trash2 className="size-3.5" />
                  {t("apagar")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// A seção
// ------------------------------------------------------------

export function WebhooksPanel() {
  const t = useTranslations("Settings.webhooks");
  const [aba, setAba] = useState<"recebidos" | "enviados">("recebidos");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("titulo")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("descricao")}</p>
      </div>

      <div className="flex gap-4 border-b border-border">
        {(["recebidos", "enviados"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            aria-current={aba === id}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2 text-sm",
              aba === id
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {id === "recebidos" ? t("abaRecebidos") : t("abaEnviados")}
          </button>
        ))}
      </div>

      {aba === "recebidos" ? <AbaRecebidos /> : <AbaEnviados />}
    </div>
  );
}
