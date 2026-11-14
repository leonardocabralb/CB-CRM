"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { CaixinhaDaIa } from "@/components/notifications/caixinha-da-ia";
import { useAuth } from "@/hooks/use-auth";
import { avisoPossivelNoAparelho, usePreferenciaDeAviso } from "@/hooks/use-browser-notifications";
import { EVENTO_ABRIR_CONVERSA, EVENTO_CONVERSA_ABERTA, EVENTO_VER_EM_ATRASO } from "@/lib/inbox/url";
import {
  abaEmFoco,
  avisosParaReabrir,
  caixinhaTocaOSom,
  caixinhasDaConversa,
  desdeDaReabertura,
  ehAlarmeDaIa,
  idDaCaixinha,
  temCaixinha,
  TETO_NA_REABERTURA,
  TIPOS_COM_CAIXINHA,
  tomDaCaixinha,
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
 *
 * 1140 (F1): o ALARME de que a IA parou (`ia_falhou`) usa a mesma caixinha,
 * VERMELHA, e o clique leva às conversas "Em atraso" (sem conversa própria).
 * Ela some quando a IA volta: o servidor marca o alarme como lido.
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
    // Os avisos da IA que já se sabe LIDOS nesta página (o clique, o UPDATE do
    // tempo real): nunca reabrem — nem a foto da consulta da abertura, que
    // pode ter saído antes da leitura (Codex, #511).
    const lidos = new Set<string>();
    // As fechadas no X nesta página: a releitura da reconexão não as reabre.
    const dispensadas = new Set<string>();

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
      lidos.add(aviso.id);
      fechar(aviso.id);
      void marcarLido(aviso.id);
      const rota = rotaDoAviso(aviso);
      if (rota) vivoRef.current.router.push(rota);
      // Com a caixa de entrada já montada, o push só troca a query: a página
      // abre a conversa por este sinal (como no pop-up do navegador).
      if (aviso.conversation_id) {
        window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CONVERSA, { detail: aviso.conversation_id }));
      }
      // 1140: o alarme da IA leva às clientes "Em atraso"; com a caixa de
      // entrada já montada, o `?ver=` não a remonta — este sinal acende o chip.
      if (ehAlarmeDaIa(aviso.type)) window.dispatchEvent(new CustomEvent(EVENTO_VER_EM_ATRASO));
    };

    const mostrar = (aviso: Notification, comSom: boolean) => {
      if (lidos.has(aviso.id) || dispensadas.has(aviso.id)) return;
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
            tom={tomDaCaixinha(aviso.type)}
            titulo={aviso.title}
            corpo={aviso.body?.trim() ? aviso.body : null}
            onAbrir={() => abrir(aviso)}
            onFechar={() => {
              dispensadas.add(aviso.id);
              fechar(aviso.id);
            }}
          />
        ),
        { id: idDaCaixinha(aviso.id), duration: Infinity },
      );
    };

    // D6: os avisos da IA ainda NÃO lidos das últimas 24 h voltam a abrir a
    // caixinha. ⚠️ Só depois de o canal CONFIRMAR a inscrição (`SUBSCRIBED`,
    // como o `ligacoes-provider.tsx`): `.subscribe()` só começa a entrar, e um
    // INSERT entre a consulta e a entrada não estaria em nenhum dos dois
    // (Codex, #511). A reconexão relê também (o que chegou com o canal caído);
    // o repetido cala pelo id, o lido e o fechado no X não voltam. O
    // `user_id` vai ESCRITO na consulta (a RLS também recorta). Falha = só o
    // sino, como antes.
    const reabrirNaoLidos = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .in("type", [...TIPOS_COM_CAIXINHA])
        .is("read_at", null)
        .gte("created_at", desdeDaReabertura(Date.now()))
        .order("created_at", { ascending: false })
        .limit(TETO_NA_REABERTURA);
      if (cancelado) return;
      if (error) {
        console.warn("[useAvisoDaIaNaTela] avisos não lidos não carregados:", error.message);
        return;
      }
      for (const aviso of avisosParaReabrir((data ?? []) as Notification[], lidos)) mostrar(aviso, false);
    };

    const canal = supabase
      .channel(`aviso-da-ia-na-tela:${++geracaoDoCanal}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const aviso = payload.new as Notification;
          if (!temCaixinha(aviso.type)) return;
          mostrar(aviso, true);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          // Lido por outro caminho (o sino, o pop-up, outra aba): a caixinha
          // sai — e o id fica guardado, para a consulta da abertura ainda no
          // ar não a reabrir com a foto de antes da leitura.
          const aviso = payload.new as Notification;
          if (!aviso.read_at || !temCaixinha(aviso.type)) return;
          lidos.add(aviso.id);
          if (abertas.has(aviso.id)) fechar(aviso.id);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void reabrirNaoLidos();
      });

    // A conversa aberta na caixa de entrada (pela lista, pelo sino…): quem
    // está nela não precisa mais da caixinha. ⚠️ E conta como DISPENSADA, como
    // o X: a releitura de cada reconexão do tempo real (`SUBSCRIBED`) a
    // reabria, para quem já tinha agido. O aviso segue não lido no sino.
    const aoAbrirConversa = (e: Event) => {
      const conversaId = (e as CustomEvent<unknown>).detail;
      if (typeof conversaId !== "string") return;
      for (const avisoId of caixinhasDaConversa(abertas, conversaId)) {
        dispensadas.add(avisoId);
        fechar(avisoId);
      }
    };
    window.addEventListener(EVENTO_CONVERSA_ABERTA, aoAbrirConversa);

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
