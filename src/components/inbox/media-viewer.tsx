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

import { useCallback, useEffect, useRef, useState } from "react";
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
  // Deslocamento arrastável.
  //
  // A versão anterior confiava em `overflow-auto` para alcançar o que
  // transbordava, e isso NÃO funciona: `transform` não altera a caixa de
  // layout, então a área rolável de um contêiner centralizado nunca inclui
  // o que sai pela borda de cima ou da esquerda. Medido: girando 90°, ~104px
  // do topo ficavam inalcançáveis em qualquer posição da barra; com zoom 5×,
  // mais de 1300px. E a barra de rolagem aparecia, sinalizando conteúdo que
  // rolar não trazia. Arrastar resolve giro e ampliação de uma vez.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [arrastando, setArrastando] = useState(false);
  const inicio = useRef<{ x: number; y: number } | null>(null);

  const girar = useCallback((graus: number) => {
    setGiro((atual) => (atual + graus + 360) % 360);
    // Sem zerar, a imagem reaparece deslocada num eixo que acabou de mudar.
    setPan({ x: 0, y: 0 });
  }, []);

  const aplicarZoom = useCallback((delta: number) => {
    setZoom((z) => {
      const novo = Math.min(5, Math.max(0.25, z + delta));
      // Voltando a caber, o deslocamento perde sentido e só atrapalha.
      if (novo <= 1) setPan({ x: 0, y: 0 });
      return novo;
    });
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
        <BotaoBarra onClick={() => aplicarZoom(-0.25)} title={t("zoomOut")}>
          <ZoomOut className="h-4 w-4" />
        </BotaoBarra>
        <BotaoBarra onClick={() => aplicarZoom(0.25)} title={t("zoomIn")}>
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

      {/* `overflow-hidden`, não `auto`: a barra de rolagem aqui era pura
          desinformação — aparecia e não alcançava o que estava fora. */}
      <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            // Captura o ponteiro para o arraste sobreviver a sair da imagem.
            e.currentTarget.setPointerCapture(e.pointerId);
            inicio.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            setArrastando(true);
          }}
          onPointerMove={(e) => {
            if (!inicio.current) return;
            setPan({ x: e.clientX - inicio.current.x, y: e.clientY - inicio.current.y });
          }}
          onPointerUp={() => {
            inicio.current = null;
            setArrastando(false);
          }}
          onPointerCancel={() => {
            inicio.current = null;
            setArrastando(false);
          }}
          className={cn(
            "max-h-full max-w-full touch-none object-contain select-none",
            arrastando ? "cursor-grabbing" : "cursor-grab",
            // A transição faz cada quadro do arraste interpolar 150ms e o
            // movimento fica pastoso — só vale para giro e zoom.
            !arrastando && "transition-transform duration-150",
          )}
          // `translate` ANTES de `rotate`: assim o arraste segue o eixo da
          // tela, não o eixo já girado da imagem.
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) rotate(${giro}deg) scale(${zoom})`,
          }}
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
