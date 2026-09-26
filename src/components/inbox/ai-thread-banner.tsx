"use client";

import { useEffect, useState } from "react";
import { Sparkles, Pause, Undo2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

// ============================================================
// ⚠️⚠️ NOSSO (agentes de IA, D24–D26 do docs/PLANO-agentes-de-ia.md). A faixa
// diz QUEM responde nesta conversa e se a IA está pausada — e quem responde é
// o agente da ETAPA do card (D24), que a conversa não guarda. Por isso ela
// pergunta à rota `GET /api/cb/ia/conversa/[id]`, e as colunas da conversa
// que o realtime traz (pausa, motivo, último agente) servem só de GATILHO
// para perguntar de novo.
//
// No upstream ela lia a configuração LEGADA (`/api/ai/config`) e se escondia
// com responsável humano: as duas coisas mentem desde os agentes — o
// auto-reply legado saiu (E2), e o responsável não cala o agente. Um merge
// que traga a faixa crua devolve as duas mentiras sem conflito nenhum.
//
//   - atendendo → "IA · <nome> responde nesta conversa" + [Pausar]
//   - pausada   → "IA pausada — <motivo>" + [Retomar IA] (D26: só este botão
//                 retoma; mudar o card de etapa não)
//   - nada      → não desenha
//
// Pausar e Retomar vão pela rota `POST /api/ai/autoreply/[id]`, que NÃO mexe
// no responsável humano.
// ============================================================

export const MOTIVOS_DA_PAUSA = ["gente", "botao", "transferencia", "automacao"] as const;
export type MotivoDaPausa = (typeof MOTIVOS_DA_PAUSA)[number];

/** O que a rota da conversa responde (o que a faixa usa). */
export interface EstadoDaIa {
  agente: { id: string; nome: string } | null;
  pausada: boolean;
  pausadaPor: string | null;
}

/** Corpo da rota → estado. Parse campo a campo; forma estranha = `null` (a faixa some). */
export function lerEstadoDaIa(corpo: unknown): EstadoDaIa | null {
  if (!corpo || typeof corpo !== "object") return null;
  const c = corpo as Record<string, unknown>;
  const a = c.agente as Record<string, unknown> | null | undefined;
  const agente =
    a && typeof a === "object" && typeof a.id === "string" && typeof a.nome === "string"
      ? { id: a.id, nome: a.nome }
      : null;
  return {
    agente,
    pausada: c.pausada === true,
    pausadaPor: typeof c.pausadaPor === "string" ? c.pausadaPor : null,
  };
}

export type Faixa =
  | { tipo: "atendendo"; agente: string }
  | { tipo: "pausada"; motivo: MotivoDaPausa | null }
  | null;

/**
 * O que a faixa desenha. Pausada só aparece onde há agente — o da etapa, ou
 * o último que respondeu (`iaAgenteIdDaConversa`): a pausa antiga do
 * assistente anterior, numa conversa que nenhum agente atende, seria um
 * "Retomar" que não retoma nada.
 */
export function faixaDaIa(estado: EstadoDaIa | null, iaAgenteIdDaConversa: string | null): Faixa {
  if (!estado) return null;
  if (estado.pausada) {
    if (!estado.agente && !iaAgenteIdDaConversa) return null;
    const motivo = (MOTIVOS_DA_PAUSA as readonly string[]).includes(estado.pausadaPor ?? "")
      ? (estado.pausadaPor as MotivoDaPausa)
      : null;
    return { tipo: "pausada", motivo };
  }
  return estado.agente ? { tipo: "atendendo", agente: estado.agente.nome } : null;
}

/** Qual frase do dicionário explica a recusa da rota. Nunca o `error` cru (inglês). */
export type ErroDaFaixa =
  | "grupo"
  | "instagram"
  | "nadaGravado"
  | "naoEncontrada"
  | "semPermissao"
  | "muitasTentativas"
  | "generico";

export function erroDaResposta(status: number, code: unknown): ErroDaFaixa {
  if (code === "grupo") return "grupo";
  if (code === "instagram") return "instagram";
  if (code === "nada_gravado") return "nadaGravado";
  if (status === 404) return "naoEncontrada";
  if (status === 403) return "semPermissao";
  if (status === 429) return "muitasTentativas";
  return "generico";
}

interface AiThreadBannerProps {
  conversationId: string;
  /** `conversations.ia_agente_id` — o ÚLTIMO agente que respondeu aqui. */
  iaAgenteId: string | null;
  /** `conversations.ai_autoreply_disabled` — a IA pausada nesta conversa. */
  disabled: boolean;
  /** `conversations.ia_pausada_por` — por que pausou. */
  pausadaPor?: string | null;
}

export function AiThreadBanner({ conversationId, iaAgenteId, disabled, pausadaPor }: AiThreadBannerProps) {
  const t = useTranslations("Inbox.aiBanner");
  // O estado carrega DE QUAL conversa é: a faixa não remonta ao trocar de
  // conversa, e o da anterior não pode aparecer nem por um quadro.
  const [lido, setLido] = useState<{ conversa: string; estado: EstadoDaIa | null } | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [busy, setBusy] = useState(false);

  // Pergunta de novo sempre que o realtime muda a pausa, o motivo ou o
  // último agente — e depois de cada clique. A resposta de um pedido velho
  // é descartada (`vivo`).
  useEffect(() => {
    let vivo = true;
    void (async () => {
      let estado: EstadoDaIa | null = null;
      try {
        const res = await fetch(`/api/cb/ia/conversa/${conversationId}`, { cache: "no-store" });
        if (res.ok) estado = lerEstadoDaIa(await res.json());
      } catch {
        estado = null;
      }
      if (vivo) setLido({ conversa: conversationId, estado });
    })();
    return () => {
      vivo = false;
    };
  }, [conversationId, disabled, pausadaPor, iaAgenteId, recarga]);

  async function alternar(pausar: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: pausar }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(textoDoErro(t, erroDaResposta(res.status, j?.code)));
        return;
      }
      toast.success(pausar ? t("pausou") : t("resumed"));
    } catch {
      toast.error(t("networkError"));
    } finally {
      setBusy(false);
      setRecarga((n) => n + 1);
    }
  }

  const estado = lido?.conversa === conversationId ? lido.estado : null;
  return (
    <FaixaDaIa
      faixa={faixaDaIa(estado, iaAgenteId)}
      busy={busy}
      aoPausar={() => void alternar(true)}
      aoRetomar={() => void alternar(false)}
    />
  );
}

