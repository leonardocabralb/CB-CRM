"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { LogoDaMarca, SimboloDaMarca } from "@/components/marca/logo-da-marca";
import { useMarca } from "@/components/marca/marca-provider";
import { useAuth } from "@/hooks/use-auth";
import { useMenuRecolhido } from "@/hooks/use-menu-recolhido";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { useTarefasNaoLidas } from "@/hooks/use-tarefas-nao-lidas";
import {
  Activity,
  Bell,
  Bot,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Crown,
  GitBranch,
  LayoutDashboard,
  Sunrise,
  ListTodo,
  LogOut,
  MessageSquare,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import { ROTA_DA_TELA } from "@/lib/perfis/catalogo";
import { podeVerTela, telaDoCaminho } from "@/lib/perfis/visibilidade";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    // Primary-tinted: significant but not as scarce as owner.
    className:
      "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    // Neutral slate: the operational default.
    className:
      "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    // Muted slate: read-only role; visually quieter than agent.
    className:
      "border-border bg-card text-muted-foreground",
  },
};
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ItemDoMenu } from "@/components/layout/menu-recolhivel";

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  // O painel PRÓPRIO (Meu dia, F3): a mesma tela da entrada, para rever o dia
  // a qualquer hora. Logo abaixo do Painel — para quem não tem o Painel
  // (Advogado, Observador), é o primeiro item. ⚠️ Fica FORA do catálogo de
  // perfis de propósito: `telaDoCaminho` devolve null e o filtro abaixo deixa
  // passar; uma tela nova no catálogo nasceria invisível para todo perfil já
  // gravado.
  { href: "/meu-dia", labelKey: "meuDia", icon: Sunrise },
  // Logo abaixo do Painel: as duas telas são "visão do conjunto" — o
  // Painel conta números, o Radar diz PARA ONDE olhar (e salta pro inbox).
  { href: "/radar", labelKey: "radar", icon: Activity },
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
  { href: "/notifications", labelKey: "notifications", icon: Bell },
  // Ao lado de Notificações, e não do inbox: as duas respondem à mesma
  // pergunta ("o que é meu, e o que ainda não vi"). A tarefa também aparece
  // na ficha do cliente e na conversa — esta entrada é para olhar o conjunto.
  { href: "/tarefas", labelKey: "tasks", icon: ListTodo },
  { href: "/contacts", labelKey: "contacts", icon: Users },
  // Acima dos Funis: a agenda é rotina diária de quem atende, os funis são
  // acompanhamento de negócio. Reunião marcada é o compromisso que a pessoa
  // precisa ver ao abrir o sistema de manhã.
  { href: "/agenda", labelKey: "agenda", icon: CalendarDays },
  // Logo abaixo da Agenda: a pauta das reuniões marcadas (Calendly + agenda do
  // CRM), com os botões que movem o card. ⚠️ Fica FORA do catálogo de perfis,
  // como `/meu-dia`: `telaDoCaminho` devolve null e o filtro abaixo deixa
  // passar — uma tela nova no catálogo nasceria invisível para todo perfil já
  // gravado. O recorte por funil é feito DENTRO da tela.
  { href: "/reunioes", labelKey: "reunioes", icon: CalendarCheck },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
  { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
  // Ao lado de Disparos, e não do inbox: as duas telas respondem à mesma
  // pergunta ("o que sai daqui, e quando"). Dentro da conversa a agendada
  // continua aparecendo na faixa acima do compositor — esta entrada é para
  // olhar o conjunto, não uma conversa.
  { href: "/agendadas", labelKey: "scheduled", icon: CalendarClock },
  { href: "/automations", labelKey: "automations", icon: Zap },
  { href: "/flows", labelKey: "flows", icon: Workflow, beta: true },
  { href: "/agents", labelKey: "aiAgents", icon: Bot },
];

const bottomNavItems = [
  { href: "/settings", labelKey: "settings", icon: Settings },
];

