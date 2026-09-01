"use client";

// ============================================================
// Painel lateral de uma conversa de GRUPO.
//
// Componente separado do `contact-sidebar.tsx` de propósito: aquele é
// contato de ponta a ponta (etiquetas, negócios, histórico do lead) e nada
// disso existe num grupo. Enfiar ramos de `if (grupo)` lá deixaria os dois
// piores.
//
// ⚠️ Ganhou ABAS em 2026-09-01, e até então não tinha nenhuma. Duas das
// features que o painel do contato tem NÃO dependem de contato:
//
//   - **Arquivos** — o acervo é da CONVERSA; o componente é o mesmo.
//   - **Notas** — `cb_conversation_notes.conversation_id` é NOT NULL e
//     `contact_id` é anulável, e o comentário da migration 918 já antecipa
//     o caso de grupo por escrito. O hook sempre buscou por conversa. Só o
//     painel não expunha.
//
// O que continua de fora, e por quê: tarefas e campos personalizados exigem
// `contact_id NOT NULL` (944 / 001); negócios e histórico o banco aceitaria,
// mas dependem de decisão de produto; automações estão excluídas por desenho
// (`cb-groups/persist.ts` não importa os motores, e há teste vigiando).
// ⚠️ FIXAR nota também fica de fora, e é estrutural: o índice único da 951
// exige `contact_id NOT NULL` — fixação é conceito da ficha do cliente.
// ============================================================

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Users,
  RefreshCw,
  Pencil,
  Megaphone,
  ShieldCheck,
  PanelRightClose,
} from "lucide-react";

import type { CbGroup, Message } from "@/types";
import { useChannels } from "@/hooks/use-channels";
import { useConversationNotes } from "@/hooks/use-conversation-notes";
import { nomeDoGrupo, podeRenomearNoWhatsApp } from "@/lib/cb-groups/display";
import { TituloDeSecao } from "@/components/inbox/painel/painel-do-contato";
import { LinhaDeEdicao } from "@/components/inbox/painel/linha-de-edicao";
import { AbaArquivos } from "@/components/inbox/painel/aba-arquivos";
import { InternalNoteBox } from "@/components/inbox/internal-note-box";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface GroupSidebarProps {
  grupo: CbGroup | null;
  /**
   * A conversa aberta. Necessária para as anotações — elas são chaveadas pela
   * CONVERSA (918), não pelo contato, que num grupo é nulo.
   */
  conversationId?: string | null;
  /** Reflete no estado do pai o que a rota devolveu. */
  onGrupoAtualizado?: (patch: Partial<CbGroup>) => void;
  /** Fecha o painel — mesmo botão, mesmo lugar que na ficha do contato. */
  onClose?: () => void;
  /** O fio, para a aba Arquivos. Ver `PainelDoContatoProps.messages`. */
  messages?: Message[];
}

