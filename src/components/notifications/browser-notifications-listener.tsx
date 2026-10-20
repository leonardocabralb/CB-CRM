"use client";

import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import { useAvisosDoSinoNoNavegador } from "@/hooks/use-avisos-do-sino-no-navegador";

/**
 * Headless. Mount ONCE per signed-in dashboard tab (the dashboard
 * shell, below the auth gate) so desktop notifications for new customer
 * messages fire on every dashboard page, not just the inbox.
 */
export function BrowserNotificationsListener() {
  useBrowserNotifications();
  // NOSSO (20/10/2026): o pop-up dos avisos do sino — menção, tarefa e o
  // resto (`docs/PLANO-avisos-do-sino-no-navegador.md`).
  useAvisosDoSinoNoNavegador();
  return null;
}
