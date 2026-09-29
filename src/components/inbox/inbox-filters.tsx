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

import { useMemo, useState } from "react";
import {
  AlarmClock,
  ChevronDown,
  MailOpen,
  SlidersHorizontal,
  Star,
  X,
  CircleDollarSign,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MotivoDaNeutralizacao } from "@/lib/asaas/aviso-na-conversa";
import type { CbChannel } from "@/lib/cb-channels/repo";
import {
  contarFiltrosAtivos,
  FILTROS_VAZIOS,
  funisDoFiltro,
  funisDoRecorte,
  recorteTemDoisNiveis,
  SEM_ETAPA,
  SEM_RESPONSAVEL,
  type FiltrosDoInbox,
  type SituacaoDaCaixa,
} from "@/lib/inbox/filtros";
import { nomeDaEtapa } from "@/lib/inbox/filtros-salvos";
import type { TipoDeConversa } from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import type {
  PipelineStage,
  Profile,
  Tag,
} from "@/types";

/**
 * O chip quadrado da barra: 28×28, só ícone, mesma cara nos QUATRO controles
 * (favoritas, não lidas, salvos, filtros) — o menu de salvos importa daqui,
 * senão o gatilho dele volta a ter forma própria, que foi a queixa. Ligado
 * pinta em violeta; a estrela em âmbar, que é a cor dela na linha da lista.
 * Com conteúdo a mais (o distintivo do painel) o chip cresce pelo `min-w`.
 */
export function chipDaBarra(ligado: boolean, tom: "primary" | "amber" = "primary") {
  return cn(
    "inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-md border px-1.5 text-xs transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0",
    !ligado &&
      "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
    ligado &&
      tom === "primary" &&
      "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
    ligado &&
      tom === "amber" &&
      "border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400",
  );
}

interface InboxFiltersProps {
  filtros: FiltrosDoInbox;
  onChange: (filtros: FiltrosDoInbox) => void;
  canais: CbChannel[];
  etiquetas: Tag[];
  empresas: string[];
  responsaveis: Profile[];
  etapas: PipelineStage[];
  /**
   * O mapa contato→etapa por trás do recorte está íntegro? Gateia OFERECER o
   * campo de etapa — escolher sem os dados responderia errado. A lista
   * `etapas` continua chegando inteira mesmo com `false`: é ela que dá NOME
   * à pastilha de um filtro já ativo (o deep link `?etapa=` chega antes dos
   * dados, e a consulta de `deals` pode falhar sozinha, com as etapas de pé).
   */
  etapasConfiaveis: boolean;
  /** `pipeline_id` → nome do funil. Só usado quando há mais de um funil. */
  funis: Map<string, string>;
  /** Existe conversa de grupo carregada? Sem isso o recorte por tipo não decide nada. */
  temGrupos: boolean;
  /**
   * A FILEIRA DE VISÕES (os filtros salvos do membro como chips), montada
   * pela LISTA e entregue pronta — slot, porque os dados dela são da lista
   * (hook de filtros salvos, padrão, catálogos). Desenhada logo abaixo das
   * abas. Opcional para a tela continuar montável sem ela (testes).
   */
  visoes?: React.ReactNode;
  /** A caixa de busca, que vive fora daqui — o "Limpar tudo" precisa dela. */
  busca: string;
  onLimparBusca: () => void;
  exibindo: number;
  total: number;
  /**
   * Por que o filtro "Inadimplentes" (Fase 1b) está neutralizado — a MESMA
   * régua do recorte (`motivoDaNeutralizacao`), para o interruptor nunca
   * ficar ligado, sem efeito e sem dica. `null` = o recorte vale. O
   * interruptor é OFERECIDO com o Asaas conectado (`null` ou
   * `sincronizando`); com um filtro salvo já ligado ele aparece de qualquer
   * jeito, para dar como desligá-lo, e a dica diz por que não está
   * recortando: "desconectado" só com `desconectado`, "conferindo…" com
   * `sem_resposta` — afirmar "desconectado" sobre uma conta conectada com a
   * rota em 500 era a confusão `null`/`false` que o resto do PR evita
   * (revisão do PR #203). Ausente = `sem_resposta`.
   */
  asaasNeutralizado?: MotivoDaNeutralizacao | null;
  /**
   * ISO da última listagem completa do Asaas quando ela NÃO é fresca (o
   * espelho está parado); `null` com leitura fresca. O interruptor mostra
   * "dados do Asaas de …" — o recorte continua valendo (é a régua do ícone
   * da linha), só não afirma que é de agora.
   */
  asaasDadosDe?: string | null;
}

