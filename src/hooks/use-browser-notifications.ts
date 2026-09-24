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
  lerPreferencia,
  silencioDoAviso,
  type ConversaDoAviso,
  type PreferenciaDeAviso,
} from "@/lib/notifications/aviso-no-navegador";
import { nomeDoContato, type ContatoIdentificavel } from "@/lib/contacts/identidade";
import { EVENTO_ABRIR_CONVERSA, EVENTO_CONVERSA_ABERTA, urlDoInbox } from "@/lib/inbox/url";
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
  "id, channel_id, channel_pinned, group_id, assigned_agent_id, " +
  "contact:contacts(name, phone, instagram_username), group:cb_groups(channel_id)";

type ConversaDaConsulta = ConversaDoAviso & {
  contact?: ContatoIdentificavel | null;
};

/** De quanto em quanto tempo a fila de estacionadas é varrida. */
const VARREDURA_MS = 5_000;
/** Por quanto tempo uma atribuição fica guardada para a corrida da consulta. */
const JANELA_DA_CORRIDA_MS = 60_000;

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
    const estacionadas = new Map<string, { msg: Message; ate: number; ordem: number }>();
    // Ordem de CHEGADA pelo realtime, que entrega os INSERTs na ordem em que
    // foram gravados. É ela que diz qual mensagem é a mais nova: as consultas
    // de `avisar` voltam em qualquer ordem, e o carimbo empata no mesmo
    // milissegundo (Codex, PR #289).
    let chegadas = 0;
    // Quando cada conversa foi atribuída a esta pessoa (o UPDATE do realtime).
    // A atribuição pode chegar ENQUANTO a consulta de `avisar` está no ar: a
    // resposta volta com o dono velho, e a mensagem estacionaria DEPOIS de a
    // soltura já ter passado (revisão do PR #289).
    const atribuidasAgora = new Map<string, number>();
    // A ordem da última mensagem AVISADA de cada conversa: a soltura de uma
    // estacionada mais antiga, que pode chegar depois, não troca o aviso da
    // mais nova (mesma `tag`) por texto velho (revisão do PR #289).
    const avisadas = new Map<string, { ordem: number; em: number }>();
    // Até qual CHEGADA a pessoa já viu cada conversa (aberta nesta aba). É uma
    // geração, e não só apagar a fila: a consulta de uma mensagem que chegou
    // ANTES da abertura pode ainda estar no ar e estacionar depois — ou a da
    // soltura, que já tirou a mensagem da fila (Codex, PR #289).
    const vistas = new Map<string, { ate: number; em: number }>();
    const marcarVista = (conversaId: string) => {
      vistas.set(conversaId, { ate: chegadas, em: Date.now() });
      estacionadas.delete(conversaId);
    };
    const descartarAte = (conversaId: string, ordem: number) => {
      const parada = estacionadas.get(conversaId);
      if (parada && parada.ordem <= ordem) estacionadas.delete(conversaId);
    };

    // A pessoa está com ESTA conversa na tela agora? Conferido de novo na hora
    // de exibir: entre o INSERT e o aviso cabem a consulta e, na estacionada,
    // minutos — ela pode ter aberto a conversa nesse meio (Codex, PR #289).
    const vendoAgora = (conversaId: string) =>
      document.visibilityState === "visible" &&
      viewedConversationFromLocation(window.location.pathname, window.location.search) ===
        conversaId;

    const avisar = async (msg: Message, podeEstacionar: boolean, ordem: number) => {
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
      // Mensagem que chegou até a última vez que a pessoa ABRIU esta conversa
      // já foi vista: nem estaciona nem avisa.
      if ((vistas.get(msg.conversation_id)?.ate ?? 0) >= ordem) return;
      if (esperaAtribuicao(silencio)) {
        if (!podeEstacionar) return;
        const atribuidaEm = atribuidasAgora.get(msg.conversation_id);
        if (atribuidaEm !== undefined && atribuidaEm >= consultouEm) {
          void avisar(msg, false, ordem);
          return;
        }
        // As consultas de duas mensagens da mesma conversa podem voltar fora
        // de ordem: a mais ANTIGA não substitui a mais nova (Codex, PR #289).
        const atual = estacionadas.get(msg.conversation_id);
        if (atual && atual.ordem > ordem) return;
        // O prazo conta da MENSAGEM, não do estacionamento: a que chegou com
        // 50 min de atraso de entrega tem 10 min, não mais uma hora.
        const escrita = Date.parse(msg.created_at);
        const base = Number.isNaN(escrita) ? Date.now() : Math.min(Date.now(), escrita);
        estacionadas.set(msg.conversation_id, { msg, ate: base + JANELA_DA_ATRIBUICAO_MS, ordem });
        return;
      }
      if (silencio) return;
      if ((avisadas.get(msg.conversation_id)?.ordem ?? 0) > ordem) return;

      const labels = labelsRef.current;
      const titulo = nomeDoContato(conversa.contact, labels.fallbackTitle);
      const { body } = buildNotificationContent(msg, titulo, labels);
      if (vendoAgora(msg.conversation_id)) {
        descartarAte(msg.conversation_id, ordem);
        return;
      }
      avisadas.set(msg.conversation_id, { ordem, em: Date.now() });
      descartarAte(msg.conversation_id, ordem);

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
          void avisar(msg, true, ++chegadas);
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
          atribuidasAgora.set(id, agora);
          const parada = estacionadas.get(id);
          if (!parada) return;
          estacionadas.delete(id);
          if (Date.now() > parada.ate) return;
          if (getNotificationPermission() !== "granted") return;
          void avisar(parada.msg, false, parada.ordem);
        },
      )
      .subscribe();

    // A conversa ABERTA nesta aba sai da fila: a pessoa viu a mensagem, e
    // soltá-la depois seria aviso de mensagem já lida. Por EVENTO da caixa de
    // entrada — amostrar a URL perdia quem abre e sai entre dois tiques — e,
    // para a conversa que já estava aberta numa aba oculta, na volta dela.
    // ⚠️ Nunca pela não lida da conversa: ela é da CONTA, e qualquer fio
    // aberto — até numa aba oculta — a zera, o que calaria o aviso de quem
    // nunca viu a mensagem (revisão do PR #289).
    const aoAbrirConversa = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      // Só com a aba VISÍVEL: a aba oculta que termina de carregar uma
      // conversa por link também dispara o evento, e ninguém a viu (Codex,
      // PR #289). A volta à aba (`visibilitychange`) cobre o resto.
      if (typeof id === "string" && document.visibilityState === "visible") marcarVista(id);
    };
    window.addEventListener(EVENTO_CONVERSA_ABERTA, aoAbrirConversa);
    const varrer = () => {
      const agora = Date.now();
      for (const [id, parada] of estacionadas) {
        if (agora > parada.ate) estacionadas.delete(id);
        else if (vendoAgora(id)) marcarVista(id);
      }
      for (const [id, v] of vistas) {
        if (agora - v.em > JANELA_DA_ATRIBUICAO_MS) vistas.delete(id);
      }
      for (const [id, em] of atribuidasAgora) {
        if (agora - em > JANELA_DA_CORRIDA_MS) atribuidasAgora.delete(id);
      }
      for (const [id, a] of avisadas) {
        if (agora - a.em > JANELA_DA_ATRIBUICAO_MS) avisadas.delete(id);
      }
    };
    document.addEventListener("visibilitychange", varrer);
    // A varredura periódica tira a VENCIDA (e cobre a volta à aba que não
    // disparou evento nenhum).
    const varredura = window.setInterval(varrer, VARREDURA_MS);

    return () => {
      cancelado = true;
      window.clearInterval(varredura);
      window.removeEventListener(EVENTO_CONVERSA_ABERTA, aoAbrirConversa);
      document.removeEventListener("visibilitychange", varrer);
      estacionadas.clear();
      atribuidasAgora.clear();
      avisadas.clear();
      vistas.clear();
      supabase.removeChannel(canal);
    };
  }, [ativo, userId, router]);
}
