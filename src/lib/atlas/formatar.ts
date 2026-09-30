/**
 * Puro: os dados do cliente no formato que o Atlas recebe, IGUAIS aos que o
 * n8n do escritório mandava ao `create_client` (nó "Formatar dados" do fluxo
 * de 23/09/2026), para o passo nativo "Criar cliente no Atlas" poder
 * substituí-lo sem o Atlas notar diferença:
 *
 * - telefone com DDI e com o nono dígito (`telefoneCanonico`, a mesma régua);
 * - estado pela sigla do DDD — SÓ de número brasileiro (55 + 12 ou 13
 *   dígitos). O n8n tirava os 2 primeiros dígitos de QUALQUER número e dava
 *   "SP" a um telefone dos EUA; aqui, fora do Brasil, vai nulo;
 * - datas `aaaa-mm-dd` no fuso do escritório (nunca `toISOString().slice`,
 *   que erra das 21h à meia-noite); primeiro contato cai na criação do card,
 *   fechamento cai em "agora", proposta não tem reserva;
 * - valor do card em número (0 sem card), contrato "fixo" por padrão;
 * - vazio vai `null`, nunca `''`.
 */

import { FUSO_PADRAO, diaNoFuso } from "@/lib/agenda/fuso";
import { telefoneCanonico } from "@/lib/contacts/telefone";

import type { DadosDoClienteNoAtlas } from "./cliente";

/** DDD → UF (os 67 DDDs em uso). */
const UF_DO_DDD: Record<string, string> = {};
for (const [uf, ddds] of Object.entries({
  SP: [11, 12, 13, 14, 15, 16, 17, 18, 19],
  RJ: [21, 22, 24],
  ES: [27, 28],
  MG: [31, 32, 33, 34, 35, 37, 38],
  PR: [41, 42, 43, 44, 45, 46],
  SC: [47, 48, 49],
  RS: [51, 53, 54, 55],
  DF: [61],
  GO: [62, 64],
  TO: [63],
  MT: [65, 66],
  MS: [67],
  AC: [68],
  RO: [69],
  BA: [71, 73, 74, 75, 77],
  SE: [79],
  PE: [81, 87],
  AL: [82],
  PB: [83],
  RN: [84],
  CE: [85, 88],
  PI: [86, 89],
  PA: [91, 93, 94],
  AM: [92, 97],
  RR: [95],
  AP: [96],
  MA: [98, 99],
})) {
  for (const ddd of ddds) UF_DO_DDD[String(ddd)] = uf;
}

export const TIPOS_DE_CONTRATO = ["fixo", "mensal"] as const;
export type TipoDeContrato = (typeof TIPOS_DE_CONTRATO)[number];

/** O telefone como o Atlas recebe: só dígitos, com DDI e o nono dígito. */
export function telefoneParaAtlas(telefone: string | null | undefined): string | null {
  const t = telefoneCanonico(telefone);
  return t === "" ? null : t;
}

/** A sigla do estado pelo DDD — só de número brasileiro; senão, `null`. */
export function ufDoTelefone(telefone: string | null | undefined): string | null {
  const t = telefoneCanonico(telefone);
  if (!/^55\d{10,11}$/.test(t)) return null;
  return UF_DO_DDD[t.slice(2, 4)] ?? null;
}

/** `aaaa-mm-dd` no fuso do escritório; texto que não é instante → `null`. */
export function diaParaAtlas(iso: string | null | undefined, fuso: string = FUSO_PADRAO): string | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return null;
  return diaNoFuso(instante, fuso);
}

function textoOuNulo(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

export interface EntradaDoCliente {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  /** O valor do card (0 sem card, como o n8n). */
  valor: number | null;
  /** Quando o card nasceu — a reserva do primeiro contato. */
  cardCriadoEm: string | null;
  /** Os campos de data escolhidos no passo, CRUS (ISO). */
  primeiroContato: string | null;
  proposta: string | null;
  fechamento: string | null;
  /** O link da conversa no CRM (`/inbox?c=…`), ou nulo sem conversa. */
  linkDaConversa: string | null;
  tipoDeContrato: TipoDeContrato;
  /** O instante da execução (fechamento sem campo, e a nota). */
  agora: Date;
  /** O nome do CRM na nota ("Enviado pelo <app> em …"): de `marca.ts`, nunca literal. */
  nomeDoApp: string;
}

/** O que o `create_client` recebe (e, sem a nota e o nome, a reativação). */
export function dadosParaCriar(e: EntradaDoCliente): DadosDoClienteNoAtlas {
  return {
    name: textoOuNulo(e.nome),
    email: textoOuNulo(e.email),
    phone: telefoneParaAtlas(e.telefone),
    state: ufDoTelefone(e.telefone),
    contractType: e.tipoDeContrato,
    contractValue: typeof e.valor === "number" && Number.isFinite(e.valor) ? e.valor : 0,
    firstContactDate: diaParaAtlas(e.primeiroContato) ?? diaParaAtlas(e.cardCriadoEm),
    proposalDate: diaParaAtlas(e.proposta),
    closingDate: diaParaAtlas(e.fechamento) ?? diaNoFuso(e.agora, FUSO_PADRAO),
    chatLink: textoOuNulo(e.linkDaConversa),
    notes: `Enviado pelo ${e.nomeDoApp} em ${e.agora.toISOString()}`,
  };
}

/**
 * A REATIVAÇÃO (D3): o cadastro que já existe volta a `ativo` com os dados do
 * novo fechamento — sem mexer no nome, no telefone, no e-mail nem na nota que
 * a equipe já cuidou no Atlas.
 */
export function dadosParaReativar(e: EntradaDoCliente): DadosDoClienteNoAtlas {
  const novo = dadosParaCriar(e);
  return {
    status: "ativo",
    contractType: novo.contractType,
    contractValue: novo.contractValue,
    closingDate: novo.closingDate,
    ...(novo.proposalDate ? { proposalDate: novo.proposalDate } : {}),
    ...(novo.chatLink ? { chatLink: novo.chatLink } : {}),
  };
}
