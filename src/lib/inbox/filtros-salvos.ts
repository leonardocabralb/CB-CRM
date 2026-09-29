// ============================================================
// Filtros salvos da caixa de entrada (migration 967, Fase A1).
//
// Funções PURAS. Um filtro salvo é só um NOME + um `FiltrosDoInbox`; aplicar é
// `setFiltros(...)` e nada muda em `aplicarFiltros`. O que mora aqui é o que a
// travessia pelo banco exige: ler de volta com segurança, comparar, descrever e
// limpar referência morta.
//
// ⚠️ POR QUE O PARSE É DEFENSIVO (e não um `as FiltrosDoInbox`)
// A linha do banco é JSONB e pode ter sido gravada por uma versão do app que
// não conhecia um campo que hoje existe — ou, no outro sentido, conhecer um que
// já morreu. Um cast diria ao compilador que está tudo certo e entregaria
// `undefined` para `aplicarFiltros`, que então recortaria de um jeito que
// ninguém escolheu, sem erro em lugar nenhum. `lerFiltroSalvo` parte de
// `FILTROS_VAZIOS` e só aceita chave conhecida com o tipo certo: campo ausente
// vira o padrão, campo com lixo vira o padrão, chave desconhecida é ignorada.
// ============================================================

import {
  FILTROS_VAZIOS,
  funisDoFiltro,
  recorteTemDoisNiveis,
  SEM_ETAPA,
  SEM_RESPONSAVEL,
  type FiltrosDoInbox,
} from "@/lib/inbox/filtros";
import type { ModoDeEtiqueta, TipoDeConversa } from "@/lib/inbox/conversations";
import type {
  PipelineStage,
  Profile,
  Tag,
} from "@/types";

/** Uma linha de `cb_inbox_saved_filters`, já lida. */
export interface FiltroSalvo {
  id: string;
  nome: string;
  filtros: FiltrosDoInbox;
}

const TIPOS: readonly TipoDeConversa[] = ["todas", "diretas", "grupos"];
const MODOS: readonly ModoDeEtiqueta[] = ["qualquer", "todas"];

function umDe<T extends string>(
  valor: unknown,
  aceitos: readonly T[],
  padrao: T,
): T {
  return typeof valor === "string" && (aceitos as readonly string[]).includes(valor)
    ? (valor as T)
    : padrao;
}

/** Lista de ids: só strings não vazias, sem repetição; outra forma vira []. */
function listaDeIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const saida: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.trim() !== "" && !saida.includes(x.trim())) saida.push(x.trim());
  }
  return saida;
}

/**
 * String não vazia, ou `null`.
 *
 * ⚠️ `""` vira `null` de propósito: um id vazio não casa com nada e faria o
 * recorte devolver zero conversas com cara de filtro configurado.
 */
function textoOuNulo(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.trim();
  return t === "" ? null : t;
}

/**
 * A lista do formato NOVO ou, sem ela, o valor único do formato ANTIGO.
 *
 * ⚠️ Os três campos que viraram lista — conexões (`canalId`, até 03/09),
 * funil e etapa (`funilId`/`etapaId`, até 29/09) — foram gravados como UM
 * valor, e as visões salvas antigas continuam no banco de cada membro (as
 * "Bancário"/"Trabalhista" foram copiadas aos 12). Traduzir AQUI, na leitura,
 * é o que as mantém de pé sem migration de dados; tirar a leitura do antigo
 * faria essas visões virarem "sem recorte" em silêncio. A lista nova vence
 * quando as duas vêm; lixo nas duas vira [] (sem recorte).
 */
function listaOuValorAntigo(nova: unknown, antigo: unknown): string[] {
  const lista = listaDeIds(nova);
  if (lista.length > 0) return lista;
  const valor = textoOuNulo(antigo);
  return valor ? [valor] : [];
}

