"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Automation, Deal, PipelineStage } from "@/types";
import type { CbChannel } from "@/lib/cb-channels/repo";
import { DealCard } from "./deal-card";
import { Button } from "@/components/ui/button";
import { MessageSquare, Plus, Zap } from "lucide-react";
import { useSinalDeExecucoes } from "@/hooks/use-sinal-de-execucoes";
import { useChannels } from "@/hooks/use-channels";
import { formatCurrency } from "@/lib/currency";
import { contarAtivasNaEtapa } from "@/lib/automations/por-etapa";
import { useTranslations } from "next-intl";
import type { DealDoQuadro } from "@/lib/pipelines/cartao";
import {
  CARDS_POR_COLUNA,
  cardsDaColuna,
  idsDesenhados,
  semConteudo,
  type NegocioEnxuto,
} from "@/lib/pipelines/quadro-enxuto";
import type { CamposDoCard } from "@/lib/pipelines/campos-do-card";
import { gravarRetorno, lerRetorno } from "@/lib/pipelines/retorno";
import { urlDoInbox } from "@/lib/inbox/url";

// O teto por coluna e a regra do card recém-solto moraram aqui até
// 21/09/2026; mudaram para o módulo puro do quadro enxuto, que também decide
// o que se BAIXA por coluna. Reexportados para quem já os importava daqui.
export { CARDS_POR_COLUNA, cardsDaColuna } from "@/lib/pipelines/quadro-enxuto";

/**
 * Os tetos por coluna, carimbados com o funil a que pertencem. Exportado
 * porque a PÁGINA cria o ref e o quadro só o alimenta.
 */
export interface TetosDoQuadro {
  funil: string;
  porEtapa: Record<string, number>;
}

