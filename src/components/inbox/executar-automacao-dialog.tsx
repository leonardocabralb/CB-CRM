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
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Play, Search, Zap } from "lucide-react";
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
import { createClient } from "@/lib/supabase/client";
import { semAcento } from "@/lib/inbox/busca-em-mensagens";
import {
  listaVazia,
  separarParaExecutar,
  type AutomacaoParaExecutar,
  type RoboParaExecutar,
} from "@/lib/execucoes/lista-para-executar";
import { avisarExecucoesMudaram } from "@/hooks/use-execucoes-do-contato";

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

  const [automacoes, setAutomacoes] = useState<AutomacaoParaExecutar[]>([]);
  const [robos, setRobos] = useState<RoboParaExecutar[]>([]);
  const [carregou, setCarregou] = useState(false);
  const [erroCarga, setErroCarga] = useState(false);
  const [busca, setBusca] = useState("");
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const [executando, setExecutando] = useState(false);

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
      const colunasDaAutomacao = "id, name, description, channel_ids, trigger_type, is_active";
      const colunasDoRobo = "id, name, channel_id, status";
      const [autosLigadas, autosDesligadas, robosAtivos, robosInativos] = await Promise.all([
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
      ]);
      if (cancelado) return;
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
  const lista = useMemo(
    () => separarParaExecutar(automacoes, robos, busca),
    [automacoes, robos, busca],
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
  // desligado não abre nem a confirmação.
  function LinhaDeItem({
    icone,
    nome,
    descricao,
    bloqueio,
    onClick,
  }: {
    icone: React.ReactNode;
    nome: string;
    descricao?: string | null;
    bloqueio: string | null;
    onClick?: () => void;
  }) {
    return (
      <button
        type="button"
        disabled={bloqueio !== null}
        onClick={onClick}
        className="border-border bg-muted/40 hover:border-primary/50 hover:bg-muted flex w-full items-center gap-2 rounded-md border p-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-muted/40"
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
                  {termo ? t("nadaNaBusca") : t("nadaDisponivel")}
                </p>
              ) : (
                <>
                  {lista.automacoes.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-muted-foreground text-xs font-semibold uppercase">
                        {t("grupoAutomacoes")}
                      </p>
                      {lista.automacoes.map((a) => (
                        <LinhaDeItem
                          key={a.id}
                          icone={<Zap className="text-primary h-4 w-4 shrink-0" />}
                          nome={a.name}
                          descricao={a.description}
                          bloqueio={automacaoForaDoCanal(a) ? t("foraDoCanal") : null}
                          onClick={() =>
                            setSelecao({ tipo: "automacao", id: a.id, nome: a.name })
                          }
                        />
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
