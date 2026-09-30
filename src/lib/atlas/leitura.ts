/**
 * Puro: as regras da LEITURA periódica das situações do Atlas (Fase 2 de
 * docs/PLANO-integracao-atlas.md) e do vínculo automático. O I/O mora em
 * `situacoes.ts`; aqui fica o que se decide, com teste.
 *
 * ⚠️ Nenhum dado pessoal do Atlas passa daqui para o banco: do `list_clients`
 * o parser (`cliente.ts`) guarda só o id, a situação, a data da mudança, o
 * `app_url` e dois SINAIS em memória — os uuids do link da conversa e o
 * telefone canônico —, que servem só para achar a ficha.
 */

import { diaNoFuso, partesNoFuso } from "@/lib/agenda/fuso";
import { telefoneCanonico, telefoneDigitado } from "@/lib/contacts/telefone";

import type { ClienteDoAtlas } from "./cliente";

// ------------------------------------------------------------
// Constantes (num lugar só)
// ------------------------------------------------------------

/** O ciclo inteiro (todas as contas) no cron: depois disto, nenhuma conta nova começa. */
export const ORCAMENTO_DO_CICLO_MS = 60_000;
/** O "Ler situações agora" do cartão: uma conta só, e a pessoa espera a resposta. */
export const PRAZO_DO_LER_AGORA_MS = 45_000;
/**
 * Páginas do `list_clients` por conta e por ciclo. A cota do Atlas (60 por
 * minuto) é do ESCRITÓRIO inteiro, dividida com o n8n e com o passo "Criar
 * cliente", que nunca repete: um 429 nele é falha.
 */
export const PAGINAS_POR_CICLO = 10;
export const PAUSA_ENTRE_PAGINAS_MS = 3_000;
export const LIMITE_DA_PAGINA = 100;
/** O `statusChangedSince` recua isto a partir da última leitura (contrato §11). */
export const SOBREPOSICAO_MS = 5 * 60_000;
/**
 * Mudança mais nova que isto NÃO é gravada nem vira vínculo neste ciclo (a
 * sobreposição a relê no próximo). Fecha a corrida com o passo "Criar
 * cliente", que escreve no Atlas ANTES de gravar o vínculo.
 */
export const JANELA_RECENTE_MS = 2 * 60_000;
/** Cadeado sem dono há mais que isto é recolhido (o ciclo é bem mais curto). */
export const RECOLHER_LEITURA_MS = 10 * 60_000;
/** Leitura sem sucesso há mais que isto é "velha" (a tela diz "lida em …"). */
export const LEITURA_VELHA_MS = 60 * 60_000;
/** Vínculos conferidos um a um (`get_client`) na lixeira, por ciclo. */
export const TETO_CONFERENCIAS_DE_LIXEIRA = 5;
/**
 * Vínculos pelo link confirmados no Atlas (`find_clients`), por ciclo: fora
 * da listagem completa que começa e termina no ciclo, a página não prova que
 * só UM cadastro do escritório aponta para a ficha.
 */
export const TETO_CONFIRMACOES_DO_LINK = 5;
/** Ids por consulta `.in(...)` (lista longa estoura a URL do PostgREST). */
export const LOTE_DE_IDS = 100;
/** A listagem completa diária é devida a partir desta hora local (como a do Asaas). */
export const HORA_DA_LISTAGEM_DIARIA = 3;
/** "Ler agora" por CONTA (fora de `rate-limit.ts`, que é do upstream). */
export const LEITURA_AGORA = { limit: 2, windowMs: 60_000 } as const;

/** As situações que acendem a faixa na conversa (PR B; decisão do operador, 30/09/2026). */
export const SITUACOES_NA_FAIXA = ["rescindido", "finalizado", "suspenso", "inativo"] as const;
/** Como o vínculo nasceu — espelho do CHECK da 1072 (pino `atlas-1072.test.ts`). */
export const ORIGENS_DO_VINCULO = ["criada", "reativada", "encontrada", "manual", "automatica"] as const;
/** Por que o vínculo AUTOMÁTICO casou — espelho do CHECK da 1072. */
export const CASOU_POR = ["chat_link", "telefone"] as const;

export type OrigemDoVinculo = (typeof ORIGENS_DO_VINCULO)[number];
export type CasouPor = (typeof CASOU_POR)[number];

// ------------------------------------------------------------
// O vínculo como a leitura o vê
// ------------------------------------------------------------

/** As colunas que a leitura lê de cada vínculo. */
export const COLUNAS_DO_VINCULO =
  "id, atlas_client_id, contact_id, situacao, situacao_desde, situacao_lida_em, app_url, created_at, crm_escreveu_em, excluido_no_atlas_em, visto_na_listagem_em";

