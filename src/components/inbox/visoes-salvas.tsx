"use client";

// ============================================================
// A FILEIRA DE VISÕES — os filtros salvos do membro como chips, logo abaixo
// das abas da caixa de entrada (layout "B", escolhido pelo operador em
// 2026-09-03 entre três mocks). Trocar de visão é UM clique, o chip aceso
// diz qual está aplicada, e salvar acontece aqui mesmo.
//
// Substitui o menu atrás do ícone de marcador (`filtros-salvos-menu`, que
// foi apagado): lá a troca custava dois cliques e nada na tela dizia qual
// filtro estava aplicado. A regra do que aparece aceso/salvável é pura
// (`lib/inbox/visoes.ts`); os diálogos são os de sempre
// (`filtros-salvos-dialogos.tsx`).
//
// 974: cada membro vê e edita SÓ os seus filtros — por isso não há mais gate
// de admin em nada aqui.
// ============================================================

import { useCallback, useMemo, useState } from "react";
import { Bookmark, Check, MoreHorizontal, Pencil, Plus, Star, StarOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { DialogoGerir, DialogoSalvar } from "@/components/inbox/filtros-salvos-dialogos";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ResultadoDaEscrita } from "@/hooks/use-filtros-salvos";
import type { FiltrosDoInbox } from "@/lib/inbox/filtros";
import {
  descreverFiltro,
  type CatalogosDoFiltro,
  type FiltroSalvo,
  type PedacoDoFiltro,
} from "@/lib/inbox/filtros-salvos";
import { estadoDasVisoes } from "@/lib/inbox/visoes";
import { cn } from "@/lib/utils";

export interface VisoesSalvasProps {
  salvos: FiltroSalvo[];
  padraoId: string | null;
  carregando: boolean;
  falhou: boolean;
  filtrosAtuais: FiltrosDoInbox;
  /** O chip clicado por último — de onde o recorte atual partiu. */
  baseId: string | null;
  catalogos: CatalogosDoFiltro;
  /** Aplica o recorte (já limpo) e registra a base. `null` = "Todas". */
  onAplicar: (filtros: FiltrosDoInbox | null, baseId: string | null) => void;
  criar: (nome: string, filtros: FiltrosDoInbox) => Promise<ResultadoDaEscrita>;
  regravar: (id: string, filtros: FiltrosDoInbox) => Promise<ResultadoDaEscrita>;
  renomear: (id: string, nome: string) => Promise<ResultadoDaEscrita>;
  apagar: (id: string) => Promise<ResultadoDaEscrita>;
  definirPadrao: (filtroId: string | null) => Promise<ResultadoDaEscrita>;
}

const CHIP =
  "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs transition-colors";
const CHIP_OFF =
  "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground";
const CHIP_ON = "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15";

