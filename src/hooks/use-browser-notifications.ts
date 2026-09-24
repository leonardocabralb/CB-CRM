"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Message } from "@/types";
import {
  BROWSER_NOTIFY_CHANGE_EVENT,
  DEFAULT_NOTIFICATION_LABELS,
  buildNotificationContent,
  getNotificationPermission,
  shouldNotifyForMessage,
  viewedConversationFromLocation,
  type NotificationLabels,
} from "@/lib/notifications/browser-notify";
import {
  CHAVE_ANTIGA,
  JANELA_DA_ATRIBUICAO_MS,
  chaveDaPreferencia,
  esperaAtribuicao,
  instanteDaMensagem,
  lerPreferencia,
  silencioDoAviso,
  type ConversaDoAviso,
  type PreferenciaDeAviso,
} from "@/lib/notifications/aviso-no-navegador";
import { nomeDoContato, type ContatoIdentificavel } from "@/lib/contacts/identidade";
import { EVENTO_ABRIR_CONVERSA, urlDoInbox } from "@/lib/inbox/url";
import { MIDIA_DE_TOQUE } from "@/lib/celular/teclado";

// ⚠️ Este arquivo veio do original (#516) e foi PORTADO na Fase 8 do plano do
// merge do upstream: a preferência é POR PESSOA, a régua de quem recebe
// aviso é a nossa (`silencioDoAviso`: perfil, grupo, "quais conversas",
// mensagem antiga) e o título sai de `nomeDoContato`. Um merge que traga a
// versão dele crua devolve o aviso de grupo e de conexão fora do perfil.

const semServidor = () => null;

/**
 * O aviso pode aparecer NESTE aparelho? Sem service worker, `new
 * Notification()` só funciona no computador: no Chrome do Android e no app
 * instalado no iPhone a API existe, a permissão é concedida — e o construtor
 * lança. O cartão ligaria e nada chegaria (o defeito que tirou o cartão no
 * #259). Aparelho de toque conta como "não suportado".
 */
export function avisoPossivelNoAparelho(): boolean {
  if (getNotificationPermission() === "unsupported") return false;
  return !window.matchMedia?.(MIDIA_DE_TOQUE).matches;
}

function lerTexto(chave: string | null): string | null {
  if (!chave || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(chave);
  } catch {
    // localStorage lança em aba privada / contexto isolado: vale o padrão.
    return null;
  }
}

/**
 * A preferência de aviso DESTA pessoa neste navegador, sincronizada entre a
 * aba (o cartão de Seu perfil) e as outras abas.
 *
 * O snapshot é o TEXTO cru do storage — primitivo, estável entre leituras —
 * e o parse acontece no render: um objeto novo a cada leitura faria o
 * `useSyncExternalStore` renderizar sem parar.
 */
export function usePreferenciaDeAviso(): {
  preferencia: PreferenciaDeAviso;
  gravar: (proxima: PreferenciaDeAviso) => void;
} {
  const { user } = useAuth();
  const chave = user ? chaveDaPreferencia(user.id) : null;

  const assinar = useCallback(
    (aoMudar: () => void) => {
      const aoMudarStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === chave) aoMudar();
      };
      window.addEventListener(BROWSER_NOTIFY_CHANGE_EVENT, aoMudar);
      window.addEventListener("storage", aoMudarStorage);
      return () => {
        window.removeEventListener(BROWSER_NOTIFY_CHANGE_EVENT, aoMudar);
        window.removeEventListener("storage", aoMudarStorage);
      };
    },
    [chave],
  );
  const texto = useSyncExternalStore(assinar, () => lerTexto(chave), semServidor);
  const preferencia = useMemo(() => lerPreferencia(texto), [texto]);

  const gravar = useCallback(
    (proxima: PreferenciaDeAviso) => {
      if (!chave) return;
      try {
        window.localStorage.setItem(chave, JSON.stringify(proxima));
        window.localStorage.removeItem(CHAVE_ANTIGA);
      } catch {
        // Melhor esforço: sem storage, a escolha não sobrevive ao recarregar.
      }
      window.dispatchEvent(new Event(BROWSER_NOTIFY_CHANGE_EVENT));
    },
    [chave],
  );

  return { preferencia, gravar };
}