export interface VinculoLido {
  id: string;
  atlas_client_id: string;
  contact_id: string | null;
  situacao: string | null;
  situacao_desde: string | null;
  situacao_lida_em: string | null;
  app_url: string | null;
  created_at: string;
  crm_escreveu_em: string | null;
  excluido_no_atlas_em: string | null;
  visto_na_listagem_em: string | null;
}

function instante(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Como a situação se COMPARA: sem diferença de maiúsculas, e `em_negociacao`
 * (o valor antigo de "ativo", que uma integração ainda envia — contrato §8)
 * vale `ativo`. Gravada, ela continua como veio.
 */
export function situacaoComparavel(situacao: string | null | undefined): string {
  const s = (situacao ?? "").trim().toLowerCase();
  return s === "em_negociacao" ? "ativo" : s;
}

/** O `app_url` só entra no banco (e na tela) se for `https:` e apontar para ESTE cliente. */
export function appUrlSegura(url: string | null | undefined, atlasClientId: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" && url.includes(atlasClientId) ? url : null;
  } catch {
    return null;
  }
}

/** A situação mudou há menos de `JANELA_RECENTE_MS`? (a sobreposição a relê) */
export function mudouHaPouco(situacaoDesde: string | null | undefined, agora: Date): boolean {
  const desde = instante(situacaoDesde);
  return desde !== null && agora.getTime() - desde < JANELA_RECENTE_MS;
}

export type TipoDaMudanca = "ignorar" | "recente" | "antiga" | "igual" | "primeira" | "mudou_sem_data" | "corrigida" | "mudou";

export interface DecisaoDaMudanca {
  tipo: TipoDaMudanca;
  /** Escreve a situação lida no vínculo? */
  grava: boolean;
}

/**
 * O que fazer com o cliente do Atlas que TEM vínculo, nesta ordem:
 *
 * - `ignorar`: a situação veio nula;
 * - `recente`: mudou há menos de 2 min — não grava (a sobreposição relê);
 * - `antiga`: a data é ANTERIOR à guardada (página velha) — nada;
 * - `primeira`: o vínculo não tinha situação, ou `importado → ativo` (o
 *   cadastro inicial, não uma reativação — decisão do operador, 30/09) —
 *   grava, nunca é evento;
 * - `igual`: mesma situação (`em_negociacao` vale `ativo`) — grava só se a
 *   data, a grafia, o `app_url` mudaram, ou se estava na lixeira;
 * - `mudou_sem_data`: mudou e o Atlas não sabe quando — grava, nunca é evento;
 * - `corrigida`: mudou com data ANTERIOR ao vínculo (o CRM só não tinha lido)
 *   — grava, nunca é evento;
 * - `mudou`: mudou depois do vínculo — grava; é o evento da Fase 4
 *   (`viraEvento`).
 */
export function decidirMudanca(
  vinculo: Pick<VinculoLido, "situacao" | "situacao_desde" | "app_url" | "created_at" | "excluido_no_atlas_em">,
  cliente: Pick<ClienteDoAtlas, "id" | "status" | "appUrl" | "situacaoDesde">,
  agora: Date,
): DecisaoDaMudanca {
  if (!cliente.status || cliente.status.trim() === "") return { tipo: "ignorar", grava: false };
  if (mudouHaPouco(cliente.situacaoDesde, agora)) return { tipo: "recente", grava: false };
  const desde = instante(cliente.situacaoDesde);
  const guardada = instante(vinculo.situacao_desde);
  if (desde !== null && guardada !== null && desde < guardada) return { tipo: "antiga", grava: false };
  if (!vinculo.situacao || vinculo.situacao.trim() === "") return { tipo: "primeira", grava: true };
  const anterior = situacaoComparavel(vinculo.situacao);
  const nova = situacaoComparavel(cliente.status);
  if (anterior === "importado" && nova === "ativo") return { tipo: "primeira", grava: true };
  if (anterior === nova) {
    const url = appUrlSegura(cliente.appUrl, cliente.id);
    const grava =
      desde !== guardada ||
      vinculo.situacao.trim().toLowerCase() !== cliente.status.trim().toLowerCase() ||
      (url !== null && url !== vinculo.app_url) ||
      vinculo.excluido_no_atlas_em !== null;
    return { tipo: "igual", grava };
  }
  if (desde === null) return { tipo: "mudou_sem_data", grava: true };
  const criado = instante(vinculo.created_at);
  if (criado !== null && desde <= criado) return { tipo: "corrigida", grava: true };
  return { tipo: "mudou", grava: true };
}

/** A decisão vira EVENTO ("Situação mudou no Atlas", Fase 4)? Um lugar só, para a Fase 4 estender. */
export function viraEvento(decisao: DecisaoDaMudanca): boolean {
  return decisao.tipo === "mudou";
}

// ------------------------------------------------------------
// Os sinais do vínculo automático (só em memória)
// ------------------------------------------------------------

