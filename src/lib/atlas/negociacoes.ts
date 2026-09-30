/**
 * Puro: a NEGOCIAÇÃO de um cliente do Atlas (Fase 3 de
 * docs/PLANO-integracao-atlas.md) — bancos, contratos, propostas e acordos,
 * lidos NA HORA pelo `get_client_negotiations` (permissão `read_negotiations`,
 * opcional no escritório) e mostrados na aba Atlas. Nada disto é gravado no
 * CRM.
 *
 * ⚠️⚠️ ALLOWLIST campo a campo (`lerNegociacoes`): o objeto do Atlas nunca é
 * repassado. Só sai daqui o que a aba mostra — nome do banco e dívidas;
 * referência, titular, tipo, judicializado, situação, data e acordo do
 * contrato; data, valores, desconto, situação e tipo da proposta. Anotação,
 * canal, remetente, link, simulação, plano de ação, garantia, abusividade,
 * número do processo, quem mudou a situação, a trilha da proposta e qualquer
 * campo novo que o Atlas passar a mandar ficam FORA (pino
 * `negociacoes.test.ts`). Número que não é número finito e data fora de
 * `AAAA-MM-DD` viram nulo — a tela mostra travessão, nunca um valor inventado.
 *
 * A saída usa os MESMOS nomes do contrato, de propósito: `lerNegociacoes` é
 * idempotente, e o navegador passa a resposta da rota pelo MESMO filtro (o
 * parse das rotas é campo a campo, nunca `as`).
 */

/**
 * Leituras por minuto — POR USUÁRIO e POR CONTA (fora de `rate-limit.ts`,
 * que é do upstream). A cota do Atlas (60/min) é do ESCRITÓRIO, dividida com
 * o n8n, a leitura periódica e o passo "Criar cliente", que não repete um
 * 429: sem o balde da conta, uma equipe abrindo a aba ao mesmo tempo
 * derrubaria o passo.
 */
export const NEGOCIACOES_POR_USUARIO = { limit: 20, windowMs: 60_000 } as const;
export const NEGOCIACOES_POR_CONTA = { limit: 20, windowMs: 60_000 } as const;

/**
 * Os valores que o Atlas usa hoje (a lista NÃO é fechada no contrato): cada
 * um tem rótulo nos dois dicionários (chave montada, cobrada por teste); o
 * desconhecido cai no texto de reserva, nunca na chave crua.
 */
export const SITUACOES_DO_CONTRATO = ["ativo", "quitado"] as const;
export const SITUACOES_DA_PROPOSTA = ["enviada", "recebida", "aceita", "recusada"] as const;
export const TIPOS_DE_PROPOSTA = ["a_vista", "parcelado"] as const;

export interface AcordoDoAtlas {
  total_debt_at_settlement: number | null;
  total_settled_amount: number | null;
  discount_pct: number | null;
}

export interface ContratoDoAtlas {
  id: string | null;
  contract_ref: string | null;
  titular: string | null;
  debt_type: string | null;
  is_judicializado: boolean | null;
  status: string | null;
  /** `AAAA-MM-DD` */
  settled_date: string | null;
  settlement: AcordoDoAtlas | null;
}

export interface PropostaDoAtlas {
  id: string | null;
  /** `AAAA-MM-DD` */
  date: string | null;
  proposed_amount: number | null;
  base_debt: number | null;
  /** Pode ser NEGATIVO (proposta parcelada acima da dívida); nulo sem dívida base. */
  discount_pct: number | null;
  status: string | null;
  proposal_type: string | null;
}

export interface BancoDoAtlas {
  id: string | null;
  bank_name: string | null;
  original_debt: number | null;
  updated_debt: number | null;
  contracts: ContratoDoAtlas[];
  proposals: PropostaDoAtlas[];
}

