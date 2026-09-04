import { semAcento } from "@/lib/inbox/busca-em-mensagens";

import { dentroDoIntervalo, type Intervalo } from "./periodo";
import type { FatosDoNegocio, Situacao } from "./trajetoria";

/**
 * A LISTA de leads de um funil (Fase 1 do plano): colunas, recorte,
 * ordenação e as linhas do CSV. Tudo puro — a tela só monta.
 *
 * ⚠️ A lista mostra os negócios que estão NESTE funil hoje (`noFunil`); o
 * transferido só conta no painel (regra 6). E o período da lista é pela
 * CRIAÇÃO do negócio (`created_at`), não pela entrada no funil (decisão D3):
 * é a coluna "Data" da referência, sempre presente — para negócio de canal
 * as duas coincidem, porque a etapa de entrada é `lead`.
 */

export const COLUNAS_FIXAS = [
  "numero",
  "data",
  "nome",
  "naEtapaDesde",
  "etapa",
  "valor",
  "telefone",
  "email",
  "entrada",
  "situacao",
  "conexao",
  "responsavel",
  "empresa",
] as const;
export type ColunaFixa = (typeof COLUNAS_FIXAS)[number];
export type ColunaDeCampo = `campo:${string}`;
export type ColunaId = ColunaFixa | ColunaDeCampo;

/** O que a lista mostra de largada (D5): fixas principais, nenhum campo personalizado. */
export const COLUNAS_PADRAO: ColunaId[] = [
  "numero",
  "data",
  "nome",
  "naEtapaDesde",
  "etapa",
  "valor",
  "telefone",
  "email",
  "situacao",
];

/** Sem estas a linha não identifica ninguém nem permite mover — não se desligam. */
export const COLUNAS_SEMPRE: readonly ColunaFixa[] = ["numero", "nome", "etapa"];

export const CHAVE_COLUNAS = "wacrm:pipelines:lista:colunas";

export function ehColunaFixa(id: string): id is ColunaFixa {
  return (COLUNAS_FIXAS as readonly string[]).includes(id);
}

export function ehColunaDeCampo(id: string): id is ColunaDeCampo {
  return id.startsWith("campo:") && id.length > "campo:".length;
}

export function chaveDoCampo(id: ColunaDeCampo): string {
  return id.slice("campo:".length);
}

export function colunaDoCampo(fieldKey: string): ColunaDeCampo {
  return `campo:${fieldKey}`;
}

/**
 * Lê a preferência gravada (qualquer lixo) e devolve colunas válidas, NA
 * ORDEM FIXA (as fixas primeiro, na ordem do catálogo; os campos depois, na
 * ordem em que foram gravados). Campo apagado some sozinho quando a tela
 * cruza com o catálogo. As colunas obrigatórias voltam sempre.
 */
export function normalizarColunas(cru: unknown): ColunaId[] {
  if (!Array.isArray(cru)) return [...COLUNAS_PADRAO];
  const pedidas = new Set<string>(cru.filter((v): v is string => typeof v === "string"));
  for (const sempre of COLUNAS_SEMPRE) pedidas.add(sempre);
  const fixas = COLUNAS_FIXAS.filter((c) => pedidas.has(c));
  const campos = [...pedidas].filter(ehColunaDeCampo);
  return [...fixas, ...campos];
}

export const COLUNAS_ORDENAVEIS = ["data", "nome", "naEtapaDesde", "etapa", "valor", "entrada"] as const;
export type ColunaOrdenavel = (typeof COLUNAS_ORDENAVEIS)[number];

export function ehOrdenavel(id: string): id is ColunaOrdenavel {
  return (COLUNAS_ORDENAVEIS as readonly string[]).includes(id);
}

export interface Ordenacao {
  coluna: ColunaOrdenavel;
  direcao: "asc" | "desc";
}

/** A referência abre por "Na etapa desde ↓": quem mexeu por último no topo. */
export const ORDENACAO_PADRAO: Ordenacao = { coluna: "naEtapaDesde", direcao: "desc" };

/** Clicar na mesma coluna inverte; coluna nova nasce na direção natural dela. */
export function alternarOrdenacao(atual: Ordenacao, coluna: ColunaOrdenavel): Ordenacao {
  if (atual.coluna === coluna) {
    return { coluna, direcao: atual.direcao === "asc" ? "desc" : "asc" };
  }
  const natural: Record<ColunaOrdenavel, Ordenacao["direcao"]> = {
    data: "desc",
    naEtapaDesde: "desc",
    entrada: "desc",
    valor: "desc",
    nome: "asc",
    etapa: "asc",
  };
  return { coluna, direcao: natural[coluna] };
}

export type FiltroDeSituacao = Situacao | "todas";

export interface FiltrosDaLista {
  busca: string;
  etapaId: string | null;
  situacao: FiltroDeSituacao;
}

export const FILTROS_VAZIOS: FiltrosDaLista = { busca: "", etapaId: null, situacao: "todas" };

/** Só quem está NESTE funil hoje (o transferido fica com o painel). */
export function linhasDoFunil(fatos: readonly FatosDoNegocio[]): FatosDoNegocio[] {
  return fatos.filter((f) => f.noFunil);
}

/** Período da lista = criação do negócio (D3). */
export function noPeriodo(fatos: readonly FatosDoNegocio[], intervalo: Intervalo): FatosDoNegocio[] {
  // Sem data de criação não dá para dizer se cabe no período: fica de fora
  // do recorte por data, e aparece no "Total" (que não filtra).
  return fatos.filter((f) =>
    f.linha.created_at ? dentroDoIntervalo(new Date(f.linha.created_at), intervalo) : false,
  );
}

const soDigitos = (texto: string) => texto.replace(/\D+/g, "");

