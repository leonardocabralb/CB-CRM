// ============================================================
// A forma do EDITOR de perfis — o que ele mostra e como agrupa.
//
// Pedido do operador (2026-09-03): "a aba de edição de perfil está muito
// complexa". Medido antes: ~31 controles mais um por funil, 25 caixas
// idênticas em duas grades (14 telas + 11 seções), itens que o papel não
// opera misturados aos que opera — e o perfil novo nascia SEM tela nenhuma,
// que aqui é literal (ver `tipos.ts`): só servia depois de 14 caixas
// marcadas à mão.
//
// Três respostas, todas aqui e nenhuma no banco:
//   1. MODELO DE PARTIDA — o perfil novo nasce preenchido a partir de um dos
//      três de fábrica (`modelosDePartida`). O trabalho vira desmarcar.
//   2. ÁREAS — as caixas em quatro grupos com caixa de grupo e detalhe
//      recolhido (`AREA_DA_TELA`, `gruposDoEditor`, `estadoDoGrupo`,
//      `alternarGrupo`). As seções entram aninhadas em Configurações.
//   3. "SÓ LEITURA PARA ESTE PAPEL" — o que o papel não opera SAI das áreas
//      e vai para um grupo próprio, recolhido. Continua existindo porque os
//      perfis "Gestor" desta conta usam isso de propósito (agent que
//      acompanha Conexões, Membros, Automações sem mexer).
//
// ⚠️ A partição em "só leitura" é DERIVADA de `ESCRITA_DA_TELA` /
// `ESCRITA_DA_SECAO` (poderes.ts) — a mesma fonte do aviso antigo. Há teste
// cobrando que o grupo seja EXATAMENTE o que `areasQueNaoOperam` apontaria
// com tudo marcado: duas régua divergindo fariam a tela avisar sobre um item
// e agrupar outro.
//
// Puro: a tela só desenha o que sai daqui. Quem for mexer no agrupamento
// mexe neste módulo, não no componente.
// ============================================================

import { hasMinRole } from "@/lib/auth/roles";
import {
  SECOES_PESSOAIS,
  SECOES_SO_DE_ADMIN,
  SECOES_TRAVADAS_PARA_ADMIN,
  TELAS_SEMPRE_VISIVEIS,
  TODAS_AS_SECOES,
  TODAS_AS_TELAS,
  type SecaoId,
  type TelaId,
} from "./catalogo";
import { PERFIS_DE_FABRICA } from "./padroes";
import { ESCRITA_DA_SECAO, ESCRITA_DA_TELA } from "./poderes";
import type { PapelBase } from "./tipos";

/**
 * ⚠️ Cada id é também chave do dicionário (`PerfisPanel.areas.<id>`), e há
 * teste lendo `messages/*.json` que cobra uma entrada por área — a mesma
 * amarração de `poderes.ts`. Área nova sem tradução cairia crua na tela.
 */
export type AreaId =
  | "atendimento"
  | "gestao"
  | "disparos"
  | "configuracoes"
  | "so-leitura";

/** A ordem em que a tela desenha os grupos. "Só leitura" é sempre o último. */
export const ORDEM_DAS_AREAS: readonly AreaId[] = [
  "atendimento",
  "gestao",
  "disparos",
  "configuracoes",
  "so-leitura",
] as const;

export type ItemDoEditor =
  | { tipo: "tela"; id: TelaId }
  | { tipo: "secao"; id: SecaoId };

/**
 * A que área cada tela pertence quando o papel a OPERA. `Record<TelaId, …>`
 * de propósito: tela nova não compila sem área.
 *
 * `settings` mora em Configurações — é a tela-mãe das seções, travada
 * (`TELAS_SEMPRE_VISIVEIS`), e aparece lá com cadeado, como antes.
 */
export const AREA_DA_TELA: Record<TelaId, Exclude<AreaId, "so-leitura">> = {
  inbox: "atendimento",
  notifications: "atendimento",
  tarefas: "atendimento",
  contacts: "atendimento",
  agenda: "atendimento",
  dashboard: "gestao",
  radar: "gestao",
  pipelines: "gestao",
  broadcasts: "disparos",
  agendadas: "disparos",
  automations: "disparos",
  flows: "disparos",
  agents: "disparos",
  settings: "configuracoes",
};

export interface GrupoDoEditor {
  area: AreaId;
  itens: ItemDoEditor[];
}

/**
 * Os grupos que o editor mostra para um papel.
 *
 * - Item que o papel opera fica na sua área; item acima do piso vai para
 *   "só leitura" (régua: `ESCRITA_DA_*` + `hasMinRole`, nunca comparação de
 *   papel à mão — ver poderes.ts).
 * - Seções pessoais nunca entram (aparecem sempre, para todo mundo).
 * - `perfis` (SECOES_SO_DE_ADMIN) NÃO é oferecida fora do admin: marcada num
 *   perfil agent/viewer a caixa é inerte, e oferecer o inerte é o que fazia
 *   alguém sair da tela achando ter delegado a gestão de permissões. O caso
 *   já gravado (legado, ou papel trocado depois) continua avisado por
 *   `AvisoDeAreasSemAcao`.
 * - Grupo vazio some (para viewer, "Disparos e automações" fica vazio).
 */