/** JSONB → `FiltrosDoInbox`. Nunca lança; o pior caso é `FILTROS_VAZIOS`. */
export function lerFiltroSalvo(bruto: unknown): FiltrosDoInbox {
  if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto)) {
    return FILTROS_VAZIOS;
  }
  const o = bruto as Record<string, unknown>;

  // ⚠️ Duplicatas removidas e ordem preservada: `etiquetaIds` entra em
  // `mesmoFiltro` (que compara conjunto ordenado) e em `matchesContactFilters`
  // com modo "todas", onde um id repetido não muda o resultado mas faz a
  // contagem de pastilhas mentir.
  const etiquetaIds = Array.isArray(o.etiquetaIds)
    ? Array.from(
        new Set(
          o.etiquetaIds
            .map((x) => textoOuNulo(x))
            .filter((x): x is string => x !== null),
        ),
      )
    : FILTROS_VAZIOS.etiquetaIds;

  return {
    tipo: umDe(o.tipo, TIPOS, FILTROS_VAZIOS.tipo),
    // ⚠️ A ABA não faz parte da visão salva — é onde o operador ESTÁ, não o
    // que ele recorta. O JSON antigo pode trazer `status` ("todos"/"open"/
    // "pending" de antes das duas abas, ou o "closed" gravado até 03/09): é
    // ignorado. Aplicar o chip mantém a aba (ver `aplicarVisao` na lista);
    // ler "closed" daqui jogava quem estava em Encerradas de volta para
    // Abertas — a queixa do operador.
    status: FILTROS_VAZIOS.status,
    // ⚠️ Aceita o formato ANTIGO (`canalId: "x"`, uma conexão só, até 03/09)
    // além do novo (`canalIds: [...]`) — ver `listaOuValorAntigo`.
    canalIds: listaOuValorAntigo(o.canalIds, o.canalId),
    responsavelId: textoOuNulo(o.responsavelId),
    etiquetaIds,
    modoDeEtiqueta: umDe(o.modoDeEtiqueta, MODOS, FILTROS_VAZIOS.modoDeEtiqueta),
    empresa: textoOuNulo(o.empresa),
    // ⚠️ Idem para funil e etapa (um só de cada até 29/09): `funilId: "p"`
    // vira `["p"]`, e `etapaId` — inclusive o sentinela "sem negócio" — vira
    // lista de um. As duas formas recortam igual (`casaComAEtapa`).
    funilIds: listaOuValorAntigo(o.funilIds, o.funilId),
    etapaIds: listaOuValorAntigo(o.etapaIds, o.etapaId),
    favoritas: o.favoritas === true,
    naoLidas: o.naoLidas === true,
    emAtraso: o.emAtraso === true,
    inadimplentes: o.inadimplentes === true,
  };
}

/**
 * `FiltrosDoInbox` → o objeto que vai para a coluna JSONB.
 *
 * Explícito, e não um spread do estado: o estado da tela pode ganhar um campo
 * de UI (aberto/fechado, rascunho) e um spread o gravaria no banco em silêncio,
 * onde ele viveria para sempre sem ninguém saber de onde veio.
 *
 * `status` (a aba) fica de fora de propósito — ver `lerFiltroSalvo`. E só o
 * formato NOVO é gravado (as listas): o antigo é só LIDO, e "Salvar
 * alterações" numa visão antiga a regrava inteira no novo.
 */
export function escreverFiltroSalvo(f: FiltrosDoInbox): Record<string, unknown> {
  return {
    tipo: f.tipo,
    canalIds: f.canalIds,
    responsavelId: f.responsavelId,
    etiquetaIds: f.etiquetaIds,
    modoDeEtiqueta: f.modoDeEtiqueta,
    empresa: f.empresa,
    funilIds: f.funilIds,
    etapaIds: f.etapaIds,
    favoritas: f.favoritas,
    naoLidas: f.naoLidas,
    emAtraso: f.emAtraso,
    inadimplentes: f.inadimplentes,
  };
}

