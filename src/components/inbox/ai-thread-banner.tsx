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
 * Um clique na faixa que o realtime ainda não confirmou. `base` é o que o
 * banco dizia NO CLIQUE; `pausada` é o que o clique pediu — `null` enquanto a
 * rota não respondeu (a tela mostra o banco).
 */
export interface CliqueOtimista {
  conversa: string;
  base: boolean;
  pausada: boolean | null;
}

/**
 * O clique ainda vale? Só na conversa em que foi dado e enquanto o banco
 * disser o que dizia no clique. ⚠️ Deixou de valer, é DESCARTADO de vez (o
 * componente o apaga no render): o banco que saiu do `base` — o realtime
 * confirmando, o gatilho da 1049 pausando porque o advogado respondeu, outra
 * aba retomando — e depois VOLTA ao mesmo valor é o banco mandando, nunca o
 * clique velho. Comparar só o valor, sem descartar, fazia o clique voltar a
 * mandar na tela nesse A→B→A: "respondendo automaticamente" numa conversa
 * pausada, até recarregar. Trocar de conversa também descarta: a faixa não
 * remonta, e ao voltar o banco daquela conversa pode ter andado e voltado.
 */
export function cliqueAindaVale(
  clique: CliqueOtimista,
  conversationId: string,
  disabled: boolean,
): boolean {
  return clique.conversa === conversationId && clique.base === disabled;
}

/**
 * A pausa que a tela mostra: a do banco, salvo um clique que a rota aceitou e
 * que ainda vale. Derivada no render, nunca guardada por efeito — o efeito
 * passivo mostraria, por um quadro, a pausa da conversa anterior.
 */
export function pausadaNaTela(
  clique: CliqueOtimista | null,
  conversationId: string,
  disabled: boolean,
): boolean {
  if (
    clique &&
    clique.pausada !== null &&
    cliqueAindaVale(clique, conversationId, disabled)
  ) {
    return clique.pausada;
  }
  return disabled;
}

interface AiThreadBannerProps {
  conversationId: string;
  /**
   * `conversations.ia_agente_id` (1049) — o agente de IA ATIVO. É ele que
   * acende a faixa: sem agente, a IA não responde nesta conversa (a entrada
   * da conexão, quando atende, grava o agente antes de responder).
   */
  iaAgenteId: string | null;
  /** `conversations.ai_autoreply_disabled` — a IA pausada nesta conversa. */
  disabled: boolean;
  /** `conversations.ia_pausada_por` (1049) — por que pausou (`gente` |
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
  const [clique, setClique] = useState<CliqueOtimista | null>(null);
  // Descartado DURANTE o render (o padrão "derived state" do react.dev, como
  // no `media-viewer.tsx`), nunca num efeito: o React Compiler recusa setState
  // síncrono em efeito, e o efeito passivo pintaria um quadro com o clique
  // velho. Este render já mostra o banco (`pausadaNaTela` ignora o clique que
  // não vale), e o React o refaz com `null` antes de pintar.
  // ⚠️ O lint do compiler NÃO analisa este componente: o `finally` do `toggle`
  // o faz desistir em silêncio (medido: nem o setState em efeito é acusado
  // aqui). Lint verde neste arquivo não prova nada — quem prova é o teste da
  // sequência de renders.
  if (clique && !cliqueAindaVale(clique, conversationId, disabled)) {
    setClique(null);
  }
  const paused = pausadaNaTela(clique, conversationId, disabled);

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
      // A marca nasce no CLIQUE, com o banco de agora, e não na resposta: se
      // o banco andar enquanto a rota responde (o realtime chega antes do
      // HTTP, e o advogado pode responder no meio), o render a descarta, e a
      // resposta não instala nada. Quem confere é a IDENTIDADE da marca.
      const marca: CliqueOtimista = {
        conversa: conversationId,
        base: disabled,
        pausada: null,
      };
      const soltar = (c: CliqueOtimista | null) => (c === marca ? null : c);
      setClique(marca);
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // "Assumir" também atribui a conversa a quem clicou.
          body: JSON.stringify({ paused: pausar, assign_to_me: pausar }),
        });
        if (!res.ok) {
          setClique(soltar);
          const j = await res.json().catch(() => ({}));
          toast.error(textoDoErro(erroDaResposta(res.status, j?.code)));
          return;
        }
        setClique((c) => (c === marca ? { ...marca, pausada: pausar } : c));
        onChange?.(patchDoClique(pausar, currentUserId));
        toast.success(pausar ? t("tookOver") : t("resumed"));
      } catch {
        setClique(soltar);
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
