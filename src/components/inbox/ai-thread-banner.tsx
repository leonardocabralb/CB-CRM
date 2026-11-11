"use client";

import { useEffect, useState } from "react";
import { Sparkles, Pause, Undo2, Loader2, CircleSlash } from "lucide-react";
import { cn } from "@/lib/utils";
import { EVENTO_EXECUCOES } from "@/lib/execucoes/aviso";
import { MOTIVOS_DA_PAUSA, type MotivoDaPausa } from "@/lib/ia-agentes/pausa";
import {
  MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE,
  type MotivoDoAgenteQueNaoAtende,
} from "@/lib/ia-agentes/quem-responde";
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
//   - atendendo → "IA · <nome> responde nesta conversa" + [Pausar] +
//                 [Desativar IA] (1138: o Pausar é TEMPORÁRIO — a IA volta se
//                 a cliente esperar N min sem resposta da equipe; o Desativar
//                 fica até o Retomar). Com N = 0 na conta, só o [Pausar], que
//                 então é permanente (como antes).
//   - pausada   → "IA pausada — <motivo>" + [Retomar IA]; a TEMPORÁRIA
//                 (`gente`/`botao` com N > 0) diz quando volta ("volta às
//                 14:32 se ninguém responder", com mensagem esperando) e
//                 oferece também [Desativar IA]. Mudar o card de etapa não
//                 retoma (D26, mantida em 11/11/2026).
//   - não atende → "IA · <nome> não atende esta conversa: <motivo>", discreta,
//                 sem botão: a etapa do card TEM agente, mas ele está
//                 desligado, sem a conexão ou o card é antigo (D27; nunca
//                 sugere mover o card e voltar: as automações das etapas
//                 rodariam de novo). Sem ela, o card que já estava na
//                 etapa quando o agente foi religado ficava em silêncio sem
//                 rastro (medido, validação de 25/10/2026). Também vai como
//                 segunda linha da pausada: retomar não faria ele atender.
//   - nada      → não desenha
//
// Pausar, Desativar e Retomar vão pela rota `POST /api/ai/autoreply/[id]`,
// que NÃO mexe no responsável humano.
// ============================================================

// A lista dos motivos é a do motor (1138): o motivo é chave MONTADA
// (`Inbox.aiBanner.motivo.<m>`), cobrada nos dois dicionários pelo teste.
export { MOTIVOS_DA_PAUSA, type MotivoDaPausa };

/** O agente da etapa que não atende esta conversa, e por quê (`naoAtende` da rota). */
export interface NaoAtende {
  agente: { id: string; nome: string };
  motivo: MotivoDoAgenteQueNaoAtende;
}

/** O que a rota da conversa responde (o que a faixa usa). */
export interface EstadoDaIa {
  agente: { id: string; nome: string } | null;
  pausada: boolean;
  pausadaPor: string | null;
  /** A pausa VOLTA sozinha (1138). */
  pausaTemporaria: boolean;
  /** O N da conta (0 = desligado); nulo = servidor antigo (a faixa de antes). */
  voltaAposMin: number | null;
  /** Quando o turno que espera a equipe vai rodar. */
  voltaEm: string | null;
  naoAtende: NaoAtende | null;
}

function lerAgente(v: unknown): { id: string; nome: string } | null {
  const a = v as Record<string, unknown> | null | undefined;
  return a && typeof a === "object" && typeof a.id === "string" && typeof a.nome === "string"
    ? { id: a.id, nome: a.nome }
    : null;
}

/** `naoAtende` da rota; motivo fora da lista (servidor mais novo) = nulo, nunca chave crua. */
function lerNaoAtende(v: unknown): NaoAtende | null {
  if (!v || typeof v !== "object") return null;
  const n = v as Record<string, unknown>;
  const agente = lerAgente(n.agente);
  const motivo = (MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE as readonly unknown[]).includes(n.motivo)
    ? (n.motivo as MotivoDoAgenteQueNaoAtende)
    : null;
  return agente && motivo ? { agente, motivo } : null;
}

/** Corpo da rota → estado. Parse campo a campo; forma estranha = `null` (a faixa some). */
export function lerEstadoDaIa(corpo: unknown): EstadoDaIa | null {
  if (!corpo || typeof corpo !== "object") return null;
  const c = corpo as Record<string, unknown>;
  const minutos = c.voltaAposMin;
  return {
    agente: lerAgente(c.agente),
    pausada: c.pausada === true,
    pausadaPor: typeof c.pausadaPor === "string" ? c.pausadaPor : null,
    pausaTemporaria: c.pausaTemporaria === true,
    voltaAposMin: typeof minutos === "number" && Number.isInteger(minutos) && minutos >= 0 ? minutos : null,
    voltaEm: typeof c.voltaEm === "string" && Number.isFinite(Date.parse(c.voltaEm)) ? c.voltaEm : null,
    naoAtende: lerNaoAtende(c.naoAtende),
  };
}