interface PipelineBoardProps {
  stages: PipelineStage[];
  /**
   * TODOS os cards do funil, na forma enxuta — a verdade sobre a coluna de
   * cada um, o contador e a soma do cabeçalho. Ver `quadro-enxuto.ts`.
   */
  deals: NegocioEnxuto[];
  /** O conteúdo completo, por id, dos cards que já foram baixados. */
  detalhes: ReadonlyMap<string, DealDoQuadro>;
  /**
   * Os cards DESENHADOS que ainda não têm conteúdo — o "carregar mais" de
   * uma coluna, o teto que a volta do inbox restaura, o card que nasceu
   * entre as duas consultas. A página baixa e deduplica; o quadro só avisa.
   */
  onFaltamDetalhes: (ids: string[]) => void;
  /** Automações da conta, para a etiqueta por coluna (Fase 5). */
  automations: Automation[];
  /** O funil exibido — carimba o ponto de retorno ao sair para o inbox. */
  pipelineId: string;
  /** O que os cards exibem (popover da barra, por dispositivo). */
  campos: CamposDoCard;
  /**
   * Criado pela PÁGINA e atachado aqui no `.pipeline-scroll`: a página
   * também precisa medir a rolagem (o link do formulário de negócio grava o
   * retorno da mesma jornada).
   */
  quadroRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Idem: os tetos por coluna são estado DAQUI, mas a página é quem grava o
   * retorno pelo link "ver conversa" do formulário do negócio — aberto pelo
   * lápis de um card que pode ser o de número 150 de uma coluna expandida.
   * Sem este espelho, aquela saída grava rolagem sem tetos e a volta cai num
   * quadro de 100 cards, com o card de origem ausente e o `scrollTop`
   * grampeado (achado do Codex no PR #231, 2ª rodada).
   *
   * Carimbado com o funil: o quadro DESMONTA ao trocar para a Lista, e o
   * `useEffect` de limpeza não roda a troca de funil feita de lá — sem o
   * carimbo, o retorno do funil B levaria os tetos do funil A.
   */
  limitesRef: React.MutableRefObject<TetosDoQuadro>;
  onDealMoved: (dealId: string, newStageId: string) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  onOpenAutomations: (stage: PipelineStage) => void;
}

export function PipelineBoard({
  stages,
  deals,
  detalhes,
  onFaltamDetalhes,
  automations,
  pipelineId,
  campos,
  quadroRef,
  limitesRef,
  onDealMoved,
  onAddDeal,
  onEditDeal,
  onOpenAutomations,
}: PipelineBoardProps) {
  const router = useRouter();
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  /**
   * Quanto cada coluna já revelou, CARIMBADO com o funil a que pertence.
   *
   * ⚠️ Trocar de funil tem de voltar ao teto inicial, senão a coluna do
   * funil novo abre expandida com o limite que o operador subiu no
   * anterior. E a volta NÃO pode ser um efeito: `setState` síncrono em
   * efeito é ERRO do React Compiler neste projeto (PRs #92/#94). Carimbar o
   * dono e comparar contra o prop do render ATUAL é o mesmo padrão dos
   * campos personalizados (`{ de, mapa }`) — e não tem o quadro em que o
   * efeito ainda não rodou.
   */
  const [limites, setLimites] = useState<{
    funil: string;
    porEtapa: Record<string, number>;
  }>({ funil: pipelineId, porEtapa: {} });
  // `useMemo` para o `{}` do ramo vazio não ganhar identidade nova a cada
  // render — sem ele, o efeito que alimenta `limitesRef` rodaria sempre.
  const limitesDoFunil = useMemo(
    () => (limites.funil === pipelineId ? limites.porEtapa : {}),
    [limites, pipelineId],
  );
  /**
   * Espelho dos tetos para `navegarParaInbox` ler sem virar dependência dele
   * — ver o porquê lá. Efeito passivo basta: o valor só precisa estar em dia
   * quando o operador CLICA, que é muito depois de qualquer commit.
   *
   * ⚠️ O ref é da PÁGINA (prop), não deste componente: a outra saída para o
   * inbox — o link do formulário do negócio — é gravada lá, e um ref local
   * seria invisível para ela.
   */
  useEffect(() => {
    limitesRef.current = { funil: pipelineId, porEtapa: limitesDoFunil };
  }, [limitesRef, pipelineId, limitesDoFunil]);
  /**
   * O último card solto. Só existe para `cardsDaColuna` poder trazê-lo para
   * dentro do teto — ver o porquê lá.
   */
  const [recemSolto, setRecemSolto] = useState<string | null>(null);

  const mostrarMais = useCallback(
    (stageId: string) => {
      setLimites((atual) => {
        const base = atual.funil === pipelineId ? atual.porEtapa : {};
        return {
          funil: pipelineId,
          porEtapa: {
            ...base,
            [stageId]: (base[stageId] ?? CARDS_POR_COLUNA) + CARDS_POR_COLUNA,
          },
        };
      });
    },
    [pipelineId],
  );
  // UMA busca de canais para o quadro inteiro. Dentro do card, o hook
  // disparava um GET /api/cb/channels POR CARD (120 numa conta real) a cada
  // montagem — achado da revisão do PR #71.
  const { channels } = useChannels();
  // Quais clientes têm automação agendada (985) — UMA consulta para o quadro
  // inteiro. O mapa é memoizado por identidade do resumo: sem isso, um objeto
  // novo a cada render derrubaria o `memo` dos ~120 cards.
  const { resumo: sinalDeExecucoes } = useSinalDeExecucoes();
  const esperasPorContato = useMemo(() => {
    const mapa: Record<string, number> = {};
    for (const [id, info] of Object.entries(sinalDeExecucoes?.porContato ?? {})) {
      mapa[id] = info.esperas;
    }
    return mapa;
  }, [sinalDeExecucoes]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, NegocioEnxuto[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  /**
   * Os cards desenhados sem conteúdo ainda — pedidos à página num efeito,
   * que deduplica e baixa (o quadro não sabe o que já está em voo). A regra
   * de quem é desenhado é a MESMA do render (`idsDesenhados` usa
   * `cardsDaColuna`), senão um card desenhado ficaria para sempre
   * "carregando", ou se baixaria card que ninguém vê.
   */
  const semConteudoAinda = useMemo(
    () =>
      semConteudo(
        idsDesenhados(
          deals,
          sortedStages.map((s) => s.id),
          limitesDoFunil,
          recemSolto,
        ),
        detalhes,
      ),
    [deals, sortedStages, limitesDoFunil, recemSolto, detalhes],
  );
  useEffect(() => {
    if (semConteudoAinda.length > 0) onFaltamDetalhes(semConteudoAinda);
  }, [semConteudoAinda, onFaltamDetalhes]);

  /**
   * As duas portas de saída para o inbox (corpo do card e botão da coluna)
   * gravam o ponto de retorno ANTES de navegar — é o que permite à volta
   * cair no mesmo funil, na mesma rolagem. O scroll vertical da página é o
   * `<main>` do dashboard-shell (único ancestral com overflow-y), alcançado
   * por `closest` para não acoplar a shell a esta feature.
   *
   * `useCallback` até o card: com handlers estáveis, o `memo` do DealCard
   * segura o re-render dos ~120 cards quando um diálogo irmão digita.
   */
  const navegarParaInbox = useCallback(
    (destino: { c?: string; etapa?: string }) => {
      const quadro = quadroRef.current;
      gravarRetorno({
        pipelineId,
        scrollLeft: quadro?.scrollLeft ?? 0,
        scrollTop: quadro?.closest("main")?.scrollTop ?? 0,
        // ⚠️ Os tetos viajam junto com a rolagem: quem abriu a conversa a
        // partir do card 150 volta, sem eles, para um quadro de 100 — o card
        // de origem não existe e o `scrollTop` é grampeado pela altura menor.
        //
        // ⚠️ Lido por REF, nunca por dependência: `limitesDoFunil` ganha
        // identidade nova a cada render, e pô-lo aqui desestabilizaria este
        // callback — que é o que segura o `memo` do DealCard e impede os
        // ~120 cards de redesenharem a cada tecla digitada num diálogo irmão
        // (o achado da revisão do PR #71, registrado logo acima).
        limites:
          limitesRef.current.funil === pipelineId
            ? limitesRef.current.porEtapa
            : {},
      });
      router.push(urlDoInbox({ ...destino, de: "funil" }));
    },
    [pipelineId, quadroRef, limitesRef, router],
  );
  const abrirConversa = useCallback(
    (conversationId: string) => navegarParaInbox({ c: conversationId }),
    [navegarParaInbox],
  );
  const verConversas = useCallback(
    (stageId: string) => navegarParaInbox({ etapa: stageId }),
    [navegarParaInbox],
  );

  /**
   * A volta: aplica o retorno gravado acima. O registro NÃO é apagado — ele
   * expira (ver retorno.ts): apagar no consumo perdia a restauração quando o
   * quadro desmontava antes dos rAF, e quebrava o ir-e-voltar repetido da
   * mesma jornada. `aplicadoRef` impede reaplicar no MESMO mount quando
   * `sortedStages` troca de identidade (refreshStages).
   *
   * Dispara quando as colunas existem — etapas e negócios chegam no MESMO
   * commit (Promise.all na página), então aqui o quadro já tem a largura e
   * a altura reais. ⚠️ O `loading` da página NÃO serviria de gatilho: ele
   * cobre só a carga dos funis, e restaurar sobre um quadro vazio grampeia
   * o scroll em zero.
   */
  const aplicadoRef = useRef(false);
  useEffect(() => {
    if (aplicadoRef.current) return;
    if (sortedStages.length === 0) return;
    const retorno = lerRetorno();
    if (!retorno) return;
    // Funil apagado/trocado no meio do caminho: o registro não é deste quadro.
    if (retorno.pipelineId !== pipelineId) return;
    // Dois rAF: o primeiro devolve o controle depois do commit, o segundo
    // depois do layout — só aí scrollWidth/scrollHeight são reais. Os ids
    // são cancelados no cleanup: sem isso, desmontar na janela (trocar para
    // a vista de automações) dispararia scrollTo contra ref nula.
    // ⚠️ `aplicadoRef` só é marcado DEPOIS de aplicar, dentro do rAF: no
    // StrictMode o efeito roda, o cleanup cancela os rAF e o efeito roda de
    // novo — marcado antes, a segunda passada pularia a restauração.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      // ⚠️ Os tetos voltam ANTES da rolagem, e é por isso que eles ficam no
      // PRIMEIRO quadro: restaurar 150 cards numa coluna muda a altura do
      // quadro, e o `scrollTo` do segundo mediria a altura menor e seria
      // grampeado. Aqui dentro, e não no corpo do efeito, porque `setState`
      // síncrono em efeito é ERRO do React Compiler neste projeto.
      if (Object.keys(retorno.limites).length > 0) {
        setLimites({ funil: retorno.pipelineId, porEtapa: retorno.limites });
      }
      raf2 = requestAnimationFrame(() => {
        // ⚠️ `behavior: "instant"` é obrigatório: `.pipeline-scroll` tem
        // `scroll-behavior: smooth` no styled-jsx abaixo, e restaurar
        // obedecendo o CSS viraria uma varredura animada a cada volta.
        quadroRef.current?.scrollTo({
          left: retorno.scrollLeft,
          behavior: "instant",
        });
        quadroRef.current
          ?.closest("main")
          ?.scrollTo({ top: retorno.scrollTop, behavior: "instant" });
        aplicadoRef.current = true;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [sortedStages, pipelineId, quadroRef]);

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel.
    useSensor(KeyboardSensor),
  );

  // Só card COM conteúdo é arrastável (o que ainda carrega não registra
  // `useDraggable`), então o arrastado sempre está em `detalhes`.
  const activeDeal = activeDealId ? detalhes.get(activeDealId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    // Só marca quando o movimento REALMENTE acontece (as três saídas acima
    // devolvem o card ao lugar) — senão a coluna de origem passaria a fixar
    // no topo um card que ninguém moveu.
    setRecemSolto(dealId);
    onDealMoved(dealId, targetStageId);
  }

  function handleDragCancel() {
    setActiveDealId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* snap-x + snap-mandatory on mobile so swipes land the next
          stage cleanly at the viewport edge instead of mid-column.
          Disabled on lg+ where snapping would interfere with the
          natural layout. The board can still overflow horizontally on
          lg+ once a pipeline has many stages (columns keep a 260px
          min-width), so a thin scrollbar stays visible on desktop. */}
      <div
        ref={quadroRef}
        className="pipeline-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none"
      >
        {sortedStages.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          const totalValue = stageDeals.reduce(
            (s, d) => s + Number(d.value || 0),
            0,
          );
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={stageDeals}
              detalhes={detalhes}
              totalValue={totalValue}
              automacoesAtivas={contarAtivasNaEtapa(automations, stage.id)}
              campos={campos}
              channels={channels}
              esperasPorContato={esperasPorContato}
              limite={limitesDoFunil[stage.id] ?? CARDS_POR_COLUNA}
              recemSolto={recemSolto}
              onMostrarMais={mostrarMais}
              onAddDeal={onAddDeal}
              onEditDeal={onEditDeal}
              onAbrirConversa={abrirConversa}
              onVerConversas={verConversas}
              onOpenAutomations={onOpenAutomations}
            />
          );
        })}
      </div>

      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        {activeDeal ? (
          <div className="opacity-90">
            <DealCard
              deal={activeDeal}
              stage={
                sortedStages.find((s) => s.id === activeDeal.stage_id) ?? null
              }
              campos={campos}
              channels={channels}
              onEdit={() => {}}
              onAbrirConversa={() => {}}
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .pipeline-scroll {
          scroll-behavior: smooth;
        }
        /* On touch devices the peek/snap layout already signals there's
           more to swipe, so the scrollbar is hidden for a clean look.
           On desktop (mouse) the board can overflow with many stages
           and there is no peek hint, so keep a thin, themed scrollbar
           visible to make the overflow discoverable and usable. */
        @media (hover: none), (pointer: coarse) {
          .pipeline-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .pipeline-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .pipeline-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .pipeline-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .pipeline-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}

function StageColumn({
  stage,
  deals,
  detalhes,
  totalValue,
  automacoesAtivas,
  campos,
  channels,
  esperasPorContato,
  limite,
  recemSolto,
  onMostrarMais,
  onAddDeal,
  onEditDeal,
  onAbrirConversa,
  onVerConversas,
  onOpenAutomations,
}: {
  stage: PipelineStage;
  /** A coluna INTEIRA, enxuta — contador, soma e quem é desenhado. */
  deals: NegocioEnxuto[];
  /** O conteúdo completo dos cards já baixados, por id. */
  detalhes: ReadonlyMap<string, DealDoQuadro>;
  totalValue: number;
  automacoesAtivas: number;
  campos: CamposDoCard;
  channels: CbChannel[];
  /** Quantos cards desta coluna desenhar — ver `CARDS_POR_COLUNA`. */
  limite: number;
  /** O último card solto no quadro (pode ser de outra coluna). */
  recemSolto: string | null;
  onMostrarMais: (stageId: string) => void;
  /**
   * contato → quantas automações agendadas (985). Um mapa só para o quadro
   * inteiro, buscado UMA vez no board: um hook por card seria uma requisição
   * por card, e um objeto novo por render quebraria o `memo` do `DealCard`.
   */
  esperasPorContato: Record<string, number>;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  onAbrirConversa: (conversationId: string) => void;
  onVerConversas: (stageId: string) => void;
  onOpenAutomations: (stage: PipelineStage) => void;
}) {
  const t = useTranslations("Pipelines.board");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  // ⚠️ O contador do cabeçalho e o somatório continuam vindo de `deals`, a
  // coluna INTEIRA: o teto é de desenho, não de dado, e um "100" no
  // distintivo de uma coluna com 2.719 cards seria mentira.
  const visiveis = cardsDaColuna(deals, limite, recemSolto);
  const escondidos = deals.length - visiveis.length;

  return (
    // On mobile each column is `w-[85vw]` (with a reasonable min/max)
    // so the next column's edge peeks in — a "there's more here" hint.
    // snap-start lands each column cleanly when swiping. On lg+ we
    // restore the flex-1 share-the-row behavior. The droppable ref is
    // on the inner messages region below — intentionally NOT here, so
    // a drag over the column header doesn't highlight the whole column.
    <div className="flex w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[260px] lg:shrink lg:snap-none">
      {/* 3px colored top border — sits above the column's padding */}
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex items-center justify-between gap-1 pt-3">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {stage.name}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          {/* As conversas desta etapa, na caixa de entrada — abre o inbox com
              o filtro de etapa já semeado (?etapa=), gravando o retorno como
              o clique no card: é a mesma jornada de ida e volta. */}
          <button
            type="button"
            onClick={() => onVerConversas(stage.id)}
            aria-label={t("stageConversations")}
            title={t("stageConversations")}
            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
          >
            <MessageSquare className="h-3 w-3" />
          </button>
          {/* Automações desta coluna (Fase 5). Fica visível mesmo com zero:
              é por aqui que se CRIA a primeira, e um botão que só aparece
              depois de já existir automação não ensina ninguém.

              ⚠️ O número conta o que dispara e está LIGADO — inclusive as
              regras de etapa nenhuma, que valem para todas. Ver
              `contarAtivasNaEtapa`. */}
          <button
            type="button"
            onClick={() => onOpenAutomations(stage)}
            aria-label={t("stageAutomations", { count: automacoesAtivas })}
            title={t("stageAutomations", { count: automacoesAtivas })}
            className={
              automacoesAtivas > 0
                ? "inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
                : "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
            }
          >
            <Zap className="h-3 w-3" />
            {automacoesAtivas > 0 && (
              <span className="tabular-nums">{automacoesAtivas}</span>
            )}
          </button>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {deals.length}
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatCurrency(totalValue)}
      </p>

      <div
        ref={setNodeRef}
        className={`mt-3 flex flex-1 flex-col gap-2 rounded-lg transition-all ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropDealHere")}
          </div>
        ) : (
          visiveis.map((negocio) => {
            const deal = detalhes.get(negocio.id);
            // Sem conteúdo ainda: o card fica NO LUGAR, com o título que a
            // lista enxuta já tem, até a página baixar o resto — nunca some
            // da coluna nem muda o contador.
            if (!deal) return <CardCarregando key={negocio.id} titulo={negocio.title} />;
            return (
              <DraggableDealCard
                key={negocio.id}
                deal={deal}
                stage={stage}
                campos={campos}
                channels={channels}
                esperasDeAutomacao={
                  esperasPorContato[deal.contact_id ?? ""] ?? 0
                }
                onEdit={onEditDeal}
                onAbrirConversa={onAbrirConversa}
              />
            );
          })
        )}

        {/* Dentro da área de soltura, de propósito: quem arrasta até o fim
            de uma coluna cheia solta em cima deste botão, e fora dela o
            gesto cairia no vão entre o quadro e "Adicionar negócio". */}
        {escondidos > 0 && (
          <button
            type="button"
            onClick={() => onMostrarMais(stage.id)}
            className="w-full rounded-lg py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t("loadMoreCards", {
              n: Math.min(CARDS_POR_COLUNA, escondidos),
            })}
          </button>
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddDeal(stage.id)}
        className="mt-3 w-full justify-start border border-dashed border-border bg-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
      >
        <Plus className="mr-1 h-3 w-3" />
        {t("addDeal")}
      </Button>
    </div>
  );
}

function DraggableDealCard({
  deal,
  stage,
  campos,
  channels,
  esperasDeAutomacao,
  onEdit,
  onAbrirConversa,
}: {
  deal: DealDoQuadro;
  stage: PipelineStage;
  campos: CamposDoCard;
  channels: CbChannel[];
  /** Número primitivo, para não quebrar o `memo` do card. */
  esperasDeAutomacao: number;
  onEdit: (deal: Deal) => void;
  onAbrirConversa: (conversationId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <DealCard
        deal={deal}
        stage={stage}
        campos={campos}
        channels={channels}
        esperasDeAutomacao={esperasDeAutomacao}
        onEdit={onEdit}
        onAbrirConversa={onAbrirConversa}
      />
    </div>
  );
}

/**
 * O card desenhado cujo conteúdo completo ainda não chegou. Mesma moldura do
 * `DealCard` e altura parecida — a volta do inbox restaura a rolagem logo
 * depois, e um espaço muito diferente do card real a deixaria fora do lugar.
 * Não é arrastável: o arrasto e o clique precisam do negócio inteiro.
 */
function CardCarregando({ titulo }: { titulo: string }) {
  const t = useTranslations("Pipelines.board");
  return (
    <div
      aria-busy="true"
      aria-label={t("carregandoCard", { titulo })}
      className="rounded-lg border border-border bg-card p-3"
    >
      <p className="truncate text-sm font-medium text-muted-foreground">{titulo}</p>
      <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-muted" />
    </div>
  );
}
