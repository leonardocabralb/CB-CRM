/**
 * Leitura do que o ZapSign manda — o AVISO do webhook e o DOCUMENTO relido
 * com a nossa chave. Puro, e PARSE campo a campo (nunca `as`): o corpo é de
 * fora, e um campo que mudou de forma vira `null`, não `undefined` no motor.
 *
 * ⚠️⚠️ O corpo do webhook é AVISO, não dado (a regra do Asaas, D8). Dele o
 * CRM lê: qual documento (`token`), qual evento, quem assinou nesta entrega
 * (só para a idempotência e o log) e as RESPOSTAS do formulário do modelo
 * (`answers`). O que DECIDE — está completo? quem são os signatários? qual o
 * negócio (`external_id`)? — sai do documento RELIDO (`GET /docs/{token}/`).
 *
 * As respostas são a exceção, e só como queda: a doc do "detalhar documento"
 * não mostra `answers`, e elas só alimentam variáveis de mensagem (nunca o
 * casamento). O corpo que as traz chegou autenticado pelo cabeçalho que o
 * CRM gerou (`webhook_secret`).
 */

export const EVENTO_ASSINADO = "doc_signed";

/** O token do documento vai no caminho da releitura: só a forma de um uuid-ish. */
export const RE_DOC_TOKEN = /^[A-Za-z0-9-]{8,80}$/;

/** Teto de respostas e de tamanho por valor: o log não é lugar para um anexo. */
export const MAX_RESPOSTAS = 60;
export const MAX_TAMANHO_DA_RESPOSTA = 500;

export interface RespostaDoFormulario {
  variavel: string;
  valor: string;
}

export interface AvisoDoZapSign {
  eventType: string;
  docToken: string;
  /** `signer_who_signed.token`, ou '' quando não veio (a chave do UNIQUE é NOT NULL). */
  signerToken: string;
  signatarioNome: string | null;
  documentoNome: string | null;
  respostas: RespostaDoFormulario[];
}

export interface SignatarioDoZapSign {
  token: string;
  /** `new`, `link-opened`, `signed`… */
  status: string | null;
  nome: string;
  email: string | null;
  /** Como veio: `+<phone_country><phone_number>`, ou só o número sem o país. Nulo = sem telefone. */
  telefone: string | null;
  /** 11 dígitos, ou nulo. O CPF nunca vai para variável nem para o log. */
  cpf: string | null;
  assinadoEm: string | null;
}

export interface DocumentoDoZapSign {
  token: string;
  nome: string | null;
  /** `pending` | `signed` (o documento só está COMPLETO em `signed`). */
  status: string | null;
  externalId: string | null;
  apagado: boolean;
  signatarios: SignatarioDoZapSign[];
  /** `null` = o campo nem veio (a queda é a resposta do aviso). */
  respostas: RespostaDoFormulario[] | null;
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const aparado = v.trim();
  return aparado === "" ? null : aparado;
}

/** As respostas do formulário do modelo (`answers[]`): `variable` + `value`, com teto. */
export function lerRespostas(v: unknown): RespostaDoFormulario[] {
  if (!Array.isArray(v)) return [];
  const saida: RespostaDoFormulario[] = [];
  for (const r of v) {
    if (saida.length >= MAX_RESPOSTAS) break;
    if (!ehObjeto(r)) continue;
    const variavel = texto(r.variable);
    const valor = typeof r.value === "string" || typeof r.value === "number" ? String(r.value).trim() : "";
    if (!variavel || valor === "") continue;
    saida.push({ variavel, valor: valor.slice(0, MAX_TAMANHO_DA_RESPOSTA) });
  }
  return saida;
}