/** A linha "não atende": o nome do agente e o motivo. */
export type LinhaNaoAtende = { agente: string; motivo: MotivoDoAgenteQueNaoAtende };

/** A pausa que VOLTA sozinha (1138): o N da conta e, com mensagem esperando, quando. */
export type VoltaDaPausa = { minutos: number; em: string | null };

export type Faixa =
  /** `minutos`: o N da conta — > 0 = o Pausar é temporário e o Desativar aparece; 0 ou nulo, a faixa de antes. */
  | { tipo: "atendendo"; agente: string; minutos: number | null }
  | { tipo: "pausada"; motivo: MotivoDaPausa | null; naoAtende: LinhaNaoAtende | null; volta: VoltaDaPausa | null }
  | ({ tipo: "naoAtende" } & LinhaNaoAtende)
  | null;

/**
 * O que a faixa desenha. Pausada só aparece onde há agente — o da etapa, ou
 * o último que respondeu (`iaAgenteIdDaConversa`): a pausa antiga do
 * assistente anterior, numa conversa que nenhum agente atende, seria um
 * "Retomar" que não retoma nada. "Não atende" entra só onde, antes, não se
 * desenhava NADA (e como segunda linha da pausada): os estados de atender e
 * de pausa ficam como eram.
 */
export function faixaDaIa(estado: EstadoDaIa | null, iaAgenteIdDaConversa: string | null): Faixa {
  if (!estado) return null;
  const naoAtende = estado.naoAtende
    ? { agente: estado.naoAtende.agente.nome, motivo: estado.naoAtende.motivo }
    : null;
  if (estado.pausada && (estado.agente || iaAgenteIdDaConversa)) {
    const motivo = (MOTIVOS_DA_PAUSA as readonly string[]).includes(estado.pausadaPor ?? "")
      ? (estado.pausadaPor as MotivoDaPausa)
      : null;
    // Temporária só com o N conhecido e > 0: na dúvida, a faixa de antes
    // (nunca "volta sozinha" sobre uma pausa que não volta).
    const volta =
      estado.pausaTemporaria && estado.voltaAposMin !== null && estado.voltaAposMin > 0
        ? { minutos: estado.voltaAposMin, em: estado.voltaEm }
        : null;
    return { tipo: "pausada", motivo, naoAtende, volta };
  }
  // Daqui para baixo, agente da etapa só sem pausa (pausada com ele já saiu acima).
  if (estado.agente) return { tipo: "atendendo", agente: estado.agente.nome, minutos: estado.voltaAposMin };
  return naoAtende ? { tipo: "naoAtende", ...naoAtende } : null;
}

/** O que cada botão manda à rota. */
export type AcaoDaFaixa = "pausar" | "desativar" | "retomar";

export function corpoDaAcao(acao: AcaoDaFaixa): { paused: boolean; permanente?: boolean } {
  switch (acao) {
    case "pausar":
      return { paused: true };
    case "desativar":
      return { paused: true, permanente: true };
    case "retomar":
      return { paused: false };
  }
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
  /**
   * `conversations.ia_pausada_em` — recarimbado quando a equipe responde na
   * pausa temporária (1138): a faixa pergunta de novo, senão continuaria
   * dizendo "volta às …" sobre o retorno que a resposta descartou.
   */
  pausadaEm?: string | null;
}

export function AiThreadBanner({ conversationId, iaAgenteId, disabled, pausadaPor, pausadaEm }: AiThreadBannerProps) {
  const t = useTranslations("Inbox.aiBanner");
  // O estado carrega DE QUAL conversa é: a faixa não remonta ao trocar de
  // conversa, e o da anterior não pode aparecer nem por um quadro.
  const [lido, setLido] = useState<{ conversa: string; estado: EstadoDaIa | null; em: number } | null>(null);
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
      // `em`: quando a rota respondeu — a hora da volta diz o dia quando não é hoje.
      if (vivo) setLido({ conversa: conversationId, estado, em: Date.now() });
    })();
    return () => {
      vivo = false;
    };
  }, [conversationId, disabled, pausadaPor, pausadaEm, iaAgenteId, recarga]);

  // Quem responde depende da ETAPA do card, e mover o card só muda `deals`:
  // nenhuma das props acima muda. O aviso das execuções sai quando uma tela
  // move o card (painel, formulário, quadro — `avisarDrenagemDeFunil`) e
  // quando chega mensagem do cliente na conversa aberta (Codex, #309).
  useEffect(() => {
    const aoMudar = () => setRecarga((n) => n + 1);
    window.addEventListener(EVENTO_EXECUCOES, aoMudar);
    return () => window.removeEventListener(EVENTO_EXECUCOES, aoMudar);
  }, []);

  async function alternar(acao: AcaoDaFaixa) {
    setBusy(true);
    try {
      const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpoDaAcao(acao)),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(textoDoErro(t, erroDaResposta(res.status, j?.code)));
        return;
      }
      toast.success(acao === "pausar" ? t("pausou") : acao === "desativar" ? t("desativou") : t("resumed"));
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
      lidoEm={lido?.em}
      busy={busy}
      aoPausar={() => void alternar("pausar")}
      aoDesativar={() => void alternar("desativar")}
      aoRetomar={() => void alternar("retomar")}
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