const UUID = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi;

/** Os uuids dentro do link da conversa gravado no Atlas (`…/inbox?c=<uuid>`) — nada mais do texto. */
export function uuidsDoLink(link: unknown): string[] {
  if (typeof link !== "string") return [];
  return [...new Set((link.match(UUID) ?? []).map((u) => u.toLowerCase()))].slice(0, 10);
}

/**
 * O telefone do Atlas que serve para LIGAR sozinho: passa pela régua de
 * telefone digitado (CLAUDE.md 8d — o Atlas grava "como veio": "11
 * 98765-4321" ganha o 55), vai à grafia canônica (o nono dígito, como
 * `contacts.telefone_canonico`) e tem de ter DDI + DDD + número (12 dígitos
 * ou mais). Telefone sem DDD, com letra ou recusado fica FORA — é o sinal
 * fraco que casa pessoas diferentes.
 */
export function telefoneForte(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const t = telefoneDigitado(bruto);
  if (!t.ok) return null;
  const canonico = telefoneCanonico(t.digitos);
  return canonico.length >= 12 ? canonico : null;
}

export interface ParDoVinculo {
  atlasClientId: string;
  contactId: string;
}

/**
 * O vínculo pelo LINK da conversa: para cada cliente do Atlas sem vínculo,
 * as fichas que os uuids do link acham — a dona de cada conversa casada
 * (conversa de grupo não tem ficha e fica fora) e cada ficha casada direto
 * (o link antigo apontava para a ficha). Exatamente UMA ficha = candidato;
 * mais de uma = ambíguo. Depois, a ficha disputada por dois ou mais clientes
 * derruba TODOS eles (ambíguo).
 */
export function candidatosPeloLink(
  clientes: { id: string; uuids: string[] }[],
  conversas: ReadonlyMap<string, string | null>,
  contatos: ReadonlySet<string>,
): { pares: ParDoVinculo[]; ambiguos: number; comAlgumaFicha: Set<string> } {
  const unicos: ParDoVinculo[] = [];
  const comAlgumaFicha = new Set<string>();
  let ambiguos = 0;
  for (const c of clientes) {
    const fichas = new Set<string>();
    for (const u of c.uuids) {
      const dona = conversas.get(u);
      if (dona) fichas.add(dona);
      if (contatos.has(u)) fichas.add(u);
    }
    if (fichas.size === 0) continue;
    comAlgumaFicha.add(c.id);
    if (fichas.size > 1) {
      ambiguos++;
      continue;
    }
    unicos.push({ atlasClientId: c.id, contactId: [...fichas][0] });
  }
  const porFicha = new Map<string, number>();
  for (const p of unicos) porFicha.set(p.contactId, (porFicha.get(p.contactId) ?? 0) + 1);
  const pares = unicos.filter((p) => porFicha.get(p.contactId) === 1);
  ambiguos += unicos.length - pares.length;
  return { pares, ambiguos, comAlgumaFicha };
}

/**
 * O vínculo pelo TELEFONE: os telefones fortes que aparecem em EXATAMENTE um
 * cliente da listagem inteira (a contagem inclui os já vinculados — um
 * telefone de dois cadastros não liga nenhum), tirando os das conexões do
 * escritório e os clientes em `fora` (já vinculados, casados pelo link,
 * mudados há pouco). Devolve telefone → cliente do Atlas.
 */
export function telefonesUnicos(
  listagem: { id: string; telefone: string | null }[],
  fora: ReadonlySet<string>,
  telefonesDasConexoes: ReadonlySet<string>,
): Map<string, string> {
  const porTelefone = new Map<string, Set<string>>();
  for (const c of listagem) {
    if (!c.telefone) continue;
    const ids = porTelefone.get(c.telefone) ?? new Set<string>();
    ids.add(c.id);
    porTelefone.set(c.telefone, ids);
  }
  const saida = new Map<string, string>();
  for (const [telefone, ids] of porTelefone) {
    if (ids.size !== 1 || telefonesDasConexoes.has(telefone)) continue;
    const [id] = ids;
    if (!fora.has(id)) saida.set(telefone, id);
  }
  return saida;
}

/** Tira a ficha que já tem vínculo neste ambiente e o par que gente recusou (`contato:cliente`). */
export function semDescartados(pares: ParDoVinculo[], fichasLigadas: ReadonlySet<string>, recusas: ReadonlySet<string>): ParDoVinculo[] {
  return pares.filter((p) => !fichasLigadas.has(p.contactId) && !recusas.has(`${p.contactId}:${p.atlasClientId}`));
}

// ------------------------------------------------------------
// O modo do ciclo
// ------------------------------------------------------------

