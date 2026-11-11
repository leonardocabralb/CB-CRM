"use client";

// ============================================================
// O painel da ligação pelo CRM (4c, §8.1 do plano): flutuante, no canto da
// tela (no celular, no alto, para não cobrir o compositor), montado na casca —
// trocar de tela não o derruba. Mostra quem é, por qual número, o estado
// ("Conectando o áudio…" → "Chamando…" → "Em ligação 02:13" → "Encerrada ·
// 4 min 21 s"), o selo "Gravando" (D7), Mudo, Desligar e "Abrir conversa".
//
// ⚠️ "Conectando o áudio…" existe porque a rota de ligar/atender leva ~5 s
// (a ponte do lado da máquina, medido na 4b): sem ele, o clique parecia não
// ter feito nada.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Mic, MicOff, PhoneIncoming, PhoneOff, PhoneOutgoing, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useChannels } from "@/hooks/use-channels";
import { coresPorCanal, corDoCanal } from "@/lib/cb-channels/cores";
import { AVISO_DO_FIM_SEG, partesDaDuracao, relogioDaLigacao } from "@/lib/ligacoes/ao-vivo";
import { cn } from "@/lib/utils";

import type { MinhaLigacao } from "./ligacoes-provider";

export function PainelDaLigacao({
  minha,
  onDesligar,
  onMudo,
  onFechar,
  onAbrirConversa,
}: {
  minha: MinhaLigacao;
  onDesligar: () => void;
  onMudo: () => void;
  onFechar: () => void;
  onAbrirConversa: (conversationId: string) => void;
}) {
  const t = useTranslations("Ligacoes");
  const { channels } = useChannels();
  const cores = useMemo(() => coresPorCanal(channels), [channels]);
  const canal = channels.find((c) => c.id === minha.canalId) ?? null;
  const cor = corDoCanal(cores, minha.canalId);

  // O cronômetro: um tique por segundo, só em ligação.
  const emLigacao = minha.fase === "em_ligacao";
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!emLigacao) return;
    const laco = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(laco);
  }, [emLigacao]);
  const segundos =
    emLigacao && minha.emLigacaoDesde !== null
      ? Math.max(0, Math.floor((agora - minha.emLigacaoDesde) / 1000))
      : 0;

  const ativa = minha.fase !== "encerrada" && minha.fase !== "falhou";
  const esperando = ativa && (minha.fase === "microfone" || minha.fase === "conectando" || minha.desligando);

  const duracao = (s: number) => {
    const partes = partesDaDuracao(s);
    return partes.minutos > 0 ? t("painel.duracaoMin", partes) : t("painel.duracaoSeg", partes);
  };

  let estado: string;
  if (ativa && minha.desligando) {
    estado = t("painel.desligando");
  } else {
    switch (minha.fase) {
      case "microfone":
        estado = t("painel.microfone");
        break;
      case "conectando":
        estado = t("painel.conectando");
        break;
      case "chamando":
        estado = t("painel.chamando");
        break;
      case "em_ligacao":
        estado = `${t("painel.emLigacao")} · ${relogioDaLigacao(segundos)}`;
        break;
      case "encerrada":
        estado =
          minha.duracaoSeg !== null
            ? `${t("painel.encerrada")} · ${duracao(minha.duracaoSeg)}`
            : minha.direcao === "feita"
              ? t("painel.naoAtendida")
              : t("painel.encerrada");
        break;
      case "falhou":
        estado = t(`recusa.${minha.recusa ?? "desconhecida"}`);
        break;
    }
  }

  const Direcao = minha.direcao === "feita" ? PhoneOutgoing : PhoneIncoming;

  return (
    <div
      role="region"
      aria-label={t("toque.titulo")}
      className="fixed inset-x-4 top-2 z-50 rounded-xl border bg-card p-3 text-card-foreground shadow-lg sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:w-80"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
          {minha.nome.charAt(0).toUpperCase() || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{minha.nome}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Direcao aria-hidden className="h-3 w-3 shrink-0" />
            {canal && (
              <>
                {cor && <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", cor.ponto)} />}
                <span className="truncate">{canal.label}</span>
              </>
            )}
          </p>
        </div>
        {!ativa && (
          <button
            type="button"
            onClick={onFechar}
            aria-label={t("painel.fechar")}
            title={t("painel.fechar")}
            className="-m-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-2 flex min-w-0 items-center gap-2 text-sm" aria-live="polite">
        {esperando && <Loader2 aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin" />}
        <span className={cn("min-w-0", minha.fase === "falhou" && "text-destructive")}>{estado}</span>
        {emLigacao && (
          // A cor mora no PONTO: o `dark:` está inerte e o texto vermelho
          // sumiria no tema escuro.
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-red-500/40 px-2 py-0.5 text-[10px] font-medium">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
            {t("painel.gravando")}
          </span>
        )}
      </div>
      {emLigacao && segundos >= AVISO_DO_FIM_SEG && (
        <p className="mt-1 text-xs text-amber-700">{t("painel.avisoDoFim")}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        {ativa && minha.fase !== "microfone" && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={onMudo}
            aria-pressed={minha.mudo}
            aria-label={minha.mudo ? t("painel.comSom") : t("painel.mudo")}
            title={minha.mudo ? t("painel.comSom") : t("painel.mudo")}
          >
            {minha.mudo ? <MicOff className="text-destructive" /> : <Mic />}
          </Button>
        )}
        {minha.conversationId && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onAbrirConversa(minha.conversationId!)}
          >
            {t("painel.abrirConversa")}
          </Button>
        )}
        {ativa && (
          <Button
            type="button"
            size="sm"
            onClick={onDesligar}
            disabled={minha.desligando}
            className="ml-auto bg-red-600 text-white hover:bg-red-700"
          >
            <PhoneOff />
            {t("painel.desligar")}
          </Button>
        )}
      </div>
    </div>
  );
}
