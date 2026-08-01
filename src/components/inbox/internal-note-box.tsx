"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { fetchAccountMembers, memberLabel } from "@/lib/account/members";
import {
  aplicarMencao,
  filtrarMembros,
  mencionadosNoTexto,
  tokenSobOCursor,
  type MembroMencionavel,
} from "@/lib/notes/mentions";
import { cn } from "@/lib/utils";
import type { ConversationNote } from "@/types";

/**
 * A caixa amarela de anotação interna (migrations 918/919).
 *
 * Componente PRÓPRIO, e não mais um trecho dentro do `message-composer`, por
 * dois motivos: o compositor é arquivo do upstream e cada linha nossa ali é
 * superfície de conflito no merge; e com o autocomplete de menção a caixa
 * passou a ter estado e teclado próprios, que não têm nada a ver com o envio
 * de mensagem.
 *
 * ⚠️ <textarea> própria, NUNCA a do compositor. Lá o `handleKeyDown` manda
 * Enter para `handleSend` — a anotação interna sairia como mensagem para o
 * cliente, que é o pior erro possível nesta feature. Aqui Enter quebra linha
 * (anotação longa é o caso normal) e Ctrl/⌘+Enter salva.
 */
export function InternalNoteBox({
  conversationId,
  onSaved,
  onClose,
}: {
  conversationId: string;
  onSaved?: (nota: ConversationNote) => void;
  onClose: () => void;
}) {
  const t = useTranslations("Inbox.composer");

  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // --- menção -------------------------------------------------------
  const [membros, setMembros] = useState<MembroMencionavel[]>([]);
  const [termo, setTermo] = useState<{ inicio: number; termo: string } | null>(
    null,
  );
  const [destacado, setDestacado] = useState(0);

  useEffect(() => {
    let vivo = true;
    void fetchAccountMembers().then((lista) => {
      if (!vivo) return;
      setMembros(
        lista.map((m) => ({ user_id: m.user_id, rotulo: memberLabel(m) })),
      );
    });
    return () => {
      vivo = false;
    };
  }, []);

  const sugestoes = useMemo(
    () => (termo ? filtrarMembros(membros, termo.termo) : []),
    [termo, membros],
  );
  const listaAberta = termo !== null && sugestoes.length > 0;

  /**
   * ⚠️ Foco por REF num efeito, e NÃO pelo atributo `autoFocus`.
   *
   * Com `autoFocus` o texto digitado saía embaralhado: escrever "Teste da
   * anotação interna" gravava "teTeste da anotação internaste". O React
   * reaplica o foco durante o commit da caixa, e o cursor volta para o começo
   * no meio da digitação. Focar depois da montagem, com o cursor posto no fim
   * de propósito, é o mesmo padrão que `desfazerEnvio` usa no compositor.
   */
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const mudarTexto = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const el = e.target;
      setTexto(el.value);
      setTermo(tokenSobOCursor(el.value, el.selectionStart));
      setDestacado(0);
    },
    [],
  );

  /**
   * Reavalia o token quando o cursor anda sem o texto mudar (clique, setas).
   * Sem isto, clicar no meio de um `@nome` já escrito não reabre a lista, e
   * clicar para fora não a fecha.
   */
  const moverCursor = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    setTermo(tokenSobOCursor(el.value, el.selectionStart));
  }, []);

  const escolher = useCallback(
    (m: MembroMencionavel) => {
      if (!termo) return;
      const el = areaRef.current;
      const cursor = el?.selectionStart ?? texto.length;
      const r = aplicarMencao(texto, termo.inicio, cursor, m.rotulo);
      setTexto(r.texto);
      setTermo(null);
      setDestacado(0);
      // O cursor precisa ser reposto DEPOIS do render, senão o navegador o
      // deixa no fim do valor novo e continuar digitando escreve no lugar
      // errado quando a menção está no meio da frase.
      requestAnimationFrame(() => {
        const alvo = areaRef.current;
        if (!alvo) return;
        alvo.focus();
        alvo.setSelectionRange(r.cursor, r.cursor);
      });
    },
    [termo, texto],
  );

  const salvar = useCallback(async () => {
    const limpo = texto.trim();
    if (!limpo || salvando) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/cb/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          texto: limpo,
          // Derivado do texto, não de quem foi clicado — ver `mentions.ts`.
          mencionados: mencionadosNoTexto(limpo, membros),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || t("noteSaveError"));
        return;
      }
      onSaved?.(json.note as ConversationNote);
      setTexto("");
      onClose();
    } catch {
      toast.error(t("noteSaveError"));
    } finally {
      setSalvando(false);
    }
  }, [texto, salvando, conversationId, membros, onSaved, onClose, t]);

  const tecla = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // ⚠️ A lista aberta come as teclas de navegação ANTES de qualquer outra
      // coisa. Sem isto, Enter para escolher um colega quebraria linha e
      // Escape fecharia a caixa inteira com o texto dentro.
      if (listaAberta) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setDestacado((i) => (i + 1) % sugestoes.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setDestacado((i) => (i - 1 + sugestoes.length) % sugestoes.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          escolher(sugestoes[destacado] ?? sugestoes[0]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setTermo(null);
          return;
        }
      }

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void salvar();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [listaAberta, sugestoes, destacado, escolher, salvar, onClose],
  );

  return (
    <div className="mb-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-700/50 dark:bg-amber-950/40">
      <p className="mb-2 text-xs text-amber-950 dark:text-amber-50">
        <span className="font-semibold">{t("noteBoxTitle")}</span>{" "}
        <span className="opacity-80">{t("noteBoxHint")}</span>
      </p>

      <div className="relative">
        {/* A lista sobe, e não desce: a caixa fica colada no rodapé da tela,
            então para baixo ela sairia da área visível. */}
        {listaAberta && (
          <ul className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-64 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md">
            {sugestoes.map((m, i) => (
              <li key={m.user_id}>
                <button
                  type="button"
                  // `onMouseDown` em vez de `onClick`: o clique tira o foco da
                  // textarea antes do `onClick` rodar, e aí `selectionStart`
                  // já não vale mais.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    escolher(m);
                  }}
                  onMouseEnter={() => setDestacado(i)}
                  className={cn(
                    "w-full truncate px-3 py-1.5 text-left text-sm",
                    i === destacado
                      ? "bg-accent text-accent-foreground"
                      : "text-popover-foreground",
                  )}
                >
                  {m.rotulo}
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={areaRef}
          value={texto}
          onChange={mudarTexto}
          onKeyDown={tecla}
          onClick={moverCursor}
          onSelect={moverCursor}
          onBlur={() => setTermo(null)}
          rows={3}
          placeholder={t("notePlaceholder")}
          className="w-full resize-none rounded-md border border-amber-300/60 bg-amber-100/60 px-3 py-2 text-sm text-amber-950 outline-none placeholder:text-amber-900/50 focus:border-amber-500 dark:border-amber-700/50 dark:bg-amber-900/30 dark:text-amber-50 dark:placeholder:text-amber-100/40"
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => void salvar()}
          disabled={!texto.trim() || salvando}
          className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          {t("saveNote")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} className="h-8">
          {t("cancel")}
        </Button>
        <span className="ml-auto text-[10px] text-amber-900/60 dark:text-amber-100/50">
          {t("noteMentionHint")}
        </span>
      </div>
    </div>
  );
}