export function GroupSidebar({
  grupo,
  conversationId,
  onGrupoAtualizado,
  onClose,
  messages = [],
}: GroupSidebarProps) {
  const t = useTranslations("Inbox.groupSidebar");
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");
  const { channels } = useChannels();
  const { notas, acrescentar: acrescentarNota } =
    useConversationNotes(conversationId);

  const [editandoApelido, setEditandoApelido] = useState(false);
  const [apelido, setApelido] = useState("");
  const [editandoNomeReal, setEditandoNomeReal] = useState(false);
  const [nomeReal, setNomeReal] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  const patch = useCallback(
    async (corpo: Record<string, unknown>) => {
      if (!grupo) return;
      setSalvando(true);
      try {
        const res = await fetch(`/api/cb/groups/${grupo.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload.error ?? t("saveFailed"));
          return false;
        }
        onGrupoAtualizado?.(payload.group ?? {});
        return true;
      } catch {
        toast.error(t("saveFailed"));
        return false;
      } finally {
        setSalvando(false);
      }
    },
    [grupo, onGrupoAtualizado, t],
  );

  const sincronizar = useCallback(async () => {
    if (!grupo?.channel_id) return;
    setSincronizando(true);
    try {
      const res = await fetch("/api/cb/groups/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: grupo.channel_id }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error ?? t("syncFailed"));
        return;
      }
      // A parte lenta roda em segundo plano na rota — dizer "pronto" seria
      // mentira: participantes e admin ainda estão chegando.
      toast.success(t("syncStarted"));
    } catch {
      toast.error(t("syncFailed"));
    } finally {
      setSincronizando(false);
    }
  }, [grupo, t]);

  /* Cabeçalho na MESMA forma da ficha do contato: fechar na ponta esquerda
     (encostado na fronteira com o fio), avatar 40px, nome em linha. Aparece
     também no estado vazio — painel sem grupo também precisa poder fechar. */
  const cabecalho = (extra?: React.ReactNode) => (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={tThread("hideContactPanel")}
          title={tThread("hideContact")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      )}
      {extra}
    </div>
  );

  if (!grupo) {
    return (
      <div className="flex h-full w-full flex-col border-l border-border bg-card">
        {cabecalho()}
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
          <Users className="h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-xs text-muted-foreground">{t("empty")}</p>
        </div>
      </div>
    );
  }

  const nome = nomeDoGrupo(grupo, t("noName"));
  const canal = channels.find((c) => c.id === grupo.channel_id);
  const podeRenomear = podeRenomearNoWhatsApp(grupo);

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-card">
      {cabecalho(
        <>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
            {grupo.picture_url ? (
              <img
                src={grupo.picture_url}
                alt={nome}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <Users className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {nome}
            </h3>
            {grupo.participant_count != null && (
              <p className="truncate text-xs text-muted-foreground">
                {t("participants", { count: grupo.participant_count })}
              </p>
            )}
          </div>
        </>,
      )}

      {/* Abas com RÓTULO, não só-ícone como na ficha do contato: lá são cinco
          e o espaço obriga; aqui são três e cabem escritas. */}
      <Tabs
        defaultValue="informacoes"
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {/* ⚠️ `group-data-horizontal/tabs:h-auto` com o prefixo REPETIDO, não
            `h-auto` cru: o `h-8` do TabsList vem sob prefixo de variante, e o
            tailwind-merge só desempata classes de MESMO prefixo — as duas
            sobreviveriam e a variante venceria. É a armadilha que já quebrou a
            ficha do contato (as abas renderizadas por cima dos campos). */}
        <TabsList className="border-border bg-muted/30 w-full shrink-0 justify-start gap-x-1 rounded-none border-b px-2 py-1 group-data-horizontal/tabs:h-auto [&>button]:h-8 [&>button]:flex-1">
          <TabsTrigger value="informacoes" className="text-xs">
            {t("tabInfo")}
          </TabsTrigger>
          <TabsTrigger value="notas" className="text-xs">
            {tSidebar("tabNotes")}
          </TabsTrigger>
          <TabsTrigger value="arquivos" className="text-xs">
            {tSidebar("tabFiles")}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="informacoes"
          className="min-h-0 flex-1 overflow-y-auto"
        >
      {/* `min-h-0` é load-bearing: filho de flex nasce com min-height:auto e
          o Root do ScrollArea é overflow:visible — sem isto a coluna cresce
          para caber tudo e o fim é cortado sem barra (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {/* Com apelido, o nome REAL vira legenda: o operador precisa
              conseguir dizer a que grupo do WhatsApp aquele apelido
              corresponde. */}
          {grupo.alias && grupo.subject && (
            <p className="text-xs text-muted-foreground">{grupo.subject}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {grupo.is_announce && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Megaphone className="h-3 w-3" />
                {t("announceOnly")}
              </Badge>
            )}
            {grupo.we_are_admin && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <ShieldCheck className="h-3 w-3" />
                {t("weAreAdmin")}
              </Badge>
            )}
          </div>

          {/* Apelido interno */}
          <Secao titulo={t("aliasTitle")}>
            <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
              {t("aliasHint")}
            </p>
            {editandoApelido ? (
              <LinhaDeEdicao
                valor={apelido}
                onChange={setApelido}
                placeholder={t("aliasPlaceholder")}
                salvando={salvando}
                onCancelar={() => setEditandoApelido(false)}
                onSalvar={async () => {
                  if (await patch({ alias: apelido })) setEditandoApelido(false);
                }}
              />
            ) : (
              <button
                onClick={() => {
                  setApelido(grupo.alias ?? "");
                  setEditandoApelido(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Pencil className="h-3.5 w-3.5" />
                {grupo.alias || t("aliasEmpty")}
              </button>
            )}
          </Secao>

          {/* Nome no WhatsApp */}
          <Secao titulo={t("realNameTitle")}>
            <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
              {podeRenomear ? t("realNameHint") : t("realNameBlocked")}
            </p>
            {editandoNomeReal ? (
              <LinhaDeEdicao
                valor={nomeReal}
                onChange={setNomeReal}
                placeholder={t("realNamePlaceholder")}
                salvando={salvando}
                onCancelar={() => setEditandoNomeReal(false)}
                onSalvar={async () => {
                  const ok = await patch({
                    subject: nomeReal,
                    renomear_no_whatsapp: true,
                  });
                  if (ok) {
                    setEditandoNomeReal(false);
                    toast.success(t("realNameDone"));
                  }
                }}
              />
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={!podeRenomear}
                onClick={() => {
                  setNomeReal(grupo.subject ?? "");
                  setEditandoNomeReal(true);
                }}
              >
                {t("realNameAction")}
              </Button>
            )}
          </Secao>

          {/* Conexão + sincronizar */}
          <Secao titulo={t("channelTitle")}>
            <p className="mb-2 text-sm text-foreground">
              {canal?.label ?? t("channelUnknown")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              disabled={sincronizando || !grupo.channel_id}
              onClick={sincronizar}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", sincronizando && "animate-spin")} />
              {sincronizando ? t("syncing") : t("syncAction")}
            </Button>
          </Secao>
        </div>
      </ScrollArea>
        </TabsContent>

        {/* ---- Notas (918). O mesmo caminho da ficha do contato, menos a
             FIXAÇÃO: o índice único da 951 exige `contact_id NOT NULL`.
             ⚠️ `keepMounted` pela mesma razão de lá — o rascunho mora dentro
             do `InternalNoteBox`, e o TabsPanel do base-ui desmonta a aba
             inativa: dar uma olhada em Informações e voltar apagaria o texto
             em silêncio. ---- */}
        <TabsContent
          value="notas"
          keepMounted
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          {conversationId ? (
            <InternalNoteBox
              key={conversationId}
              conversationId={conversationId}
              listaParaBaixo
              autoFocus={false}
              onSaved={acrescentarNota}
            />
          ) : null}

          <div className="mt-2 space-y-2">
            {notas.map((note) => (
              <div key={note.id} className="bg-muted rounded-lg px-3 py-2">
                <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                  {note.texto}
                </p>
                <p className="text-muted-foreground mt-1 text-[10px]">
                  {/* Locale do NAVEGADOR (undefined), nunca fixo. */}
                  {new Date(note.created_at).toLocaleString(undefined, {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            ))}
            {notas.length === 0 && (
              // ⚠️ `t` (Inbox.groupSidebar), NÃO `tSidebar`: a chave mora no
              // bloco do grupo. O portão estático não pega a troca — ele
              // confere a chave contra TODOS os namespaces do arquivo, de
              // propósito (tradutor viaja como prop), então `tSidebar("noNotes")`
              // passava no CI e só o console do navegador acusava
              // MISSING_MESSAGE.
              <p className="text-muted-foreground py-6 text-center text-xs">
                {t("noNotes")}
              </p>
            )}
          </div>
        </TabsContent>

        {/* ---- Arquivos: o MESMO componente da ficha do contato. O acervo é
             da conversa, e ele não sabe de quem ela é. ---- */}
        <TabsContent
          value="arquivos"
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          <AbaArquivos messages={messages} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  // A tipografia do título vem do painel do contato — as duas fichas já
  // haviam divergido uma vez (semibold/wide aqui, medium/wider lá).
  return (
    <div className="mt-6">
      <TituloDeSecao className="mb-2">{titulo}</TituloDeSecao>
      {children}
    </div>
  );
}