/** O aviso do webhook, ou `null` quando não traz evento e documento reconhecíveis. */
export function lerAviso(corpo: unknown): AvisoDoZapSign | null {
  if (!ehObjeto(corpo)) return null;
  const eventType = texto(corpo.event_type);
  const docToken = texto(corpo.token);
  if (!eventType || !docToken || !RE_DOC_TOKEN.test(docToken)) return null;
  const quem = ehObjeto(corpo.signer_who_signed) ? corpo.signer_who_signed : null;
  return {
    eventType,
    docToken,
    signerToken: (quem && texto(quem.token)?.slice(0, 80)) ?? "",
    signatarioNome: quem ? (texto(quem.name)?.slice(0, 200) ?? null) : null,
    documentoNome: texto(corpo.name)?.slice(0, 300) ?? null,
    respostas: lerRespostas(corpo.answers),
  };
}

/** `phone_country` + `phone_number` → o texto que `telefoneDigitado` lê. */
export function telefoneDoSignatario(pais: unknown, numero: unknown): string | null {
  const n = typeof numero === "string" || typeof numero === "number" ? String(numero).trim() : "";
  if (!n) return null;
  const p = typeof pais === "string" || typeof pais === "number" ? String(pais).replace(/\D/g, "") : "";
  // Sem país, o número vai como veio: o brasileiro sem DDI ganha o 55 na régua.
  return p ? `+${p}${n}` : n;
}

/** CPF só com 11 dígitos e que não seja uma repetição ("00000000000"). */
export function cpfDoSignatario(v: unknown): string | null {
  const d = typeof v === "string" || typeof v === "number" ? String(v).replace(/\D/g, "") : "";
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  return d;
}

function lerSignatario(s: unknown): SignatarioDoZapSign | null {
  if (!ehObjeto(s)) return null;
  const token = texto(s.token);
  if (!token) return null;
  const email = texto(s.email)?.toLowerCase() ?? null;
  return {
    token,
    status: texto(s.status),
    nome: texto(s.name) ?? "",
    email: email && email.includes("@") ? email : null,
    telefone: telefoneDoSignatario(s.phone_country, s.phone_number),
    cpf: cpfDoSignatario(s.cpf),
    assinadoEm: texto(s.signed_at),
  };
}

/** O documento relido (`GET /docs/{token}/`), ou `null` quando não tem a forma de um. */
export function lerDocumento(corpo: unknown): DocumentoDoZapSign | null {
  if (!ehObjeto(corpo)) return null;
  const token = texto(corpo.token);
  if (!token) return null;
  return {
    token,
    nome: texto(corpo.name),
    status: texto(corpo.status),
    externalId: texto(corpo.external_id),
    apagado: corpo.deleted === true,
    signatarios: Array.isArray(corpo.signers)
      ? corpo.signers.map(lerSignatario).filter((s): s is SignatarioDoZapSign => s !== null)
      : [],
    respostas: Array.isArray(corpo.answers) ? lerRespostas(corpo.answers) : null,
  };
}

/** Todos assinaram? Só o `status` do DOCUMENTO responde — `doc_signed` chega a cada signatário. */
export function documentoCompleto(d: Pick<DocumentoDoZapSign, "status">): boolean {
  return d.status === "signed";
}

/** O instante da ÚLTIMA assinatura (a que completou o documento), ou `null`. */
export function assinadoEm(d: Pick<DocumentoDoZapSign, "signatarios">): string | null {
  let ultimo: { iso: string; ms: number } | null = null;
  for (const s of d.signatarios) {
    if (!s.assinadoEm) continue;
    const ms = Date.parse(s.assinadoEm);
    if (Number.isNaN(ms)) continue;
    if (!ultimo || ms > ultimo.ms) ultimo = { iso: s.assinadoEm, ms };
  }
  return ultimo?.iso ?? null;
}

/** Quantos já assinaram, para o detalhe do `incompleto` ("1 de 2"). */
export function contagemDeAssinaturas(d: Pick<DocumentoDoZapSign, "signatarios">): { assinaram: number; total: number } {
  return {
    assinaram: d.signatarios.filter((s) => s.status === "signed").length,
    total: d.signatarios.length,
  };
}
