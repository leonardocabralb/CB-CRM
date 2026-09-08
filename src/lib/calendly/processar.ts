import type { SupabaseClient } from "@supabase/supabase-js";

import { runAutomationsForTrigger } from "@/lib/automations/engine";
import { findExistingContact } from "@/lib/contacts/dedupe";

import type { ResultadoDoEvento } from "./cartao";
import type { Agendamento } from "./payload";
import { variaveisDoAgendamento } from "./variaveis";

/**
 * Do agendamento gravado ao motor de automações.
 *
 * Roda em `after()`, DEPOIS de a rota responder 200 ao Calendly (ele
 * espera 15 s e retenta por 24 h; uma conta com automação lenta não pode
 * segurar a resposta). Cada saída vira um `resultado` na linha do evento —
 * é o que o cartão da integração mostra, e é assim que "marquei e nada
 * aconteceu" tem resposta: sem telefone no formulário, telefone que não é
 * de nenhum contato, nenhuma automação escutando este evento.
 *
 * ⚠️ Não cria contato (D2 do plano): telefone desconhecido é `sem_contato`.
 */

export interface AutomacaoQueEscuta {
  trigger_type: string;
  trigger_config: unknown;
  is_active: boolean;
}

/** Puro: quais automações ativas do tipo `calendly_booking` casam com este evento. */
export function escutamEsteEvento(automacoes: readonly AutomacaoQueEscuta[], eventoUri: string | null): number {
  let n = 0;
  for (const a of automacoes) {
    if (a.trigger_type !== "calendly_booking" || !a.is_active) continue;
    const cfg = (a.trigger_config ?? {}) as { event_type_uri?: unknown };
    const alvo = typeof cfg.event_type_uri === "string" ? cfg.event_type_uri.trim() : "";
    if (!alvo || (eventoUri && alvo === eventoUri)) n += 1;
  }
  return n;
}

export interface ProcessamentoDoAgendamento {
  resultado: ResultadoDoEvento;
  detalhe: string | null;
  contactId: string | null;
}

export async function processarAgendamento(
  admin: SupabaseClient,
  accountId: string,
  agendamento: Agendamento,
): Promise<ProcessamentoDoAgendamento> {
  if (!agendamento.telefone) {
    return { resultado: "sem_telefone", detalhe: "o agendamento não trouxe telefone (SMS ou pergunta do formulário)", contactId: null };
  }

  const busca = await findExistingContact(admin, accountId, agendamento.telefone);
  if (busca.falhou) return { resultado: "falhou", detalhe: "busca do contato falhou", contactId: null };
  if (!busca.contato) {
    return { resultado: "sem_contato", detalhe: `nenhum contato com o telefone ${agendamento.telefone}`, contactId: null };
  }
  const contactId = busca.contato.id;

  const { data: automacoes, error: erroAuto } = await admin
    .from("automations")
    .select("trigger_type, trigger_config, is_active")
    .eq("account_id", accountId)
    .eq("trigger_type", "calendly_booking")
    .eq("is_active", true);
  if (erroAuto) return { resultado: "falhou", detalhe: `leitura das automações falhou: ${erroAuto.message}`, contactId };
  if (escutamEsteEvento((automacoes ?? []) as AutomacaoQueEscuta[], agendamento.eventoUri) === 0) {
    return { resultado: "sem_automacao", detalhe: "nenhuma automação ativa escuta este evento", contactId };
  }

  // A conversa do contato (única por conta, 036) e o canal por onde ele
  // fala — é o que o recorte por conexão da automação lê.
  const { data: conversa } = await admin
    .from("conversations")
    .select("id, channel_id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  await runAutomationsForTrigger({
    accountId,
    triggerType: "calendly_booking",
    contactId,
    context: {
      conversation_id: conversa?.id ?? undefined,
      channel_id: conversa?.channel_id ?? null,
      calendly_event_type: agendamento.eventoUri,
      vars: variaveisDoAgendamento(agendamento),
    },
  });
  return { resultado: "disparado", detalhe: null, contactId };
}

/** Carimba o resultado na linha do evento. Nunca lança — é o fim de um `after()`. */
export async function gravarResultado(
  admin: SupabaseClient,
  eventoId: string,
  r: ProcessamentoDoAgendamento,
): Promise<void> {
  const { error } = await admin
    .from("cb_calendly_eventos")
    .update({ resultado: r.resultado, detalhe: r.detalhe, contact_id: r.contactId, processado_em: new Date().toISOString() })
    .eq("id", eventoId);
  if (error) console.error("[calendly] não foi possível gravar o resultado do evento:", error.message);
}
