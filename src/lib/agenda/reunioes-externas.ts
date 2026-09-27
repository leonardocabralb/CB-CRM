import { SITUACAO_REAGENDAMENTO } from '@/lib/calendly/variaveis';
import type { Meeting } from '@/types';

/**
 * As reuniões do cliente que NÃO moram na agenda do CRM (`cb_meetings`): os
 * agendamentos do Calendly (977) e a última reunião que a Kommo guardou (1036).
 * É o histórico da aba Reuniões, na ficha e no painel da conversa.
 *
 * ⚠️ As duas tabelas são FECHADAS ao navegador (guardam telefone, e-mail e as
 * respostas do formulário). Quem lê é a rota
 * `/api/cb/agenda/contato/[contactId]`, que devolve só o que está aqui:
 * data, evento, link e situação. Nunca abrir SELECT nelas para a tela.
 *
 * Tudo aqui é puro: a rota monta, o navegador confere a forma e intercala com
 * a agenda.
 */

export type OrigemDaReuniao = 'calendly' | 'kommo';

/**
 * Por que o horário NÃO aconteceu: `cancelada` (o Calendly avisou o
 * cancelamento) ou `reagendada` (o cliente trocou por outro horário — o novo
 * aparece como outra reunião, com `reagendamento`).
 */
export type Desmarcada = 'cancelada' | 'reagendada';

export interface ReuniaoExterna {
  /** Id da linha de origem (`cb_calendly_eventos.id` ou `cb_reunioes_da_kommo.id`). */
  id: string;
  origem: OrigemDaReuniao;
  /** Nome do evento no Calendly (na Kommo, onde a reunião foi marcada). */
  evento: string | null;
  /** Instante ISO, sempre com fuso. */
  inicio: string;
  fim: string | null;
  /** Nulo = o horário continua de pé (ou já passou sem aviso de cancelamento). */
  desmarcada: Desmarcada | null;
  /** Este agendamento é o horário NOVO de um reagendamento. */
  reagendamento: boolean;
  link: string | null;
}

/** A linha de `invitee.created` como a rota a lê. */
export interface LinhaDoCalendly {
  id: string;
  invitee_uri: string;
  event_type_uri: string | null;
  event_type_nome: string | null;
  inicio: string | null;
  fim: string | null;
  link: string | null;
  /** `variaveis->>agendamento_situacao`; nulo nas linhas anteriores à 979. */
  situacao: string | null;
  recebido_em: string;
}

/** A linha de `cb_reunioes_da_kommo` como a rota a lê. */
export interface LinhaDaKommo {
  id: string;
  reuniao_em: string | null;
  link: string | null;
  marcou_onde: string | null;
}

/**
 * Folga para o reagendamento feito em cima da hora: o convite substituído é
 * uma reunião que AINDA NÃO tinha acontecido quando o cliente reagendou.
 */
const FOLGA_DO_REAGENDAMENTO_MS = 60 * 60_000;

