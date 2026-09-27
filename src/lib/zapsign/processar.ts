import type { SupabaseClient } from "@supabase/supabase-js";

import { dispararAutomacoes } from "@/lib/automations/engine";
import { decrypt } from "@/lib/whatsapp/encryption";
import type { DealStatus } from "@/types";

import { acharNoNivel, campoDeCpf, conversaDoContato, negocioDaConta, negocioRegistrado, telefonesDasConexoes } from "./buscar";
import { chavesDosSignatarios, decidirNivel, ehUuid, motivoSemContato, NIVEIS, type Nivel } from "./casamento";
import { criarClienteZapSign, ZapSignError, type ClienteZapSign } from "./cliente";
import {
  assinadoEm,
  contagemDeAssinaturas,
  documentoCompleto,
  lerDocumento,
  type DocumentoDoZapSign,
  type SignatarioDoZapSign,
} from "./leitura";
import type { ResultadoParaGravar } from "./claim";
import type { CasadoPor } from "./log";
import { variaveisDasRespostas, variaveisDoDocumento } from "./variaveis";

/**
 * Da assinatura gravada ao motor de automações.
 *
 * Roda em `after()`, DEPOIS de a rota responder 200 ao ZapSign (ele repete a
 * entrega que não recebe 200). Cada saída vira um `resultado` na linha do
 * evento — é o que o cartão da integração mostra, e é assim que "o cliente
 * assinou e o card não andou" tem resposta.
 *
 * ⚠️⚠️ O corpo do webhook é AVISO: o documento é RELIDO com a nossa chave
 * (`GET /docs/{token}/`), e só o que voltou dali decide. Com o documento
 * ainda `pending` (falta alguém assinar) o resultado é `incompleto` — não é
 * erro: a assinatura seguinte chega como outra entrega e completa.
 *
 * ⚠️⚠️ NUNCA cria contato. Sem casamento, `sem_contato` com o motivo: o
 * operador arruma a ficha (telefone, e-mail, CPF) e clica em "Processar de
 * novo". Assinatura não é lead.
 *
 * ⚠️ Toda falha ANTES do disparo grava `recebido` (reprocessável), com o
 * motivo: nada da automação rodou, repetir é seguro. `falhou` fica para o
 * que pode ter rodado.
 *
 * ⚠️⚠️ O DISPARO tem cadeado próprio (`cb_zapsign_documentos.
 * disparo_evento_id`): o ZapSign manda `doc_signed` a CADA signatário, e duas
 * entregas quase simultâneas releem o MESMO documento já completo. Só a que
 * escreve o cadeado dispara; a outra termina `ignorado`. Quando nenhuma
 * automação chega a rodar (escopo barrou tudo), o cadeado é devolvido.
 */

export const GATILHO = "zapsign_documento_assinado" as const;

export interface EntradaDoProcessamento {
  /** A linha em `cb_zapsign_eventos` — é ela que reivindica o disparo. */
  eventoId: string;
  docToken: string;
  /** Quem assinou nesta entrega ('' quando o aviso não trouxe). */
  signerToken: string;
  /**
   * As respostas do formulário como VARIÁVEIS, para quando o documento relido
   * não as traz: as do aviso (webhook) ou as já guardadas no log (reprocessar).
   */
  respostasDeQueda: Record<string, string>;
}

export interface OpcoesDoProcessamento {
  /** Fábrica do cliente (os testes passam um falso). */
  cliente?: (token: string) => ClienteZapSign;
}

type FabricaDeCliente = (token: string) => ClienteZapSign;

