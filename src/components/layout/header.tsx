"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useModoAnonimo } from "@/hooks/use-modo-anonimo";
import { EyeOff, LogOut, Menu, Settings as SettingsIcon, User } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { ABRE_PARA_BAIXO } from "@/components/layout/popup-do-cabecalho";
import { ChannelHealthIndicator } from "@/components/channels/channel-health-indicator";
import { SchedulerHealthIndicator } from "@/components/scheduled/scheduler-health-indicator";

const pageTitles: Record<string, string> = {
  "/dashboard": "dashboard",
  "/meu-dia": "meuDia",
  "/radar": "radar",
  "/inbox": "inbox",
  "/notifications": "notifications",
  "/tarefas": "tasks",
  "/contacts": "contacts",
  "/pipelines": "pipelines",
  "/broadcasts": "broadcasts",
  "/agendadas": "scheduled",
  // ⚠️ Faltava desde que a agenda nasceu (945): `/agenda` caía em "dashboard"
  // e o cabeçalho dizia "Painel" sobre a agenda de reuniões. A chave
  // `Header.agenda` já existia nos dois dicionários — só o mapa não a lia.
  // ⚠️ DEPOIS de `/agendadas`, de propósito: `getPageTitleKey` casa por
  // `startsWith` na ORDEM de inserção, e `/agendadas/...` começa com
  // `/agenda` (a mesma armadilha que `telaDoCaminho` resolveu por tamanho).
  "/agenda": "agenda",
  // A pauta das reuniões. Nenhuma outra rota começa com `/reunioes` nem é
  // prefixo dela, então a ordem aqui não importa (ao contrário do par acima).
  "/reunioes": "reunioes",
  "/automations": "automations",
  // ⚠️ `/flows` e `/agents` faltavam aqui desde que as telas nasceram, e o
  // `getPageTitleKey` abaixo cai em "dashboard" para rota desconhecida — as
  // duas mostravam "Painel" no cabeçalho. Entram junto porque o defeito é
  // deste mapa, e deixar dois errados enquanto se acrescenta um certo é o jeito
  // de ninguém nunca consertar.
  "/flows": "flows",
  "/agents": "aiAgents",
  "/settings": "settings",
};

function getPageTitleKey(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "dashboard";
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

import { useTranslations } from "next-intl";

export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations("Header");
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  // Modo anônimo (decisão do operador, 01/10/2026): o interruptor mora no
  // menu do nome, e a pastilha escura ao lado do nome fica acesa em TODA
  // tela enquanto ele vale — é o que impede esquecê-lo ligado. Regra:
  // `.claude/rules/modo-anonimo.md`.
  const modoAnonimo = useModoAnonimo();
  // Ligar é de admin; DESLIGAR, sempre: com o papel desconhecido o modo
  // segue valendo (`modoAnonimoAtivo`), e o item tem de estar lá para isso.
  const mostraModoAnonimo = modoAnonimo.disponivel || modoAnonimo.ativo;
  const titleKey = getPageTitleKey(pathname);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t("openMenu")}
          className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
          {t(titleKey as string)}
        </h1>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <ChannelHealthIndicator />
        {/* Some sozinho quando não há nada a dizer — ver o componente. */}
        <SchedulerHealthIndicator />
        <ModeToggle />

        <DropdownMenu>
        <DropdownMenuTrigger
          className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/70 focus:bg-muted/70 focus:outline-none data-popup-open:bg-muted/70 sm:gap-3 sm:pl-1 sm:pr-3"
          aria-label={
            modoAnonimo.ativo
              ? t("openAccountMenuAnonimo")
              : t("openAccountMenu")
          }
        >
          <Avatar className="size-8">
            {profile?.avatar_url ? (
              <AvatarImage
                src={profile.avatar_url}
                alt={profile.full_name ?? t("defaultAvatar")}
              />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-sm font-medium text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium text-foreground sm:inline">
            {profile?.full_name ?? t("defaultUser")}
          </span>
          {/* Escura (`foreground`), e não violeta/âmbar/verde: essas já
              dizem outra coisa na tela (situação da conversa, presença). No
              celular o nome some e fica só o olho riscado. */}
          {modoAnonimo.ativo && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background">
              <EyeOff className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t("modoAnonimoAtivo")}</span>
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          // Sempre para baixo, com a altura pela tela: no app do iPhone o
          // menu abria para cima, cortado (`popup-do-cabecalho.ts`).
          collisionAvoidance={ABRE_PARA_BAIXO}
          // O primitivo mede o menu pelo gatilho (`w-(--anchor-width)`): com
          // o item do modo anônimo, a dica quebrava em quatro linhas.
          className={cn(
            "max-h-[calc(var(--altura-visivel,100dvh)-5rem)] min-w-56 bg-popover text-popover-foreground ring-border",
            mostraModoAnonimo && "w-72",
          )}
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium text-foreground">
              {profile?.full_name ?? t("defaultUser")}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {profile?.email ?? ""}
            </p>
          </div>
          <DropdownMenuSeparator className="bg-border" />
          {/* O item fica no menu mesmo durante a lente "Ver como": o modo é
              da pessoa REAL, como a presença e as escritas dela. */}
          {mostraModoAnonimo && (
            <>
              <DropdownMenuCheckboxItem
                checked={modoAnonimo.ativo}
                onCheckedChange={(ligar) => {
                  if (!modoAnonimo.definir(ligar)) {
                    toast.error(t("modoAnonimoFalhou"));
                  }
                }}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <EyeOff className="size-4" />
                <span className="flex min-w-0 flex-col">
                  <span>{t("modoAnonimo")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("modoAnonimoDica")}
                  </span>
                </span>
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator className="bg-border" />
            </>
          )}
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=profile"
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
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <SettingsIcon className="size-4" />
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
    </header>
  );
}
