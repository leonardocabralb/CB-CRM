"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { CaixinhaDaIa } from "@/components/notifications/caixinha-da-ia";
import { useAuth } from "@/hooks/use-auth";
import { avisoPossivelNoAparelho, usePreferenciaDeAviso } from "@/hooks/use-browser-notifications";
import { EVENTO_ABRIR_CONVERSA, EVENTO_CONVERSA_ABERTA } from "@/lib/inbox/url";
import {
  abaEmFoco,
  caixinhaTocaOSom,
  caixinhasDaConversa,
  desdeDaReabertura,
  idDaCaixinha,
  TETO_NA_REABERTURA,
  TIPO_DO_AVISO_DA_IA,
} from "@/lib/notifications/aviso-da-ia";
import { silencioDoSino } from "@/lib/notifications/aviso-do-sino";
import { getNotificationPermission, viewedConversationFromLocation } from "@/lib/notifications/browser-notify";
import { rotaDoAviso } from "@/lib/notifications/rota-do-aviso";
import { tocarSomDoAviso } from "@/lib/notifications/som-do-aviso";
import { podeVerTela } from "@/lib/perfis/visibilidade";
import { createClient } from "@/lib/supabase/client";
import type { Notification } from "@/types";

/** Tópico novo a cada inscrição (a mesma armadilha de `useAvisosDoSinoNoNavegador`). */
let geracaoDoCanal = 0;

/** A conversa aberta na aba VISÍVEL, ou null. */
function conversaAVista(): string | null {
  if (document.visibilityState !== "visible") return null;
  return viewedConversationFromLocation(window.location.pathname, window.location.search);
}

/**
 * A caixinha clicável dentro do CRM quando um agente de IA passa a conversa
 * para a equipe (1139; decisões D3 e D4 do operador,
 * `docs/PLANO-aviso-da-ia-que-passa-a-conversa.md`). Montado no
 * `BrowserNotificationsListener` (uma vez por aba, depois do "Continuar").
 *
 * Ouve os INSERTs `ia_transferiu` do PRÓPRIO login — independente da
 * permissão do navegador e da chave do sino: a caixinha é do CRM, vale no
 * celular e para quem nunca ligou o pop-up. Cala como o pop-up do sino
 * (`silencioDoSino`): sem a Caixa de entrada no perfil, aviso de outra
 * pessoa, já lido, repetido, ou a conversa já aberta na aba visível.
 *
 * Fica até a pessoa agir: clicar abre a conversa e marca o aviso lido; o X só
 * fecha. Some também quando o aviso é lido por outro caminho (sino, pop-up,
 * outra aba) e quando a conversa é aberta na caixa de entrada.
 *
 * Ao montar (abrir o CRM, recarregar), voltam as dos avisos ainda NÃO lidos
 * das últimas 24 h (D6 do operador, 12/11/2026), sem som — não são novos. O X
 * vale só naquela página: recarregada, a caixinha volta até o aviso ser lido.
 */
