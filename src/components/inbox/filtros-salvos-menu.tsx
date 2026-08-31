"use client";

// ============================================================
// O menu de filtros salvos, ao lado do botão "Filtros" (Fase A2).
//
// ⚠️ POR QUE UM GATILHO PRÓPRIO, E NÃO "DENTRO DO BOTÃO FILTROS"
// O botão "Filtros" ABRE E FECHA o painel — ele já tem um clique com dono. Um
// segundo comportamento no mesmo alvo não existe. Este gatilho fica colado
// nele, na mesma barra, e mostra o NOME do filtro aplicado: um clique para
// abrir, um para acionar, que é o "sob demanda" que o operador pediu.
//
// ⚠️ ARQUIVO NOVO de propósito. `inbox-filters.tsx` já passa de 700 linhas e
// acabou de ser reescrito pelo PR #73 (funil em dois níveis) — enfiar o menu
// lá dentro engrossaria o conflito do próximo merge sem ganho nenhum.
// ============================================================

import { useMemo, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useCan } from "@/hooks/use-can";
import type { ResultadoDaEscrita } from "@/hooks/use-filtros-salvos";
import { contarFiltrosAtivos, type FiltrosDoInbox } from "@/lib/inbox/filtros";
import {
  descreverFiltro,
  mesmoFiltro,
  type CatalogosDoFiltro,
  type FiltroSalvo,
  type PedacoDoFiltro,
} from "@/lib/inbox/filtros-salvos";
import { cn } from "@/lib/utils";

export interface FiltrosSalvosMenuProps {
  salvos: FiltroSalvo[];
  /** O filtro que ESTE membro escolheu como padrão (968). */
  padraoId: string | null;
  carregando: boolean;
  falhou: boolean;
  filtrosAtuais: FiltrosDoInbox;
  onAplicar: (filtros: FiltrosDoInbox) => void;
  catalogos: CatalogosDoFiltro;
  criar: (nome: string, filtros: FiltrosDoInbox) => Promise<ResultadoDaEscrita>;
  regravar: (id: string, filtros: FiltrosDoInbox) => Promise<ResultadoDaEscrita>;
  renomear: (id: string, nome: string) => Promise<ResultadoDaEscrita>;
  apagar: (id: string) => Promise<ResultadoDaEscrita>;
  definirPadrao: (filtroId: string | null) => Promise<ResultadoDaEscrita>;
}

