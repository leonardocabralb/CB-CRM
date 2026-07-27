"use client";

// ============================================================
// Visualizador de mídia em tela cheia.
//
// A bolha mostrava a imagem num quadrado de 240×256 com `object-cover`, e
// era o fim da linha: sem ampliar, sem baixar, sem girar. Num CRM jurídico
// isso é limitante de verdade — o cliente manda a foto de um documento ou
// a captura de uma tela de processo, e o advogado precisa LER aquilo,
// muitas vezes deitado de lado porque o celular estava na horizontal.
//
// Componente próprio (não dentro de message-bubble) porque a bolha já é
// grande e porque vídeo e documento também vão querer isto depois.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { Download, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface MediaViewerProps {
  /** URL já resolvida (pode ser `blob:` quando veio do proxy autenticado). */
  src: string;
  /** Nome sugerido no download. */
  fileName?: string;
  alt: string;
  onClose: () => void;
}

/** Roda o download por blob para o nome do arquivo ser respeitado. */
async function baixar(src: string, fileName: string) {
  // `<a download>` é IGNORADO em URL de outra origem — o navegador navega
  // para a imagem em vez de baixar. O bucket do Supabase é outra origem,
  // então buscamos o binário e baixamos a partir de uma URL local.
  let href = src;
  let criada = false;
  try {
    if (!src.startsWith("blob:")) {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      href = URL.createObjectURL(await res.blob());
      criada = true;
    }
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    // Último recurso: abrir numa aba. Pior que baixar, melhor que nada.
    window.open(src, "_blank", "noopener,noreferrer");
  } finally {
    if (criada) setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }
}

export function MediaViewer({ src, fileName, alt, onClose }: MediaViewerProps) {
  const t = useTranslations("Inbox.mediaViewer");
  const [giro, setGiro] = useState(0);
  const [zoom, setZoom] = useState(1);

  const girar = useCallback((graus: number) => {
    setGiro((atual) => (atual + graus + 360) % 360);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "r") girar(90);
      if (e.key === "R") girar(-90);
    };
    window.addEventListener("keydown", onKey);
    // Trava o scroll do fundo enquanto o visualizador está aberto.
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflowAnterior;
    };
  }, [onClose, girar]);

  const nome = fileName || `${alt || "anexo"}.jpg`;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      // Clique no fundo fecha; clique na imagem ou na barra, não.
      onClick={onClose}
    >
      <div
        className="flex items-center justify-end gap-1 p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <BotaoBarra onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} title={t("zoomOut")}>
          <ZoomOut className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra onClick={() => setZoom((z) => Math.min(5, z + 0.25))} title={t("zoomIn")}>
          <ZoomIn className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra onClick={() => girar(-90)} title={t("rotateLeft")}>
          <RotateCcw className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra onClick={() => girar(90)} title={t("rotateRight")}>
          <RotateCw className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra onClick={() => void baixar(src, nome)} title={t("download")}>
          <Download className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra onClick={onClose} title={t("close")}>
          <X className="h-4 w-4" />
        </BotaoBarra>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain transition-transform duration-150"
          style={{ transform: `rotate(${giro}deg) scale(${zoom})` }}
        />
      </div>
    </div>
  );
}

function BotaoBarra({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "rounded-lg p-2 text-white/80 transition-colors",
        "hover:bg-white/15 hover:text-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
      )}
    >
      {children}
    </button>
  );
}