function casaComABusca(f: FatosDoNegocio, agulha: string, digitos: string): boolean {
  const l = f.linha;
  if (agulha) {
    if (semAcento(l.contato_nome ?? "").includes(agulha)) return true;
    if (semAcento(l.title).includes(agulha)) return true;
    if ((l.contato_email ?? "").toLowerCase().includes(agulha)) return true;
  }
  if (digitos.length >= 3 && soDigitos(l.contato_telefone ?? "").includes(digitos)) return true;
  return false;
}

export function filtrarLinhas(
  fatos: readonly FatosDoNegocio[],
  filtros: FiltrosDaLista,
): FatosDoNegocio[] {
  const agulha = semAcento(filtros.busca).trim();
  const digitos = soDigitos(filtros.busca);
  return fatos.filter((f) => {
    if (filtros.etapaId && f.etapaAtual !== filtros.etapaId) return false;
    if (filtros.situacao !== "todas" && f.situacao !== filtros.situacao) return false;
    if ((agulha || digitos.length >= 3) && !casaComABusca(f, agulha, digitos)) return false;
    return true;
  });
}

const cmpTexto = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
const cmpNumero = (a: number, b: number) => a - b;

/** Nulos (sem entrada, etapa desconhecida) vão sempre para o FIM. */
function chaveNumerica(f: FatosDoNegocio, coluna: ColunaOrdenavel, posicaoDaEtapa: Map<string, number>): number | null {
  switch (coluna) {
    case "data":
      return f.linha.created_at ? new Date(f.linha.created_at).getTime() : null;
    case "naEtapaDesde":
      return f.naEtapaDesde?.getTime() ?? null;
    case "entrada":
      return f.entradaEm ? f.entradaEm.getTime() : null;
    case "valor":
      return f.linha.value;
    case "etapa":
      return f.etapaAtual ? (posicaoDaEtapa.get(f.etapaAtual) ?? null) : null;
    case "nome":
      return null;
  }
}

export function ordenarLinhas(
  fatos: readonly FatosDoNegocio[],
  ordenacao: Ordenacao,
  posicaoDaEtapa: Map<string, number>,
): FatosDoNegocio[] {
  const sinal = ordenacao.direcao === "asc" ? 1 : -1;
  return [...fatos].sort((a, b) => {
    let resultado: number;
    if (ordenacao.coluna === "nome") {
      resultado = cmpTexto(nomeDaLinha(a), nomeDaLinha(b)) * sinal;
    } else {
      const ka = chaveNumerica(a, ordenacao.coluna, posicaoDaEtapa);
      const kb = chaveNumerica(b, ordenacao.coluna, posicaoDaEtapa);
      if (ka === null && kb === null) resultado = 0;
      else if (ka === null) resultado = 1;
      else if (kb === null) resultado = -1;
      else resultado = cmpNumero(ka, kb) * sinal;
    }
    return resultado !== 0 ? resultado : a.linha.deal_id.localeCompare(b.linha.deal_id);
  });
}

export function nomeDaLinha(f: FatosDoNegocio): string {
  return f.linha.contato_nome?.trim() || f.linha.title;
}

export interface ContextoDoCsv {
  rotulos: Record<ColunaFixa, string>;
  rotuloDoCampo: (fieldKey: string) => string;
  nomeDaEtapa: (stageId: string | null) => string;
  nomeDoCanal: (channelId: string | null) => string;
  nomeDoResponsavel: (userId: string | null) => string;
  rotuloDaSituacao: (s: Situacao) => string;
  formatarData: (d: Date) => string;
  /** número puro com vírgula decimal ("1234,56"), para o Excel somar */
  formatarValor: (v: number) => string;
}

export function celula(f: FatosDoNegocio, coluna: ColunaId, indice: number, ctx: ContextoDoCsv): string {
  if (ehColunaDeCampo(coluna)) return f.linha.campos[chaveDoCampo(coluna)] ?? "";
  const l = f.linha;
  switch (coluna) {
    case "numero":
      return String(indice + 1);
    case "data":
      return l.created_at ? ctx.formatarData(new Date(l.created_at)) : "";
    case "nome":
      return nomeDaLinha(f);
    case "naEtapaDesde":
      return f.naEtapaDesde ? ctx.formatarData(f.naEtapaDesde) : "";
    case "etapa":
      return ctx.nomeDaEtapa(f.etapaAtual);
    case "valor":
      return ctx.formatarValor(l.value);
    case "telefone":
      return l.contato_telefone ?? "";
    case "email":
      return l.contato_email ?? "";
    case "entrada":
      return f.entradaEm ? ctx.formatarData(f.entradaEm) : "";
    case "situacao":
      return ctx.rotuloDaSituacao(f.situacao);
    case "conexao":
      return ctx.nomeDoCanal(l.channel_id);
    case "responsavel":
      return ctx.nomeDoResponsavel(l.assigned_to);
    case "empresa":
      return l.contato_empresa ?? "";
  }
}

/** Cabeçalho + uma linha por negócio, nas colunas VISÍVEIS e na ordem da tela. */
export function linhasDoCsv(
  fatos: readonly FatosDoNegocio[],
  colunas: readonly ColunaId[],
  ctx: ContextoDoCsv,
): string[][] {
  const cabecalho = colunas.map((c) => (ehColunaDeCampo(c) ? ctx.rotuloDoCampo(chaveDoCampo(c)) : ctx.rotulos[c]));
  return [cabecalho, ...fatos.map((f, i) => colunas.map((c) => celula(f, c, i, ctx)))];
}

/** "1234,56" — o Excel em pt-BR lê como número; R$ e ponto de milhar não. */
export function valorParaCsv(v: number): string {
  return v.toFixed(2).replace(".", ",");
}
