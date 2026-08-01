"use client";

// ============================================================
// O painel de filtros do inbox (F2 fatia A, commit 2).
//
// Arquivo NOVO de propósito: `conversation-list.tsx` é do upstream e já
// carrega bastante coisa nossa. O painel mora aqui, o estado mora na lista, e
// o recorte é feito pelas funções puras de `src/lib/inbox/filtros.ts`.
//
// ⚠️ A CAIXA DE BUSCA NÃO ESTÁ AQUI, E ISSO É DECISÃO.
// Ela continua onde sempre esteve, acima deste painel. A revisão prévia achou
// que substituí-la pelos filtros estruturados APAGARIA três coisas que já
// funcionam: buscar pelo texto da última mensagem, buscar grupo pelo nome, e
// o recorte por empresa. Filtro estruturado responde "quais conversas se
// parecem com X"; a busca responde "onde está aquela conversa" — não são a
// mesma pergunta e uma não substitui a outra.
//
// ⚠️ OS GATES SÃO DELIBERADOS (convenção do CLAUDE.md).
// Canal só aparece com 2+ números, etiqueta só com 1+ etiqueta, tipo só com
// grupo carregado, empresa só com 1+ empresa. Um seletor de uma opção só não
// decide nada e ocupa espaço. Hoje quase todos nascem escondidos, e isso está
// certo: eles aparecem sozinhos quando os dados chegarem.
// ============================================================

import { useState } from "react";
import { ChevronDown, SlidersHorizontal, Star, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { ChannelFilter } from "@/components/channels/channel-filter";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CbChannel } from "@/lib/cb-channels/repo";
import {
  contarFiltrosAtivos,
  FILTROS_VAZIOS,
  SEM_ETAPA,
  SEM_RESPONSAVEL,
  type FiltrosDoInbox,
} from "@/lib/inbox/filtros";
import type { TipoDeConversa } from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import type {
  ConversationStatus,
  PipelineStage,
  Profile,
  Tag,
} from "@/types";

interface InboxFiltersProps {
  filtros: FiltrosDoInbox;
  onChange: (filtros: FiltrosDoInbox) => void;
  canais: CbChannel[];
  etiquetas: Tag[];
  empresas: string[];
  responsaveis: Profile[];
  etapas: PipelineStage[];
  /** Existe conversa de grupo carregada? Sem isso o recorte por tipo não decide nada. */
  temGrupos: boolean;
  exibindo: number;
  total: number;
}

