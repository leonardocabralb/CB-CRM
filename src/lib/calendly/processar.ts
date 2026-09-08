import type { SupabaseClient } from "@supabase/supabase-js";

import { resolverDestinatario } from "@/lib/automations/destinatario";
import { dispararAutomacoes } from "@/lib/automations/engine";
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
 * ⚠️⚠️ CRIA a ficha quando o telefone não é de nenhum contato — e essa é a
 * REVISÃO da D2 do plano, decidida pelo operador em 08/09/2026.
 *
 * O desenho original recusava criar contato a partir de número digitado num
 * formulário. Na prática a ficha nascia mesmo assim, segundos depois, porque
 * o OUTRO CRM do escritório respondia ao mesmo agendamento mandando um
 * WhatsApp pelo celular pareado — medido: o evento foi processado 4,2 s e
 * 4,5 s ANTES de a ficha existir, nos dois primeiros agendamentos de gente
 * de verdade, e os dois viraram `sem_contato` com o contato aparecendo logo
 * em seguida. Ou seja: a integração dependia, sem dizer, de um sistema que
 * vai ser desligado. Quando ele sair, lead novo nenhum teria ficha, e a
 * automação não teria em quem agir.
 *
 * ⚠️ A ficha só é criada se ALGUMA automação escuta este evento — por isso a
 * consulta de automações subiu para ANTES dela. Sem essa ordem, um
 * agendamento numa conta que não configurou nada materializaria um lead que
 * ninguém pediu.
 *
 * ⚠️ Falha ao criar vira `sem_contato` (não `falhou`), de propósito: nada da
 * automação rodou, então repetir é seguro — e `sem_contato` é justamente o
 * que o botão "Processar de novo" aceita.
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
  /**
   * As variáveis a entregar ao motor. O reprocessamento manual passa as que
   * FORAM gravadas na primeira vez (979) — remontá-las do agendamento
   * reconstruído entregaria menos variáveis que da primeira vez, porque a
   * linha não guarda local/cancelar/remarcar/situacao em coluna.
   */
  vars?: Record<string, string>,
): Promise<ProcessamentoDoAgendamento> {
  if (!agendamento.telefone) {
    return { resultado: "sem_telefone", detalhe: "o agendamento não trouxe telefone (SMS ou pergunta do formulário)", contactId: null };
  }

  const busca = await findExistingContact(admin, accountId, agendamento.telefone);
  if (busca.falhou) return { resultado: "falhou", detalhe: "busca do contato falhou", contactId: null };

  // ⚠️ ANTES de criar ficha: alguém escuta este evento? Ver o cabeçalho.
  const { data: automacoes, error: erroAuto } = await admin
    .from("automations")
    .select("trigger_type, trigger_config, is_active")
    .eq("account_id", accountId)
    .eq("trigger_type", "calendly_booking")
    .eq("is_active", true);
  const contatoExistente = busca.contato?.id ?? null;
  if (erroAuto) {
    return { resultado: "falhou", detalhe: `leitura das automações falhou: ${erroAuto.message}`, contactId: contatoExistente };
  }
  if (escutamEsteEvento((automacoes ?? []) as AutomacaoQueEscuta[], agendamento.eventoUri) === 0) {
    return { resultado: "sem_automacao", detalhe: "nenhuma automação ativa escuta este evento", contactId: contatoExistente };
  }

  let resolvido = contatoExistente;
  let conversaDaFichaNova: string | null = null;
  let fichaNova = false;
  if (!resolvido) {
    try {
      const destino = await resolverDestinatario(admin, accountId, agendamento.telefone, agendamento.nome);
      resolvido = destino.contactId;
      conversaDaFichaNova = destino.conversationId;
      fichaNova = destino.criouContato;
    } catch (e) {
      return {
        resultado: "sem_contato",
        detalhe: `não foi possível criar a ficha de ${agendamento.telefone}: ${e instanceof Error ? e.message : "erro"}`,
        contactId: null,
      };
    }
  }

  // ⚠️ Daqui para baixo o contato EXISTE — ou já existia, ou acabou de ser
  // criado, ou a função já voltou. A const estreita o tipo para quem editar
  // isto depois: com `string | null`, um `dispararAutomacoes` sem contato
  // passaria no compilador e os passos morreriam um a um no motor.
  const contactId: string = resolvido;

  // A conversa do contato (única por conta, 036) e o canal por onde ele
  // fala — é o que o recorte por conexão da automação lê. Ficha recém-criada
  // já devolveu a conversa; a conexão dela é NULA, e `channelInScope` deixa
  // passar nesse caso (a mesma passagem livre do resíduo de ingestão).
  const { data: conversa } = conversaDaFichaNova
    ? { data: { id: conversaDaFichaNova, channel_id: null as string | null } }
    : await admin
        .from("conversations")
        .select("id, channel_id")
        .eq("account_id", accountId)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

  const r = await dispararAutomacoes({
    accountId,
    triggerType: "calendly_booking",
    contactId,
    context: {
      conversation_id: conversa?.id ?? undefined,
      channel_id: conversa?.channel_id ?? null,
      calendly_event_type: agendamento.eventoUri,
      vars: vars ?? variaveisDoAgendamento(agendamento),
    },
  });
  return comFichaNova(resultadoDoDisparo(r, contactId), fichaNova);
}