/** Igualdade de conjunto (ordem não importa) — para as listas de ids. */
function mesmoConjunto(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

/**
 * Dois recortes são o MESMO recorte?
 *
 * Usado para marcar no menu qual filtro salvo está aplicado agora. Compara
 * conteúdo, nunca identidade — o objeto do estado é recriado a cada `mexer()`.
 *
 * ⚠️ `etiquetaIds` é comparado como CONJUNTO (ordenado antes): escolher
 * "Bancário" e depois "Urgente" produz o mesmo recorte que a ordem inversa, e
 * sem ordenar o menu deixaria de marcar o filtro que o operador acabou de
 * aplicar. `modoDeEtiqueta` só conta quando há 2+ etiquetas — com uma só,
 * "qualquer" e "todas" recortam igual, e diferenciar ali faria o mesmo recorte
 * parecer dois. Conexões, funis e etapas também comparam como conjunto, pelo
 * mesmo motivo.
 *
 * ⚠️ `status` (a aba) NÃO entra: trocar de aba com um chip aceso não pode
 * apagá-lo nem oferecer "salvar alterações" — a aba não faz parte da visão
 * (ver `lerFiltroSalvo`).
 */
export function mesmoFiltro(a: FiltrosDoInbox, b: FiltrosDoInbox): boolean {
  const etiquetasIguais = (() => {
    if (a.etiquetaIds.length !== b.etiquetaIds.length) return false;
    // Ordenadas UMA vez cada. Reordenar `b` dentro do laço custa n·log n por
    // elemento e não muda o resultado.
    const ea = [...a.etiquetaIds].sort();
    const eb = [...b.etiquetaIds].sort();
    return ea.every((id, i) => id === eb[i]);
  })();

  const modoImporta = a.etiquetaIds.length >= 2 || b.etiquetaIds.length >= 2;

  return (
    a.tipo === b.tipo &&
    mesmoConjunto(a.canalIds, b.canalIds) &&
    a.responsavelId === b.responsavelId &&
    a.empresa === b.empresa &&
    mesmoConjunto(a.funilIds, b.funilIds) &&
    mesmoConjunto(a.etapaIds, b.etapaIds) &&
    a.favoritas === b.favoritas &&
    a.naoLidas === b.naoLidas &&
    a.emAtraso === b.emAtraso &&
    a.inadimplentes === b.inadimplentes &&
    etiquetasIguais &&
    (!modoImporta || a.modoDeEtiqueta === b.modoDeEtiqueta)
  );
}

// ------------------------------------------------------------
// Descrever um recorte
//
// ⚠️ UMA descrição, DUAS superfícies. As pastilhas do painel e a linha de
// resumo do menu de filtros salvos ficam na MESMA tela: duas listas montadas em
// lugares diferentes divergiriam no primeiro filtro novo, e o operador veria o
// mesmo recorte descrito de dois jeitos lado a lado.
//
// ⚠️ Devolve CHAVE + valores, nunca texto pronto — a regra de
// `descrever-passo.ts`. Texto pronto aqui obrigaria este módulo a importar
// `next-intl`, e ele deixaria de ser puro (e testável sem React).
// ------------------------------------------------------------

/**
 * As chaves de `Inbox.conversationList` que a descrição pode usar. Fechada de
 * propósito: há teste lendo `messages/*.json` que cobra cada uma, então
 * inventar um rótulo novo sem tocar nos dois dicionários quebra o teste em vez
 * de imprimir a chave crua na tela do operador.
 */
export type ChaveDeRotulo =
  | "typeDirect"
  | "typeGroups"
  | "filterUnread"
  | "filterAwaiting"
  | "filterDelinquent"
  | "favorites"
  | "channelFilter"
  | "assigneeNone"
  | "assigneeUnnamed"
  | "stageNone"
  | "labelStage"
  | "labelPipeline"
  | "tags"
  | "deletedRef";

export type RotuloDoPedaco =
  | { fonte: "i18n"; chave: ChaveDeRotulo }
  | { fonte: "dado"; texto: string };

export interface PedacoDoFiltro {
  /** Identidade estável, para `key` de lista e para o botão de remover. */
  chave: string;
  rotulo: RotuloDoPedaco;
  /** Cor da etiqueta, quando o pedaço é uma etiqueta resolvida. */
  cor?: string;
  /**
   * O id referenciado não está no catálogo. Pode ser "apagado" ou "ainda não
   * carregado" — quem exibe decide o que dizer. A pastilha mantém o rótulo
   * genérico do campo (comportamento que já existia); o menu de filtros
   * salvos troca por `deletedRef`.
   */
  orfao?: boolean;
  /** O patch que REMOVE este pedaço do recorte. */
  limpar: Partial<FiltrosDoInbox>;
}

export interface CatalogosDoFiltro {
  canais: { id: string; label: string }[];
  responsaveis: Profile[];
  etapas: PipelineStage[];
  /** `pipeline_id` → nome do funil. Só prefixa quando há mais de um. */
  funis: Map<string, string>;
  etiquetas: Tag[];
}

/**
 * O nome da etapa, com o funil na frente quando há mais de um.
 *
 * Com dois funis os nomes se repetem — "Lead", "Qualificado" — e a lista
 * mostraria itens idênticos ordenados por posição, sem o operador poder
 * distingui-los.
 */
export function nomeDaEtapa(
  etapa: PipelineStage,
  funis: Map<string, string>,
): string {
  if (funis.size < 2) return etapa.name;
  const funil = funis.get(etapa.pipeline_id);
  return funil ? `${funil} · ${etapa.name}` : etapa.name;
}

/**
 * Um pedaço por recorte ativo, NA MESMA ORDEM das pastilhas do painel.
 *
 * ⚠️ A ordem não é enfeite: as pastilhas e a linha de resumo do menu ficam na
 * mesma tela, e listar os mesmos recortes em ordens diferentes faz o operador
 * achar que são coisas diferentes.
 */
export function descreverFiltro(
  f: FiltrosDoInbox,
  cat: CatalogosDoFiltro,
): PedacoDoFiltro[] {
  const pedacos: PedacoDoFiltro[] = [];
  // Com 2+ funis o painel tem os dois campos, e a etapa é descrita DENTRO do
  // pedaço do funil dela — ver o bloco de funil/etapa abaixo.
  const doisNiveis = recorteTemDoisNiveis(cat.etapas, cat.funis);

  if (f.tipo !== "todas") {
    pedacos.push({
      chave: "tipo",
      rotulo: {
        fonte: "i18n",
        chave: f.tipo === "grupos" ? "typeGroups" : "typeDirect",
      },
      limpar: { tipo: "todas" },
    });
  }

  // A situação (aba) não é descrita: não faz parte da visão salva, e o resumo
  // do diálogo de salvar não pode prometer uma aba que não vai ser gravada.

  if (f.canalIds.length > 0) {
    const nomes = f.canalIds.map((id) => cat.canais.find((c) => c.id === id)?.label ?? null);
    const todosResolvidos = nomes.every((n) => n !== null);
    pedacos.push({
      chave: "canal",
      // Uma conexão: o nome dela. Várias: os nomes separados por " ou ".
      rotulo: todosResolvidos
        ? { fonte: "dado", texto: nomes.join(" ou ") }
        : { fonte: "i18n", chave: "channelFilter" },
      // ⚠️ Catálogo VAZIO não prova nada (M4 do plano 31/08) — a MESMA
      // guarda do `limparOrfaos` lá embaixo: lista vazia pode ser "ainda não
      // carregou" ou "a busca falhou", e marcar "(apagado)" sobre canal VIVO
      // enquanto os catálogos chegam é o menu afirmando referência morta
      // sobre um blip de rede. Vale para os cinco campos com `orfao`.
      orfao: cat.canais.length > 0 && !todosResolvidos,
      limpar: { canalIds: [] },
    });
  }

  if (f.responsavelId) {
    if (f.responsavelId === SEM_RESPONSAVEL) {
      pedacos.push({
        chave: "responsavel",
        rotulo: { fonte: "i18n", chave: "assigneeNone" },
        limpar: { responsavelId: null },
      });
    } else {
      const p = cat.responsaveis.find((x) => x.user_id === f.responsavelId);
      // ⚠️ `||`, não `??`: `profiles.full_name` é NOT NULL mas SEM default —
      // pode ser string vazia, e com `??` a pastilha ficaria em branco
      // enquanto o filtro está pegando.
      const nome = p ? p.full_name || p.email : "";
      pedacos.push({
        chave: "responsavel",
        rotulo: nome
          ? { fonte: "dado", texto: nome }
          : { fonte: "i18n", chave: "assigneeUnnamed" },
        orfao: cat.responsaveis.length > 0 && !p,
        limpar: { responsavelId: null },
      });
    }
  }

  if (f.empresa !== null) {
    // Sem `orfao`: empresa é texto casado contra `contact.company`, não
    // referência a uma linha. "Nenhuma conversa desta empresa agora" é uma
    // resposta VERDADEIRA, não uma referência morta — ver `limparOrfaos`.
    pedacos.push({
      chave: "empresa",
      rotulo: { fonte: "dado", texto: f.empresa },
      limpar: { empresa: null },
    });
  }

  // Uma pastilha POR ETIQUETA, e não uma dizendo "3 etiquetas": tirar uma
  // etiqueta do recorte é um clique, e agrupá-las viraria três.
  for (const id of f.etiquetaIds) {
    const tag = cat.etiquetas.find((x) => x.id === id);
    pedacos.push({
      chave: `etiqueta:${id}`,
      rotulo: tag
        ? { fonte: "dado", texto: tag.name }
        : { fonte: "i18n", chave: "tags" },
      cor: tag?.color,
      orfao: cat.etiquetas.length > 0 && !tag,
      limpar: { etiquetaIds: f.etiquetaIds.filter((x) => x !== id) },
    });
  }

  // FUNIL E ETAPA (vários de cada desde 29/09, somando com OU): "Sem negócio"
  // primeiro — é a primeira opção do painel —, depois UM pedaço por funil,
  // com as etapas DELE entre parênteses, e por último as etapas soltas.
  //
  // ⚠️ As etapas vão DENTRO do pedaço do funil, e não soltas ao lado: a etapa
  // refina SÓ o funil dela (`casaComAEtapa`), e "Bancário · Trabalhista ·
  // Reunião marcada" faria o operador ler a reunião como valendo para os dois.
  if (f.etapaIds.includes(SEM_ETAPA)) {
    pedacos.push({
      chave: `etapa:${SEM_ETAPA}`,
      rotulo: { fonte: "i18n", chave: "stageNone" },
      limpar: { etapaIds: f.etapaIds.filter((x) => x !== SEM_ETAPA) },
    });
  }

  // Com dois níveis, o funil DERIVADO de uma etapa solta (visão salva numa
  // conta de um funil) ganha pedaço também — é como o painel o mostra
  // (`funisDoFiltro`). Com um funil só não há seletor de funil, e a etapa é
  // descrita sozinha, como sempre foi.
  const funisDescritos = doisNiveis ? funisDoFiltro(f, cat.etapas) : f.funilIds;
  const agrupadas = new Set<string>();
  for (const id of funisDescritos) {
    const nome = cat.funis.get(id);
    const etapasDele = f.etapaIds
      .map((e) => cat.etapas.find((x) => x.id === e))
      .filter((e): e is PipelineStage => e !== undefined && e.pipeline_id === id);
    // Sem o nome do funil, as etapas dele seguem soltas, com o nome delas:
    // agrupadas sob o rótulo genérico, sumiriam da descrição.
    if (nome) for (const e of etapasDele) agrupadas.add(e.id);
    pedacos.push({
      chave: `funil:${id}`,
      rotulo: nome
        ? {
            fonte: "dado",
            texto:
              etapasDele.length > 0
                ? `${nome} (${etapasDele.map((e) => e.name).join(", ")})`
                : nome,
          }
        : { fonte: "i18n", chave: "labelPipeline" },
      orfao: cat.funis.size > 0 && !nome,
      // ⚠️ Tirar o funil tira as etapas DELE junto — é o que o painel faz ao
      // desmarcá-lo (o funil derivado de uma etapa só sai assim). As etapas
      // dos outros funis ficam.
      limpar: {
        funilIds: f.funilIds.filter((x) => x !== id),
        etapaIds: f.etapaIds.filter((x) => !etapasDele.some((e) => e.id === x)),
      },
    });
  }

  for (const id of f.etapaIds) {
    if (id === SEM_ETAPA || agrupadas.has(id)) continue;
    const etapa = cat.etapas.find((e) => e.id === id);
    pedacos.push({
      chave: `etapa:${id}`,
      // Etapa não resolvida: o rótulo genérico do campo é o honesto —
      // "Qualquer etapa" seria o OPOSTO do que está acontecendo.
      rotulo: etapa
        ? { fonte: "dado", texto: nomeDaEtapa(etapa, cat.funis) }
        : { fonte: "i18n", chave: "labelStage" },
      orfao: cat.etapas.length > 0 && !etapa,
      limpar: { etapaIds: f.etapaIds.filter((x) => x !== id) },
    });
  }

  if (f.naoLidas) {
    pedacos.push({
      chave: "naoLidas",
      rotulo: { fonte: "i18n", chave: "filterUnread" },
      limpar: { naoLidas: false },
    });
  }

  if (f.favoritas) {
    pedacos.push({
      chave: "favoritas",
      rotulo: { fonte: "i18n", chave: "favorites" },
      limpar: { favoritas: false },
    });
  }

  // ⚠️ Não passa por `limparOrfaos`, como favoritas e não lidas: não é
  // referência a linha nenhuma do banco, é uma pergunta sobre o relógio.
  // "Ninguém em atraso agora" é uma resposta VERDADEIRA, não um id morto.
  if (f.emAtraso) {
    pedacos.push({
      chave: "emAtraso",
      rotulo: { fonte: "i18n", chave: "filterAwaiting" },
      limpar: { emAtraso: false },
    });
  }

  // Também fora de `limparOrfaos`: não é id, é uma pergunta ao espelho do
  // Asaas — e com o espelho indisponível o recorte é neutralizado no ctx,
  // não apagado da visão salva.
  if (f.inadimplentes) {
    pedacos.push({
      chave: "inadimplentes",
      rotulo: { fonte: "i18n", chave: "filterDelinquent" },
      limpar: { inadimplentes: false },
    });
  }

  return pedacos;
}

/**
 * Tira do recorte as referências que não existem mais.
 *
 * ⚠️⚠️ EXISTE PORQUE UM ID MORTO DEVOLVE ZERO CONVERSAS SEM DAR ERRO. Etapa
 * removida, conexão desconectada, etiqueta apagada: o recorte simplesmente não
 * casa com nada, e o operador aciona "Jurídico" e recebe uma caixa vazia que
 * parece uma resposta certa. É a mesma família de
 * `recorteDeEtapaConfiavel` — filtro sem o dado por trás não some, RESPONDE
 * ERRADO.
 *
 * ⚠️ **Catálogo VAZIO não prova nada, e por isso não limpa nada.** Lista vazia
 * pode ser "ainda não carregou" ou "a busca falhou" (o `useChannels` engole
 * erro por desenho, e as tags/perfis vêm de um `Promise.all` que pode voltar
 * pela metade). Descartar sobre catálogo vazio jogaria fora um filtro
 * perfeitamente bom por causa de uma falha de rede — o erro simétrico, e o pior
 * dos dois: o primeiro devolve conversa demais, o segundo apaga o recorte que o
 * operador gravou.
 *
 * ⚠️ `empresa` fica FORA de propósito. Ela não é referência a linha nenhuma: é
 * texto casado contra `contact.company` das conversas carregadas. Empresa sem
 * conversa aberta hoje continua existindo, e devolver zero ali é uma resposta
 * verdadeira. Os sentinelas (`SEM_ETAPA`, `SEM_RESPONSAVEL`) também ficam fora
 * — não são ids e nunca podem ser lidos como órfãos.
 */
export function limparOrfaos(
  f: FiltrosDoInbox,
  cat: CatalogosDoFiltro,
): FiltrosDoInbox {
  const limpo = { ...f };

  // Tira só os ids MORTOS; as conexões vivas do mesmo filtro continuam.
  if (limpo.canalIds.length > 0 && cat.canais.length > 0) {
    limpo.canalIds = limpo.canalIds.filter((id) => cat.canais.some((c) => c.id === id));
  }

  if (
    limpo.responsavelId &&
    limpo.responsavelId !== SEM_RESPONSAVEL &&
    cat.responsaveis.length > 0 &&
    !cat.responsaveis.some((p) => p.user_id === limpo.responsavelId)
  ) {
    limpo.responsavelId = null;
  }

  // ⚠️ Funil morto leva as etapas DELE junto: as etapas cascateiam com o
  // funil no banco, então uma etapa "viva" apontando para funil apagado é dado
  // velho de catálogo, não recorte aplicável. As etapas dos OUTROS funis
  // ficam — com vários funis marcados, levar todas junto apagaria recorte bom.
  if (limpo.funilIds.length > 0 && cat.funis.size > 0) {
    const mortos = limpo.funilIds.filter((id) => !cat.funis.has(id));
    if (mortos.length > 0) {
      limpo.funilIds = limpo.funilIds.filter((id) => cat.funis.has(id));
      limpo.etapaIds = limpo.etapaIds.filter((id) => {
        const funil = cat.etapas.find((e) => e.id === id)?.pipeline_id;
        return !funil || !mortos.includes(funil);
      });
    }
  }

  // Tira só as etapas MORTAS; as vivas e o sentinela ficam.
  if (limpo.etapaIds.length > 0 && cat.etapas.length > 0) {
    limpo.etapaIds = limpo.etapaIds.filter(
      (id) => id === SEM_ETAPA || cat.etapas.some((e) => e.id === id),
    );
  }

  if (limpo.etiquetaIds.length > 0 && cat.etiquetas.length > 0) {
    const vivas = limpo.etiquetaIds.filter((id) =>
      cat.etiquetas.some((t) => t.id === id),
    );
    if (vivas.length !== limpo.etiquetaIds.length) limpo.etiquetaIds = vivas;
  }

  return limpo;
}