// As chaves são LITERAIS (nunca montadas) onde dá: o portão de i18n do CI só
// confere chave escrita por extenso. O motivo é montado, e o teste o cobra.
function textoDoErro(t: ReturnType<typeof useTranslations>, erro: ErroDaFaixa): string {
  switch (erro) {
    case "grupo":
      return t("erroGrupo");
    case "instagram":
      return t("erroInstagram");
    case "nadaGravado":
      return t("erroNadaGravado");
    case "naoEncontrada":
      return t("erroNaoEncontrada");
    case "semPermissao":
      return t("erroSemPermissao");
    case "muitasTentativas":
      return t("erroMuitasTentativas");
    case "generico":
      return t("updateError");
  }
}

/** A faixa desenhada (sem dado nem efeito) — o que os testes renderizam. */
export function FaixaDaIa({
  faixa,
  busy,
  aoPausar,
  aoRetomar,
}: {
  faixa: Faixa;
  busy: boolean;
  aoPausar: () => void;
  aoRetomar: () => void;
}) {
  const t = useTranslations("Inbox.aiBanner");
  if (!faixa) return null;

  if (faixa.tipo === "pausada") {
    return (
      <Banner tone="muted">
        <p className="min-w-0 flex-1 truncate font-medium text-foreground">
          {faixa.motivo ? t("pausadaComMotivo", { motivo: t(`motivo.${faixa.motivo}`) }) : t("pausada")}
        </p>
        <BannerButton onClick={aoRetomar} busy={busy} icon={Undo2} title={t("retomarDica")}>
          {t("resume")}
        </BannerButton>
      </Banner>
    );
  }

  return (
    <Banner tone="primary">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
        <span className="truncate font-medium text-foreground">{t("atendendo", { agente: faixa.agente })}</span>
      </div>
      <BannerButton onClick={aoPausar} busy={busy} icon={Pause}>
        {t("pausar")}
      </BannerButton>
    </Banner>
  );
}

function Banner({ tone, children }: { tone: "primary" | "muted"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-3 py-2 text-xs sm:px-4",
        tone === "primary" ? "border-primary/20 bg-primary/5" : "border-border bg-muted/40",
      )}
    >
      {children}
    </div>
  );
}

function BannerButton({
  onClick,
  busy,
  icon: Icon,
  title,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Pause;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {children}
    </button>
  );
}
