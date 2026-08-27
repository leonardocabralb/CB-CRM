"use client";

// ============================================================
// Galeria do fio: a navegação ‹ › entre os anexos da conversa.
//
// O visualizador do upstream (#467) foi descartado no merge — o nosso tem
// giro e zoom, que servem para ler foto de documento tirada deitada. A
// navegação dele, porém, valia a pena, e as bibliotecas sobreviveram com
// testes: `collectMediaGallery` enumera imagens e vídeos do fio na ordem,
// e `useMediaBlobUrl` resolve o proxy autenticado com cache — folhear de
// volta não rebaixa o arquivo.
//
// A identidade do item aberto é `messages.id`, nunca um índice: o realtime
// insere linhas no fio a qualquer momento, e um índice passaria a apontar
// para outra foto em silêncio.
// ============================================================

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { collectMediaGallery, galleryIndexOf } from "@/lib/media/gallery";
import { mediaFilename } from "@/lib/media/filename";
import { useMediaBlobUrl } from "@/hooks/use-media-blob-url";
import type { Message } from "@/types";

import { MediaViewer } from "./media-viewer";

interface GaleriaDoFioProps {
  /** O fio completo — a conversa é carregada inteira (ver achados-no-fio). */
  messages: Message[];
  /** `messages.id` do anexo aberto; `null` = galeria fechada. */
  abertaEm: string | null;
  onIrPara: (messageId: string) => void;
  onFechar: () => void;
}

export function GaleriaDoFio({
  messages,
  abertaEm,
  onIrPara,
  onFechar,
}: GaleriaDoFioProps) {
  const t = useTranslations("Inbox.mediaViewer");
  const itens = useMemo(() => collectMediaGallery(messages), [messages]);
  const indice = galleryIndexOf(itens, abertaEm);
  const item = indice >= 0 ? itens[indice] : null;

  // Só imagem passa pelo blob (o hook exige isso): vídeo mantém a URL crua
  // para o player fazer streaming em vez de baixar tudo antes de tocar.
  const { src, status } = useMediaBlobUrl(
    item?.kind === "image" ? item.url : undefined,
  );

  // Fechada — ou o anexo aberto saiu do fio (mensagem apagada com a galeria
  // na tela). Sumir é o comportamento certo: não há mais o que mostrar.
  if (!item) return null;

  const resolvido = item.kind === "video" ? item.url : src;

  return (
    <MediaViewer
      src={resolvido}
      falhou={item.kind === "image" && status === "error"}
      alt={item.caption || t("imageAlt")}
      fileName={mediaFilename(item.message)}
      video={item.kind === "video"}
      onClose={onFechar}
      galeria={{
        indice,
        total: itens.length,
        onNavegar: (novo) => {
          const alvo = itens[novo];
          if (alvo) onIrPara(alvo.messageId);
        },
      }}
    />
  );
}
