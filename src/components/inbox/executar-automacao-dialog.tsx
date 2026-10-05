"use client";

// ============================================================
// "Executar automação" — popup do menu + do compositor (referência Kommo,
// adaptada por decisão do operador: botão, nunca "/" no texto).
//
// Lista as automações e os robôs da conta (leitura direta sob RLS —
// policies por conta desde a 017) e dispara pelo POST
// /api/cb/execucoes/executar, que valida grupo/escopo/papel no servidor.
//
// Item que não pode rodar aqui fica VISÍVEL e desabilitado, com o motivo —
// escondê-lo faria o operador achar que a automação sumiu. Vale para o que
// está fora do escopo de canal da conversa e, desde 29/09/2026, para o que
// está DESLIGADO (seção própria no fim; a separação é
// `separarParaExecutar`, em `src/lib/execucoes/lista-para-executar.ts`).
// Clique pede confirmação NO LUGAR (a execução pode enviar mensagem real
// ao cliente; não há janela de desfazer aqui).
//
// ⚠️ "O acervo está vazio" antes da primeira resposta já mordeu (953):
// `carregou` nasce false e o estado vazio só aparece depois dela.
//
// NOSSO (1079): a barra das ÁREAS da tela de Automações (1055) e a estrela das
// FAVORITAS de quem usa (pessoais), que sobem para o topo. A barra só entra
// com as áreas LIDAS e havendo pelo menos uma (só "Todas" e "Geral" não
// separam nada); a leitura das áreas que falha some com a barra, sem derrubar
// a lista.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Play, Search, Star, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BarraDeAbas } from "@/components/automations/abas-de-automacao";
import { createClient } from "@/lib/supabase/client";
import { semAcento } from "@/lib/inbox/busca-em-mensagens";
import { ABA_GERAL, ordenarAreas, type AreaDeAutomacao } from "@/lib/automations/areas";
import {
  contagemDasAbas,
  listaVazia,
  separarParaExecutar,
  type AutomacaoParaExecutar,
  type RoboParaExecutar,
} from "@/lib/execucoes/lista-para-executar";
import { avisarExecucoesMudaram } from "@/hooks/use-execucoes-do-contato";
import { useAutomacoesFavoritas } from "@/hooks/use-automacoes-favoritas";
import { cn } from "@/lib/utils";

// A área escolhida fica lembrada NESTE aparelho, à parte da tela de
// Automações (storage que falha só volta para "Todas").
const CHAVE_DA_ABA = "cb-executar-automacao-aba";

function lerAbaGuardada(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_DA_ABA);
  } catch {
    return null;
  }
}

function guardarAba(aba: string | null) {
  try {
    if (aba) window.localStorage.setItem(CHAVE_DA_ABA, aba);
    else window.localStorage.removeItem(CHAVE_DA_ABA);
  } catch {
    // sem storage, a área só não é lembrada
  }
}

type Selecao =
  | { tipo: "automacao"; id: string; nome: string }
  | { tipo: "robo"; id: string; nome: string };

interface ExecutarAutomacaoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactName: string;
  /** Canal da conversa (`conversations.channel_id`); null = desconhecido. */
  channelId: string | null;
  /**
   * A conexão de saída da conversa está FORA DO AR (`aviso-da-conexao.ts`).
   * O menu + que abre este diálogo já trava junto com o compositor; isto
   * cobre o diálogo que JÁ estava aberto quando a sonda virou (Codex, #386).
   */
  conexaoForaDoAr?: boolean;
}

