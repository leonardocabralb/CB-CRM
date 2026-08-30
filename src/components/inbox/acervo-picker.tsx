"use client";

import { FileText, Image as ImageIcon, Library, Loader2, Mic, Search, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAcervo } from "@/hooks/use-acervo";
import { categoriasDe, filtrarAcervo, tamanhoLegivel } from "@/lib/acervo/filtro";
import type { TipoDeMidia } from "@/lib/acervo/tipos";
import { cn } from "@/lib/utils";
import type { MediaLibraryItem } from "@/types";

const ICONE: Record<TipoDeMidia, typeof FileText> = {
  image: ImageIcon,
  video: Video,
  document: FileText,
  audio: Mic,
};

/**
 * O acervo (953) visto de dentro da conversa: escolher um arquivo que o
 * escritório já preparou, em vez de procurar no computador.
 *
 * ⚠️ Só ESCOLHE. Copiar o objeto e montar o rascunho é do compositor — ele é
 * quem sabe descartar o anexo anterior e quem trava a caixa enquanto trabalha.
 *
 * ⚠️ Carrega ao ABRIR (`useAcervo(open)`), não na montagem do compositor: o
 * seletor existe em toda conversa aberta, e buscar o acervo inteiro a cada
 * troca de conversa seria uma consulta por clique na lista, para uma lista que
 * quase nunca é usada naquele instante.
 */
export function AcervoPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (item: MediaLibraryItem) => void;
}) {
  const t = useTranslations("Inbox.acervo");
  const { itens, jaCarregou, falhou } = useAcervo(open);
  const [termo, setTermo] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);

  const categorias = useMemo(() => categoriasDe(itens), [itens]);
  const lista = useMemo(
    () => filtrarAcervo(itens, { termo, categoria }),
    [itens, termo, categoria],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Library className="h-4 w-4" />
            {t("title")}
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="pl-8"
          />
        </div>

        {/* Abas de categoria — só aparecem quando há mais de uma. Numa conta
            com tudo no Geral elas não decidem nada e só ocupam a tela, como o
            seletor de canal que some com menos de dois canais. */}
        {categorias.length > 1 && (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setCategoria(null)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs transition-colors",
                categoria === null
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {t("allCategories")}
            </button>
            {categorias.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoria(c)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs transition-colors",
                  categoria === c
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="max-h-[46vh] min-h-0 overflow-y-auto">
          {!jaCarregou ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : falhou ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("loadError")}
            </p>
          ) : lista.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {itens.length === 0 ? t("empty") : t("noMatch")}
            </p>
          ) : (
            <ul className="space-y-1">
              {lista.map((item) => {
                const Icone = ICONE[item.tipo];
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onPick(item)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                    >
                      {item.tipo === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.media_url}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted">
                          <Icone className="h-4 w-4 text-muted-foreground" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">
                          {item.titulo}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.categoria ? `${item.categoria} · ` : ""}
                          {item.filename} · {tamanhoLegivel(item.size_bytes)}
                        </span>
                      </span>
                      {/* Áudio do acervo chega como nota de voz — o mesmo
                          caminho do gravador. Dizer isto aqui evita a surpresa
                          de mandar "um arquivo" e o cliente receber um púlpito
                          de voz. */}
                      {item.tipo === "audio" && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {t("asVoiceNote")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