export function InboxFilters({
  filtros,
  onChange,
  canais,
  etiquetas,
  empresas,
  responsaveis,
  etapas,
  temGrupos,
  exibindo,
  total,
}: InboxFiltersProps) {
  const t = useTranslations("Inbox.conversationList");
  const [aberto, setAberto] = useState(false);
  const ativos = contarFiltrosAtivos(filtros);

  const mexer = (patch: Partial<FiltrosDoInbox>) =>
    onChange({ ...filtros, ...patch });

  const alternarEtiqueta = (id: string) =>
    mexer({
      etiquetaIds: filtros.etiquetaIds.includes(id)
        ? filtros.etiquetaIds.filter((x) => x !== id)
        : [...filtros.etiquetaIds, id],
    });

  const responsavelAtual = responsaveis.find(
    (p) => p.user_id === filtros.responsavelId,
  );
  const etapaAtual = etapas.find((e) => e.id === filtros.etapaId);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-muted",
            ativos > 0
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {t("filters")}
          {/* ⚠️ O distintivo é o que explica uma lista curta com o painel
              fechado. Sem ele, um filtro esquecido vira "sumiram conversas". */}
          {ativos > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {ativos}
            </span>
          )}
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", aberto && "rotate-180")}
          />
        </button>

        {/* Favoritas fica FORA do painel: é o único recorte de uso diário que
            se liga e desliga o tempo todo, e enterrá-lo atrás de um clique a
            mais custaria mais que o espaço que ocupa. */}
        <button
          type="button"
          onClick={() => mexer({ favoritas: !filtros.favoritas })}
          aria-pressed={filtros.favoritas}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-muted",
            filtros.favoritas
              ? "text-amber-500"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Star className={cn("h-3.5 w-3.5", filtros.favoritas && "fill-current")} />
          {t("favorites")}
        </button>

        {ativos > 0 && (
          <button
            type="button"
            onClick={() => onChange(FILTROS_VAZIOS)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
            {t("clearAll")}
          </button>
        )}

        {/* O contador só aparece quando algo recorta. Ele existe para explicar
            um resultado vazio ou curto — mostrá-lo com a lista inteira seria
            ruído. */}
        {(ativos > 0 || exibindo !== total) && (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {t("showingCount", { count: exibindo, total })}
          </span>
        )}
      </div>

      {aberto && (
        <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2">
          {temGrupos && (
            <Campo rotulo={t("labelType")}>
              <Escolha
                rotulo={
                  filtros.tipo === "grupos"
                    ? t("typeGroups")
                    : filtros.tipo === "diretas"
                      ? t("typeDirect")
                      : t("typeAll")
                }
                ativo={filtros.tipo !== "todas"}
                opcoes={(
                  [
                    ["todas", t("typeAll")],
                    ["diretas", t("typeDirect")],
                    ["grupos", t("typeGroups")],
                  ] as [TipoDeConversa, string][]
                ).map(([valor, texto]) => ({
                  chave: valor,
                  texto,
                  escolhido: filtros.tipo === valor,
                  aoEscolher: () => mexer({ tipo: valor }),
                }))}
              />
            </Campo>
          )}

          <Campo rotulo={t("labelStatus")}>
            <Escolha
              rotulo={
                filtros.status === "todos"
                  ? t("filterAll")
                  : filtros.status === "open"
                    ? t("filterOpen")
                    : filtros.status === "pending"
                      ? t("filterPending")
                      : t("filterClosed")
              }
              ativo={filtros.status !== "todos"}
              opcoes={(
                [
                  ["todos", t("filterAll")],
                  ["open", t("filterOpen")],
                  ["pending", t("filterPending")],
                  // ⚠️ "Encerrada" É "arquivada" (decisão P2.3): é o mesmo
                  // campo. Um segundo controle "arquivadas" poderia
                  // contradizer este, então não existe.
                  ["closed", t("filterClosed")],
                ] as [ConversationStatus | "todos", string][]
              ).map(([valor, texto]) => ({
                chave: valor,
                texto,
                escolhido: filtros.status === valor,
                aoEscolher: () => mexer({ status: valor }),
              }))}
            />
          </Campo>

          {canais.length >= 2 && (
            <Campo rotulo={t("labelChannel")}>
              {/* Peça compartilhada: ela já traz o gate de 2+ e o rótulo do
                  canal com bolinha de estado. */}
              <ChannelFilter
                channels={canais}
                value={filtros.canalId}
                onChange={(canalId) => mexer({ canalId })}
                className="h-8 w-full justify-between"
              />
            </Campo>
          )}

          <Campo rotulo={t("labelAssignee")}>
            <Escolha
              rotulo={
                filtros.responsavelId === null
                  ? t("assigneeAll")
                  : filtros.responsavelId === SEM_RESPONSAVEL
                    ? t("assigneeNone")
                    : (responsavelAtual?.full_name ??
                      responsavelAtual?.email ??
                      t("assigneeAll"))
              }
              ativo={filtros.responsavelId !== null}
              opcoes={[
                {
                  chave: "__todos__",
                  texto: t("assigneeAll"),
                  escolhido: filtros.responsavelId === null,
                  aoEscolher: () => mexer({ responsavelId: null }),
                },
                {
                  // A pergunta da manhã: "o que ninguém pegou ainda?".
                  chave: SEM_RESPONSAVEL,
                  texto: t("assigneeNone"),
                  escolhido: filtros.responsavelId === SEM_RESPONSAVEL,
                  aoEscolher: () => mexer({ responsavelId: SEM_RESPONSAVEL }),
                },
                ...responsaveis.map((p) => ({
                  chave: p.user_id,
                  texto: p.full_name || p.email || p.user_id,
                  escolhido: filtros.responsavelId === p.user_id,
                  aoEscolher: () => mexer({ responsavelId: p.user_id }),
                })),
              ]}
            />
          </Campo>

          {etapas.length > 0 && (
            <Campo rotulo={t("labelStage")}>
              <Escolha
                rotulo={
                  filtros.etapaId === null
                    ? t("stageAll")
                    : filtros.etapaId === SEM_ETAPA
                      ? t("stageNone")
                      : (etapaAtual?.name ?? t("stageAll"))
                }
                ativo={filtros.etapaId !== null}
                opcoes={[
                  {
                    chave: "__todas__",
                    texto: t("stageAll"),
                    escolhido: filtros.etapaId === null,
                    aoEscolher: () => mexer({ etapaId: null }),
                  },
                  {
                    // Sem esta opção, quem ainda não virou negócio some de
                    // qualquer recorte por etapa — e é justamente quem
                    // precisa de atenção.
                    chave: SEM_ETAPA,
                    texto: t("stageNone"),
                    escolhido: filtros.etapaId === SEM_ETAPA,
                    aoEscolher: () => mexer({ etapaId: SEM_ETAPA }),
                  },
                  ...etapas.map((e) => ({
                    chave: e.id,
                    texto: e.name,
                    escolhido: filtros.etapaId === e.id,
                    aoEscolher: () => mexer({ etapaId: e.id }),
                  })),
                ]}
              />
            </Campo>
          )}

          {empresas.length > 0 && (
            <Campo rotulo={t("labelCompany")}>
              <Escolha
                rotulo={filtros.empresa ?? t("allCompanies")}
                ativo={filtros.empresa !== null}
                opcoes={[
                  {
                    chave: "__todas__",
                    texto: t("allCompanies"),
                    escolhido: filtros.empresa === null,
                    aoEscolher: () => mexer({ empresa: null }),
                  },
                  ...empresas.map((co) => ({
                    chave: co,
                    texto: co,
                    escolhido: filtros.empresa === co,
                    aoEscolher: () => mexer({ empresa: co }),
                  })),
                ]}
              />
            </Campo>
          )}

          {etiquetas.length > 0 && (
            <Campo rotulo={t("labelTags")}>
              <div className="flex items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      "inline-flex h-8 min-w-0 flex-1 items-center justify-between gap-1 rounded-md border border-border px-2 text-xs transition-colors hover:bg-muted",
                      filtros.etiquetaIds.length > 0
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="truncate">
                      {filtros.etiquetaIds.length > 0
                        ? t("tagsChosen", { count: filtros.etiquetaIds.length })
                        : t("tags")}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="max-h-64 w-56 overflow-y-auto border-border bg-popover"
                  >
                    {etiquetas.map((tag) => (
                      <DropdownMenuCheckboxItem
                        key={tag.id}
                        checked={filtros.etiquetaIds.includes(tag.id)}
                        onCheckedChange={() => alternarEtiqueta(tag.id)}
                        className="text-sm text-popover-foreground"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="truncate">{tag.name}</span>
                        </span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* O modo só faz diferença com 2+ etiquetas escolhidas — com
                    uma só, "qualquer" e "todas" dão o mesmo resultado. */}
                {filtros.etiquetaIds.length >= 2 && (
                  <button
                    type="button"
                    onClick={() =>
                      mexer({
                        modoDeEtiqueta:
                          filtros.modoDeEtiqueta === "todas" ? "qualquer" : "todas",
                      })
                    }
                    className="h-8 shrink-0 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {filtros.modoDeEtiqueta === "todas"
                      ? t("tagModeAll")
                      : t("tagModeAny")}
                  </button>
                )}
              </div>
            </Campo>
          )}
        </div>
      )}
    </div>
  );
}

function Campo({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
      {children}
    </div>
  );
}

interface Opcao {
  chave: string;
  texto: string;
  escolhido: boolean;
  aoEscolher: () => void;
}

/** Um seletor de valor único, no formato dos outros filtros do inbox. */
function Escolha({
  rotulo,
  ativo,
  opcoes,
}: {
  rotulo: string;
  ativo: boolean;
  opcoes: Opcao[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-8 w-full items-center justify-between gap-1 rounded-md border border-border px-2 text-xs transition-colors hover:bg-muted",
          ativo ? "text-primary" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span className="truncate">{rotulo}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-64 w-56 overflow-y-auto border-border bg-popover"
      >
        {opcoes.map((o) => (
          <DropdownMenuItem
            key={o.chave}
            onClick={o.aoEscolher}
            className={cn(
              "text-sm",
              o.escolhido ? "text-primary" : "text-popover-foreground",
            )}
          >
            <span className="truncate">{o.texto}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