export function ExecutarAutomacaoDialog({
  open,
  onOpenChange,
  conversationId,
  contactName,
  channelId,
  conexaoForaDoAr = false,
}: ExecutarAutomacaoDialogProps) {
  const t = useTranslations("Inbox.execucoes.executar");
  const tFav = useTranslations("Automations.favoritas");

  const [automacoes, setAutomacoes] = useState<AutomacaoParaExecutar[]>([]);
  const [robos, setRobos] = useState<RoboParaExecutar[]>([]);
  const [carregou, setCarregou] = useState(false);
  const [erroCarga, setErroCarga] = useState(false);
  const [busca, setBusca] = useState("");
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const [executando, setExecutando] = useState(false);
  // `null` = não sei (carregando, ou a leitura falhou): sem barra.
  const [areas, setAreas] = useState<AreaDeAutomacao[] | null>(null);
  // `null` = "Todas". Lida no primeiro render: o diálogo só desenha aberto,
  // no navegador (o portal não vai no HTML do servidor).
  const [aba, setAba] = useState<string | null>(() =>
    typeof window === "undefined" ? null : lerAbaGuardada(),
  );
  const { favoritas, falhou: favoritasFalharam, alternar } = useAutomacoesFavoritas(open);

  function escolherAba(nova: string | null) {
    setAba(nova);
    guardarAba(nova);
  }

  async function alternarFavorita(id: string) {
    if (!(await alternar(id))) toast.error(tFav("falhouSalvar"));
  }

  useEffect(() => {
    if (!open) return;
    // Estado zerado A CADA abertura: a lista muda pouco, mas o custo do
    // refetch é pequeno e o estado velho custa caro (lição do acervo).
    setCarregou(false);
    setErroCarga(false);
    setBusca("");
    setSelecao(null);

    const supabase = createClient();
    let cancelado = false;
    void (async () => {
      // As desligadas também aparecem (no fim, sem clique); quem separa os
      // grupos na tela é `separarParaExecutar`.
      // ⚠️ Ligadas e desligadas em consultas SEPARADAS (Codex, PR #343): o
      // PostgREST corta em 1000 linhas sem avisar, e numa consulta só, em
      // ordem de nome, as desligadas do começo do alfabeto empurrariam para
      // fora do teto automações que dá para executar. Assim o que roda chega
      // como chegava antes; as desligadas vêm à parte, só para serem vistas.
      const colunasDaAutomacao =
        "id, name, description, channel_ids, trigger_type, is_active, area_id";
      const colunasDoRobo = "id, name, channel_id, status";
      const [autosLigadas, autosDesligadas, robosAtivos, robosInativos, leituraDasAreas] =
        await Promise.all([
        supabase
          .from("automations")
          .select(colunasDaAutomacao)
          .eq("is_active", true)
          .order("name"),
        // `IS NOT TRUE`: nulo também é desligada (a régua de `separarParaExecutar`).
        supabase
          .from("automations")
          .select(colunasDaAutomacao)
          .not("is_active", "is", true)
          .order("name"),
        supabase
          .from("flows")
          .select(colunasDoRobo)
          .eq("status", "active")
          .order("name"),
        supabase
          .from("flows")
          .select(colunasDoRobo)
          .or("status.is.null,status.neq.active")
          .order("name"),
        supabase.from("cb_areas_de_automacao").select("id, nome, posicao"),
      ]);
      if (cancelado) return;
      // À parte da lista: sem as áreas, a janela funciona como antes.
      if (leituraDasAreas.error) {
        console.error("[executar] áreas não carregaram:", leituraDasAreas.error.message);
        setAreas(null);
      } else {
        setAreas(ordenarAreas((leituraDasAreas.data ?? []) as AreaDeAutomacao[]));
      }
      const falha =
        autosLigadas.error ?? autosDesligadas.error ?? robosAtivos.error ?? robosInativos.error;
      if (falha) {
        console.error("[executar] carga falhou:", falha.message);
        setErroCarga(true);
      } else {
        setAutomacoes([
          ...(autosLigadas.data ?? []),
          ...(autosDesligadas.data ?? []),
        ] as AutomacaoParaExecutar[]);
        setRobos([...(robosAtivos.data ?? []), ...(robosInativos.data ?? [])] as RoboParaExecutar[]);
      }
      setCarregou(true);
    })();
    return () => {
      cancelado = true;
    };
  }, [open]);

  // ⚠️ `semAcento` como o resto do inbox: com o `.toLowerCase()` cru,
  // "cobranca" não achava "Cobrança" e o dialog dizia "Nada casa com a
  // busca" sobre item existente (ledger 48h). Aqui só decide a FRASE do
  // estado vazio; o recorte (com a mesma régua) é de `separarParaExecutar`.
  const termo = semAcento(busca.trim());
  // A régua do Asaas (998) só roda pela varredura: por aqui sairia com as
  // `{{vars.*}}` vazias, sem reconfirmar o pagamento e sem trava — a rota
  // também recusa (`runAutomationById`), mas oferecer o botão seria mentir.
  // Ela sai dos DOIS grupos dentro de `separarParaExecutar`.
  const idsDasAreas = useMemo(() => new Set((areas ?? []).map((x) => x.id)), [areas]);
  const comAbas = areas !== null && areas.length > 0;
  // Área guardada que não existe mais (apagada) volta para "Todas"; sem a
  // barra na tela, nenhum recorte invisível.
  const abaVigente =
    comAbas && aba !== null && (aba === ABA_GERAL || idsDasAreas.has(aba)) ? aba : null;
  const lista = useMemo(
    () =>
      separarParaExecutar(automacoes, robos, busca, {
        aba: abaVigente,
        idsDasAreas,
        favoritas,
      }),
    [automacoes, robos, busca, abaVigente, idsDasAreas, favoritas],
  );
  const contagem = useMemo(
    () => contagemDasAbas(automacoes, robos, busca, areas ?? []),
    [automacoes, robos, busca, areas],
  );

  // Falha ABERTA, como o motor: canal da conversa desconhecido (pré-903)
  // não desabilita nada — o envio resolve o canal padrão, igual aos gatilhos.
  function automacaoForaDoCanal(a: AutomacaoParaExecutar): boolean {
    if (!a.channel_ids || a.channel_ids.length === 0 || !channelId) return false;
    return !a.channel_ids.includes(channelId);
  }
  function roboForaDoCanal(r: RoboParaExecutar): boolean {
    return Boolean(r.channel_id && channelId && r.channel_id !== channelId);
  }

  async function executar() {
    if (!selecao || conexaoForaDoAr) return;
    setExecutando(true);
    try {
      const res = await fetch("/api/cb/execucoes/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          tipo: selecao.tipo,
          id: selecao.id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        if (data.error === "channel_out_of_scope") toast.error(t("foraDoCanal"));
        else if (data.error === "stage_out_of_scope") toast.error(t("foraDaEtapa"));
        else if (data.error === "inactive") toast.error(t("inativa"));
        else if (data.error === "engine_refused" && data.detail)
          toast.error(data.detail);
        else toast.error(t("erro"));
        return;
      }
      toast.success(
        selecao.tipo === "robo" ? t("roboIniciado") : t("automacaoDisparada"),
      );
      // A aba Automações do painel vive em outra árvore — o evento global a
      // faz recarregar sem fiar callback por page → thread → composer.
      avisarExecucoesMudaram();
      onOpenChange(false);
    } catch {
      toast.error(t("erro"));
    } finally {
      setExecutando(false);
    }
  }

  // `bloqueio` preenchido = a linha aparece desabilitada, com o motivo (fora
  // do canal da conversa, ou desligada). Sem `onClick` nesse caso: o item
  // desligado não abre nem a confirmação. A estrela (só automação, e só com
  // as favoritas LIDAS) fica clicável mesmo na bloqueada: desfavoritar a
  // desligada também é preciso. Botão IRMÃO do principal, nunca dentro dele.
  function LinhaDeItem({
    icone,
    nome,
    descricao,
    bloqueio,
    onClick,
    favoritaId,
  }: {
    icone: React.ReactNode;
    nome: string;
    descricao?: string | null;
    bloqueio: string | null;
    onClick?: () => void;
    favoritaId?: string;
  }) {
    const ehFavorita = favoritaId !== undefined && favoritas?.has(favoritaId) === true;
    return (
      <div
        className={cn(
          "border-border bg-muted/40 flex w-full items-center rounded-md border",
          bloqueio === null && "hover:border-primary/50 hover:bg-muted",
        )}
      >
        <button
          type="button"
          disabled={bloqueio !== null}
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-2 p-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
        >
          {icone}
          <span className="min-w-0 flex-1">
            <span className="text-foreground block truncate text-sm font-medium">
              {nome}
            </span>
            {/* Bloqueada, o MOTIVO ocupa a linha de baixo — é a informação
                que decide, a descrição pode esperar. */}
            {bloqueio !== null ? (
              <span className="text-muted-foreground block text-xs">
                {bloqueio}
              </span>
            ) : descricao ? (
              <span className="text-muted-foreground block truncate text-xs">
                {descricao}
              </span>
            ) : null}
          </span>
        </button>
        {favoritaId !== undefined && favoritas !== null && (
          <button
            type="button"
            onClick={() => void alternarFavorita(favoritaId)}
            aria-pressed={ehFavorita}
            aria-label={ehFavorita ? tFav("desmarcar") : tFav("marcar")}
            title={ehFavorita ? tFav("desmarcar") : tFav("marcar")}
            className="text-muted-foreground hover:text-foreground mr-1 flex size-8 shrink-0 items-center justify-center rounded-md"
          >
            <Star
              className={cn(
                "size-4",
                ehFavorita && "fill-amber-400 text-amber-500",
              )}
            />
          </button>
        )}
      </div>
    );
  }

  function LinhaDeAutomacao({ a }: { a: AutomacaoParaExecutar }) {
    return (
      <LinhaDeItem
        icone={<Zap className="text-primary h-4 w-4 shrink-0" />}
        nome={a.name}
        descricao={a.description}
        bloqueio={automacaoForaDoCanal(a) ? t("foraDoCanal") : null}
        onClick={() => setSelecao({ tipo: "automacao", id: a.id, nome: a.name })}
        favoritaId={a.id}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("titulo")}</DialogTitle>
        </DialogHeader>

        {selecao ? (
          /* ---- Confirmação: mensagens reais podem sair daqui. ---- */
          /* min-w-0: filho de grid (DialogContent) nasce com min-width:auto,
             e a descrição em `truncate` (nowrap) infla o intrínseco — o
             card ficava com 448px e o conteúdo com 1124px (medido). */
          <div className="min-w-0 space-y-4">
            <p className="text-foreground text-sm">
              {t("confirmarTexto", { nome: selecao.nome, contato: contactName })}
            </p>
            <p className="text-muted-foreground text-xs">{t("avisoEnvio")}</p>
            {conexaoForaDoAr && (
              <p role="alert" className="text-xs font-medium text-red-700 dark:text-red-300">
                {t("conexaoForaDoAr")}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={executando}
                onClick={() => setSelecao(null)}
              >
                {t("voltar")}
              </Button>
              <Button
                size="sm"
                disabled={executando || conexaoForaDoAr}
                onClick={() => void executar()}
              >
                {executando ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {t("executar")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={t("buscar")}
                className="pl-8"
              />
            </div>

            {comAbas && (
              <BarraDeAbas
                areas={areas}
                contagem={contagem.contagem}
                total={contagem.total}
                aba={abaVigente}
                onAba={escolherAba}
                podeGerenciar={false}
                onGerenciar={() => {}}
              />
            )}
            {favoritasFalharam && favoritas === null && (
              <p className="text-muted-foreground text-xs">{tFav("falhouCarregar")}</p>
            )}

            <div className="max-h-[55vh] space-y-4 overflow-y-auto">
              {!carregou ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
                </div>
              ) : erroCarga ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {t("erroCarregar")}
                </p>
              ) : listaVazia(lista) ? (
                /* Só quando NENHUM dos grupos tem resultado: a busca que
                   acha apenas uma desligada mostra a desligada, não "nada". */
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {termo ? t("nadaNaBusca") : abaVigente !== null ? t("nadaNaAba") : t("nadaDisponivel")}
                </p>
              ) : (
                <>
                  {lista.favoritas.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-muted-foreground flex items-center gap-1 text-xs font-semibold uppercase">
                        <Star className="size-3 fill-amber-400 text-amber-500" />
                        {tFav("grupo")}
                      </p>
                      {lista.favoritas.map((a) => (
                        <LinhaDeAutomacao key={a.id} a={a} />
                      ))}
                    </div>
                  )}
                  {lista.automacoes.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-muted-foreground text-xs font-semibold uppercase">
                        {t("grupoAutomacoes")}
                      </p>
                      {lista.automacoes.map((a) => (
                        <LinhaDeAutomacao key={a.id} a={a} />
                      ))}
                    </div>
                  )}
                  {lista.robos.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-muted-foreground text-xs font-semibold uppercase">
                        {t("grupoRobos")}
                      </p>
                      {lista.robos.map((r) => (
                        <LinhaDeItem
                          key={r.id}
                          icone={<Bot className="text-primary h-4 w-4 shrink-0" />}
                          nome={r.name}
                          bloqueio={roboForaDoCanal(r) ? t("foraDoCanal") : null}
                          onClick={() =>
                            setSelecao({ tipo: "robo", id: r.id, nome: r.name })
                          }
                        />
                      ))}
                    </div>
                  )}
                  {/* Desligadas no FIM, sem clique: aparecem para o operador
                      não concluir que a automação sumiu (29/09/2026), e o
                      motivo diz onde ligar. O robô usa o MESMO rótulo da tela
                      de Fluxos (Rascunho/Arquivado), que é onde ele vai
                      procurar. A rota continua recusando desligada. */}
                  {lista.desligadas.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-muted-foreground text-xs font-semibold uppercase">
                        {t("grupoDesligadas")}
                      </p>
                      {lista.desligadas.map((d) =>
                        d.tipo === "automacao" ? (
                          <LinhaDeItem
                            key={d.automacao.id}
                            icone={<Zap className="text-primary h-4 w-4 shrink-0" />}
                            nome={d.automacao.name}
                            bloqueio={t("motivoAutomacaoDesligada")}
                            favoritaId={d.automacao.id}
                          />
                        ) : (
                          <LinhaDeItem
                            key={d.robo.id}
                            icone={<Bot className="text-primary h-4 w-4 shrink-0" />}
                            nome={d.robo.name}
                            bloqueio={
                              d.robo.status === "archived"
                                ? t("motivoRoboArquivado")
                                : t("motivoRoboRascunho")
                            }
                          />
                        ),
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