export function useAvisoDaIaNaTela(): void {
  const { user, profile, perfilDeAcesso } = useAuth();
  const { preferencia } = usePreferenciaDeAviso();
  const router = useRouter();
  const userId = user?.id ?? null;

  // Lidos dentro do callback do realtime: por ref, para mudar o perfil ou a
  // preferência não derrubar e reabrir o canal. O contexto é o REAL, nunca a
  // lente do "Ver como".
  const vivoRef = useRef({
    ctx: { papel: profile?.account_role ?? null, perfil: perfilDeAcesso },
    preferencia,
    router,
  });
  useEffect(() => {
    vivoRef.current = {
      ctx: { papel: profile?.account_role ?? null, perfil: perfilDeAcesso },
      preferencia,
      router,
    };
  });

  // Ids já tratados, contra a reentrega do realtime ao reconectar.
  const vistosRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let cancelado = false;
    // As caixinhas abertas: id do aviso → conversa.
    const abertas = new Map<string, string | null>();

    const fechar = (avisoId: string) => {
      abertas.delete(avisoId);
      toast.dismiss(idDaCaixinha(avisoId));
    };

    // O clique marca lido, como o clique no sino. Zero linhas não é falha: o
    // aviso já foi lido noutra aba ou no sino.
    const marcarLido = async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (error) console.warn("[useAvisoDaIaNaTela] aviso não marcado como lido:", error.message);
    };

    const abrir = (aviso: Notification) => {
      fechar(aviso.id);
      void marcarLido(aviso.id);
      const rota = rotaDoAviso(aviso);
      if (rota) vivoRef.current.router.push(rota);
      // Com a caixa de entrada já montada, o push só troca a query: a página
      // abre a conversa por este sinal (como no pop-up do navegador).
      if (aviso.conversation_id) {
        window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CONVERSA, { detail: aviso.conversation_id }));
      }
    };

    const mostrar = (aviso: Notification, comSom: boolean) => {
      const { ctx, preferencia: pref } = vivoRef.current;
      const silencio = silencioDoSino({
        aviso,
        userId,
        podeVerCaixa: podeVerTela(ctx, "inbox"),
        vistos: vistosRef.current,
        conversaAVista: conversaAVista(),
        agoraMs: Date.now(),
      });
      if (silencio) return;

      // O som sai daqui só quando o pop-up do sistema não vai sair — senão
      // tocariam os dois (`caixinhaTocaOSom`).
      const popUpPossivel = pref.sino && getNotificationPermission() === "granted" && avisoPossivelNoAparelho();
      if (comSom && caixinhaTocaOSom({ somNoSino: pref.somNoSino, abaEmFoco: abaEmFoco(), popUpPossivel })) {
        tocarSomDoAviso();
      }

      abertas.set(aviso.id, aviso.conversation_id ?? null);
      toast.custom(
        () => (
          <CaixinhaDaIa
            titulo={aviso.title}
            corpo={aviso.body?.trim() ? aviso.body : null}
            onAbrir={() => abrir(aviso)}
            onFechar={() => fechar(aviso.id)}
          />
        ),
        { id: idDaCaixinha(aviso.id), duration: Infinity },
      );
    };

    const canal = supabase
      .channel(`aviso-da-ia-na-tela:${++geracaoDoCanal}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const aviso = payload.new as Notification;
          if (aviso.type !== TIPO_DO_AVISO_DA_IA) return;
          mostrar(aviso, true);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          // Lido por outro caminho (o sino, o pop-up, outra aba): a caixinha sai.
          const aviso = payload.new as Notification;
          if (aviso.read_at && abertas.has(aviso.id)) fechar(aviso.id);
        },
      )
      .subscribe();

    // A conversa aberta na caixa de entrada (pela lista, pelo sino…): quem
    // está nela não precisa mais da caixinha.
    const aoAbrirConversa = (e: Event) => {
      const conversaId = (e as CustomEvent<unknown>).detail;
      if (typeof conversaId !== "string") return;
      for (const avisoId of caixinhasDaConversa(abertas, conversaId)) fechar(avisoId);
    };
    window.addEventListener(EVENTO_CONVERSA_ABERTA, aoAbrirConversa);

    // D6: os avisos da IA ainda NÃO lidos das últimas 24 h voltam a abrir a
    // caixinha — depois de inscrever o canal, para nenhum INSERT cair no vão
    // (o repetido, o `silencioDoSino` cala pelo id). O `user_id` vai ESCRITO na
    // consulta (a RLS também recorta). Falha = só o sino, como antes.
    void (async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .eq("type", TIPO_DO_AVISO_DA_IA)
        .is("read_at", null)
        .gte("created_at", desdeDaReabertura(Date.now()))
        .order("created_at", { ascending: false })
        .limit(TETO_NA_REABERTURA);
      if (cancelado) return;
      if (error) {
        console.warn("[useAvisoDaIaNaTela] avisos não lidos não carregados:", error.message);
        return;
      }
      // O mais antigo primeiro: o sonner põe o último no topo da pilha.
      for (const aviso of [...((data ?? []) as Notification[])].reverse()) mostrar(aviso, false);
    })();

    return () => {
      cancelado = true;
      window.removeEventListener(EVENTO_CONVERSA_ABERTA, aoAbrirConversa);
      supabase.removeChannel(canal);
      // Sem o ouvinte (saiu, trocou de login), a caixinha não teria quem a
      // fechasse quando o aviso fosse lido.
      for (const avisoId of [...abertas.keys()]) fechar(avisoId);
    };
  }, [userId]);
}