export function gruposDoEditor(papel: PapelBase): GrupoDoEditor[] {
  const porArea = new Map<AreaId, ItemDoEditor[]>(
    ORDEM_DAS_AREAS.map((a) => [a, [] as ItemDoEditor[]]),
  );
  for (const tela of TODAS_AS_TELAS) {
    const area = hasMinRole(papel, ESCRITA_DA_TELA[tela])
      ? AREA_DA_TELA[tela]
      : "so-leitura";
    porArea.get(area)!.push({ tipo: "tela", id: tela });
  }
  for (const secao of TODAS_AS_SECOES) {
    if (SECOES_PESSOAIS.includes(secao)) continue;
    if (SECOES_SO_DE_ADMIN.includes(secao) && !hasMinRole(papel, "admin")) continue;
    const area: AreaId = hasMinRole(papel, ESCRITA_DA_SECAO[secao])
      ? "configuracoes"
      : "so-leitura";
    porArea.get(area)!.push({ tipo: "secao", id: secao });
  }
  return ORDEM_DAS_AREAS.map((area) => ({ area, itens: porArea.get(area)! })).filter(
    (g) => g.itens.length > 0,
  );
}

/** As duas listas que o editor edita — o pedaço do rascunho que este módulo lê. */
export interface RascunhoDeAreas {
  telas: readonly TelaId[];
  secoes_config: readonly SecaoId[];
}

/**
 * Item que nenhum perfil deste papel consegue desligar: aparece marcado, com
 * cadeado, e fica fora da caixa de grupo. Espelha `podeVerTela`/`podeVerSecao`
 * (`TELAS_SEMPRE_VISIVEIS`; `SECOES_TRAVADAS_PARA_ADMIN` só para admin).
 */
export function itemTravado(papel: PapelBase, item: ItemDoEditor): boolean {
  if (item.tipo === "tela") return TELAS_SEMPRE_VISIVEIS.includes(item.id);
  return papel === "admin" && SECOES_TRAVADAS_PARA_ADMIN.includes(item.id);
}

export function itemMarcado(
  papel: PapelBase,
  r: RascunhoDeAreas,
  item: ItemDoEditor,
): boolean {
  if (itemTravado(papel, item)) return true;
  return item.tipo === "tela"
    ? r.telas.includes(item.id)
    : r.secoes_config.includes(item.id);
}

export type EstadoDoGrupo = "nenhum" | "alguns" | "todos";

/**
 * O que a caixa do grupo mostra. `marcados`/`total` contam TODOS os itens
 * (travado conta como marcado — é o que a pessoa vê na grade); o estado é
 * decidido só pelos itens LIVRES, porque o travado não muda com o clique.
 */
export function estadoDoGrupo(
  papel: PapelBase,
  r: RascunhoDeAreas,
  grupo: GrupoDoEditor,
): { estado: EstadoDoGrupo; marcados: number; total: number } {
  const livres = grupo.itens.filter((i) => !itemTravado(papel, i));
  const livresMarcados = livres.filter((i) => itemMarcado(papel, r, i)).length;
  const estado: EstadoDoGrupo =
    livres.length === 0 || livresMarcados === livres.length
      ? "todos"
      : livresMarcados === 0
        ? "nenhum"
        : "alguns";
  return {
    estado,
    marcados: grupo.itens.filter((i) => itemMarcado(papel, r, i)).length,
    total: grupo.itens.length,
  };
}

/**
 * Liga ou desliga o grupo inteiro. Item travado não é tocado (nem entra no
 * array quando se liga: `settings` listada em `telas` "daria a impressão
 * falsa de que dá para tirá-la" — padroes.ts). Sem duplicata.
 */
export function alternarGrupo(
  papel: PapelBase,
  r: RascunhoDeAreas,
  grupo: GrupoDoEditor,
  ligar: boolean,
): { telas: TelaId[]; secoes_config: SecaoId[] } {
  const telas = new Set(r.telas);
  const secoes = new Set(r.secoes_config);
  for (const item of grupo.itens) {
    if (itemTravado(papel, item)) continue;
    if (item.tipo === "tela") {
      if (ligar) telas.add(item.id);
      else telas.delete(item.id);
    } else if (ligar) secoes.add(item.id);
    else secoes.delete(item.id);
  }
  return { telas: [...telas], secoes_config: [...secoes] };
}

/**
 * Quais grupos abrem expandidos ao entrar no editor: só os PARCIALMENTE
 * marcados. "Todos" e "nenhum" já dizem tudo no cabeçalho ("5 de 5"); o
 * parcial é o que merece um olhar. A pessoa abre e fecha o que quiser depois.
 */
export function gruposAbertosDeInicio(
  papel: PapelBase,
  r: RascunhoDeAreas,
  grupos: GrupoDoEditor[],
): AreaId[] {
  return grupos
    .filter((g) => estadoDoGrupo(papel, r, g).estado === "alguns")
    .map((g) => g.area);
}

export interface ModeloDePartida {
  nome: string;
  papel_base: PapelBase;
  telas: TelaId[];
  secoes_config: SecaoId[];
}

/**
 * Os três perfis de fábrica como ponto de partida do perfil novo — cópias,
 * para o rascunho poder ser mexido sem tocar em `PERFIS_DE_FABRICA` (que o
 * semeador também lê). A descrição de cada um vem do dicionário, por
 * `papel_base` (`PerfisPanel.modelos.<papel>`), porque os três casam 1:1
 * com os papéis.
 */
export function modelosDePartida(): ModeloDePartida[] {
  return PERFIS_DE_FABRICA.map(({ nome, papel_base, telas, secoes_config }) => ({
    nome,
    papel_base,
    telas: [...telas],
    secoes_config: [...secoes_config],
  }));
}