function instante(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function comAlgo(texto: string | null): string | null {
  const t = texto?.trim();
  return t ? t : null;
}

/**
 * Os convites que cada reagendamento substituiu. Para cada agendamento com a
 * situação "Reagendamento" (em ordem de chegada), os CANDIDATOS são os que
 * chegaram antes dele, do mesmo tipo de evento, cuja reunião ainda não tinha
 * acontecido e que nenhum outro reagendamento já tomou. Marca só quando a
 * resposta é ÚNICA: um candidato só, ou — com dois ou mais — o único que o
 * Calendly avisou como cancelado. Ambíguo não marca nada: com duas reuniões
 * futuras do mesmo tipo, marcar a errada esconderia uma reunião de pé (Codex,
 * PR #331).
 *
 * ⚠️ Existe porque o cancelamento só chega desde a 1013, e só com a assinatura
 * refeita: o convite antigo de um reagendamento de antes disso não tem a linha
 * `invitee.canceled` e apareceria como reunião que aconteceu (5 dos 8
 * reagendamentos em 27/09/2026). O payload traz `old_invitee`, mas a 977 não
 * o guarda. Conferido nos 8: todos com candidato único, e nos 2 que TÊM o
 * cancelamento a inferência acha o mesmo convite.
 */
function convitesSubstituidos(
  agendamentos: LinhaDoCalendly[],
  convitesCancelados: ReadonlySet<string>,
): Set<string> {
  const ordem = agendamentos
    .map((a) => ({ a, chegou: instante(a.recebido_em) }))
    .filter((x): x is { a: LinhaDoCalendly; chegou: number } => x.chegou !== null)
    .sort((x, y) => x.chegou - y.chegou);

  const tomados = new Set<string>();
  ordem.forEach(({ a, chegou }, i) => {
    if (a.situacao !== SITUACAO_REAGENDAMENTO) return;
    const candidatos = ordem.slice(0, i).map((x) => x.a).filter((anterior) => {
      if (tomados.has(anterior.id)) return false;
      if (anterior.event_type_uri !== a.event_type_uri) return false;
      const inicio = instante(anterior.inicio);
      return inicio !== null && inicio >= chegou - FOLGA_DO_REAGENDAMENTO_MS;
    });
    const cancelados = candidatos.filter((c) => convitesCancelados.has(c.invitee_uri));
    const escolhido = candidatos.length === 1 ? candidatos[0] : cancelados.length === 1 ? cancelados[0] : null;
    if (escolhido) tomados.add(escolhido.id);
  });
  return tomados;
}

/** Sem o fim (a reunião da Kommo), a reunião dura isto para a tela. */
const DURACAO_SEM_FIM_MS = 60 * 60_000;

/**
 * A reunião já TERMINOU? Pelo fim, nunca pelo início: durante a reunião ela
 * continua marcada e o link continua servindo (Codex, PR #331).
 */
export function reuniaoTerminou(r: Pick<ReuniaoExterna, 'inicio' | 'fim'>, agora: Date): boolean {
  const inicio = instante(r.inicio);
  if (inicio === null) return true;
  const fim = instante(r.fim) ?? inicio + DURACAO_SEM_FIM_MS;
  return fim <= agora.getTime();
}

/**
 * Monta o histórico externo, do mais recente para o mais antigo.
 *
 * - O cancelamento é casado pelo `invitee_uri` (o UNIQUE da 977 é por
 *   `(conta, evento, invitee)`, então o convite cancelado tem as DUAS linhas).
 *   O convite que um reagendamento substituiu é `reagendada`, com ou sem a
 *   linha do cancelamento.
 * - ⚠️ A reunião da Kommo SOME quando o Calendly tem uma no MESMO instante: a
 *   integração antiga gravava o agendamento nos dois sistemas, e medido em
 *   27/09/2026 49 das 56 reuniões da Kommo desde 08/09 são a mesma do
 *   Calendly. Compara por INSTANTE (o PostgREST devolve "… 17:00:00+00" e o
 *   Calendly grava "…T17:00:00.000000Z").
 * - Linha sem instante legível fica de fora: sem data ela não tem lugar no
 *   histórico.
 */
export function montarReunioesExternas(
  agendamentos: LinhaDoCalendly[],
  convitesCancelados: ReadonlySet<string>,
  kommo: LinhaDaKommo[],
): ReuniaoExterna[] {
  const saida: { ms: number; reuniao: ReuniaoExterna }[] = [];
  const instantesVistos = new Set<number>();
  const substituidos = convitesSubstituidos(agendamentos, convitesCancelados);

  for (const a of agendamentos) {
    const ms = instante(a.inicio);
    if (ms === null) continue;
    const fimMs = instante(a.fim);
    instantesVistos.add(ms);
    saida.push({
      ms,
      reuniao: {
        id: a.id,
        origem: 'calendly',
        evento: comAlgo(a.event_type_nome),
        inicio: new Date(ms).toISOString(),
        fim: fimMs === null ? null : new Date(fimMs).toISOString(),
        desmarcada: substituidos.has(a.id)
          ? 'reagendada'
          : convitesCancelados.has(a.invitee_uri)
            ? 'cancelada'
            : null,
        reagendamento: a.situacao === SITUACAO_REAGENDAMENTO,
        link: comAlgo(a.link),
      },
    });
  }

  for (const k of kommo) {
    const ms = instante(k.reuniao_em);
    if (ms === null || instantesVistos.has(ms)) continue;
    // Um contato pode ter dois leads na Kommo (um por área) com a mesma data.
    instantesVistos.add(ms);
    saida.push({
      ms,
      reuniao: {
        id: k.id,
        origem: 'kommo',
        evento: comAlgo(k.marcou_onde),
        inicio: new Date(ms).toISOString(),
        fim: null,
        desmarcada: null,
        reagendamento: false,
        link: comAlgo(k.link),
      },
    });
  }

  return saida.sort((x, y) => y.ms - x.ms).map((s) => s.reuniao);
}

/**
 * Confere a resposta da rota no navegador. Forma estranha → `null` ("não sei"),
 * nunca lista vazia: vazio seria lido como "este cliente não tem reunião".
 */
export function lerReunioesExternas(json: unknown): ReuniaoExterna[] | null {
  if (!json || typeof json !== 'object') return null;
  const lista = (json as { reunioes?: unknown }).reunioes;
  if (!Array.isArray(lista)) return null;

  const saida: ReuniaoExterna[] = [];
  for (const item of lista) {
    if (!item || typeof item !== 'object') return null;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string') return null;
    if (r.origem !== 'calendly' && r.origem !== 'kommo') return null;
    if (typeof r.inicio !== 'string' || instante(r.inicio) === null) return null;
    saida.push({
      id: r.id,
      origem: r.origem,
      evento: typeof r.evento === 'string' ? r.evento : null,
      inicio: r.inicio,
      fim: typeof r.fim === 'string' ? r.fim : null,
      desmarcada: r.desmarcada === 'cancelada' || r.desmarcada === 'reagendada' ? r.desmarcada : null,
      reagendamento: r.reagendamento === true,
      link: typeof r.link === 'string' ? r.link : null,
    });
  }
  return saida;
}

/** Um item do histórico da aba: a reunião da agenda (editável) ou a externa. */
export type ItemDoHistorico =
  | { tipo: 'agenda'; reuniao: Meeting }
  | { tipo: 'externa'; reuniao: ReuniaoExterna };

/** Agenda e externas numa lista só, do mais recente para o mais antigo. */
export function intercalarHistorico(agenda: Meeting[], externas: ReuniaoExterna[]): ItemDoHistorico[] {
  const itens: { ms: number; item: ItemDoHistorico }[] = [
    ...agenda.map((reuniao) => ({ ms: instante(reuniao.starts_at) ?? 0, item: { tipo: 'agenda' as const, reuniao } })),
    ...externas.map((reuniao) => ({ ms: instante(reuniao.inicio) ?? 0, item: { tipo: 'externa' as const, reuniao } })),
  ];
  return itens.sort((x, y) => y.ms - x.ms).map((i) => i.item);
}