/** `dd/mm hh:mm` no fuso de quem lê — a mesma forma da faixa do fio. */
function quandoFoi(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function InboxFilters({
  filtros,
  onChange,
  canais,
  etiquetas,
  empresas,
  responsaveis,
  etapas,
  etapasConfiaveis,
  funis,
  temGrupos,
  visoes,
  busca,
  onLimparBusca,
  exibindo,
  total,
  asaasNeutralizado = "sem_resposta",
  asaasDadosDe = null,
}: InboxFiltersProps) {
  const t = useTranslations("Inbox.conversationList");
  const [aberto, setAberto] = useState(false);
  const [maisFiltros, setMaisFiltros] = useState(false);
  // A situação (aba Abertas/Encerradas) fica FORA da conta: é uma visão com
  // controle próprio, sempre à vista — ver `contarFiltrosAtivos`.
  const ativos = contarFiltrosAtivos(filtros);

  const mexer = (patch: Partial<FiltrosDoInbox>) =>
    onChange({ ...filtros, ...patch });

  const alternarCanal = (id: string) =>
    mexer({
      canalIds: filtros.canalIds.includes(id)
        ? filtros.canalIds.filter((x) => x !== id)
        : [...filtros.canalIds, id],
    });

  // "Mais filtros" abre sozinho quando um dos campos escondidos está
  // recortando: senão o painel esconderia de onde vem o recorte.
  const maisAbertos =
    maisFiltros ||
    filtros.tipo !== "todas" ||
    filtros.responsavelId !== null ||
    filtros.empresa !== null;

  const alternarEtiqueta = (id: string) =>
    mexer({
      etiquetaIds: filtros.etiquetaIds.includes(id)
        ? filtros.etiquetaIds.filter((x) => x !== id)
        : [...filtros.etiquetaIds, id],
    });

  const responsavelAtual = responsaveis.find(
    (p) => p.user_id === filtros.responsavelId,
  );

  // ⚠️ As duas saem do módulo puro, e não de uma cópia local: a LISTA também
  // decide, lá em `conversation-list`, se o deep link `?etapa=` pode carimbar
  // o funil. Divergindo, o carimbo acontece numa conta onde este seletor
  // não existe — e some com quem não tem negócio (ver `funisDoRecorte`).
  const funisDoSeletor = useMemo(
    () => funisDoRecorte(etapas, funis),
    [etapas, funis],
  );
  const doisNiveis = useMemo(
    () => recorteTemDoisNiveis(etapas, funis),
    [etapas, funis],
  );

  // "Sem negócio" é opção DE VERDADE (`SEM_ETAPA`) e mora em `etapaIds` nas
  // duas formas do painel: no campo Funil com dois níveis, no campo Etapa com
  // um só — onde sempre esteve.
  const semNegocio = filtros.etapaIds.includes(SEM_ETAPA);

  // ⚠️ Os funis que o PAINEL mostra marcados são os marcados E os DERIVADOS
  // das etapas marcadas (#26 do plano 31/08, ver `funisDoFiltro`): uma visão
  // salva numa conta de um funil grava a etapa sem funil, e sem derivar o
  // campo Etapa nem aparecia — a lista recortada por uma etapa que o painel
  // não mostrava nem deixava trocar. Derivar dá ao painel UMA fonte de
  // verdade sem carimbar nada (carimbar é a armadilha que o CLAUDE.md
  // proíbe).
  const funisMarcados = useMemo(
    () => (doisNiveis ? funisDoFiltro(filtros, etapas) : []),
    [doisNiveis, filtros, etapas],
  );

  // As etapas que o campo Etapa oferece. Com dois níveis, as dos funis
  // marcados, AGRUPADAS pelo nome do funil, na ordem do seletor de funil;
  // com um, todas, num grupo só. Já vêm ordenadas por `position` da
  // consulta — a ordem das colunas do quadro, que é como o operador pensa o
  // funil.
  const gruposDeEtapas = useMemo((): {
    funil: { id: string; nome: string } | null;
    etapas: PipelineStage[];
  }[] => {
    if (!doisNiveis) return [{ funil: null, etapas }];
    return funisDoSeletor
      .filter((f) => funisMarcados.includes(f.id))
      .map((f) => ({
        funil: f,
        etapas: etapas.filter((e) => e.pipeline_id === f.id),
      }))
      .filter((g) => g.etapas.length > 0);
  }, [doisNiveis, etapas, funisDoSeletor, funisMarcados]);

  /**
   * Marcar uma etapa NUNCA escreve `funilIds` — quem escreve é só o seletor
   * de funil. Ver o comentário do campo em `filtros.ts`: com um funil só,
   * carimbá-lo por tabela transformaria "Qualquer etapa" (hoje: não filtro
   * por etapa) em "quem tem negócio neste funil", sumindo em silêncio com
   * quem ainda não virou negócio.
   */
  const alternarEtapa = (id: string) =>
    mexer({
      etapaIds: filtros.etapaIds.includes(id)
        ? filtros.etapaIds.filter((x) => x !== id)
        : [...filtros.etapaIds, id],
    });

  /**
   * Desmarcar um funil tira as etapas DELE junto (pedido do operador,
   * 29/09); as dos outros funis ficam. Sem isso a etapa seguiria recortando
   * sem o funil dela na tela — e o funil DERIVADO de uma etapa nem
   * desmarcaria: é a etapa que o mantém marcado.
   */
  const alternarFunil = (id: string) =>
    funisMarcados.includes(id)
      ? mexer({
          funilIds: filtros.funilIds.filter((x) => x !== id),
          etapaIds: filtros.etapaIds.filter(
            (x) => etapas.find((e) => e.id === x)?.pipeline_id !== id,
          ),
        })
      : mexer({ funilIds: [...filtros.funilIds, id] });

  const rotuloDaEtapa = (id: string) => {
    if (id === SEM_ETAPA) return t("stageNone");
    const etapa = etapas.find((e) => e.id === id);
    // Etapa não resolvida: o rótulo genérico do campo é o honesto —
    // "Qualquer etapa" seria o OPOSTO do que está acontecendo.
    if (!etapa) return t("labelStage");
    return doisNiveis ? etapa.name : nomeDaEtapa(etapa, funis);
  };
  // O que o gatilho do campo Etapa resume. Com dois níveis, "Sem negócio"
  // está no campo Funil e fica fora daqui.
  const etapasDoResumo = doisNiveis
    ? filtros.etapaIds.filter((id) => id !== SEM_ETAPA)
    : filtros.etapaIds;

  return (
    <div className="space-y-2">
      {/* ⚠️ UMA LINHA SÓ, e todos os controles com a MESMA cara (pedido do
          operador, 2026-09-03 — "tá feia e aglomerada, os itens estão
          diferentes"). Antes eram duas linhas: um bloco cinza com as abas,
          dois botões de texto ao lado, e "Filtros"/"Salvos" embaixo, cada um
          com padding e forma próprios porque era o jeito de caber em 296px.
          Agora: as duas ABAS (Abertas = a caixa; Encerradas = o acervo) como
          abas de verdade, sublinhadas, e à direita três chips quadrados só
          com ícone — os dois interruptores que SOMAM (favoritas, não lidas)
          e o botão do painel. (O chip do menu de filtros salvos saiu em
          03/09: os salvos viraram a FILEIRA DE VISÕES logo abaixo.) O nome
          vive no `title`/`aria-label`.
          MEDIDO em 03/09: abas ~130px + chips ~148px = ~290px nos 296px úteis
          da coluna no `lg` (336 no `xl`, onde ela passa a 360px). Sem
          `flex-wrap` de propósito: se não couber, é para encolher, nunca
          quebrar. O `-mx-3 px-3` estica o sublinhado até as bordas da coluna
          (o pai tem `p-3`), senão a linha para 12px antes de cada lado. */}
      <div className="-mx-3 flex items-center gap-3 border-b border-border px-3">
        <div
          role="group"
          aria-label={t("labelStatus")}
          className="flex items-center gap-3"
        >
          {(
            [
              ["ativas", t("filterOpen")],
              ["closed", t("filterClosed")],
            ] as [SituacaoDaCaixa, string][]
          ).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              onClick={() => mexer({ status: valor })}
              aria-pressed={filtros.status === valor}
              className={cn(
                "-mb-px h-8 whitespace-nowrap border-b-2 px-0.5 text-[13px] transition-colors",
                filtros.status === valor
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {texto}
            </button>
          ))}
        </div>

        <div className="mb-1 ml-auto flex items-center gap-1.5">
          {/* Favoritas e Não lidas ficam FORA do painel: são recortes de uso
              diário, que se ligam e desligam o tempo todo, e enterrá-los atrás
              de um clique a mais custaria mais que o espaço que ocupam.
              ⚠️ "Não lidas" SOMA com o resto (não substitui a situação, como a
              antiga opção do menu fazia). */}
          <button
            type="button"
            onClick={() => mexer({ favoritas: !filtros.favoritas })}
            aria-pressed={filtros.favoritas}
            aria-label={t("favorites")}
            title={t("favorites")}
            className={chipDaBarra(filtros.favoritas, "amber")}
          >
            <Star className={cn(filtros.favoritas && "fill-current")} />
          </button>
          <button
            type="button"
            onClick={() => mexer({ naoLidas: !filtros.naoLidas })}
            aria-pressed={filtros.naoLidas}
            aria-label={t("filterUnread")}
            title={t("filterUnread")}
            className={chipDaBarra(filtros.naoLidas)}
          >
            <MailOpen />
          </button>
          {/* "Em atraso" (pedido do operador, 2026-09-09). Fica na barra, e
              não no painel, porque é a pergunta da manhã — quem está
              esperando resposta agora — e porque o alerta que ele recorta já
              está desenhado na linha ao lado.
              ⚠️ MESMO ícone e MESMA cor do selo da linha: o chip é o
              interruptor daquele selo, e um par ícone/cor diferente faria
              parecer outra coisa. Âmbar como a estrela, e não é colisão: o
              selo nasce âmbar (vermelho só depois dos 30 min) e os ícones não
              se confundem.
              ⚠️ Ele NÃO substitui "Não lidas" nem depende dela — quem espera
              há 10 minutos costuma ter a conversa já aberta por alguém. */}
          <button
            type="button"
            onClick={() => mexer({ emAtraso: !filtros.emAtraso })}
            aria-pressed={filtros.emAtraso}
            aria-label={t("filterAwaiting")}
            title={t("filterAwaiting")}
            className={chipDaBarra(filtros.emAtraso, "amber")}
          >
            <AlarmClock />
          </button>

          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            aria-label={t("filters")}
            title={t("filters")}
            className={chipDaBarra(ativos > 0)}
          >
            <SlidersHorizontal />
            {/* ⚠️ O distintivo é o que explica uma lista curta com o painel
                fechado. Sem ele, um filtro esquecido vira "sumiram conversas". */}
            {ativos > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {ativos}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ⚠️ AS PASTILHAS DO FILTRO ATIVO, VISÍVEIS COM O PAINEL FECHADO — numa
          linha que SÓ EXISTE quando algo recorta (antes dividiam a linha com
          "Filtros"/"Salvos", espremidas). Sem isto o operador abre o inbox,
          vê 8 de 64 conversas e um distintivo "①" que diz que EXISTE um
          filtro, não QUAL — e a única saída seria limpar todos de uma vez.

          Também é o que salva o caso do filtro cujo campo sumiu: se o último
          grupo sair da lista com "só grupos" marcado, o campo Tipo some do
          painel mas o recorte continua valendo. A pastilha continua ali, com
          o X. */}
      {/* A fileira de visões (filtros salvos como chips) — ver `visoes-salvas`.
          As PASTILHAS do recorte, o "Limpar tudo" solto e a faixa "Filtro
          padrão" moraram aqui até 03/09 e SAÍRAM a pedido do operador: com
          um filtro salvo aplicado viravam um aglomerado que repetia o que o
          chip aceso já diz. O que resta do recorte ad hoc está no painel
          (contador e "Limpar", no rodapé) e no distintivo do botão. */}
      {visoes}

      {aberto && (
        // ⚠️ PAINEL COMPACTO (03/09): os três campos do dia a dia FIXOS —
        // conexões, etiquetas, funil/etapa — e o resto (tipo, responsável,
        // empresa) atrás de "Mais filtros". Uma coluna, de propósito: `sm:`
        // olha a JANELA, mas esta barra tem largura FIXA no desktop (320px
        // no `lg`, 360 no `xl`). Duas colunas dariam ~130px cada, e "Recebeu
        // link de agendamento" ou "Rodrigo Tavares Monteiro" truncariam no
        // próprio gatilho. E o efeito era invertido: no celular, onde a
        // lista ocupa a tela toda, ele caía para uma coluna larga.
        <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
          {/* CONEXÕES — várias, somando com OU (pedido do operador, 03/09).
              Caixas de marcação como as etiquetas; some com menos de 2
              conexões (convenção do projeto: seletor de uma opção não decide
              nada). Vazio = todas. */}
          {canais.length >= 2 && (
            <Campo rotulo={t("labelChannels")}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "inline-flex h-8 w-full min-w-0 items-center justify-between gap-1 rounded-md border border-border px-2 text-xs transition-colors hover:bg-muted",
                    filtros.canalIds.length > 0
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="truncate">
                    {filtros.canalIds.length === 0
                      ? t("channelsAll")
                      : filtros.canalIds.length === 1
                        ? (canais.find((c) => c.id === filtros.canalIds[0])?.label ??
                          t("channelsChosen", { count: 1 }))
                        : t("channelsChosen", { count: filtros.canalIds.length })}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-64 w-60 overflow-y-auto border-border bg-popover"
                >
                  {canais.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.id}
                      checked={filtros.canalIds.includes(c.id)}
                      onCheckedChange={() => alternarCanal(c.id)}
                      className="text-sm text-popover-foreground"
                    >
                      <span className="truncate">{c.label}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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
                {/* "Qualquer uma" × "Todas elas" só decide algo com 2+ etiquetas
                    marcadas. */}
                {filtros.etiquetaIds.length >= 2 && (
                  <button
                    type="button"
                    onClick={() =>
                      mexer({
                        modoDeEtiqueta:
                          filtros.modoDeEtiqueta === "todas" ? "qualquer" : "todas",
                      })
                    }
                    className="h-8 shrink-0 rounded-md border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {filtros.modoDeEtiqueta === "todas"
                      ? t("tagModeAll")
                      : t("tagModeAny")}
                  </button>
                )}
              </div>
            </Campo>
          )}

          {/* FUNIL (só com 2+ funis nomeados) e ETAPA — VÁRIOS em cada um,
              somando com OU, como as conexões (pedido do operador, 29/09).
              Ver `casaComAEtapa`: a etapa refina só o funil DELA, e marcar
              etapa nunca carimba o funil. O resumo do Funil lista os nomes
              (são poucos e curtos); o da Etapa mostra a primeira e "+N". */}
          {etapasConfiaveis && doisNiveis && (
            <Campo rotulo={t("labelPipeline")}>
              <Marcaveis
                resumo={
                  [
                    ...(semNegocio ? [t("stageNone")] : []),
                    ...funisMarcados.map(
                      (id) => funis.get(id) ?? t("labelPipeline"),
                    ),
                  ].join(", ") || t("pipelineAll")
                }
                ativo={semNegocio || funisMarcados.length > 0}
                grupos={[
                  {
                    chave: "__funis__",
                    itens: [
                      {
                        chave: SEM_ETAPA,
                        texto: t("stageNone"),
                        marcado: semNegocio,
                        aoAlternar: () => alternarEtapa(SEM_ETAPA),
                      },
                      ...funisDoSeletor.map((f) => ({
                        chave: f.id,
                        texto: f.nome,
                        marcado: funisMarcados.includes(f.id),
                        aoAlternar: () => alternarFunil(f.id),
                      })),
                    ],
                  },
                ]}
              />
            </Campo>
          )}
          {etapasConfiaveis &&
            gruposDeEtapas.some((g) => g.etapas.length > 0) && (
              <Campo rotulo={t("labelStage")}>
                <Marcaveis
                  resumo={
                    etapasDoResumo.length === 0
                      ? t("stageAll")
                      : rotuloDaEtapa(etapasDoResumo[0])
                  }
                  extra={
                    etapasDoResumo.length > 1
                      ? `+${etapasDoResumo.length - 1}`
                      : undefined
                  }
                  ativo={etapasDoResumo.length > 0}
                  grupos={gruposDeEtapas.map((g) => ({
                    chave: g.funil?.id ?? "__etapas__",
                    // Com dois níveis, o nome do funil em cima das etapas
                    // dele: dois funis costumam repetir "Lead" e "Qualificado".
                    titulo: g.funil?.nome,
                    itens: [
                      // Com um funil só, "Sem negócio" mora aqui, como sempre
                      // morou; com dois níveis, ele está no campo Funil.
                      ...(g.funil === null
                        ? [
                            {
                              chave: SEM_ETAPA,
                              texto: t("stageNone"),
                              marcado: semNegocio,
                              aoAlternar: () => alternarEtapa(SEM_ETAPA),
                            },
                          ]
                        : []),
                      ...g.etapas.map((e) => ({
                        chave: e.id,
                        texto: doisNiveis ? e.name : nomeDaEtapa(e, funis),
                        marcado: filtros.etapaIds.includes(e.id),
                        aoAlternar: () => alternarEtapa(e.id),
                      })),
                    ],
                  }))}
                />
              </Campo>
            )}

          {/* INADIMPLENTES (Asaas, Fase 1b): um interruptor no painel, e não
              um 5º chip na barra — medido em 03/09, a barra já ocupa ~290 dos
              296px úteis do `lg`, e um chip a mais a estouraria. Fixo, não
              atrás de "Mais filtros": é a pergunta de quem cobra. Só aparece
              com o Asaas conectado (ou já ligado por uma visão salva). */}
          {(asaasNeutralizado === null || asaasNeutralizado === "sincronizando" || filtros.inadimplentes) && (
            <div>
              <button
                type="button"
                onClick={() => mexer({ inadimplentes: !filtros.inadimplentes })}
                aria-pressed={filtros.inadimplentes}
                className={cn(
                  "inline-flex h-8 w-full items-center gap-2 rounded-md border px-2 text-xs transition-colors",
                  filtros.inadimplentes
                    ? "border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <CircleDollarSign className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{t("filterDelinquent")}</span>
              </button>
              {/* Espelho parado com o recorte VALENDO: é o mesmo dado do
                  ícone da linha, mas a tela não pode deixar parecer que é de
                  agora. Some quando há um motivo de neutralização — a dica
                  de baixo já explica, e as duas juntas se contradiriam. */}
              {asaasDadosDe && asaasNeutralizado === null && (
                <p className="mt-1 px-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                  {t("delinquentStale", { quando: quandoFoi(asaasDadosDe) })}
                </p>
              )}
              {/* Ligado e sem efeito: a tela diz por quê. Só com o interruptor
                  LIGADO — "filtro sem efeito" embaixo de um interruptor que
                  ninguém ligou é ruído. */}
              {filtros.inadimplentes && asaasNeutralizado !== null && (
                <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">
                  {asaasNeutralizado === "desconectado"
                    ? t("delinquentDisconnected")
                    : asaasNeutralizado === "sem_resposta"
                      ? t("delinquentChecking")
                      : t("delinquentPending")}
                </p>
              )}
            </div>
          )}

          {/* MAIS FILTROS: tipo, responsável e empresa — os menos usados no
              dia a dia. Abrem sozinhos quando um deles está recortando,
              senão o operador não veria de onde vem o recorte. */}
          {(temGrupos || responsaveis.length > 0 || empresas.length > 0) && (
            <button
              type="button"
              onClick={() => setMaisFiltros((v) => !v)}
              aria-expanded={maisAbertos}
              className="flex items-center gap-1 px-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown
                className={cn("h-3 w-3 transition-transform", maisAbertos && "rotate-180")}
              />
              {maisAbertos ? t("fewerFilters") : t("moreFilters")}
            </button>
          )}

          {maisAbertos && temGrupos && (
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

          {maisAbertos && (
            <Campo rotulo={t("labelAssignee")}>
              <Escolha
                rotulo={
                  filtros.responsavelId === null
                    ? t("assigneeAll")
                    : filtros.responsavelId === SEM_RESPONSAVEL
                      ? t("assigneeNone")
                      : // ⚠️ `||`, não `??`: `profiles.full_name` é NOT NULL
                        // mas SEM default — pode ser string vazia.
                        (responsavelAtual?.full_name ||
                        responsavelAtual?.email ||
                        t("assigneeUnnamed"))
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
                    chave: SEM_RESPONSAVEL,
                    texto: t("assigneeNone"),
                    escolhido: filtros.responsavelId === SEM_RESPONSAVEL,
                    aoEscolher: () => mexer({ responsavelId: SEM_RESPONSAVEL }),
                  },
                  ...responsaveis.map((p) => ({
                    chave: p.user_id,
                    texto: p.full_name || p.email || t("assigneeUnnamed"),
                    escolhido: filtros.responsavelId === p.user_id,
                    aoEscolher: () => mexer({ responsavelId: p.user_id }),
                  })),
                ]}
              />
            </Campo>
          )}

          {maisAbertos && empresas.length > 0 && (
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

          {/* Rodapé: o contador (só quando algo recorta — ele existe para
              explicar um resultado curto) e o "Limpar", que limpa também a
              BUSCA (um "limpar" que deixa a busca de pé não limpou) e mantém
              a ABA (ver `contarFiltrosAtivos`). */}
          <div className="flex items-center justify-between gap-2 px-0.5 pt-0.5 text-[11px] text-muted-foreground">
            <span>
              {(ativos > 0 || exibindo !== total) &&
                t("resultCount", { count: exibindo, total })}
            </span>
            {(ativos > 0 || busca.trim().length > 0) && (
              <button
                type="button"
                onClick={() => {
                  onChange({ ...FILTROS_VAZIOS, status: filtros.status });
                  onLimparBusca();
                }}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
                {t("clearAll")}
              </button>
            )}
          </div>
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

interface Marcavel {
  chave: string;
  texto: string;
  marcado: boolean;
  aoAlternar: () => void;
}

/**
 * Um seletor de VÁRIOS valores — caixas de marcação, no formato do campo de
 * conexões (funil e etapa, 29/09). O grupo com `titulo` ganha o nome em cima
 * (as etapas, agrupadas pelo funil). O `extra` ("+2") fica FORA do corte do
 * texto: com o nome longo, as reticências engoliriam justo o número que diz
 * que há mais marcado.
 */
function Marcaveis({
  resumo,
  extra,
  ativo,
  grupos,
}: {
  resumo: string;
  extra?: string;
  ativo: boolean;
  grupos: { chave: string; titulo?: string; itens: Marcavel[] }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-8 w-full min-w-0 items-center justify-between gap-1 rounded-md border border-border px-2 text-xs transition-colors hover:bg-muted",
          ativo ? "text-primary" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {/* `min-w-0`: item de flex nasce com `min-width: auto`, e sem ele o
            texto empurraria o chevron para fora do gatilho. */}
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate">{resumo}</span>
          {extra && <span className="shrink-0">{extra}</span>}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-64 w-60 overflow-y-auto border-border bg-popover"
      >
        {grupos.map((g) => (
          // ⚠️ `DropdownMenuLabel` é o `Menu.GroupLabel` do base-ui: fora de
          // um `DropdownMenuGroup` ele LANÇA, e derrubaria o painel inteiro.
          <DropdownMenuGroup key={g.chave}>
            {g.titulo && <DropdownMenuLabel>{g.titulo}</DropdownMenuLabel>}
            {g.itens.map((o) => (
              <DropdownMenuCheckboxItem
                key={o.chave}
                checked={o.marcado}
                onCheckedChange={o.aoAlternar}
                className="text-sm text-popover-foreground"
              >
                <span className="truncate">{o.texto}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