export function VisoesSalvas({
  salvos,
  padraoId,
  carregando,
  falhou,
  filtrosAtuais,
  baseId,
  catalogos,
  onAplicar,
  criar,
  regravar,
  renomear,
  apagar,
  definirPadrao,
}: VisoesSalvasProps) {
  const t = useTranslations("Inbox.conversationList");
  const [salvarAberto, setSalvarAberto] = useState(false);
  const [gerirAberto, setGerirAberto] = useState(false);

  const estado = useMemo(
    () => estadoDasVisoes({ salvos, padraoId, atual: filtrosAtuais, baseId, catalogos }),
    [salvos, padraoId, filtrosAtuais, baseId, catalogos],
  );

  const textoDoPedaco = useCallback(
    (p: PedacoDoFiltro): string => {
      if (p.orfao) return t("deletedRef");
      return p.rotulo.fonte === "i18n" ? t(p.rotulo.chave) : p.rotulo.texto;
    },
    [t],
  );
  const resumir = useCallback(
    (f: FiltrosDoInbox) => descreverFiltro(f, catalogos).map(textoDoPedaco).join(" · "),
    [catalogos, textoDoPedaco],
  );
  const avisar = (r: ResultadoDaEscrita, sucesso: string) => {
    if (r === "ok") toast.success(sucesso);
    else if (r === "sem-permissao") toast.error(t("savedFilterNoPermission"));
    else if (r === "nome-repetido") toast.error(t("savedFilterDuplicate"));
    else toast.error(t("savedFilterError"));
    return r === "ok";
  };

  // Sem filtro salvo e sem recorte: a fileira não tem o que mostrar — some
  // inteira, e a caixa fica como sempre foi. Em falha ela FICA (com o aviso):
  // sumir seria afirmar "não há filtro salvo" sobre uma consulta que não voltou.
  if (!carregando && !falhou && estado.chips.length === 0 && !estado.podeSalvar) return null;

  const chipAtivo = estado.chips.find((c) => c.ativa) ?? null;

  return (
    <>
      {/* QUEBRA LINHA em vez de rolar: com 360px, o segundo filtro já não
          cabia e a rolagem escondida cortava o chip na borda sem nenhum
          sinal (medido em 03/09). Duas linhas com poucos filtros custam
          menos que um chip invisível. */}
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label={t("savedFilters")}
      >
        <button
          type="button"
          onClick={() => onAplicar(null, null)}
          aria-pressed={estado.todasAtiva}
          className={cn(CHIP, estado.todasAtiva ? CHIP_ON : CHIP_OFF)}
        >
          {t("viewAll")}
        </button>

        {estado.chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onAplicar(c.filtros, c.id)}
            aria-pressed={c.ativa}
            title={resumir(c.filtros)}
            className={cn(CHIP, "max-w-44", c.ativa ? CHIP_ON : CHIP_OFF)}
          >
            {c.padrao && <Star className="h-3 w-3 shrink-0 fill-current" />}
            <span className="truncate">{c.nome}</span>
            {/* Partiu daqui e foi mexido: o ponto avisa que o chip já não é o
                recorte da tela. */}
            {estado.base?.id === c.id && estado.mexida && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            )}
          </button>
        ))}

        {carregando && estado.chips.length === 0 && (
          <span className="text-[11px] text-muted-foreground">{t("savedFiltersLoading")}</span>
        )}
        {falhou && (
          <span className="text-[11px] text-destructive">{t("savedFiltersLoadFailed")}</span>
        )}

        {/* SALVAR. Recorte que não é nenhum filtro: "Salvar" (novo). Partiu de
            um filtro e mexeu: menu com "Salvar em X" e "Salvar como novo". */}
        {estado.podeSalvar && estado.base && estado.mexida ? (
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(CHIP, "border-dashed", CHIP_OFF)}>
              <Plus className="h-3 w-3" />
              {t("saveViewChanges")}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              <DropdownMenuItem
                onClick={async () => {
                  const base = estado.base!;
                  avisar(await regravar(base.id, filtrosAtuais), t("savedFilterUpdated"));
                }}
                className="text-sm text-popover-foreground"
              >
                <Check className="h-3.5 w-3.5" />
                {t("saveViewInto", { nome: estado.base.nome })}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSalvarAberto(true)}
                className="text-sm text-popover-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("saveViewAsNew")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : estado.podeSalvar ? (
          <button
            type="button"
            onClick={() => setSalvarAberto(true)}
            className={cn(CHIP, "border-dashed", CHIP_OFF)}
          >
            <Plus className="h-3 w-3" />
            {t("saveView")}
          </button>
        ) : null}

        {/* Opções da visão ATIVA: padrão, renomear/apagar (o diálogo de gerir). */}
        {chipAtivo && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(CHIP, "w-7 justify-center px-0", CHIP_OFF)}
              aria-label={t("viewOptions")}
              title={t("viewOptions")}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-border bg-popover">
              <DropdownMenuItem
                onClick={async () => {
                  const tirar = chipAtivo.padrao;
                  avisar(
                    await definirPadrao(tirar ? null : chipAtivo.id),
                    tirar ? t("defaultUnset") : t("defaultSet"),
                  );
                }}
                className="text-sm text-popover-foreground"
              >
                {chipAtivo.padrao ? (
                  <StarOff className="h-3.5 w-3.5" />
                ) : (
                  <Star className="h-3.5 w-3.5" />
                )}
                {chipAtivo.padrao ? t("unsetAsDefault") : t("setAsDefault")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={() => setGerirAberto(true)}
                className="text-sm text-popover-foreground"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t("manageSavedFilters")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!chipAtivo && estado.chips.length > 0 && (
          <button
            type="button"
            onClick={() => setGerirAberto(true)}
            className={cn(CHIP, "w-7 justify-center px-0", CHIP_OFF)}
            aria-label={t("manageSavedFilters")}
            title={t("manageSavedFilters")}
          >
            <Bookmark className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <DialogoSalvar
        aberto={salvarAberto}
        onFechar={() => setSalvarAberto(false)}
        resumo={resumir(filtrosAtuais)}
        salvos={salvos}
        onCriar={async (nome) => avisar(await criar(nome, filtrosAtuais), t("savedFilterCreated"))}
        onRegravar={async (id) =>
          avisar(await regravar(id, filtrosAtuais), t("savedFilterUpdated"))
        }
      />
      <DialogoGerir
        aberto={gerirAberto}
        onFechar={() => setGerirAberto(false)}
        salvos={salvos}
        resumir={resumir}
        onRenomear={async (id, nome) => avisar(await renomear(id, nome), t("savedFilterRenamed"))}
        onApagar={async (id) => avisar(await apagar(id), t("savedFilterDeleted"))}
      />
    </>
  );
}
