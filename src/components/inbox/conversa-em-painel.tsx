"use client";

// ============================================================
// ConversaEmPainel — a conversa num painel lateral, sem sair da tela.
//
// Pedido do operador (05/10/2026): na pauta de reuniões, "Abrir conversa"
// abre o fio por cima da pauta, para ler e responder sem ir à caixa de
// entrada e voltar a cada cliente. É o MESMO `MessageThread` da caixa de
// entrada, intocado: o fio grava tudo sozinho (envio, situação, canal, o zero
// das não lidas, o modo anônimo). Este componente faz só o papel da página do
// inbox — carrega a conversa, guarda as mensagens, ouve o tempo real e marca
// a presença. Ficha, etiquetas e funil ficam na caixa de entrada: o botão
// "Abrir na caixa de entrada" e o nome no cabeçalho do fio levam para lá.
//
// No celular quem chama NÃO usa o painel: lá a caixa de entrada já ocupa a
// tela inteira, e o painel seria a mesma tela, mais apertada (decisão do
// operador, 05/10/2026).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, ShieldAlert, X } from "lucide-react";

import { MessageThread } from "@/components/inbox/message-thread";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { useMarcarConversaAberta } from "@/hooks/use-conversa-aberta";
import { useInadimplencia } from "@/hooks/use-inadimplencia";
import { useModoAnonimo } from "@/hooks/use-modo-anonimo";
import { useRealtime } from "@/hooks/use-realtime";
import { avisarExecucoesMudaram } from "@/lib/execucoes/aviso";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from "@/lib/inbox/conversations";
import { conversaNoEscopo } from "@/lib/perfis/escopo";
import { createClient } from "@/lib/supabase/client";
import type { Conversation, Message } from "@/types";

interface ConversaEmPainelProps {
  /** A conversa do painel; continua preenchida durante a animação de fechar. */
  conversaId: string | null;
  aberto: boolean;
  aoFechar: () => void;
  /** Leva a conversa para a caixa de entrada (ficha, etiquetas, funil). */
  aoAbrirNaCaixa: (conversaId: string) => void;
}

