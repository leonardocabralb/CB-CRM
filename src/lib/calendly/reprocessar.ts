import { EVENTO_AGENDADO, type Agendamento } from "./payload";
import { variaveisDoAgendamento } from "./variaveis";

/**
 * De volta da LINHA gravada para o agendamento — o caminho inverso do
 * webhook, usado pelo botão "Processar de novo".
 *
 * Puro, e separado da rota porque é aqui que mora a única sutileza: a
 * tabela não guarda `local`, `cancelar`, `remarcar` nem `situacao` em
 * coluna (eles só existem como variável), então o agendamento remontado
 * tem esses campos nulos. É por isso que as VARIÁVEIS gravadas (979)
 * vencem as remontadas: sem elas, a segunda tentativa entregaria à
 * automação um conjunto menor que o da primeira, em silêncio.
 */

/** A forma da linha que interessa aqui. `unknown` porque vem do PostgREST. */
export interface LinhaDeEvento {
  evento?: unknown;
  invitee_uri?: unknown;
  event_type_uri?: unknown;
  event_type_nome?: unknown;
  nome?: unknown;
  email?: unknown;
  telefone?: unknown;
  telefone_origem?: unknown;
  inicio?: unknown;
  fim?: unknown;
  link?: unknown;
  perguntas?: unknown;
  variaveis?: unknown;
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/**
 * Remonta o agendamento. Devolve `null` quando falta o que identifica a
 * entrega (evento e invitee) — linha assim não deveria existir, e mandar
 * um agendamento pela metade ao motor é pior que recusar.
 */
export function agendamentoDaLinha(linha: LinhaDeEvento): Agendamento | null {
  const inviteeUri = texto(linha.invitee_uri);
  // A tabela guarda outros tipos de evento? Hoje não — só `invitee.created`
  // é gravado. Conferir mesmo assim: reprocessar uma linha de outro tipo
  // entregaria ao motor um agendamento que não é um agendamento.
  if (linha.evento !== EVENTO_AGENDADO || !inviteeUri) return null;

  const origem = texto(linha.telefone_origem);
  return {
    evento: EVENTO_AGENDADO,
    inviteeUri,
    eventoUri: texto(linha.event_type_uri),
    eventoNome: texto(linha.event_type_nome),
    nome: texto(linha.nome) ?? "",
    email: texto(linha.email),
    telefone: texto(linha.telefone),
    telefoneOrigem: origem === "sms" || origem === "pergunta" || origem === "heuristica" ? origem : null,
    eventoAgendadoUri: null,
    inicio: texto(linha.inicio),
    fim: texto(linha.fim),
    link: texto(linha.link),
    local: null,
    cancelarUrl: null,
    remarcarUrl: null,
    reagendado: false,
    fusoDoConvidado: null,
    perguntas: Array.isArray(linha.perguntas) ? (linha.perguntas as Agendamento["perguntas"]) : [],
  };
}

/**
 * As variáveis a entregar ao motor: as GRAVADAS quando existirem, senão as
 * remontadas. Linha anterior à 979 tem `{}` — ali o remonte é o que há.
 */
export function varsDaLinha(linha: LinhaDeEvento, agendamento: Agendamento): Record<string, string> {
  const guardadas = linha.variaveis;
  if (guardadas && typeof guardadas === "object" && !Array.isArray(guardadas)) {
    const limpas: Record<string, string> = {};
    for (const [k, v] of Object.entries(guardadas as Record<string, unknown>)) {
      if (typeof v === "string") limpas[k] = v;
    }
    if (Object.keys(limpas).length > 0) return limpas;
  }
  return variaveisDoAgendamento(agendamento);
}