export interface NegociacoesDoAtlas {
  /** Algum teto do Atlas (1.000/1.000/100) foi atingido: a lista veio cortada. */
  truncated: boolean;
  /** Os totais REAIS (valem quando `truncated`). */
  totals: { banks: number | null; contracts: number | null; proposals: number | null };
  banks: BancoDoAtlas[];
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function contagem(v: unknown): number | null {
  const n = numero(v);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

function booleano(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

function dia(v: unknown): string | null {
  return typeof v === "string" && RE_DIA.test(v) ? v : null;
}

function acordo(v: unknown): AcordoDoAtlas | null {
  if (!ehObjeto(v)) return null;
  return {
    total_debt_at_settlement: numero(v.total_debt_at_settlement),
    total_settled_amount: numero(v.total_settled_amount),
    discount_pct: numero(v.discount_pct),
  };
}

function contrato(v: unknown): ContratoDoAtlas | null {
  if (!ehObjeto(v)) return null;
  return {
    id: texto(v.id),
    contract_ref: texto(v.contract_ref),
    titular: texto(v.titular),
    debt_type: texto(v.debt_type),
    is_judicializado: booleano(v.is_judicializado),
    status: texto(v.status),
    settled_date: dia(v.settled_date),
    settlement: acordo(v.settlement),
  };
}

function proposta(v: unknown): PropostaDoAtlas | null {
  if (!ehObjeto(v)) return null;
  return {
    id: texto(v.id),
    date: dia(v.date),
    proposed_amount: numero(v.proposed_amount),
    base_debt: numero(v.base_debt),
    discount_pct: numero(v.discount_pct),
    status: texto(v.status),
    proposal_type: texto(v.proposal_type),
  };
}

/** Uma lista de itens; ausente = vazia, mas item ILEGÍVEL derruba tudo (null). */
function lista<T>(v: unknown, ler: (x: unknown) => T | null): T[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const itens = v.map(ler);
  return itens.some((i) => i === null) ? null : (itens as T[]);
}

function banco(v: unknown): BancoDoAtlas | null {
  if (!ehObjeto(v)) return null;
  const contracts = lista(v.contracts, contrato);
  const proposals = lista(v.proposals, proposta);
  if (!contracts || !proposals) return null;
  return {
    id: texto(v.id),
    bank_name: texto(v.bank_name),
    original_debt: numero(v.original_debt),
    updated_debt: numero(v.updated_debt),
    contracts,
    proposals,
  };
}

/**
 * A resposta do `get_client_negotiations` (ou a da nossa rota) → só o que a
 * aba mostra. `null` = ilegível: sem a lista de bancos, ou com um banco,
 * contrato ou proposta que não é objeto. ⚠️ Descartar o item ilegível
 * esconderia uma dívida ou um acordo sem aviso — a tela diria menos do que o
 * Atlas tem; melhor dizer que não conseguiu ler.
 */
export function lerNegociacoes(corpo: unknown): NegociacoesDoAtlas | null {
  if (!ehObjeto(corpo) || !Array.isArray(corpo.banks)) return null;
  const banks = lista(corpo.banks, banco);
  if (!banks) return null;
  const totais = ehObjeto(corpo.totals) ? corpo.totals : {};
  return {
    truncated: corpo.truncated === true,
    totals: { banks: contagem(totais.banks), contracts: contagem(totais.contracts), proposals: contagem(totais.proposals) },
    banks,
  };
}

/** Quantos de cada, para o LOG (que nunca leva valor nem nome de banco). */
export function contarNegociacoes(n: NegociacoesDoAtlas): { bancos: number; contratos: number; propostas: number } {
  return {
    bancos: n.banks.length,
    contratos: n.banks.reduce((s, b) => s + b.contracts.length, 0),
    propostas: n.banks.reduce((s, b) => s + b.proposals.length, 0),
  };
}

// ------------------------------------------------------------
// A resposta da ROTA, lida no navegador
// ------------------------------------------------------------

/**
 * Os códigos que a rota `GET /api/cb/atlas/contato/[contactId]/negociacoes`
 * devolve — cada um é um estado da tela (`Inbox.atlasNegociacoes.erro.<c>`,
 * chave montada cobrada por teste). `falhou` é o resto (500, rede, resposta
 * ilegível): "não consegui ler", nunca "sem negociação".
 */
export const ERROS_DAS_NEGOCIACOES = [
  "sem_permissao",
  "sem_permissao_consultar",
  "nao_encontrado",
  "sem_vinculo",
  "conexao",
  "falhou",
] as const;
export type ErroDasNegociacoes = (typeof ERROS_DAS_NEGOCIACOES)[number];

/**
 * Um 429 e QUEM o deu: `atlas` (a cota do escritório no Atlas — a rota
 * repassa como `{ error: 'limite', retryAfter }`) ou `crm` (os baldes da
 * própria rota, `rateLimitResponse`, sem chamada nenhuma ao Atlas). A frase
 * difere: dizer "o Atlas pediu" no balde do CRM mandaria a equipe procurar
 * a causa no n8n e no passo "Criar cliente".
 */
export interface EsperaPedida {
  segundos: number;
  origem: "atlas" | "crm";
}

export type ResultadoDasNegociacoes =
  | { tipo: "ok"; negociacoes: NegociacoesDoAtlas }
  | { tipo: "limite"; espera: EsperaPedida }
  | { tipo: "erro"; erro: ErroDasNegociacoes };

/** A espera pedida num 429, em segundos (1 a 300); sem número legível, 60. */
export function segundosDeEspera(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.min(300, Math.ceil(n)) : 60;
}

/**
 * Puro: o status e o corpo da nossa rota → o estado da tela. O 429 vem do
 * Atlas (`{ error: 'limite', retryAfter }`, só a rota escreve `limite`) ou
 * dos baldes da própria rota (`retry_after_seconds`, o formato do
 * `rateLimitResponse`): a espera é a mesma, a ORIGEM não (`EsperaPedida`).
 */
export function resultadoDaResposta(status: number, corpo: unknown): ResultadoDasNegociacoes {
  const c = ehObjeto(corpo) ? corpo : {};
  if (status === 200) {
    const negociacoes = lerNegociacoes(corpo);
    return negociacoes ? { tipo: "ok", negociacoes } : { tipo: "erro", erro: "falhou" };
  }
  if (status === 429) {
    return c.error === "limite"
      ? { tipo: "limite", espera: { segundos: segundosDeEspera(c.retryAfter), origem: "atlas" } }
      : { tipo: "limite", espera: { segundos: segundosDeEspera(c.retry_after_seconds), origem: "crm" } };
  }
  switch (c.error) {
    case "sem_permissao":
      return { tipo: "erro", erro: c.permissao === "read_client" ? "sem_permissao_consultar" : "sem_permissao" };
    case "nao_encontrado":
    case "sem_vinculo":
      return { tipo: "erro", erro: c.error };
    case "nao_conectado":
    case "chave_invalida":
    case "api_fora_do_plano":
    case "chave_ilegivel":
      return { tipo: "erro", erro: "conexao" };
    default:
      return { tipo: "erro", erro: "falhou" };
  }
}
