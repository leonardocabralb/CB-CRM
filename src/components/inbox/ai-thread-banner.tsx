"use client";

import { useState, useCallback } from "react";
import { Sparkles, Hand, Undo2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

// ============================================================
// ⚠️⚠️ NOSSO (F2a dos agentes de IA, docs/PLANO-agentes-de-ia.md, 5.3/5.4/5.9
// e E2/E13). A faixa lê a CONVERSA, nunca a configuração da conta.
//
// No upstream ela perguntava ao `/api/ai/config` se o auto-reply estava ligado
// (`is_active && auto_reply_enabled`, com cache por conta) e se escondia quando
// havia responsável humano, porque a atribuição era o portão do robô. As duas
// coisas mentem desde a F2: o auto-reply legado saiu (E2) — com as flags
// ligadas a faixa diria "respondendo" onde ninguém responde, e desligadas
// esconderia um agente que responde —, e o responsável humano NÃO cala o
// agente ativo (5.3, regra 4). Um merge que traga a faixa crua devolve as duas
// mentiras sem conflito nenhum.
//
// E "Retomar" NÃO solta mais o responsável: a rota deixou de zerar
// `assigned_agent_id` (E13, `src/app/api/ai/autoreply/[conversationId]/route.ts`),
// e zerar aqui, na tela, tiraria a conversa da fila de quem a atende até o
// realtime corrigir — ou para sempre, se o realtime cair.
// ============================================================

/**
 * O que a tela escreve na conversa depois de um clique que DEU CERTO.
 * "Assumir" pausa e atribui a quem clicou (a rota faz o mesmo com
 * `assign_to_me`); "Retomar" só tira a pausa — nunca menciona o responsável.
 */
export function patchDoClique(
  pausar: boolean,
  currentUserId: string | null | undefined,
): { ai_autoreply_disabled: boolean; assigned_agent_id?: string } {
  if (!pausar) return { ai_autoreply_disabled: false };
  return currentUserId
    ? { ai_autoreply_disabled: true, assigned_agent_id: currentUserId }
    : { ai_autoreply_disabled: true };
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

/**
 * A pausa que a tela mostra: a do banco, salvo um clique ainda não confirmado
 * pelo realtime NESTA conversa. Derivada no render, nunca guardada por efeito
 * — o efeito passivo mostraria, por um quadro, a pausa da conversa anterior.
 * O clique vale enquanto o banco continuar dizendo o que dizia quando ele foi
 * dado (`base`); qualquer mudança no banco (o realtime confirmando, ou o
 * gatilho da 1044 pausando porque alguém respondeu) passa a mandar.
 */
export interface CliqueOtimista {
  conversa: string;
  base: boolean;
  pausada: boolean;
}

export function pausadaNaTela(
  otimista: CliqueOtimista | null,
  conversationId: string,
  disabled: boolean,
): boolean {
  if (otimista && otimista.conversa === conversationId && otimista.base === disabled) {
    return otimista.pausada;
  }
  return disabled;
}

interface AiThreadBannerProps {
  conversationId: string;
  /**
   * `conversations.ia_agente_id` (1044) — o agente de IA ATIVO. É ele que
   * acende a faixa: sem agente, a IA não responde nesta conversa (a entrada
   * da conexão, quando atende, grava o agente antes de responder).
   */
  iaAgenteId: string | null;
  /** `conversations.ai_autoreply_disabled` — a IA pausada nesta conversa. */
  disabled: boolean;
  /** `conversations.ia_pausada_por` (1044) — por que pausou (`gente` |
   *  `transferencia` | `botao` | `automacao`; nulo = pausa anterior ao motivo). */
  pausadaPor?: string | null;
  /** `conversations.ai_handoff_summary` — nota do auto-reply anterior. */
  handoffSummary?: string | null;
  /** Quem clica — "Assumir" atribui a conversa a essa pessoa. */
  currentUserId?: string | null;
  /** Chamado depois de um clique que deu certo, para a página remendar o
   *  estado local (o UPDATE do realtime também chega). */
  onChange?: (patch: {
    ai_autoreply_disabled: boolean;
    assigned_agent_id?: string | null;
  }) => void;
}

/**
 * Faixa do fio com o agente de IA da conversa:
 *   - agente ativo, sem pausa → "respondendo automaticamente" + [Assumir]
 *   - agente ativo, pausado   → a pausa, com o motivo, + [Retomar IA]
 * Sem agente ativo, não desenha nada.
 */
export function AiThreadBanner({
  conversationId,
  iaAgenteId,
  disabled,
  pausadaPor,
  handoffSummary,
  currentUserId,
  onChange,
}: AiThreadBannerProps) {
  const t = useTranslations("Inbox.aiBanner");
  const [busy, setBusy] = useState(false);
  const [otimista, setOtimista] = useState<CliqueOtimista | null>(null);
  const paused = pausadaNaTela(otimista, conversationId, disabled);

  // As chaves são LITERAIS (nunca montadas): o portão de i18n do CI só
  // confere chave escrita por extenso.
  const textoDoErro = useCallback(
    (erro: ErroDaFaixa): string => {
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
    },
    [t],
  );

  const toggle = useCallback(
    async (pausar: boolean) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // "Assumir" também atribui a conversa a quem clicou.
          body: JSON.stringify({ paused: pausar, assign_to_me: pausar }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(textoDoErro(erroDaResposta(res.status, j?.code)));
          return;
        }
        setOtimista({ conversa: conversationId, base: disabled, pausada: pausar });
        onChange?.(patchDoClique(pausar, currentUserId));
        toast.success(pausar ? t("tookOver") : t("resumed"));
      } catch {
        toast.error(t("networkError"));
      } finally {
        setBusy(false);
      }
    },
    [conversationId, currentUserId, disabled, onChange, t, textoDoErro],
  );

  if (!iaAgenteId) return null;

  if (paused) {
    const motivo =
      pausadaPor === "gente"
        ? t("pausadaPorGente")
        : pausadaPor === "transferencia"
          ? t("pausadaPorTransferencia")
          : pausadaPor === "botao"
            ? t("pausadaPeloBotao")
            : pausadaPor === "automacao"
              ? t("pausadaPorAutomacao")
              : null;
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{t("pausedTitle")}</p>
          {motivo && <p className="text-muted-foreground">{motivo}</p>}
          {handoffSummary && (
            <p className="truncate text-muted-foreground" title={handoffSummary}>
              {handoffSummary}
            </p>
          )}
        </div>
        <BannerButton onClick={() => toggle(false)} busy={busy} icon={Undo2}>
          {t("resume")}
        </BannerButton>
      </Banner>
    );
  }

  return (
    <Banner tone="primary">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
        <span className="truncate font-medium text-foreground">
          {t("activeText")}
        </span>
      </div>
      <BannerButton onClick={() => toggle(true)} busy={busy} icon={Hand}>
        {t("takeOver")}
      </BannerButton>
    </Banner>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "primary" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-3 py-2 text-xs sm:px-4",
        tone === "primary"
          ? "border-primary/20 bg-primary/5"
          : "border-border bg-muted/40",
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
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Hand;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {children}
    </button>
  );
}
