import type { Agendamento } from "./payload";
import { formatarTelefone } from "@/lib/contacts/telefone";

/**
 * As variáveis que o agendamento entrega ao motor de automações, em
 * `context.vars` — o `{{vars.agendamento_*}}` que o operador escreve na
 * mensagem, no nome e nos campos.
 *
 * ⚠️ `agendamento_data` é montada por `formatToParts`, nunca por
 * `toLocaleString`: a forma da data varia entre majors do Node (o PR #66
 * reprovou no CI por `Intl` divergindo entre 22 e 24), e aqui ela vai para
 * uma mensagem de WhatsApp. `agendamento_inicio` é o ISO cru, em UTC — o que
 * o campo personalizado do tipo `datetime` guarda (`campo-data.ts`).
 */

/** O Brasil não tem horário de verão desde 2019; se voltar, muda aqui. */
export const FUSO_DO_ESCRITORIO = "America/Sao_Paulo";

/** "2026-08-26T16:45:00Z" → "26/08/2026 13:45" no fuso dado. */
export function formatarDataHora(iso: string | null | undefined, fuso: string = FUSO_DO_ESCRITORIO): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((x) => x.type === tipo)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}`;
}

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