export function FiltrosSalvosMenu({
  salvos,
  padraoId,
  carregando,
  falhou,
  filtrosAtuais,
  onAplicar,
  catalogos,
  criar,
  regravar,
  renomear,
  apagar,
  definirPadrao,
}: FiltrosSalvosMenuProps) {
  const t = useTranslations("Inbox.conversationList");
  // `edit-settings` é `admin`+ — a MESMA régua da policy da 967. Duas réguas
  // divergiriam na primeira mudança, e o operador veria um botão que o banco
  // recusa.
  const podeGerir = useCan("edit-settings");

  const [salvarAberto, setSalvarAberto] = useState(false);
  const [gerirAberto, setGerirAberto] = useState(false);

  const aplicado = useMemo(
    () => salvos.find((f) => mesmoFiltro(f.filtros, filtrosAtuais)) ?? null,
    [salvos, filtrosAtuais],
  );

  /**
   * Um pedaço do recorte vira texto.
   *
   * ⚠️ Órfão vira "(apagado)" AQUI, e não na pastilha do painel. São duas
   * perguntas diferentes: a pastilha mostra o que está pegando AGORA (e o dado
   * pode só não ter carregado ainda); o menu descreve um recorte GRAVADO, onde
   * um id que não resolve depois da carga é quase sempre coisa apagada — e
   * dizer isso é o que explica por que aquele filtro devolve pouca coisa.
   */
  const textoDoPedaco = (p: PedacoDoFiltro): string => {
    if (p.orfao) return t("deletedRef");
    return p.rotulo.fonte === "i18n" ? t(p.rotulo.chave) : p.rotulo.texto;
  };

  const resumir = (f: FiltrosDoInbox) =>
    descreverFiltro(f, catalogos).map(textoDoPedaco).join(" · ");

  /**
   * ⚠️ Filtro que aponta para um canal FORA do escopo do perfil de quem olha
   * some do menu. Aplicá-lo devolveria zero conversas com nada na tela
   * explicando — o pior tipo de resposta errada. Some é honesto.
   *
   * O recorte por perfil já filtra `catalogos.canais` lá na lista (ver
   * `canaisVisiveis` em `conversation-list`), então basta perguntar se o canal
   * do filtro está no catálogo que ESTE membro recebeu. Sem canal no filtro,
   * ele vale para todos.
   */
  const visiveis = useMemo(
    () =>
      salvos.filter(
        (f) =>
          !f.filtros.canalId ||
          catalogos.canais.length === 0 ||
          catalogos.canais.some((c) => c.id === f.filtros.canalId),
      ),
    [salvos, catalogos.canais],
  );

  const avisar = (r: ResultadoDaEscrita, sucesso: string) => {
    if (r === "ok") toast.success(sucesso);
    else if (r === "sem-permissao") toast.error(t("savedFilterNoPermission"));
    else if (r === "nome-repetido") toast.error(t("savedFilterDuplicate"));
    else toast.error(t("savedFilterError"));
    return r === "ok";
  };

  /**
   * ⚠️ O gatilho SOME quando não decide nada — a convenção do projeto (o
   * seletor de canal com menos de 2 números, o de tipo sem grupos, o de bloco
   * com um bloco só). Para quem não pode gerir e ainda não tem filtro nenhum,
   * este menu só teria "Nenhum filtro salvo ainda." atrás de um clique.
   *
   * Enquanto CARREGA ele fica, para a barra não pular; e quando a leitura
   * FALHA ele fica também — é lá que o aviso mora, e sumir seria afirmar
   * "não há filtro salvo" sobre uma consulta que não voltou.
   */
  if (!podeGerir && !carregando && !falhou && visiveis.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "inline-flex h-7 max-w-40 items-center gap-1 rounded-md px-2 text-xs transition-colors hover:bg-muted",
            aplicado
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Bookmark
            className={cn("h-3.5 w-3.5 shrink-0", aplicado && "fill-current")}
          />
          {/* Com um filtro acionado, o gatilho vira a etiqueta dele: é o que
              explica um inbox recortado sem obrigar a abrir o menu. */}
          <span className="truncate">
            {aplicado ? aplicado.nome : t("savedFilters")}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="max-h-80 w-64 overflow-y-auto border-border bg-popover"
        >
          {carregando ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("savedFiltersLoading")}
            </div>
          ) : falhou ? (
            // ⚠️ NUNCA "nenhum filtro salvo" aqui: a leitura falhou, e afirmar
            // ausência mandaria o operador remontar à mão o que já existe.
            <div className="px-2 py-3 text-xs text-destructive">
              {t("savedFiltersLoadFailed")}
            </div>
          ) : visiveis.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              {t("savedFiltersEmpty")}
            </div>
          ) : (
            visiveis.map((f) => {
              const resumo = resumir(f.filtros);
              return (
                <DropdownMenuItem
                  key={f.id}
                  onClick={() => onAplicar(f.filtros)}
                  className="flex-col items-start gap-0.5 text-popover-foreground"
                >
                  <span className="flex w-full items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {f.nome}
                    </span>
                    {aplicado?.id === f.id && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    {/* ⚠️ Escolher o padrão é de QUALQUER membro — o filtro é
                        do escritório, mas com qual recorte a MINHA caixa abre
                        é meu. Por isso fica na linha, e não atrás do
                        "Gerenciar", que é só de admin.

                        `<button>` dentro de `DropdownMenuItem` é válido: o
                        item do base-ui renderiza uma `div`. O
                        `stopPropagation` impede que marcar o padrão também
                        APLIQUE o filtro e feche o menu. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const virandoPadrao = padraoId !== f.id;
                        void definirPadrao(virandoPadrao ? f.id : null).then((r) =>
                          avisar(
                            r,
                            virandoPadrao ? t("defaultSet") : t("defaultUnset"),
                          ),
                        );
                      }}
                      title={
                        padraoId === f.id ? t("unsetAsDefault") : t("setAsDefault")
                      }
                      aria-pressed={padraoId === f.id}
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-muted",
                        padraoId === f.id
                          ? "text-amber-500"
                          : "text-muted-foreground/50 hover:text-foreground",
                      )}
                    >
                      <Star
                        className={cn(
                          "h-3.5 w-3.5",
                          padraoId === f.id && "fill-current",
                        )}
                      />
                    </button>
                  </span>
                  {/* O resumo é o que impede "acionei o SDR e sumiu tudo":
                      ele diz, antes do clique, o que aquele nome recorta. */}
                  {resumo && (
                    <span className="w-full truncate text-[11px] text-muted-foreground">
                      {resumo}
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })
          )}

          {podeGerir && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setSalvarAberto(true)}
                // Um filtro vazio salvo vira um item de menu que não faz nada.
                disabled={contarFiltrosAtivos(filtrosAtuais) === 0}
                className="text-popover-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("saveCurrentFilter")}
              </DropdownMenuItem>
              {salvos.length > 0 && (
                <DropdownMenuItem
                  onClick={() => setGerirAberto(true)}
                  className="text-popover-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t("manageSavedFilters")}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
        onRenomear={async (id, nome) =>
          avisar(await renomear(id, nome), t("savedFilterRenamed"))
        }
        onApagar={async (id) => avisar(await apagar(id), t("savedFilterDeleted"))}
      />
    </>
  );
}

// ------------------------------------------------------------
// Salvar o filtro atual
// ------------------------------------------------------------

function DialogoSalvar({
  aberto,
  onFechar,
  resumo,
  salvos,
  onCriar,
  onRegravar,
}: {
  aberto: boolean;
  onFechar: () => void;
  resumo: string;
  salvos: FiltroSalvo[];
  onCriar: (nome: string) => Promise<boolean>;
  onRegravar: (id: string) => Promise<boolean>;
}) {
  const t = useTranslations("Inbox.conversationList");
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);

  /**
   * O homônimo, se houver — mesma regra do índice único (aparado, minúsculas).
   *
   * ⚠️ Achá-lo ANTES de tentar gravar é o que transforma o `23505` numa
   * pergunta em vez de num erro. Salvar por cima do filtro de mesmo nome é
   * quase sempre a intenção de quem está ali.
   */
  const homonimo = salvos.find(
    (f) => f.nome.trim().toLowerCase() === nome.trim().toLowerCase(),
  );

  const fechar = () => {
    setNome("");
    onFechar();
  };

  const gravar = async () => {
    if (!nome.trim() || salvando) return;
    setSalvando(true);
    const ok = homonimo ? await onRegravar(homonimo.id) : await onCriar(nome);
    setSalvando(false);
    if (ok) fechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? undefined : fechar())}>
      {/* min-w-0: filho direto do DialogContent (que é grid) nasce com
          min-width:auto, e o `truncate` do resumo estouraria a largura. */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("saveFilterTitle")}</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void gravar();
              }
            }}
            maxLength={60}
            placeholder={t("saveFilterNamePlaceholder")}
            autoFocus
          />
          {/* O que está sendo gravado, por escrito. Sem isto o operador salva
              "SDR" sem saber que o recorte ainda tem "Favoritas" ligado de uma
              hora atrás. */}
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">{t("saveFilterWhat")}</span> {resumo}
          </p>
          {homonimo && (
            <p className="text-xs text-amber-500">
              {t("saveFilterOverwriteHint", { nome: homonimo.nome })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={fechar}>
              {t("saveFilterCancel")}
            </Button>
            <Button size="sm" onClick={() => void gravar()} disabled={!nome.trim() || salvando}>
              {salvando && <Loader2 className="size-3.5 animate-spin" />}
              {homonimo ? t("saveFilterOverwrite") : t("saveFilterConfirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Renomear e apagar
// ------------------------------------------------------------

function DialogoGerir({
  aberto,
  onFechar,
  salvos,
  resumir,
  onRenomear,
  onApagar,
}: {
  aberto: boolean;
  onFechar: () => void;
  salvos: FiltroSalvo[];
  resumir: (f: FiltrosDoInbox) => string;
  onRenomear: (id: string, nome: string) => Promise<boolean>;
  onApagar: (id: string) => Promise<boolean>;
}) {
  const t = useTranslations("Inbox.conversationList");
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const fechar = () => {
    setEditando(null);
    setConfirmando(null);
    onFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? undefined : fechar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("manageSavedFilters")}</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-2">
          {salvos.map((f) => (
            <div key={f.id} className="min-w-0 rounded-md border border-border p-2">
              {editando === f.id ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={rascunho}
                    onChange={(e) => setRascunho(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (!rascunho.trim() || ocupado) return;
                        setOcupado(true);
                        void onRenomear(f.id, rascunho).then((ok) => {
                          setOcupado(false);
                          if (ok) setEditando(null);
                        });
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditando(null);
                      }
                    }}
                    maxLength={60}
                    className="h-8 text-sm"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    disabled={!rascunho.trim() || ocupado}
                    onClick={() => {
                      setOcupado(true);
                      void onRenomear(f.id, rascunho).then((ok) => {
                        setOcupado(false);
                        if (ok) setEditando(null);
                      });
                    }}
                  >
                    <Check className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{f.nome}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {resumir(f.filtros)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRascunho(f.nome);
                      setEditando(f.id);
                    }}
                    title={t("savedFilterRename")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmando(f.id)}
                    title={t("savedFilterDelete")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Confirmação inline: apagar tira o atalho de TODO MUNDO, e um
                  clique errado num ícone de 28px não pode ser definitivo. */}
              {confirmando === f.id && (
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {t("savedFilterDeleteConfirm")}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmando(null)}>
                    {t("saveFilterCancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={ocupado}
                    onClick={() => {
                      setOcupado(true);
                      void onApagar(f.id).then(() => {
                        setOcupado(false);
                        setConfirmando(null);
                      });
                    }}
                  >
                    {t("savedFilterDelete")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
