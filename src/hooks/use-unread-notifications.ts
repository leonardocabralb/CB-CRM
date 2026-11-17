"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { criarRecontagem } from "@/lib/notifications/recontagem-do-sino";

/**
 * Cada inscrição ganha um tópico próprio: o cliente do Supabase é um só, e
 * `channel(nome)` devolveria o canal que ainda está saindo depois do
 * `removeChannel` (o efeito duplo do dev) — o selo ficaria surdo até recarregar.
 */
let geracaoDoCanal = 0;

/**
 * Count of unread notifications for the current user. Used by the
 * sidebar to surface a badge on the Notifications nav entry.
 *
 * RLS on `notifications` already scopes every read to the caller's own
 * notifications in their accounts (1067), so no explicit filter is needed
 * here — same pattern as `useTotalUnread` for conversations.
 *
 * ⚠️ Every realtime change RECOUNTS in the database, never a ±1 delta: a
 * DELETE reaches every connected client of every account, and an UPDATE
 * carries no "before" row — see `recontagem-do-sino.ts`.
 */
export function useUnreadNotifications(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    const recontagem = criarRecontagem(async () => {
      // head:true skips fetching rows — we only need the `count`
      // supabase-js returns alongside the (empty) response body.
      const { count: unreadCount, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .is("read_at", null);
      return error ? null : (unreadCount ?? 0);
    }, setCount);

    recontagem.agora();

    const channel = supabase
      .channel(`notifications-unread-count:${++geracaoDoCanal}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => recontagem.pedir(),
      )
      // A (re)inscrição reconta: o que mudou entre a primeira contagem e a
      // entrada no canal, ou com o canal caído, não chega como evento.
      .subscribe((status) => {
        if (status === "SUBSCRIBED") recontagem.pedir();
      });

    return () => {
      recontagem.parar();
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}
