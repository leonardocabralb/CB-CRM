import type { Agendamento } from "./payload";
import { formatarTelefone } from "@/lib/contacts/telefone";
import { FUSO_DO_ESCRITORIO, formatarParaMensagem } from "@/lib/contacts/campo-data";

/**
 * As variáveis que o agendamento entrega ao motor de automações, em
 * `context.vars` — o `{{vars.agendamento_*}}` que o operador escreve na
 * mensagem, no nome e nos campos.
 *
 * ⚠️ `agendamento_data` sai de `formatarParaMensagem` (`campo-data.ts`), a
 * MESMA função que formata campo de data dentro de mensagem — o formato do
 * aviso de agendamento e o do lembrete de reunião têm de ser o mesmo, e duas
 * cópias divergiriam na primeira mudança. `agendamento_inicio` é o ISO cru,
 * em UTC — o que o campo personalizado do tipo `datetime` guarda.
 */

// Reexportados: os call sites e os testes do Calendly já os importavam daqui,
// e a função mudou de casa (não de comportamento) quando o lembrete de reunião
// passou a precisar dela.
export { FUSO_DO_ESCRITORIO };

/** "2026-08-26T16:45:00Z" → "26/08/2026 às 13:45h" no fuso dado. */
export const formatarDataHora = formatarParaMensagem;

export function variaveisDoAgendamento(a: Agendamento, fuso: string = FUSO_DO_ESCRITORIO): Record<string, string> {
  return {
    agendamento_nome: a.nome,
    agendamento_email: a.email ?? "",
    agendamento_telefone: formatarTelefone(a.telefone),
    agendamento_evento: a.eventoNome ?? "",
    agendamento_data: formatarDataHora(a.inicio, fuso),
    agendamento_inicio: a.inicio ?? "",
    agendamento_fim: a.fim ?? "",
    agendamento_link: a.link ?? "",
    agendamento_local: a.local ?? "",
    agendamento_cancelar: a.cancelarUrl ?? "",
    agendamento_remarcar: a.remarcarUrl ?? "",
    agendamento_situacao: a.reagendado ? "Reagendamento" : "Novo agendamento",
  };
}

/** Os nomes, para a dica do editor de automações (ordem = ordem da lista). */
export const VARIAVEIS_DO_AGENDAMENTO = [
  "agendamento_nome",
  "agendamento_telefone",
  "agendamento_evento",
  "agendamento_data",
  "agendamento_link",
  "agendamento_inicio",
  "agendamento_email",
  "agendamento_local",
  "agendamento_situacao",
  "agendamento_cancelar",
  "agendamento_remarcar",
  "agendamento_fim",
] as const;
