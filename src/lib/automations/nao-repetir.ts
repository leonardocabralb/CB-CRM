// ============================================================
// "Não repetir para o mesmo contato por N horas" (30/09/2026).
//
// O caso que motivou: a automação que avisa o cliente do Bancário que ainda
// escreve no número do Comercial ("o seu atendimento passou para o
// Jurídico"). A trava "uma vez só" era uma CONDIÇÃO de etiqueta dentro dos
// passos — e o motor grava o registro da execução ANTES do primeiro passo:
// cada mensagem seguinte do cliente virava uma linha "parou numa condição"
// (um cliente gerou 31 num dia). E o operador quer o aviso de novo depois de
// 24 h, o que uma etiqueta permanente não dá.
//
// A opção mora no GATILHO (`trigger_config.nao_repetir_horas`), sem
// migration, como `parar_ao_sair`. É conferida em `dispararAutomacoes` junto
// com os recortes de número e de etapa: dentro do prazo, a mensagem é
// descartada como "fora do escopo" — sem registro, sem pílula no fio.
//
// ⚠️ O prazo conta do INÍCIO da última execução que FEZ ALGUMA COISA
// (`automation_logs.created_at`): concluída, com falha ou ainda rodando.
// `falhou` conta de propósito: o envio que falhou pode ter saído (tempo
// esgotado), e repetir mandaria a mensagem duas vezes (CLAUDE.md, 8e). Só
// `barrada` (parou numa condição sem fazer nada) não conta.
//
// ⚠️ Só vale no DISPARO automático. "Executar automação", o agente de IA e o
// passo "Acionar automação" chamam `runAutomationById`, que não passa por
// aqui: são pedidos explícitos. Mas a execução deles CONTA para o prazo.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AutomationTriggerType } from '@/types';

/** Teto do prazo: 30 dias. Acima disso, é mais provável erro de digitação. */
export const HORAS_SEM_REPETIR_MAX = 720;

/**
 * Os gatilhos que oferecem a opção: os que disparam a CADA mensagem do
 * cliente, onde a repetição acontece. Default-deny: gatilho novo nasce sem
 * ela até alguém decidir. Os de evento (etiqueta, etapa, Calendly, webhook)
 * já disparam uma vez por evento; a régua do Asaas, o Atlas e o lembrete por
 * data têm trava própria.
 */
const GATILHOS_COM_NAO_REPETIR: ReadonlySet<AutomationTriggerType> = new Set<AutomationTriggerType>([
  'new_message_received',
  'keyword_match',
  'interactive_reply',
]);

export function aceitaNaoRepetir(tipo: AutomationTriggerType | string): boolean {
  return GATILHOS_COM_NAO_REPETIR.has(tipo as AutomationTriggerType);
}

/** Inteiro de 1 a `HORAS_SEM_REPETIR_MAX`. `"24"` (texto) não vale. */
export function horasSemRepetirValidas(valor: unknown): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isInteger(valor) &&
    valor >= 1 &&
    valor <= HORAS_SEM_REPETIR_MAX
  );
}

/**
 * O prazo desta automação, ou `null` quando ela roda a cada disparo: sem a
 * chave, gatilho que não oferece a opção (a chave fica gravada quando o
 * operador troca o gatilho no construtor, e a tela a esconde), ou valor
 * inválido (a ativação o recusa; aqui ele não inventa prazo).
 */
export function horasSemRepetir(automation: {
  trigger_type: AutomationTriggerType | string;
  trigger_config?: unknown;
}): number | null {
  if (!aceitaNaoRepetir(automation.trigger_type)) return null;
  const valor = (automation.trigger_config as { nao_repetir_horas?: unknown } | null | undefined)
    ?.nao_repetir_horas;
  return horasSemRepetirValidas(valor) ? valor : null;
}

/**
 * Esta automação já rodou para este contato dentro do prazo?
 *
 * - `'livre'`: sem prazo, sem contato, ou nenhuma execução no prazo.
 * - `'rodou'`: há execução no prazo; o disparo é descartado.
 * - `'erro'`: a leitura falhou. O motor DESCARTA também (falha FECHADA): a
 *   próxima mensagem do cliente pergunta de novo, e rodar às cegas podia
 *   repetir o aviso que o prazo existe para segurar.
 *
 * ⚠️ Ler-e-depois-registrar, sem trava: duas mensagens do cliente no mesmo
 * instante, em POSTs diferentes, podem passar as duas antes de a primeira
 * gravar o registro (milissegundos). É a mesma janela da trava por etiqueta
 * que isto substitui; aceito.
 */
export async function rodouNoPrazo(args: {
  db: SupabaseClient;
  automation: {
    id: string;
    account_id: string;
    trigger_type: AutomationTriggerType | string;
    trigger_config?: unknown;
  };
  contactId: string | null | undefined;
  agora?: number;
}): Promise<'livre' | 'rodou' | 'erro'> {
  const horas = horasSemRepetir(args.automation);
  if (horas === null || !args.contactId) return 'livre';
  const desde = new Date((args.agora ?? Date.now()) - horas * 3_600_000).toISOString();
  // O índice `(automation_id, created_at DESC)` atende a consulta.
  const { data, error } = await args.db
    .from('automation_logs')
    .select('id')
    .eq('automation_id', args.automation.id)
    .eq('account_id', args.automation.account_id)
    .eq('contact_id', args.contactId)
    .gte('created_at', desde)
    .or('desfecho.is.null,desfecho.neq.barrada')
    .limit(1);
  if (error) {
    console.error('[automations] nao_repetir: leitura do prazo falhou, descartando o disparo', {
      automation: args.automation.id,
      erro: error.message,
    });
    return 'erro';
  }
  return (data ?? []).length > 0 ? 'rodou' : 'livre';
}