/** Puro: o que gravar a partir do que o motor DISSE que fez (a régua do Calendly). */
export function resultadoDoDisparo(r: {
  executadas: number;
  foraDoEscopo: number;
  comFalha: number;
  emEspera: number;
  erro?: string;
}): Pick<ResultadoParaGravar, "resultado" | "detalhe"> {
  if (r.erro) return { resultado: "falhou", detalhe: `o disparo não aconteceu: ${r.erro}` };
  if (r.executadas === 0) {
    return {
      resultado: "sem_automacao",
      detalhe:
        r.foraDoEscopo > 0
          ? "a automação existe, mas está fora do escopo (conexão ou etapa) para este contato"
          : "nenhuma automação ativa escuta a assinatura de documento",
    };
  }
  if (r.comFalha > 0) {
    return { resultado: "falhou", detalhe: `${r.comFalha} de ${r.executadas} automação(ões) terminou com erro — veja o histórico da automação` };
  }
  if (r.emEspera > 0) {
    return {
      resultado: "em_espera",
      detalhe: `${r.emEspera} de ${r.executadas} automação(ões) parou num passo "Aguardar" — o restante sai pelo agendador; esta linha não é atualizada depois`,
    };
  }
  return { resultado: "disparado", detalhe: `${r.executadas} automação(ões) executada(s)` };
}

/** O cliente casado: o contato, o negócio (só no casamento EXATO) e por onde. */
export interface Casamento {
  contactId: string;
  negocio: { id: string; status: DealStatus | null } | null;
  por: CasadoPor;
  /** O signatário que casou (na cascata) — é dele que saem as variáveis. */
  signatarioToken: string | null;
}

type ResultadoDoCasamento = { tipo: "casado"; casamento: Casamento } | { tipo: "sem_contato"; motivo: string } | { tipo: "erro"; motivo: string };

/**
 * Quem é o cliente: o negócio do `external_id` → o negócio que o CRM
 * registrou para o documento → a cascata pelos signatários. Ver
 * `casamento.ts` (a parte pura, e a decisão do operador).
 */
async function casar(admin: SupabaseClient, accountId: string, doc: DocumentoDoZapSign): Promise<ResultadoDoCasamento> {
  const exatos: { por: CasadoPor; dealId: () => Promise<{ ok: true; valor: string | null } | { ok: false; erro: string }> }[] = [
    { por: "external_id", dealId: async () => ({ ok: true, valor: ehUuid(doc.externalId) ? doc.externalId.trim() : null }) },
    { por: "documento", dealId: () => negocioRegistrado(admin, accountId, doc.token) },
  ];
  for (const exato of exatos) {
    const id = await exato.dealId();
    if (!id.ok) return { tipo: "erro", motivo: id.erro };
    if (!id.valor) continue;
    const negocio = await negocioDaConta(admin, accountId, id.valor);
    if (!negocio.ok) return { tipo: "erro", motivo: negocio.erro };
    // Id com forma de negócio que não é DESTA conta (ou foi apagado): segue.
    if (!negocio.valor) continue;
    if (!negocio.valor.contactId) {
      return { tipo: "sem_contato", motivo: "o negócio deste documento não tem contato (a ficha foi apagada)" };
    }
    return {
      tipo: "casado",
      casamento: {
        contactId: negocio.valor.contactId,
        negocio: { id: negocio.valor.id, status: negocio.valor.status },
        por: exato.por,
        signatarioToken: null,
      },
    };
  }

  const conexoes = await telefonesDasConexoes(admin, accountId);
  if (!conexoes.ok) return { tipo: "erro", motivo: conexoes.erro };
  const chaves = chavesDosSignatarios(doc.signatarios, conexoes.valor);
  const tentados: Nivel[] = [];
  for (const nivel of NIVEIS) {
    if (!chaves.some((c) => c[nivel])) continue;
    let campoCpfId: string | null = null;
    if (nivel === "cpf") {
      const campo = await campoDeCpf(admin, accountId);
      if (!campo.ok) return { tipo: "erro", motivo: campo.erro };
      if (!campo.valor) continue;
      campoCpfId = campo.valor;
    }
    tentados.push(nivel);
    const achados = await acharNoNivel(admin, accountId, nivel, chaves, campoCpfId);
    if (!achados.ok) return { tipo: "erro", motivo: achados.erro };
    const decisao = decidirNivel(achados.valor);
    if (decisao.tipo === "ambiguo") {
      return { tipo: "sem_contato", motivo: motivoSemContato(tentados, { por: nivel, contatos: decisao.contatos }) };
    }
    if (decisao.tipo === "casado") {
      return {
        tipo: "casado",
        casamento: { contactId: decisao.contactId, negocio: null, por: nivel, signatarioToken: decisao.signatarioToken },
      };
    }
  }
  return { tipo: "sem_contato", motivo: motivoSemContato(tentados, null) };
}

