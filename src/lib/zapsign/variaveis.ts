import { FUSO_DO_ESCRITORIO, formatarParaMensagem } from "@/lib/contacts/campo-data";
import { formatarTelefone, telefoneDigitado } from "@/lib/contacts/telefone";
import { nomeDeVariavel } from "@/lib/webhooks-de-entrada/achatar";

import type { DocumentoDoZapSign, RespostaDoFormulario, SignatarioDoZapSign } from "./leitura";

/**
 * As variáveis que a assinatura entrega ao motor, em `context.vars` — o
 * `{{vars.zapsign_*}}` que o operador escreve na mensagem e nos campos.
 *
 * ⚠️⚠️ NENHUM número de documento pessoal vira variável: o CPF do signatário
 * nunca entra, e a resposta do formulário cujo rótulo fala de documento
 * (CPF, RG, CNPJ, CNH…) ou cujo valor tem a forma de CPF/CNPJ fica de fora
 * (`pareceDocumentoPessoal`). As variáveis são gravadas no log
 * (`cb_zapsign_eventos.variaveis`) e podem ir para mensagem, campo e webhook
 * de saída — um CPF ali se espalha para onde ninguém decidiu mandar.
 *
 * `zapsign_assinado_em` sai de `formatarParaMensagem`, a MESMA função do aviso
 * do Calendly e do lembrete: um formato só para data em mensagem.
 */

export const PREFIXO_DA_RESPOSTA = "zapsign_resposta_";

/** Os nomes fixos, para a dica do editor de automações (ordem = ordem da lista). */
export const VARIAVEIS_DO_DOCUMENTO = [
  "zapsign_documento_nome",
  "zapsign_signatario_nome",
  "zapsign_signatario_telefone",
  "zapsign_signatario_email",
  "zapsign_assinado_em",
  "zapsign_documento_token",
] as const;

const ROTULO_DE_DOCUMENTO =
  /(^|_)(cpf|cnpj|rg|identidade|documento|doc|passaporte|cnh|pis|pasep|nit|ctps|titulo_de_eleitor|titulo_eleitor|registro_geral|orgao_emissor|inscricao)(_|$)/;
const ROTULO_DE_TELEFONE = /(^|_)(telefone|celular|whatsapp|fone|tel)(_|$)/;
const FORMA_DE_CPF = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;
const FORMA_DE_CNPJ = /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/;

/** O rótulo da resposta como pedaço de nome de variável: minúsculas, sem acento, `_`. */
export function slugDaResposta(variavel: string): string {
  return nomeDeVariavel(variavel).toLowerCase().slice(0, 60).replace(/_+$/, "");
}

/**
 * Puro: esta resposta é um número de documento pessoal? Pelo RÓTULO (CPF,
 * RG, CNPJ…) ou pelo VALOR com a forma de CPF/CNPJ — menos quando o rótulo
 * diz que é telefone (um celular de 11 dígitos sem pontuação tem a forma de
 * CPF).
 */
export function pareceDocumentoPessoal(variavel: string, valor: string): boolean {
  const slug = slugDaResposta(variavel);
  if (ROTULO_DE_DOCUMENTO.test(slug)) return true;
  if (ROTULO_DE_TELEFONE.test(slug)) return false;
  const v = valor.trim();
  return FORMA_DE_CPF.test(v) || FORMA_DE_CNPJ.test(v);
}

/** As respostas do formulário como `zapsign_resposta_<slug>`, sem documento pessoal. */
export function variaveisDasRespostas(respostas: readonly RespostaDoFormulario[]): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const r of respostas) {
    if (pareceDocumentoPessoal(r.variavel, r.valor)) continue;
    const slug = slugDaResposta(r.variavel);
    if (!slug) continue;
    const chave = `${PREFIXO_DA_RESPOSTA}${slug}`;
    // A primeira vence: duas perguntas com o mesmo rótulo não se sobrescrevem.
    if (!(chave in saida)) saida[chave] = r.valor;
  }
  return saida;
}

/** As respostas já guardadas no log (o reprocessamento as reusa quando o documento relido não as traz). */
export function respostasGuardadas(variaveis: unknown): Record<string, string> {
  const saida: Record<string, string> = {};
  if (!variaveis || typeof variaveis !== "object" || Array.isArray(variaveis)) return saida;
  for (const [k, v] of Object.entries(variaveis as Record<string, unknown>)) {
    if (k.startsWith(PREFIXO_DA_RESPOSTA) && typeof v === "string") saida[k] = v;
  }
  return saida;
}

function telefoneLegivel(s: SignatarioDoZapSign | null): string {
  if (!s?.telefone) return "";
  const lido = telefoneDigitado(s.telefone);
  return lido.ok ? formatarTelefone(lido.digitos) : s.telefone;
}

export function variaveisDoDocumento(
  doc: Pick<DocumentoDoZapSign, "token" | "nome">,
  signatario: SignatarioDoZapSign | null,
  assinadoEmIso: string | null,
  respostas: Record<string, string>,
  fuso: string = FUSO_DO_ESCRITORIO,
): Record<string, string> {
  return {
    ...respostas,
    zapsign_documento_nome: doc.nome ?? "",
    zapsign_documento_token: doc.token,
    zapsign_assinado_em: formatarParaMensagem(assinadoEmIso, fuso),
    zapsign_signatario_nome: signatario?.nome ?? "",
    zapsign_signatario_email: signatario?.email ?? "",
    zapsign_signatario_telefone: telefoneLegivel(signatario),
  };
}