/**
 * "14:32", no fuso e no idioma de quem olha; com o dia da semana quando não é
 * o dia em que a rota respondeu (`lidoEm`) — com N grande, "às 09:00" seria
 * ambíguo. Sem `lidoEm`, só a hora.
 */
export function horaDaVolta(iso: string, lidoEm?: number): string {
  const volta = new Date(iso);
  const outroDia = lidoEm !== undefined && new Date(lidoEm).toDateString() !== volta.toDateString();
  return volta.toLocaleString(undefined, {
    ...(outroDia ? { weekday: "short" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A faixa desenhada (sem dado nem efeito) — o que os testes renderizam. */
export function FaixaDaIa({
  faixa,
  lidoEm,
  busy,
  aoPausar,
  aoDesativar,
  aoRetomar,
}: {
  faixa: Faixa;
  /** Quando a rota respondeu (o dia da hora da volta). */
  lidoEm?: number;
  busy: boolean;
  aoPausar: () => void;
  aoDesativar: () => void;
  aoRetomar: () => void;
}) {
  const t = useTranslations("Inbox.aiBanner");
  if (!faixa) return null;

  if (faixa.tipo === "pausada") {
    const desativada = faixa.motivo === "desativada";
    return (
      <Banner tone="muted">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">
            {desativada
              ? t("desativadaNaConversa")
              : faixa.motivo
                ? t("pausadaComMotivo", { motivo: t(`motivo.${faixa.motivo}`) })
                : t("pausada")}
          </p>
          {faixa.volta ? (
            // Quebra linha (nunca `truncate`): no celular a hora sumiria cortada.
            <p className="mt-0.5 text-muted-foreground">
              {faixa.volta.em
                ? t("voltaAs", { hora: horaDaVolta(faixa.volta.em, lidoEm) })
                : t("voltaSeEsperar", { minutos: faixa.volta.minutos })}
            </p>
          ) : null}
          {faixa.naoAtende ? <LinhaNaoAtendeDaFaixa linha={faixa.naoAtende} /> : null}
        </div>
        <BannerButton
          onClick={aoRetomar}
          busy={busy}
          icon={Undo2}
          title={faixa.volta ? t("retomarAgoraDica") : t("retomarDica")}
        >
          {t("resume")}
        </BannerButton>
        {faixa.volta ? (
          <BannerButton onClick={aoDesativar} busy={busy} icon={CircleSlash} title={t("desativarDica")}>
            {t("desativar")}
          </BannerButton>
        ) : null}
      </Banner>
    );
  }

  if (faixa.tipo === "naoAtende") {
    return (
      <Banner tone="muted">
        <LinhaNaoAtendeDaFaixa linha={faixa} />
      </Banner>
    );
  }

  // Com N > 0 na conta, o Pausar é TEMPORÁRIO e o Desativar fica ao lado;
  // com 0 (ou sem saber), a faixa de antes: um Pausar, permanente.
  const temporario = faixa.minutos !== null && faixa.minutos > 0;
  return (
    <Banner tone="primary">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
        <span className="truncate font-medium text-foreground">{t("atendendo", { agente: faixa.agente })}</span>
      </div>
      <BannerButton
        onClick={aoPausar}
        busy={busy}
        icon={Pause}
        title={temporario ? t("pausarDica", { minutos: faixa.minutos ?? 0 }) : undefined}
      >
        {t("pausar")}
      </BannerButton>
      {temporario ? (
        <BannerButton onClick={aoDesativar} busy={busy} icon={CircleSlash} title={t("desativarDica")}>
          {t("desativar")}
        </BannerButton>
      ) : null}
    </Banner>
  );
}

/**
 * "IA · <agente> não atende esta conversa: <motivo>", discreta e sem botão;
 * no card antigo (D27), a dica de como fazer a IA atender. O texto QUEBRA
 * linha (nunca `truncate`): no celular a dica sumiria cortada.
 */
function LinhaNaoAtendeDaFaixa({ linha }: { linha: LinhaNaoAtende }) {
  const t = useTranslations("Inbox.aiBanner");
  return (
    <div className="min-w-0 flex-1 text-muted-foreground">
      <p className="flex min-w-0 items-start gap-1.5">
        <Sparkles className="mt-px h-3.5 w-3.5 flex-shrink-0" />
        <span className="min-w-0">
          {t("naoAtende", { agente: linha.agente, motivo: t(`naoAtendeMotivo.${linha.motivo}`) })}
        </span>
      </p>
      {linha.motivo === "card_antigo" ? <p className="mt-0.5 pl-5">{t("naoAtendeDica")}</p> : null}
    </div>
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