/**
 * Puro: registra no detalhe que a ficha do cliente nasceu deste agendamento.
 * É a única pista, no log, de que aquele lead entrou no CRM por ter marcado
 * horário — e não por ter mandado mensagem.
 */
export function comFichaNova(r: ProcessamentoDoAgendamento, fichaNova: boolean): ProcessamentoDoAgendamento {
  if (!fichaNova) return r;
  return { ...r, detalhe: `ficha criada a partir do agendamento — ${r.detalhe ?? "sem detalhe"}` };
}

/**
 * Puro: o que gravar no evento a partir do que o motor DISSE que fez.
 * "Disparado" só quando alguma automação rodou ATÉ O FIM; o escopo de
 * conexão/etapa barrando tudo é `sem_automacao` com o motivo escrito, um
 * passo que falhou é `falhou`, e execução parada num "Aguardar" é
 * `em_espera` — o log da automação tem o detalhe (achados do Codex no PR
 * #128: antes tudo virava "disparado", inclusive a que ainda nem tinha
 * terminado). Falha vence espera: se uma das automações falhou, é isso que
 * o operador precisa ver.
 *
 * ⚠️ `em_espera` NÃO é atualizado depois: o que vier após a espera (o
 * agendador retoma, e pode falhar) fica só em `automation_logs`.
 */
export function resultadoDoDisparo(
  r: { executadas: number; foraDoEscopo: number; comFalha: number; emEspera: number; erro?: string },
  contactId: string | null,
): ProcessamentoDoAgendamento {
  if (r.erro) return { resultado: "falhou", detalhe: `o disparo não aconteceu: ${r.erro}`, contactId };
  if (r.executadas === 0) {
    return {
      resultado: "sem_automacao",
      detalhe:
        r.foraDoEscopo > 0
          ? "a automação existe, mas está fora do escopo (conexão ou etapa) para este contato"
          : "nenhuma automação ativa escuta este evento",
      contactId,
    };
  }
  if (r.comFalha > 0) {
    return {
      resultado: "falhou",
      detalhe: `${r.comFalha} de ${r.executadas} automação(ões) terminou com erro — veja o histórico da automação`,
      contactId,
    };
  }
  if (r.emEspera > 0) {
    return {
      resultado: "em_espera",
      detalhe: `${r.emEspera} de ${r.executadas} automação(ões) parou num passo "Aguardar" — o restante sai pelo agendador e fica no histórico da automação; esta linha não é atualizada depois`,
      contactId,
    };
  }
  return { resultado: "disparado", detalhe: `${r.executadas} automação(ões) executada(s)`, contactId };
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
