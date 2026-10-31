"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { avisoPossivelNoAparelho, usePreferenciaDeAviso } from "@/hooks/use-browser-notifications";
import {
  getNotificationPermission,
  viewedConversationFromLocation,
} from "@/lib/notifications/browser-notify";
import { popUpDoSino, silencioDoSino } from "@/lib/notifications/aviso-do-sino";
import { textoDoAviso, type AvisoComContato } from "@/lib/notifications/texto-do-aviso";
import { tocarSomDoAviso } from "@/lib/notifications/som-do-aviso";
import {
  EVENTO_ABRIR_CONVERSA,
  EVENTO_IR_PARA_NOTA,
  type PedidoDeIrParaNota,
} from "@/lib/inbox/url";
import { podeVerTela } from "@/lib/perfis/visibilidade";
import type { Notification } from "@/types";

/**
 * Cada inscrição ganha um tópico próprio. ⚠️ O cliente do Supabase é um só
 * e `channel(nome)` devolve o canal EXISTENTE com o mesmo tópico — inclusive
 * o que ainda está saindo depois do `removeChannel` (desligar e religar a
 * chave rápido, o efeito duplo do dev). A inscrição nova pegaria esse canal
 * e o ouvinte ficaria mudo até recarregar (revisão do PR).
 */
let geracaoDoCanal = 0;

/** A conversa aberta na aba VISÍVEL, ou null. */
function conversaAVista(): string | null {
  if (document.visibilityState !== "visible") return null;
  return viewedConversationFromLocation(window.location.pathname, window.location.search);
}

/**
 * O pop-up dos avisos do SINO (menção, resposta à anotação, tarefa, conversa
 * atribuída, alerta do WhatsApp), pedido do operador em 20/10/2026 — a régua
 * em `aviso-do-sino.ts`, as decisões em
 * `docs/PLANO-avisos-do-sino-no-navegador.md`. Montado ao lado do ouvinte de
 * mensagens, no `BrowserNotificationsListener` (uma vez por aba, depois do
 * "Continuar").
 *
 * Ouve só os INSERTs do PRÓPRIO login (`user_id=eq.`; a RLS também recorta).
 * Sem carga inicial, como o de mensagens: o acúmulo do sino não vira rajada
 * ao abrir a página. Só com a aba aberta — sem service worker.
 */
export function useAvisosDoSinoNoNavegador(): void {
  const { user, profile, perfilDeAcesso } = useAuth();
  const { preferencia } = usePreferenciaDeAviso();
  const router = useRouter();
  const tTipos = useTranslations("NotificationsPage.tipos");

  const userId = user?.id ?? null;
  const ativo = preferencia.sino && userId !== null;

  // Lidos dentro do callback do realtime: por ref, para mudar o texto, o som
  // ou o perfil não derrubar e reabrir o canal.
  const vivoRef = useRef({
    // ⚠️ O contexto REAL, nunca o `acesso` (a lente do "Ver como"): quem
    // simula continua sendo quem recebe o aviso.
    ctx: { papel: profile?.account_role ?? null, perfil: perfilDeAcesso },
    preferencia,
    tTipos,
  });
  useEffect(() => {
    vivoRef.current = {
      ctx: { papel: profile?.account_role ?? null, perfil: perfilDeAcesso },
      preferencia,
      tTipos,
    };
  });

  // Ids já tratados, contra a reentrega do realtime ao reconectar.
  const vistosRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!ativo || !userId) return;
    if (!avisoPossivelNoAparelho()) return;

    const supabase = createClient();
    let cancelado = false;

    // D6: o clique marca lido, como o clique no sino. Zero linhas não é falha
    // a mostrar: o aviso já foi lido noutra aba ou no sino, e nada na tela
    // afirma esta escrita (o número do sino se atualiza pelo próprio realtime).
    const marcarLido = async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (error) console.warn("[useAvisosDoSinoNoNavegador] aviso não marcado como lido:", error.message);
    };

    const exibir = async (aviso: Notification) => {
      let comContato: AvisoComContato = aviso;
      // Só a conversa atribuída precisa do contato: o texto dela sai do
      // dicionário (o gatilho da 0027 grava em inglês). Sem o contato, a
      // frase fica com "um contato" — nunca um nome adivinhado.
      if (aviso.type === "conversation_assigned" && aviso.contact_id) {
        const { data, error } = await supabase
          .from("contacts")
          .select("name, phone, wa_username, instagram_username")
          .eq("id", aviso.contact_id)
          .maybeSingle();
        if (cancelado) return;
        if (error) console.warn("[useAvisosDoSinoNoNavegador] contato ilegível:", error.message);
        comContato = { ...aviso, contact: data ?? null };
        // A consulta deu tempo de a pessoa abrir a conversa.
        if (aviso.conversation_id && conversaAVista() === aviso.conversation_id) return;
      }

      const { preferencia: pref, tTipos: t } = vivoRef.current;
      // Sem o autor, a voz passiva (`corpoSemAutor`): afirmar quem atribuiu
      // exigiria a lista de membros, que o pop-up não carrega.
      const popUp = popUpDoSino(aviso, textoDoAviso(comContato, null, t), pref.mostrarTexto);

      try {
        const notificacao = new Notification(popUp.titulo, {
          body: popUp.corpo ?? undefined,
          tag: popUp.tag,
          icon: "/icon",
          // Som do CRM (D4): tocado, o do sistema se cala; sem ele (desligado
          // ou a aba sem clique), o sistema decide, como antes.
          silent: pref.somNoSino && tocarSomDoAviso(),
        });
        notificacao.onclick = () => {
          window.focus();
          void marcarLido(aviso.id);
          if (popUp.rota) router.push(popUp.rota);
          // Com a caixa de entrada já montada, o push só troca a query: a
          // página abre a conversa por este sinal (como no aviso de mensagem).
          if (popUp.conversaId) {
            window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CONVERSA, { detail: popUp.conversaId }));
            // 1114: e o fio salta até a anotação que gerou o aviso — também
            // quando a conversa já estava aberta (aí só o salto age).
            if (popUp.notaId) {
              const pedido: PedidoDeIrParaNota = { conversaId: popUp.conversaId, notaId: popUp.notaId };
              window.dispatchEvent(new CustomEvent(EVENTO_IR_PARA_NOTA, { detail: pedido }));
            }
          }
          notificacao.close();
        };
      } catch (err) {
        // Alguns navegadores lançam no construtor (o Chrome do Android exige
        // service worker). Não é fatal: o aviso continua no sino.
        console.error("[useAvisosDoSinoNoNavegador] aviso não exibido:", err);
      }
    };

    const canal = supabase
      .channel(`avisos-do-sino-no-navegador:${++geracaoDoCanal}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          // Conferido a cada evento: a pessoa pode revogar a permissão no
          // navegador sem a preferência mudar.
          if (getNotificationPermission() !== "granted") return;
          const aviso = payload.new as Notification;
          const silencio = silencioDoSino({
            aviso,
            userId,
            podeVerCaixa: podeVerTela(vivoRef.current.ctx, "inbox"),
            vistos: vistosRef.current,
            conversaAVista: conversaAVista(),
            agoraMs: Date.now(),
          });
          if (silencio) return;
          void exibir(aviso);
        },
      )
      .subscribe();

    return () => {
      cancelado = true;
      supabase.removeChannel(canal);
    };
  }, [ativo, userId, router]);
}
