import { telefoneCanonico, telefoneDigitado } from "@/lib/contacts/telefone";

import type { SignatarioDoZapSign } from "./leitura";

/**
 * QUEM é o cliente deste documento — a parte PURA do casamento.
 *
 * Decisão do operador (27/09/2026): o contrato nasce de dois jeitos, e os
 * dois têm de mover o card.
 *   1. O CRM gera o contrato pela API (o passo "Gerar contrato", futuro) com
 *      `external_id` = o id do NEGÓCIO: casamento EXATO. O mesmo vale para o
 *      documento que o CRM registrou em `cb_zapsign_documentos` com o negócio.
 *   2. O documento assinado pelo link PÚBLICO do modelo (o robô não tinha os
 *      dados completos, ou o funcionário mandou o link): não há `external_id`,
 *      e o cliente é achado pelos SIGNATÁRIOS, em cascata — telefone, depois
 *      e-mail, depois CPF (só na conta que tem o campo `cpf`).
 *
 * ⚠️⚠️ AMBÍGUO É "NÃO SEI": dois contatos diferentes casando no mesmo nível
 * (o cliente e o advogado do escritório assinando o mesmo contrato, os dois
 * com ficha) não vira escolha — vira `sem_contato` com o motivo, e o
 * operador decide. Mover o card errado (e mandar a mensagem de boas-vindas
 * ao cliente errado) é pior que não mover. E o nível ambíguo PARA a cascata:
 * descer para o e-mail escolheria um dos dois por um critério mais fraco.
 *
 * ⚠️ NUNCA cria contato: assinatura não é lead. Sem casamento, `sem_contato`.
 *
 * ⚠️ O telefone de uma CONEXÃO da própria conta não casa (a cerca do Asaas):
 * o escritório pode assinar com o número dele, e a outra conexão o grava
 * como cliente — o contrato cairia na ficha do próprio escritório.
 */

export type Nivel = "telefone" | "email" | "cpf";

/** A ordem da cascata. */
export const NIVEIS: readonly Nivel[] = ["telefone", "email", "cpf"];

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Puro: o `external_id` tem a forma do id de um negócio? (Só a forma — a conta confere no banco.) */
export function ehUuid(v: string | null | undefined): v is string {
  return typeof v === "string" && RE_UUID.test(v.trim());
}

export interface ChavesDoSignatario {
  token: string;
  /** A grafia CANÔNICA (`telefoneCanonico`, a chave única de `contacts`), ou nulo. */
  telefone: string | null;
  email: string | null;
  cpf: string | null;
}

/**
 * Puro: o que cada signatário oferece para casar. O telefone passa pela régua
 * das TELAS (`telefoneDigitado`: o cliente digitou no formulário do ZapSign)
 * e vira a grafia canônica — as duas grafias do nono dígito são a mesma
 * pessoa, e é essa chave que o índice único de `contacts` usa (1024).
 */
export function chavesDosSignatarios(
  signatarios: readonly SignatarioDoZapSign[],
  telefonesDasConexoes: Iterable<string>,
): ChavesDoSignatario[] {
  const conexoes = new Set<string>();
  for (const t of telefonesDasConexoes) {
    const c = telefoneCanonico(t);
    if (c) conexoes.add(c);
  }
  return signatarios.map((s) => {
    const lido = s.telefone ? telefoneDigitado(s.telefone) : null;
    const canonico = lido?.ok ? telefoneCanonico(lido.digitos) : null;
    return {
      token: s.token,
      telefone: canonico && !conexoes.has(canonico) ? canonico : null,
      email: s.email,
      cpf: s.cpf,
    };
  });
}

/** Um contato achado num nível, e por qual signatário. */
export interface Achado {
  contactId: string;
  signatarioToken: string;
}

export type DecisaoDoNivel =
  | { tipo: "casado"; contactId: string; signatarioToken: string }
  | { tipo: "ambiguo"; contatos: number }
  | { tipo: "nenhum" };

/**
 * Puro: o que um nível da cascata decide. Um contato só (achado por um ou
 * por vários signatários) = casado; dois ou mais contatos DIFERENTES =
 * ambíguo; nada = segue para o nível seguinte.
 */
export function decidirNivel(achados: readonly Achado[]): DecisaoDoNivel {
  const contatos = new Map<string, string>();
  for (const a of achados) {
    if (!contatos.has(a.contactId)) contatos.set(a.contactId, a.signatarioToken);
  }
  if (contatos.size === 0) return { tipo: "nenhum" };
  if (contatos.size > 1) return { tipo: "ambiguo", contatos: contatos.size };
  const [[contactId, signatarioToken]] = [...contatos];
  return { tipo: "casado", contactId, signatarioToken };
}

/** O motivo do `sem_contato`, na frase que o log mostra (o log do cartão é do operador). */
export function motivoSemContato(
  tentados: readonly Nivel[],
  ambiguo: { por: Nivel; contatos: number } | null,
): string {
  if (ambiguo) {
    return `${ambiguo.contatos} contatos diferentes casam pelo ${ROTULO_DO_NIVEL[ambiguo.por]} dos signatários — ninguém foi escolhido; ajuste as fichas e processe de novo`;
  }
  if (tentados.length === 0) {
    return "os signatários não trouxeram telefone, e-mail nem CPF que o CRM saiba usar — nenhum contato foi criado";
  }
  return `nenhum contato casa pelo ${tentados.map((n) => ROTULO_DO_NIVEL[n]).join(", ")} dos signatários — nenhum contato foi criado; ajuste a ficha e processe de novo`;
}

const ROTULO_DO_NIVEL: Record<Nivel, string> = { telefone: "telefone", email: "e-mail", cpf: "CPF" };