/** Puro: de quem saem as variáveis — o que casou, senão o desta entrega, senão o primeiro. */
export function signatarioDasVariaveis(
  signatarios: readonly SignatarioDoZapSign[],
  casadoToken: string | null,
  daEntrega: string,
): SignatarioDoZapSign | null {
  return (
    (casadoToken ? signatarios.find((s) => s.token === casadoToken) : undefined) ??
    (daEntrega ? signatarios.find((s) => s.token === daEntrega) : undefined) ??
    signatarios[0] ??
    null
  );
}

/** Nada rodou: `recebido` (reprocessável), com o motivo. */
function naoRodou(detalhe: string, documentoNome: string | null = null): ResultadoParaGravar {
  return { resultado: "recebido", detalhe, contactId: null, casadoPor: null, documentoNome };
}

export async function processarAssinatura(
  admin: SupabaseClient,
  accountId: string,
  entrada: EntradaDoProcessamento,
  opcoes: OpcoesDoProcessamento = {},
): Promise<ResultadoParaGravar> {
  const fabrica: FabricaDeCliente = opcoes.cliente ?? ((t) => criarClienteZapSign(t));

  const { data: config, error: erroConfig } = await admin
    .from("cb_zapsign_config")
    .select("api_token")
    .eq("account_id", accountId)
    .maybeSingle();
  if (erroConfig) return naoRodou(`leitura da conexão falhou: ${erroConfig.message}`);
  if (!config) {
    return { resultado: "ignorado", detalhe: "o ZapSign foi desconectado — nada foi disparado", contactId: null, casadoPor: null };
  }
  let token: string;
  try {
    token = decrypt(config.api_token as string);
  } catch {
    return naoRodou("o token do ZapSign guardado está ilegível — conecte de novo");
  }

  // ⚠️⚠️ A RELEITURA: só o que o ZapSign responde à NOSSA chave decide.
  let bruto: unknown;
  try {
    bruto = await fabrica(token).documento(entrada.docToken);
  } catch (e) {
    if (e instanceof ZapSignError && e.codigo === "nao_encontrado") {
      return { resultado: "ignorado", detalhe: "o documento não existe mais no ZapSign — nada foi disparado", contactId: null, casadoPor: null };
    }
    const codigo = e instanceof ZapSignError ? e.codigo : "zapsign_error";
    console.warn(`[zapsign] releitura do documento falhou (${codigo}):`, e instanceof Error ? e.message : e);
    return naoRodou(`não foi possível reler o documento no ZapSign (${codigo}) — use "Processar de novo"`);
  }
  const doc = lerDocumento(bruto);
  if (!doc || doc.token !== entrada.docToken) return naoRodou("o ZapSign respondeu sem um documento reconhecível");
  if (doc.apagado) {
    return { resultado: "ignorado", detalhe: "o documento foi apagado no ZapSign — nada foi disparado", contactId: null, casadoPor: null, documentoNome: doc.nome };
  }
  if (!documentoCompleto(doc)) {
    const { assinaram, total } = contagemDeAssinaturas(doc);
    return {
      resultado: "incompleto",
      detalhe: `${assinaram} de ${total} signatário(s) assinaram — a automação roda quando o documento estiver completo`,
      contactId: null,
      casadoPor: null,
      documentoNome: doc.nome,
    };
  }

  const quando = assinadoEm(doc);
  const agora = new Date().toISOString();
  // Só metadados: `deal_id`/`contact_id`/`disparo_evento_id` não vão no
  // upsert — o documento que o CRM registrou com o negócio mantém o que tem.
  const { error: erroDoc } = await admin
    .from("cb_zapsign_documentos")
    .upsert(
      { account_id: accountId, doc_token: doc.token, nome: doc.nome, status: doc.status, assinado_em: quando, atualizado_em: agora },
      { onConflict: "account_id,doc_token" },
    );
  if (erroDoc) return naoRodou(`não foi possível gravar o documento: ${erroDoc.message}`, doc.nome);

  const casamento = await casar(admin, accountId, doc);
  if (casamento.tipo === "erro") return naoRodou(casamento.motivo, doc.nome);
  if (casamento.tipo === "sem_contato") {
    return { resultado: "sem_contato", detalhe: casamento.motivo, contactId: null, casadoPor: null, documentoNome: doc.nome };
  }
  const c = casamento.casamento;
  const base = { contactId: c.contactId, dealId: c.negocio?.id ?? null, casadoPor: c.por, documentoNome: doc.nome };

  const { data: escutam, error: erroAuto } = await admin
    .from("automations")
    .select("id")
    .eq("account_id", accountId)
    .eq("trigger_type", GATILHO)
    .eq("is_active", true)
    .limit(1);
  if (erroAuto) return { ...naoRodou(`leitura das automações falhou: ${erroAuto.message}`, doc.nome), ...base };
  if (!escutam || escutam.length === 0) {
    return { resultado: "sem_automacao", detalhe: "nenhuma automação ativa escuta a assinatura de documento", ...base };
  }

  // ⚠️⚠️ O cadeado do DISPARO (ver o cabeçalho): só quem o escreve dispara.
  const { data: tomado, error: erroCadeado } = await admin
    .from("cb_zapsign_documentos")
    .update({
      disparo_evento_id: entrada.eventoId,
      contact_id: c.contactId,
      ...(c.negocio ? { deal_id: c.negocio.id } : {}),
      atualizado_em: agora,
    })
    .eq("account_id", accountId)
    .eq("doc_token", doc.token)
    .is("disparo_evento_id", null)
    .select("id");
  if (erroCadeado) return { ...naoRodou(`não foi possível reservar o disparo: ${erroCadeado.message}`, doc.nome), ...base };
  if (!tomado || tomado.length === 0) {
    return {
      resultado: "ignorado",
      detalhe: "as automações deste documento já rodaram por outra assinatura — nada foi disparado de novo",
      ...base,
    };
  }

  const signatario = signatarioDasVariaveis(doc.signatarios, c.signatarioToken, entrada.signerToken);
  const respostas = doc.respostas ? variaveisDasRespostas(doc.respostas) : entrada.respostasDeQueda;
  const variaveis = variaveisDoDocumento(doc, signatario, quando, respostas);
  const conversa = await conversaDoContato(admin, accountId, c.contactId);

  const r = await dispararAutomacoes({
    accountId,
    triggerType: GATILHO,
    contactId: c.contactId,
    context: {
      conversation_id: conversa?.id ?? undefined,
      channel_id: conversa?.channelId ?? null,
      // Só no casamento EXATO o card é conhecido: é ESTE o que o "Mover card"
      // move. O status visto vai junto, e a escrita confere que ele não mudou
      // no meio (`p_status_esperado`). Na cascata, o motor escolhe o card como
      // sempre (`negocioAlvo`).
      ...(c.negocio ? { deal_id: c.negocio.id, deal_status_fixado: c.negocio.status } : {}),
      vars: variaveis,
    },
  });

  if (r.executadas === 0) {
    // Nada rodou: o cadeado do disparo volta, senão uma automação ligada
    // depois nunca rodaria para este documento.
    const { error } = await admin
      .from("cb_zapsign_documentos")
      .update({ disparo_evento_id: null })
      .eq("account_id", accountId)
      .eq("doc_token", doc.token)
      .eq("disparo_evento_id", entrada.eventoId);
    if (error) console.error("[zapsign] não foi possível devolver o cadeado do disparo:", error.message);
  }
  return { ...resultadoDoDisparo(r), ...base, variaveis };
}
