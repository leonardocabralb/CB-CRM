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
import { ChevronDown, MailOpen, SlidersHorizontal, Star, X } from "lucide-react";
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
  funisDoRecorte,
  recorteTemDoisNiveis,
  SEM_ETAPA,
  SEM_RESPONSAVEL,
  type FiltrosDoInbox,
  type SituacaoDaCaixa,
} from "@/lib/inbox/filtros";
import { descreverFiltro, nomeDaEtapa } from "@/lib/inbox/filtros-salvos";
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
   * O menu de filtros salvos (Fase A2), montado pela LISTA e entregue pronto.
   *
   * Slot em vez de props de dados porque este arquivo já é grande e acabou de
   * ser reescrito pelo #73: passar `salvos`, `criar`, `renomear`, `apagar` e os
   * catálogos por aqui só para repassá-los adiante engrossaria o conflito do
   * próximo merge sem ninguém ganhar nada. Opcional para a tela continuar
   * montável sem ele (é o que os testes fazem).
   */
  menuSalvos?: React.ReactNode;
  /** A caixa de busca, que vive fora daqui — o "Limpar tudo" precisa dela. */
  busca: string;
  onLimparBusca: () => void;
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
  etapasConfiaveis,
  funis,
  temGrupos,
  menuSalvos,
  busca,
  onLimparBusca,
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

  // ⚠️ As duas saem do módulo puro, e não de uma cópia local: a LISTA também
  // decide, lá em `conversation-list`, se o deep link `?etapa=` pode carimbar
  // `funilId`. Divergindo, o carimbo acontece numa conta onde este seletor
  // não existe — e some com quem não tem negócio (ver `funisDoRecorte`).
  const funisDoSeletor = useMemo(
    () => funisDoRecorte(etapas, funis),
    [etapas, funis],
  );
  const doisNiveis = useMemo(
    () => recorteTemDoisNiveis(etapas, funis),
    [etapas, funis],
  );

  // ⚠️ O funil que o PAINEL mostra é derivado, nunca só o carimbado (#26 do
  // plano 31/08): `funilId` é escrito SÓ pelo seletor de funil, mas um filtro
  // salvo pode gravar `etapaId` sem funil (salvo numa conta de um funil, onde
  // o seed não carimba de propósito). Com dois níveis e `funilId` nulo, o
  // campo Etapa não renderizava e o de Funil dizia "Qualquer funil" — a lista
  // recortada por uma etapa que o painel não mostrava e não deixava trocar.
  // Derivar do `etapaAtual` dá ao painel UMA fonte de verdade sem carimbar
  // nada (carimbar é a armadilha que o CLAUDE.md proíbe).
  const funilVisivel = filtros.funilId ?? etapaAtual?.pipeline_id ?? null;

  // Já vêm ordenadas por `position` da consulta — a ordem das colunas do
  // quadro, que é como o operador pensa o funil.
  //
  // ⚠️ O funil é re-derivado AQUI DENTRO, com deps primitivas, em vez de
  // depender do `funilVisivel` acima: como `etapaAtual` sai de um `.find`
  // não memoizado, o React Compiler recusa a memoização
  // ("Existing memoization could not be preserved") e o lint vira ERRO.
  const etapasDoFunil = useMemo(() => {
    if (!doisNiveis) return etapas;
    const funil =
      filtros.funilId ??
      etapas.find((e) => e.id === filtros.etapaId)?.pipeline_id ??
      null;
    return etapas.filter((e) => e.pipeline_id === funil);
  }, [doisNiveis, etapas, filtros.funilId, filtros.etapaId]);

  const nomeDoFunil = (id: string) => funis.get(id) ?? t("labelPipeline");

  /**
   * Escolher uma etapa NUNCA escreve `funilId` — quem escreve é só o seletor
   * de funil. Ver o comentário do campo em `filtros.ts`: com um funil só,
   * carimbá-lo por tabela transformaria "Qualquer etapa" (hoje: não filtro
   * por etapa) em "quem tem negócio neste funil", sumindo em silêncio com
   * quem ainda não virou negócio.
   */
  const escolherFunil = (funilId: string | null) =>
    mexer({ funilId, etapaId: null });

  /**
   * Uma pastilha por recorte ativo, cada uma removível sozinha.
   *
   * ⚠️ SAI DO MÓDULO, e antes eram DUAS descrições do mesmo recorte: o
   * cabeçalho de `filtros-salvos.ts` declarava "UMA descrição, DUAS
   * superfícies", mas o painel montava a lista à mão — `aoRemover: () =>
   * mexer({ tipo: "todas" })` aqui, `limpar: { tipo: "todas" }` lá, o mesmo
   * conhecimento escrito duas vezes. O menu de filtros salvos já consumia o
   * módulo; só esta metade faltava.
   *
   * O elo que impedia as duas de divergirem era um TESTE (as `AMOSTRAS`, um
   * `Record<keyof FiltrosDoInbox, …>` que o compilador cobra) — ou seja, a
   * garantia existia e a duplicata também. Agora o campo novo entra num
   * lugar só.
   *
   * ⚠️ `orfao` NÃO vira "(apagado)" aqui, ao contrário do menu: a pastilha
   * mantém o rótulo genérico do campo, que é o comportamento que já existia
   * e o que o próprio `PedacoDoFiltro` documenta. Um id que não resolve pode
   * ser catálogo ainda carregando.
   *
   * Sem `useMemo` de propósito: a versão antiga também remontava a cada
   * render, e `mexer` não é memoizado — envolver isto num memo é o caso que
   * o React Compiler recusa ("existing memoization could not be preserved").
   */
  const pastilhas = descreverFiltro(filtros, {
    canais,
    responsaveis,
    etapas,
    funis,
    etiquetas,
  }).map((p) => ({
    chave: p.chave,
    texto: p.rotulo.fonte === "i18n" ? t(p.rotulo.chave) : p.rotulo.texto,
    cor: p.cor,
    aoRemover: () => mexer(p.limpar),
  }));

  return (
    <div className="space-y-2">
      {/* ⚠️ UMA LINHA SÓ, e todos os controles com a MESMA cara (pedido do
          operador, 2026-09-03 — "tá feia e aglomerada, os itens estão
          diferentes"). Antes eram duas linhas: um bloco cinza com as abas,
          dois botões de texto ao lado, e "Filtros"/"Salvos" embaixo, cada um
          com padding e forma próprios porque era o jeito de caber em 296px.
          Agora: as duas ABAS (Abertas = a caixa; Encerradas = o acervo) como
          abas de verdade, sublinhadas, e à direita quatro chips quadrados só
          com ícone — os dois interruptores que SOMAM (favoritas, não lidas),
          o menu de filtros salvos e o botão do painel. O nome vive no
          `title`/`aria-label`.
          MEDIDO em 03/09: abas ~130px + chips ~148px = ~290px nos 336px úteis
          da coluna (que passou de 320 para 360px no mesmo pedido). Sem
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

          {/* Colado no botão "Filtros" porque é o mesmo assunto — mas com
              gatilho próprio: aquele botão já abre e fecha o painel, e um
              segundo comportamento no mesmo clique não existe. */}
          {menuSalvos}

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
      {(ativos > 0 || busca.trim().length > 0 || exibindo !== total) && (
        <div className="flex flex-wrap items-center gap-1">
          {pastilhas.map((p) => (
            <button
              key={p.chave}
              type="button"
              onClick={p.aoRemover}
              title={t("removeFilter", { filtro: p.texto })}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-muted/70"
            >
              {p.cor && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: p.cor }}
                />
              )}
              <span className="max-w-32 truncate">{p.texto}</span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          ))}

          {/* Limpa também a BUSCA: ela recorta a lista igual aos filtros, e um
              "limpar tudo" que deixa a busca de pé não limpou tudo. Por isso
              aparece com busca preenchida mesmo sem nenhum filtro. */}
          {(ativos > 0 || busca.trim().length > 0) && (
            <button
              type="button"
              onClick={() => {
                onChange(FILTROS_VAZIOS);
                onLimparBusca();
              }}
              className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
              {t("clearAll")}
            </button>
          )}

          {/* O contador só aparece quando algo recorta. Ele existe para
              explicar um resultado vazio ou curto — mostrá-lo com a lista
              inteira seria ruído. */}
          {(ativos > 0 || exibindo !== total) && (
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {t("showingCount", { count: exibindo, total })}
            </span>
          )}
        </div>
      )}

      {aberto && (
        // ⚠️ UMA coluna, e `sm:grid-cols-2` seria errado aqui: `sm:` olha a
        // LARGURA DA JANELA, mas esta barra tem largura FIXA de 360px no
        // desktop (`lg:w-[22.5rem]`). Duas colunas dariam ~150px cada, e "Recebeu
        // link de agendamento" ou "Leonardo Cabral Baptista" truncariam no
        // próprio gatilho — o operador não conseguiria ler o filtro que
        // escolheu. E o efeito era invertido: no celular, onde a lista ocupa
        // a tela toda, ele caía para uma coluna larga.
        <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3">
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

          {canais.length >= 2 && (
            <Campo rotulo={t("channelFilter")}>
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
                    : // ⚠️ `||`, não `??`: `profiles.full_name` é NOT NULL
                      // mas SEM default — pode ser string vazia, e com `??` o
                      // gatilho ficaria em branco enquanto o filtro está
                      // pegando.
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
                  // A pergunta da manhã: "o que ninguém pegou ainda?".
                  chave: SEM_RESPONSAVEL,
                  texto: t("assigneeNone"),
                  escolhido: filtros.responsavelId === SEM_RESPONSAVEL,
                  aoEscolher: () => mexer({ responsavelId: SEM_RESPONSAVEL }),
                },
                ...responsaveis.map((p) => ({
                  chave: p.user_id,
                  // Nunca o `user_id`: um UUID cru na frente do operador não
                  // identifica ninguém.
                  texto: p.full_name || p.email || t("assigneeUnnamed"),
                  escolhido: filtros.responsavelId === p.user_id,
                  aoEscolher: () => mexer({ responsavelId: p.user_id }),
                })),
              ]}
            />
          </Campo>

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

          {/* ⚠️ FUNIL E ETAPA FICAM POR ÚLTIMO, a pedido do operador: são o
              recorte menos usado no dia a dia e o único que ocupa duas
              linhas. A ordem das pastilhas lá em cima acompanha esta — elas
              existem para o olho não ter de procurar. */}
          {etapasConfiaveis && doisNiveis && (
            <Campo rotulo={t("labelPipeline")}>
              <Escolha
                rotulo={
                  filtros.etapaId === SEM_ETAPA
                    ? t("stageNone")
                    : funilVisivel
                      ? nomeDoFunil(funilVisivel)
                      : t("pipelineAll")
                }
                ativo={filtros.funilId !== null || filtros.etapaId !== null}
                opcoes={[
                  {
                    chave: "__todos__",
                    texto: t("pipelineAll"),
                    escolhido:
                      filtros.funilId === null && filtros.etapaId === null,
                    aoEscolher: () => escolherFunil(null),
                  },
                  {
                    // "Sem negócio" mora no PRIMEIRO nível porque é a resposta
                    // a "qual funil?" — nenhum. No segundo, ele seria uma
                    // etapa que não existe dentro do funil escolhido.
                    chave: SEM_ETAPA,
                    texto: t("stageNone"),
                    escolhido: filtros.etapaId === SEM_ETAPA,
                    aoEscolher: () =>
                      mexer({ funilId: null, etapaId: SEM_ETAPA }),
                  },
                  ...funisDoSeletor.map((f) => ({
                    chave: f.id,
                    texto: f.nome,
                    escolhido: funilVisivel === f.id,
                    aoEscolher: () => escolherFunil(f.id),
                  })),
                ]}
              />
            </Campo>
          )}

          {/* Com dois níveis o seletor de etapa só aparece depois do funil:
              antes disso ele não teria o que oferecer. Com um funil só ele é
              o campo inteiro, como sempre foi. */}
          {etapasConfiaveis &&
            etapasDoFunil.length > 0 &&
            (!doisNiveis || funilVisivel !== null) && (
              <Campo rotulo={t("labelStage")}>
                <Escolha
                  rotulo={
                    filtros.etapaId === null
                      ? t("stageAll")
                      : filtros.etapaId === SEM_ETAPA
                        ? t("stageNone")
                        : etapaAtual
                          ? doisNiveis
                            ? etapaAtual.name
                            : nomeDaEtapa(etapaAtual, funis)
                          : // Etapa escolhida que sumiu da lista (apagada):
                            // "Qualquer etapa" mentiria sobre um filtro ativo.
                            t("labelStage")
                  }
                  ativo={filtros.etapaId !== null}
                  opcoes={[
                    {
                      chave: "__todas__",
                      texto: t("stageAll"),
                      escolhido: filtros.etapaId === null,
                      aoEscolher: () => mexer({ etapaId: null }),
                    },
                    // Sem esta opção, quem ainda não virou negócio some de
                    // qualquer recorte por etapa — e é justamente quem
                    // precisa de atenção. Com dois níveis ela subiu para o
                    // seletor de funil.
                    ...(doisNiveis
                      ? []
                      : [
                          {
                            chave: SEM_ETAPA,
                            texto: t("stageNone"),
                            escolhido: filtros.etapaId === SEM_ETAPA,
                            aoEscolher: () => mexer({ etapaId: SEM_ETAPA }),
                          },
                        ]),
                    ...etapasDoFunil.map((e) => ({
                      chave: e.id,
                      // Sem o prefixo do funil quando ele já foi escolhido no
                      // campo de cima: repetir "Bancário - Comercial ·" em
                      // cada uma das 10 etapas empurra o nome delas para fora
                      // da caixa.
                      texto: doisNiveis ? e.name : nomeDaEtapa(e, funis),
                      escolhido: filtros.etapaId === e.id,
                      aoEscolher: () => mexer({ etapaId: e.id }),
                    })),
                  ]}
                />
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