export function ConversaEmPainel({
  conversaId,
  aberto,
  aoFechar,
  aoAbrirNaCaixa,
}: ConversaEmPainelProps) {
  const t = useTranslations("ConversaEmPainel");
  const corpoRef = useRef<HTMLDivElement>(null);

  return (
    <Sheet
      open={aberto}
      onOpenChange={(abrir, detalhes) => {
        if (abrir) return;
        // ⚠️ O visualizador de mídia da bolha (`media-viewer.tsx`) é um
        // overlay PRÓPRIO, sem portal, que fecha no Esc ouvindo a janela — e
        // o Esc chega antes ao painel. Sem esta guarda, fechar a foto fechava
        // a conversa junto. `allowPropagation` deixa o Esc seguir até ele.
        if (
          detalhes.reason === "escape-key" &&
          corpoRef.current?.querySelector('[role="dialog"][aria-modal="true"]')
        ) {
          detalhes.cancel();
          detalhes.allowPropagation();
          return;
        }
        aoFechar();
      }}
    >
      {/* Largura pelo `max-w` PREFIXADO, nunca o `w-full` junto
          (`.claude/rules/ui.md`): o `sm:max-w-sm` do primitivo venceria um
          `max-w` cru, e o painel abriria com 384 px. */}
      {/* Foco inicial no CORPO, não no primeiro botão: o padrão punha o foco
          em "Abrir na caixa de entrada", e um Enter a mais tirava a pessoa
          da pauta. */}
      <SheetContent
        side="right"
        showCloseButton={false}
        initialFocus={corpoRef}
        className="gap-0 p-0 data-[side=right]:sm:max-w-2xl"
      >
        <div
          ref={corpoRef}
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col outline-none"
        >
          {/* Barra própria em vez do X do primitivo: o X absoluto cairia em
              cima da situação e do seletor de canal do cabeçalho do fio. */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <SheetTitle className="text-sm font-medium text-muted-foreground">
              {t("titulo")}
            </SheetTitle>
            <div className="flex items-center gap-1">
              {conversaId && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => aoAbrirNaCaixa(conversaId)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("abrirNaCaixa")}
                </Button>
              )}
              <SheetClose
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("fechar")}
                    title={t("fechar")}
                  />
                }
              >
                <X className="h-4 w-4" />
              </SheetClose>
            </div>
          </div>

          {/* `key`: outra conversa nasce do zero — mensagens, presença e tempo
              real da anterior não vazam para a seguinte (efeito passivo). */}
          {conversaId && (
            <ConversaCarregada
              key={conversaId}
              conversaId={conversaId}
              aoAbrirNaCaixa={aoAbrirNaCaixa}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ConversaCarregada({
  conversaId,
  aoAbrirNaCaixa,
}: {
  conversaId: string;
  aoAbrirNaCaixa: (conversaId: string) => void;
}) {
  const t = useTranslations("ConversaEmPainel");
  const { acesso } = useAuth();
  const { ativo: modoAnonimo } = useModoAnonimo();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  /** Erro de leitura ≠ conversa que não existe (ou que o RLS não mostra). */
  const [falha, setFalha] = useState<"erro" | "nao_encontrada" | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  /** O mesmo papel do `resyncToken` da caixa de entrada: o fio relê tudo. */
  const [resyncToken, setResyncToken] = useState(0);
  const { resumo: inadimplencia } = useInadimplencia(resyncToken);

  // A conversa é relida também a cada resync (reconexão, volta à aba, botão
  // atualizar): o que mudou nela com o tempo real caído — o número da
  // conversa, a situação — não chega de outro jeito, e o painel seguiria
  // enviando pelo `channel_id` velho, recusado a cada tentativa (Codex, PR
  // #385). Releitura que falha ou não acha mantém a conversa à vista: só a
  // carga inicial vira aviso.
  const carregouRef = useRef(false);
  useEffect(() => {
    let cancelado = false;
    createClient()
      .from("conversations")
      .select(CONVERSATION_SELECT)
      .eq("id", conversaId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) {
          console.error("[conversa-em-painel] carga falhou:", error.message);
          if (!carregouRef.current) setFalha("erro");
          return;
        }
        if (!data) {
          if (!carregouRef.current) setFalha("nao_encontrada");
          return;
        }
        carregouRef.current = true;
        setConversation(normalizeConversation(data));
      });
    return () => {
      cancelado = true;
    };
  }, [conversaId, tentativa, resyncToken]);

  // A régua da caixa de entrada, as duas linhas iguais às da página (pino
  // `modo-anonimo.chamadores.test.ts`): fora do perfil o fio NEM MONTA — ele
  // buscaria as mensagens e zeraria as não lidas de quem não pode
  // respondê-las —, e nem fora do perfil nem no modo anônimo a presença marca.
  const foraDoPerfil =
    conversation !== null && !conversaNoEscopo(acesso, conversation);
  const conversaLida =
    modoAnonimo || foraDoPerfil ? null : (conversation?.id ?? null);
  useMarcarConversaAberta(conversaLida);

  // Tempo real: o mesmo do inbox, recortado nesta conversa.
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message }) => {
      const msg = event.new;
      if (msg.conversation_id !== conversaId) return;
      if (event.eventType === "INSERT") {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          // A linha gravada substitui a bolha otimista do envio.
          return [...prev.filter((m) => !m.id.startsWith("temp-")), msg];
        });
        // O cliente respondeu: a espera "parar se o cliente responder" pode
        // ter sido cancelada no servidor logo depois (ver a página do inbox).
        if (msg.sender_type === "customer") {
          window.setTimeout(avisarExecucoesMudaram, 3000);
        }
      } else if (event.eventType === "UPDATE") {
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)),
        );
      }
    },
    [conversaId],
  );
  const handleConversationEvent = useCallback(
    (event: { eventType: string; new: Conversation }) => {
      if (event.eventType !== "UPDATE" || event.new.id !== conversaId) return;
      // O payload não traz o contato embutido: o espalhamento o preserva.
      setConversation((prev) => (prev ? { ...prev, ...event.new } : prev));
    },
    [conversaId],
  );
  const { isConnected } = useRealtime({
    channelName: `conversa-em-painel:${conversaId}`,
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
  });

  // O que se perdeu com o canal caído ou a aba escondida volta pelo resync,
  // como na caixa de entrada. A primeira conexão não conta: a carga inicial
  // do fio já cobre. Fora do corpo do efeito (microtarefa), como o disparo do
  // "Desfazer" da pauta: `setState` síncrono ali é erro do React Compiler.
  const estavaConectadoRef = useRef(false);
  const primeiraConexaoRef = useRef(false);
  useEffect(() => {
    if (isConnected && !estavaConectadoRef.current) {
      if (primeiraConexaoRef.current) {
        queueMicrotask(() => setResyncToken((n) => n + 1));
      } else {
        primeiraConexaoRef.current = true;
      }
    }
    estavaConectadoRef.current = isConnected;
  }, [isConnected]);
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === "visible") {
        setResyncToken((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, []);

  if (falha) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        {falha === "erro" ? t("falhou") : t("naoEncontrada")}
        {falha === "erro" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setFalha(null);
              setTentativa((n) => n + 1);
            }}
          >
            {t("tentarDeNovo")}
          </Button>
        )}
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("carregando")}
      </div>
    );
  }

  if (foraDoPerfil) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <ShieldAlert className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">{t("foraDaAreaTitulo")}</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {t("foraDaAreaCorpo")}
        </p>
      </div>
    );
  }

  return (
    // `min-h-0`/`min-w-0`: o fio rola por dentro em vez de esticar o painel.
    <div className="flex min-h-0 min-w-0 flex-1">
      <MessageThread
        conversation={conversation}
        contact={conversation.contact ?? null}
        messages={messages}
        onMessagesLoaded={setMessages}
        onNewMessage={(msg) =>
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
          )
        }
        onUpdateMessage={(id, updates) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, ...updates } : m)),
          )
        }
        // O fio já gravou no banco; aqui só se espelha, como na página.
        onStatusChange={(_, status) =>
          setConversation((prev) => (prev ? { ...prev, status } : prev))
        }
        onAssignChange={(_, assignedAgentId) =>
          setConversation((prev) =>
            prev
              ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
              : prev,
          )
        }
        onChannelChange={(_, patch) =>
          setConversation((prev) => (prev ? { ...prev, ...patch } : prev))
        }
        // A ficha mora na caixa de entrada: o nome do cabeçalho, o "ver
        // automações" do cartão de falha e o "ver cobranças" levam para lá.
        onOpenContactPanel={() => aoAbrirNaCaixa(conversaId)}
        resyncToken={resyncToken}
        onRefresh={() => setResyncToken((n) => n + 1)}
        inadimplencia={inadimplencia}
      />
    </div>
  );
}