/** O que a consulta da conversa traz: a régua (`silencioDoAviso`) e o nome. */
const SELECT_DA_CONVERSA =
  "id, channel_id, channel_pinned, group_id, assigned_agent_id, unread_count, " +
  "contact:contacts(name, phone, instagram_username), group:cb_groups(channel_id)";

type ConversaDaConsulta = ConversaDoAviso & {
  unread_count?: number | null;
  contact?: ContatoIdentificavel | null;
};

/**
 * Aviso na área de trabalho a cada mensagem nova de cliente. Montado UMA vez
 * por aba, na casca, DENTRO da `<PortaDeEntrada>` e só depois do "Continuar"
 * (ao lado do `PresenceHeartbeat`), para avisar em qualquer página.
 *
 * Ouve os INSERTs de `messages` pelo realtime (a RLS recorta pela conta).
 * Sem carga inicial: o acúmulo não vira uma rajada ao abrir a página. Só
 * funciona com uma aba aberta — não há service worker nem Web Push.
 */
export function useBrowserNotifications(): void {
  const { user, profile, perfilDeAcesso } = useAuth();
  const { preferencia } = usePreferenciaDeAviso();
  const router = useRouter();
  const t = useTranslations("Settings.browserNotifications.labels");

  const userId = user?.id ?? null;
  const ativo = preferencia.ativo && userId !== null;

  // Lidos DENTRO do callback do realtime: por ref, para mudar o perfil, o
  // "quais conversas" ou o idioma não derrubar e reabrir o canal. Atualizados
  // num efeito, nunca no render.
  const labelsRef = useRef<NotificationLabels>(DEFAULT_NOTIFICATION_LABELS);
  const vivoRef = useRef({
    // ⚠️ O contexto REAL, nunca o `acesso` do useAuth (que carrega a lente do
    // "Ver como"): quem simula continua sendo quem recebe o aviso.
    ctx: { papel: profile?.account_role ?? null, perfil: perfilDeAcesso },
    preferencia,
  });
  useEffect(() => {
    labelsRef.current = {
      fallbackTitle: t("fallbackTitle"),
      image: t("image"),
      audio: t("audio"),
      video: t("video"),
      document: t("document"),
      location: t("location"),
      template: t("template"),
    };
    vivoRef.current = {
      ctx: { papel: profile?.account_role ?? null, perfil: perfilDeAcesso },
      preferencia,
    };
  });

  // Ids de mensagem já tratados, contra o replay do realtime.
  const seenRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!ativo || !userId) return;
    if (!avisoPossivelNoAparelho()) return;

    const supabase = createClient();
    let cancelado = false;
    // Mensagens caladas por "não é sua", à espera de a conversa ser atribuída
    // a esta pessoa (ver `JANELA_DA_ATRIBUICAO_MS`). Uma por conversa: o aviso
    // também é um por conversa (`tag`).
    const estacionadas = new Map<string, { msg: Message; ate: number }>();
    // Quando cada conversa foi atribuída a esta pessoa (o UPDATE do realtime).
    // A atribuição pode chegar ENQUANTO a consulta de `avisar` está no ar: a
    // resposta volta com o dono velho, e a mensagem estacionaria DEPOIS de a
    // soltura já ter passado (revisão do PR #289).
    const atribuidasAgora = new Map<string, number>();

    // A pessoa está com ESTA conversa na tela agora? Conferido de novo na hora
    // de exibir: entre o INSERT e o aviso cabem a consulta e, na estacionada,
    // minutos — ela pode ter aberto a conversa nesse meio (Codex, PR #289).
    const vendoAgora = (conversaId: string) =>
      document.visibilityState === "visible" &&
      viewedConversationFromLocation(window.location.pathname, window.location.search) ===
        conversaId;

    const avisar = async (msg: Message, podeEstacionar: boolean) => {
      const consultouEm = Date.now();
      const { data, error } = await supabase
        .from("conversations")
        .select(SELECT_DA_CONVERSA)
        .eq("id", msg.conversation_id)
        .maybeSingle();
      if (cancelado) return;
      // ⚠️ Sem a conversa não há como saber se é grupo ou de outra conexão —
      // exatamente o que a P2 manda calar. Silêncio: a conversa continua com
      // a não lida na caixa de entrada, e um aviso errado ensina a desligar.
      if (error || !data) {
        if (error) console.warn("[useBrowserNotifications] conversa ilegível:", error.message);
        return;
      }
      const conversa = data as unknown as ConversaDaConsulta;
      const { ctx, preferencia: pref } = vivoRef.current;
      const silencio = silencioDoAviso({
        mensagem: msg,
        conversa,
        ctx,
        userId,
        quais: pref.quais,
        agoraMs: Date.now(),
      });
      // Na soltura, a não lida zerada diz que alguém já abriu a conversa
      // durante a espera: a mensagem foi vista, e a atribuição já avisa pelo
      // sino (o gatilho de `notifications`) — revisão do PR #289.
      if (!podeEstacionar && !conversa.unread_count) return;
      if (esperaAtribuicao(silencio)) {
        if (!podeEstacionar) return;
        const atribuidaEm = atribuidasAgora.get(msg.conversation_id);
        if (atribuidaEm !== undefined && atribuidaEm >= consultouEm) {
          void avisar(msg, false);
          return;
        }
        const agora = Date.now();
        for (const [id, parada] of estacionadas) if (agora > parada.ate) estacionadas.delete(id);
        // As consultas de duas mensagens da mesma conversa podem voltar fora
        // de ordem: a mais ANTIGA não substitui a mais nova (Codex, PR #289).
        const atual = estacionadas.get(msg.conversation_id);
        if (atual && instanteDaMensagem(atual.msg) > instanteDaMensagem(msg)) return;
        estacionadas.set(msg.conversation_id, { msg, ate: agora + JANELA_DA_ATRIBUICAO_MS });
        return;
      }
      if (silencio) return;

      const labels = labelsRef.current;
      const titulo = nomeDoContato(conversa.contact, labels.fallbackTitle);
      const { body } = buildNotificationContent(msg, titulo, labels);
      if (vendoAgora(msg.conversation_id)) return;

      try {
        const notificacao = new Notification(titulo, {
          // Texto escondido: o aviso diz só QUEM escreveu.
          body: pref.mostrarTexto ? body : labels.fallbackTitle,
          // Um aviso por conversa: a segunda mensagem substitui a primeira.
          tag: msg.conversation_id,
          icon: "/icon",
        });
        notificacao.onclick = () => {
          window.focus();
          router.push(urlDoInbox({ c: msg.conversation_id }));
          // Com a caixa de entrada já montada, o push só troca a query: a
          // página abre a conversa por este sinal (ninguém escuta fora dela).
          window.dispatchEvent(
            new CustomEvent(EVENTO_ABRIR_CONVERSA, { detail: msg.conversation_id }),
          );
          notificacao.close();
        };
      } catch (err) {
        // Alguns navegadores lançam no construtor (o Chrome do Android exige
        // service worker). Não é fatal.
        console.error("[useBrowserNotifications] aviso não exibido:", err);
      }
    };

    const canal = supabase
      .channel("browser-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          // Conferido a cada evento: a pessoa pode revogar a permissão no
          // navegador sem a preferência mudar.
          if (getNotificationPermission() !== "granted") return;
          const msg = payload.new as Message;
          const deveAvisar = shouldNotifyForMessage(msg, {
            documentVisible: document.visibilityState === "visible",
            viewingConversationId: viewedConversationFromLocation(
              window.location.pathname,
              window.location.search,
            ),
            seen: seenRef.current,
          });
          if (!deveAvisar) return;
          void avisar(msg, true);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `assigned_agent_id=eq.${userId}`,
        },
        (payload) => {
          // A conversa foi atribuída a esta pessoa: a mensagem estacionada
          // dela é decidida DE NOVO, lendo a conversa como está agora.
          const id = (payload.new as { id?: string }).id;
          if (!id) return;
          const agora = Date.now();
          for (const [k, em] of atribuidasAgora) {
            if (agora - em > JANELA_DA_ATRIBUICAO_MS) atribuidasAgora.delete(k);
          }
          atribuidasAgora.set(id, agora);
          const parada = estacionadas.get(id);
          if (!parada) return;
          estacionadas.delete(id);
          if (Date.now() > parada.ate) return;
          if (getNotificationPermission() !== "granted") return;
          void avisar(parada.msg, false);
        },
      )
      .subscribe();

    return () => {
      cancelado = true;
      estacionadas.clear();
      atribuidasAgora.clear();
      supabase.removeChannel(canal);
    };
  }, [ativo, userId, router]);
}