export interface EstadoDaLeitura {
  situacoes_lidas_ate: string | null;
  mudancas_desde: string | null;
  mudancas_cursor: string | null;
  mudancas_iniciada_em: string | null;
  listagem_completa_em: string | null;
  listagem_iniciada_em: string | null;
  listagem_cursor: string | null;
}

/** A listagem completa diária é devida? (virou o dia no fuso e já passou das 03:00 — a régua do Asaas) */
export function listagemDiariaDevida(completaEm: string | null, agora: Date, fuso: string): boolean {
  const t = instante(completaEm);
  if (t === null) return true;
  return diaNoFuso(new Date(t), fuso) < diaNoFuso(agora, fuso) && partesNoFuso(agora, fuso).hora >= HORA_DA_LISTAGEM_DIARIA;
}

/**
 * O que o ciclo faz:
 * - `mudancas` (passo A): só depois da primeira listagem completa
 *   (`situacoes_lidas_ate` preenchido) — o `statusChangedSince` deixa de fora
 *   quem tem a data desconhecida;
 * - `listagem` (passo B): a primeira, a diária, a que está em curso, ou a
 *   pedida no "Ler agora" com "completa";
 * - `recomecar`: a listagem começa do zero (sem cursor guardado, ou pedida).
 */
export function modoDaLeitura(
  estado: EstadoDaLeitura,
  agora: Date,
  fuso: string,
  forcarCompleta: boolean,
): { mudancas: boolean; listagem: boolean; recomecar: boolean } {
  const emCurso = !!estado.listagem_cursor && !!estado.listagem_iniciada_em;
  return {
    mudancas: estado.situacoes_lidas_ate !== null,
    listagem: forcarCompleta || emCurso || listagemDiariaDevida(estado.listagem_completa_em, agora, fuso),
    recomecar: forcarCompleta || !emCurso,
  };
}

/** O `statusChangedSince` de uma varredura nova: a última leitura menos a sobreposição. */
export function desdeDasMudancas(situacoesLidasAte: string): string {
  return new Date(Date.parse(situacoesLidasAte) - SOBREPOSICAO_MS).toISOString();
}

/** O filtro do cadeado: livre, ou preso há mais de `RECOLHER_LEITURA_MS` (processo morto). */
export function filtroDoCadeadoLivre(agoraMs: number): string {
  return `sincronizando_desde.is.null,sincronizando_desde.lt.${new Date(agoraMs - RECOLHER_LEITURA_MS).toISOString()}`;
}

// ------------------------------------------------------------
// Lixeira
// ------------------------------------------------------------

/**
 * Os vínculos a conferir na lixeira do Atlas depois de uma listagem completa
 * (a listagem não mostra cliente excluído — contrato §10): com ficha, fora da
 * lixeira, criados ANTES da listagem começar e que ela NÃO viu. Os de leitura
 * mais antiga primeiro, no máximo `TETO_CONFERENCIAS_DE_LIXEIRA`.
 */
export function vinculosParaConferirNaLixeira<T extends Pick<VinculoLido, "id" | "contact_id" | "created_at" | "situacao_lida_em" | "excluido_no_atlas_em" | "visto_na_listagem_em">>(
  vinculos: T[],
  listagemCompletaEm: string,
): T[] {
  const limite = instante(listagemCompletaEm);
  if (limite === null) return [];
  const antes = (iso: string | null) => {
    const t = instante(iso);
    return t !== null && t < limite;
  };
  return vinculos
    .filter((v) => v.contact_id !== null && v.excluido_no_atlas_em === null && antes(v.created_at) && (v.visto_na_listagem_em === null || antes(v.visto_na_listagem_em)))
    .sort((a, b) => (instante(a.situacao_lida_em) ?? -Infinity) - (instante(b.situacao_lida_em) ?? -Infinity) || a.id.localeCompare(b.id))
    .slice(0, TETO_CONFERENCIAS_DE_LIXEIRA);
}

// ------------------------------------------------------------
// Frescor (a tela)
// ------------------------------------------------------------

/** Quando a situação deste vínculo foi confirmada pela última vez: a linha ou a varredura inteira. */
export function lidaEm(vinculoLidaEm: string | null, situacoesLidasAte: string | null): string | null {
  const a = instante(vinculoLidaEm);
  const b = instante(situacoesLidasAte);
  if (a === null) return b === null ? null : situacoesLidasAte;
  if (b === null) return vinculoLidaEm;
  return a >= b ? vinculoLidaEm : situacoesLidasAte;
}

/** A leitura está velha? (sem leitura, com erro, ou há mais de `LEITURA_VELHA_MS`) — calculado no SERVIDOR. */
export function leituraVelha(ultimaEm: string | null, erro: string | null, agora: Date): boolean {
  const t = instante(ultimaEm);
  return erro !== null || t === null || agora.getTime() - t > LEITURA_VELHA_MS;
}