// Menu recolhido: o contador de não lidas sai da ponta da linha (que some)
// e vira selo no canto do ícone. O anel da cor do fundo o separa do traço.
const CONTADOR_SOBRE_O_ICONE =
  "absolute right-0.5 top-0.5 h-4 min-w-4 text-[9px] ring-2 ring-card";

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

import { useTranslations } from "next-intl";

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut, acesso } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const tarefasNaoLidas = useTarefasNaoLidas();
  const marca = useMarca();
  // Só os ícones (o botão mora no cabeçalho). Já sai falso abaixo de `lg`:
  // a gaveta do celular mostra sempre os nomes, e nada aqui precisa do
  // prefixo `lg:` para não vazar para ela.
  const { recolhido } = useMenuRecolhido();
  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    // O provider (sem DOM) faz a dica do item seguinte abrir sem espera ao
    // correr o mouse pelo menu recolhido.
    <TooltipProvider>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-border bg-card",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          // Recolhido: 64 px = o `px-3` do <nav> + o ícone no `px-3` do item
          // dos DOIS lados — os ícones não saem do lugar ao recolher.
          "lg:static lg:z-0 lg:translate-x-0 lg:transition-none",
          recolhido ? "lg:w-16" : "lg:w-60",
        )}
        aria-label={t("primaryNav")}
      >
        {/* Logo row. On mobile we put a close button here; on desktop the
            close button is hidden since the sidebar is always-visible.
            ⚠️ `pl-6` (24 px) = o `px-3` do <nav> + o `px-3` do item: o logo
            começa na MESMA coluna dos ícones do menu (pedido do operador,
            20/10/2026; com `px-4` ficava 8 px à esquerda deles). Recolhido,
            o símbolo fica centrado sobre a coluna dos ícones. */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border",
            recolhido ? "justify-center" : "pl-6 pr-4",
          )}
        >
          {/* ⚠️ A marca é DADO da instalação (Configurações → Marca; o layout
              raiz a entrega pelo `MarcaProvider`), nunca dicionário nem
              build-arg: nome de produto não é tradução, e quem compra o
              sistema troca nome e logo pela tela. O logo horizontal do fundo
              do modo vigente; sem ele, símbolo + nome em texto
              (`LogoDaMarca`). `min-w-0` e o teto de largura: no celular a
              linha divide os 256 px com o botão de fechar. Recolhido, só o
              símbolo (a imagem é decorativa: o nome vai no `aria-label`). */}
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center"
            aria-label={recolhido ? marca.nome : undefined}
          >
            {recolhido ? (
              <SimboloDaMarca className="h-8 w-8" />
            ) : (
              <LogoDaMarca forma="horizontal" className="h-7 w-auto max-w-44" />
            )}
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation. Recolhido, a barra de rolagem (tela baixa, mouse
            com barra clássica) comeria 15 px dos 64: some a barra, a rolagem
            continua pela roda e pelo toque. */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto px-3 py-4",
            recolhido && "[scrollbar-width:none]",
          )}
        >
          <ul className="flex flex-col gap-1">
            {navItems
              .filter((item) => {
                // Recorte por perfil (Fase 2). O shell só renderiza depois
                // de `profileLoading` resolver, então `acesso` aqui é final —
                // sem flash. Item cujo href não resolve para tela do
                // catálogo passa (não é recortável).
                const tela = telaDoCaminho(item.href, ROTA_DA_TELA);
                return tela === null || podeVerTela(acesso, tela);
              })
              .map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));

              const showUnreadDot =
                item.href === "/inbox" && totalUnread > 0 && !isActive;

              // Unlike the inbox dot, the notifications count stays visible
              // even while the page is active — it reflects unread state
              // (cleared by marking notifications read), not "currently
              // viewing this section".
              const showNotificationBadge =
                item.href === "/notifications" && unreadNotifications > 0;

              // Mesma regra da de notificações: continua visível na página
              // ativa, porque conta estado (não lida) e não "estou aqui".
              const showTaskBadge =
                item.href === "/tarefas" && tarefasNaoLidas > 0;

              const rotulo = t(item.labelKey as string);

              return (
                <li key={item.href}>
                  <ItemDoMenu
                    href={item.href}
                    rotulo={rotulo}
                    recolhido={recolhido}
                    className={cn(
                      // Taller on mobile so fingers can hit the row reliably (≥44px).
                      "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {/* Recolhido, o nome sai da tela mas fica para o leitor
                        de tela (e aparece na dica ao passar o mouse). */}
                    <span className={cn("flex-1", recolhido && "sr-only")}>
                      {rotulo}
                    </span>
                    {item.beta && !recolhido && (
                      <span
                        aria-label={t("beta")}
                        className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300"
                      >
                        {t("beta")}
                      </span>
                    )}
                    {showUnreadDot && (
                      <span
                        aria-label={t("unreadConversations", { count: totalUnread })}
                        className={cn(
                          "relative flex h-2 w-2",
                          recolhido && "absolute right-1.5 top-1.5",
                        )}
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                      </span>
                    )}
                    {showTaskBadge && (
                      <span
                        aria-label={t("unreadTasks", { count: tarefasNaoLidas })}
                        className={cn(
                          "flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground",
                          recolhido && CONTADOR_SOBRE_O_ICONE,
                        )}
                      >
                        {tarefasNaoLidas > 9 ? "9+" : tarefasNaoLidas}
                      </span>
                    )}
                    {showNotificationBadge && (
                      <span
                        aria-label={t("unreadNotifications", { count: unreadNotifications })}
                        className={cn(
                          "flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground",
                          recolhido && CONTADOR_SOBRE_O_ICONE,
                        )}
                      >
                        {unreadNotifications > 9 ? "9+" : unreadNotifications}
                      </span>
                    )}
                  </ItemDoMenu>
                </li>
              );
            })}
          </ul>

          <div className="my-4 border-t border-border" />

          <ul className="flex flex-col gap-1">
            {bottomNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href);
              const rotulo = t(item.labelKey as string);
              return (
                <li key={item.href}>
                  <ItemDoMenu
                    href={item.href}
                    rotulo={rotulo}
                    recolhido={recolhido}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className={cn(recolhido && "sr-only")}>{rotulo}</span>
                  </ItemDoMenu>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-border p-3">
          {/* Account name display — surfaced only when the account
              name differs from the user's own name (see
              `showAccountStrip`). For a default solo account the two
              match, so we hide it to avoid duplicating the user name
              below; for renamed or shared accounts it tells the user
              which account they're acting in. Recolhido, some: não cabe
              em 64 px. */}
          {showAccountStrip && account?.name && !recolhido ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-muted-foreground">
              <UsersRound className="size-3.5 shrink-0" />
              {/* `title=` exposes the full name on hover when it
                  gets truncated (long account names + narrow
                  sidebars). Cheap a11y win. */}
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                // Always render the chip — owners used to be
                // invisible here, which made them indistinguishable
                // from admins at a glance. Now everyone sees their
                // role (with a colour cue) regardless of tier.
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {t(meta.labelKey as string)}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            {/* Recolhido, só o avatar (o nome continua no cabeçalho); o
                menu abre para o lado, senão sairia da tela pela esquerda. */}
            <DropdownMenuTrigger
              aria-label={
                recolhido ? (profile?.full_name ?? t("defaultUser")) : undefined
              }
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60",
                recolhido && "justify-center px-0",
              )}
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? t("defaultAvatar")}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className={cn("min-w-0 flex-1", recolhido && "hidden")}>
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? t("defaultUser")}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side={recolhido ? "right" : "top"}
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                {t("menuProfile")}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=channels"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                {t("menuSettings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t("menuSignOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </TooltipProvider>
  );
}
