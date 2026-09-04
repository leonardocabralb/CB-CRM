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
// ⚠️ A partição em "só leitura" SAI de `areasQueNaoOperam` (poderes.ts), a
// régua única de "o que este papel não opera" — não de uma segunda leitura
// de `ESCRITA_DA_*`. Uma régua só: duas divergindo fariam a tela agrupar um
// item como operável e outra parte do app chamá-lo de somente-leitura.
//
// Puro: a tela só desenha o que sai daqui. Quem for mexer no agrupamento
// mexe neste módulo, não no componente.
// ============================================================

import {
  SECOES_PESSOAIS,
  SECOES_TRAVADAS_PARA_ADMIN,
  TELAS_SEMPRE_VISIVEIS,
  TODAS_AS_SECOES,
  TODAS_AS_TELAS,
  type SecaoId,
  type TelaId,
} from "./catalogo";
import { PERFIS_DE_FABRICA } from "./padroes";
import { areasQueNaoOperam } from "./poderes";
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
 * - Item que o papel opera fica na sua área; item que ele não opera vai
 *   para "só leitura" (`areasQueNaoOperam` com tudo marcado).
 * - Seções pessoais nunca entram (aparecem sempre, para todo mundo).
 * - `perfis` (SECOES_SO_DE_ADMIN) NÃO é oferecida fora do admin: marcada num
 *   perfil agent/viewer a caixa é inerte, e oferecer o inerte é o que fazia
 *   alguém sair da tela achando ter delegado a gestão de permissões. O que
 *   chega gravado assim (legado) ou fica assim ao descer o papel é
 *   DESCARTADO do rascunho por `semSecoesOcultas` — sem a caixa não haveria
 *   como desmarcar (Codex, PR #117).
 * - Grupo vazio some (para viewer, "Disparos e automações" fica vazio).
 */
export function gruposDoEditor(papel: PapelBase): GrupoDoEditor[] {
  // Com TUDO marcado: o que este papel não opera, e o que nem chega a ver.
  const naoOpera = areasQueNaoOperam(papel, TODAS_AS_TELAS, TODAS_AS_SECOES);
  const porArea = new Map<AreaId, ItemDoEditor[]>(
    ORDEM_DAS_AREAS.map((a) => [a, [] as ItemDoEditor[]]),
  );
  for (const tela of TODAS_AS_TELAS) {
    const area = naoOpera.telas.includes(tela) ? "so-leitura" : AREA_DA_TELA[tela];
    porArea.get(area)!.push({ tipo: "tela", id: tela });
  }
  for (const secao of TODAS_AS_SECOES) {
    if (SECOES_PESSOAIS.includes(secao)) continue;
    if (naoOpera.secoesOcultas.includes(secao)) continue;
    const area: AreaId = naoOpera.secoes.includes(secao) ? "so-leitura" : "configuracoes";
    porArea.get(area)!.push({ tipo: "secao", id: secao });
  }
  return ORDEM_DAS_AREAS.map((area) => ({ area, itens: porArea.get(area)! })).filter(
    (g) => g.itens.length > 0,
  );
}

/**
 * Tira do rascunho as seções que este papel não vê de jeito nenhum
 * (`SECOES_SO_DE_ADMIN` fora do admin). Chamada ao abrir o editor e ao trocar
 * o papel: como `gruposDoEditor` não OFERECE a caixa fora do admin, um id
 * desses preso no array não teria como ser desmarcado pela tela — e `salvar`
 * o mandaria de volta ao banco, inerte, para sempre (Codex, PR #117).
 *
 * Id desconhecido (o fantasma "deals") passa intacto: quem o descarta é a
 * validação do servidor, como sempre foi.
 */
export function semSecoesOcultas(
  papel: PapelBase,
  secoes: readonly SecaoId[],
): SecaoId[] {
  const ocultas = areasQueNaoOperam(papel, [], secoes).secoesOcultas;
  return secoes.filter((s) => !ocultas.includes(s));
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
  papel_base: PapelBase;
  telas: TelaId[];
  secoes_config: SecaoId[];
}

/**
 * Os três perfis de fábrica como ponto de partida do perfil novo — cópias,
 * para o rascunho poder ser mexido sem tocar em `PERFIS_DE_FABRICA` (que o
 * semeador também lê).
 *
 * ⚠️ Nome e descrição de cada cartão vêm do DICIONÁRIO, por `papel_base`
 * (`PerfisPanel.modelos.<papel>.nome` / `.descricao`), porque os três casam
 * 1:1 com os papéis. O `nome` de `PERFIS_DE_FABRICA` é o que o semeador
 * GRAVA — dado, em português — e no locale inglês sairia cru ao lado de um
 * texto que chama os mesmos perfis de "Administrator, Lawyer and Observer"
 * (Codex, PR #117).
 */
export function modelosDePartida(): ModeloDePartida[] {
  return PERFIS_DE_FABRICA.map(({ papel_base, telas, secoes_config }) => ({
    papel_base,
    telas: [...telas],
    secoes_config: [...secoes_config],
  }));
}
