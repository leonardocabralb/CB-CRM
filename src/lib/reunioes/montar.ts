import { montarReunioesExternas, type LinhaDoCalendly, type ReuniaoExterna } from '@/lib/agenda/reunioes-externas';

import {
  alvosDoFunil,
  faltouAntes,
  qualificacaoDaReuniao,
  resultadoDaReuniao,
  type AlvosDoFunil,
  type EntradaDaTrilha,
  type EtapaDoFunil,
  type LinhaDoMarco,
  type ReuniaoDaPauta,
} from './pauta';

/**
 * Monta a pauta a partir das linhas cruas que a rota `/api/cb/reunioes` lê.
 * Puro: a rota faz as consultas, isto decide.
 */

/** `invitee.created` do Calendly, com o contato. */
export interface LinhaDoCalendlyDaPauta extends LinhaDoCalendly {
  contact_id: string | null;
}

/** `cb_meetings` (a agenda do CRM). */
export interface LinhaDaAgenda {
  id: string;
  contact_id: string | null;
  conversation_id: string | null;
  titulo: string | null;
  local: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  created_at: string;
}

export interface LinhaDoNegocio {
  id: string;
  contact_id: string | null;
  pipeline_id: string;
  stage_id: string;
  value: number | string | null;
  status: string;
  created_at: string | null;
}

export interface DadosDaPauta {
  janela: { de: Date; ate: Date };
  /** TODOS os agendamentos dos contatos com reunião na janela (a inferência de reagendamento precisa do histórico inteiro do contato). */
  calendly: LinhaDoCalendlyDaPauta[];
  /** Convites com `invitee.canceled`. */
  cancelados: ReadonlySet<string>;
  /** A agenda do CRM dos contatos (em qualquer data — a próxima reunião pode estar fora da janela) e a da janela sem contato. */
  agenda: LinhaDaAgenda[];
  contatos: ReadonlyMap<string, string | null>;
  conversas: ReadonlyMap<string, { id: string; aguardando_desde: string | null }>;
  negocios: LinhaDoNegocio[];
  pipelines: ReadonlyMap<string, string>;
  etapas: EtapaDoFunil[];
  campos: ReadonlyMap<string, { divida: string | null; atraso: string | null; origem: string | null }>;
  trilha: ReadonlyMap<string, EntradaDaTrilha[]>;
  /** Chave `${origem}:${reuniao_id}`. */
  marcos: ReadonlyMap<string, LinhaDoMarco[]>;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isNaN(v) ? null : v;
}

function comAlgo(texto: string | null | undefined): string | null {
  const t = texto?.trim();
  return t ? t : null;
}

function dentro(iso: string, janela: { de: Date; ate: Date }): boolean {
  const v = ms(iso);
  return v !== null && v >= janela.de.getTime() && v <= janela.ate.getTime();
}

/**
 * O card que a pauta mostra: o ABERTO mais recente; sem aberto, o GANHO mais
 * recente (é cliente — e o motor também não puxa o perdido de quem tem card
 * ganho, 1031); só então o perdido mais recente. Só o aberto recebe
 * movimento (`comoMarcar`); os outros aparecem para a pessoa saber onde o
 * lead está.
 */
export function negocioDoContato(negocios: LinhaDoNegocio[]): LinhaDoNegocio | null {
  const porCriacao = [...negocios].sort((a, b) => (ms(b.created_at) ?? 0) - (ms(a.created_at) ?? 0));
  return (
    porCriacao.find((n) => n.status === 'open') ??
    porCriacao.find((n) => n.status === 'won') ??
    porCriacao[0] ??
    null
  );
}

function statusDoNegocio(s: string): 'open' | 'won' | 'lost' {
  return s === 'won' || s === 'lost' ? s : 'open';
}

export function montarPauta(d: DadosDaPauta): { reunioes: ReuniaoDaPauta[]; funis: Record<string, AlvosDoFunil> } {
  const etapaPorId = new Map(d.etapas.map((e) => [e.id, e]));
  const negociosPorContato = new Map<string, LinhaDoNegocio[]>();
  for (const n of d.negocios) {
    if (!n.contact_id) continue;
    const lista = negociosPorContato.get(n.contact_id) ?? [];
    lista.push(n);
    negociosPorContato.set(n.contact_id, lista);
  }

  // Toda reunião de pé (não desmarcada) de cada contato, em QUALQUER data: é
  // o que diz qual é a próxima. Montada antes, para a janela não esconder a
  // reunião seguinte que cai fora dela.
  const iniciosPorContato = new Map<string, number[]>();
  const anotarInicio = (contactId: string | null, inicio: string) => {
    const v = ms(inicio);
    if (!contactId || v === null) return;
    const lista = iniciosPorContato.get(contactId) ?? [];
    lista.push(v);
    iniciosPorContato.set(contactId, lista);
  };
  const proximaDepoisDe = (contactId: string | null, inicio: string): string | null => {
    const v = ms(inicio);
    if (!contactId || v === null) return null;
    const seguintes = (iniciosPorContato.get(contactId) ?? []).filter((x) => x > v);
    return seguintes.length > 0 ? new Date(Math.min(...seguintes)).toISOString() : null;
  };

  const reunioes: ReuniaoDaPauta[] = [];
  const completar = (
    base: Pick<ReuniaoDaPauta, 'origem' | 'reuniaoId' | 'inicio' | 'fim' | 'evento' | 'link' | 'reagendamento'>,
    contactId: string | null,
    desde: string | null,
    conversaDaLinha: string | null,
  ) => {
    const chave = `${base.origem}:${base.reuniaoId}`;
    const marcos = d.marcos.get(chave) ?? [];
    const entradas = contactId ? (d.trilha.get(contactId) ?? []) : [];
    const n = contactId ? negocioDoContato(negociosPorContato.get(contactId) ?? []) : null;
    const conversa = contactId ? d.conversas.get(contactId) : undefined;
    const proximaEm = proximaDepoisDe(contactId, base.inicio);
    const dealId = n?.id ?? null;
    reunioes.push({
      ...base,
      chave,
      proximaEm,
      contato: contactId ? { id: contactId, nome: d.contatos.get(contactId) ?? null } : null,
      conversaId: conversa?.id ?? conversaDaLinha,
      negocio: n
        ? {
            id: n.id,
            pipelineId: n.pipeline_id,
            pipelineNome: d.pipelines.get(n.pipeline_id) ?? null,
            etapaId: n.stage_id,
            etapaNome: etapaPorId.get(n.stage_id)?.nome ?? null,
            valor: Number(n.value) || 0,
            status: statusDoNegocio(n.status),
          }
        : null,
      qualificacao: (contactId ? d.campos.get(contactId) : undefined) ?? { divida: null, atraso: null, origem: null },
      qualificada: qualificacaoDaReuniao({ desde, ate: proximaEm, dealId, marcos, entradas, etapas: etapaPorId }),
      resultado: resultadoDaReuniao({ inicio: base.inicio, ate: proximaEm, dealId, marcos, entradas, etapas: etapaPorId }),
      faltouAntes: faltouAntes({ inicio: base.inicio, entradas, etapas: etapaPorId }),
      aguardandoDesde: conversa?.aguardando_desde ?? null,
    });
  };

  // Calendly: a montagem (cancelamento e reagendamento) é POR CONTATO — a
  // inferência do convite substituído compara agendamentos do mesmo cliente,
  // e misturar contatos casaria o reagendamento de um com o convite de outro.
  const porContato = new Map<string, LinhaDoCalendlyDaPauta[]>();
  for (const l of d.calendly) {
    const k = l.contact_id ?? `sem-contato:${l.id}`;
    const lista = porContato.get(k) ?? [];
    lista.push(l);
    porContato.set(k, lista);
  }
  const deCalendly: { r: ReuniaoExterna; linha: LinhaDoCalendlyDaPauta }[] = [];
  for (const linhas of porContato.values()) {
    const porId = new Map(linhas.map((l) => [l.id, l]));
    for (const r of montarReunioesExternas(linhas, d.cancelados, [])) {
      const linha = porId.get(r.id);
      if (r.desmarcada !== null || !linha) continue;
      anotarInicio(linha.contact_id, r.inicio);
      deCalendly.push({ r, linha });
    }
  }
  const deAgenda = d.agenda.filter((a) => a.status !== 'cancelada' && ms(a.starts_at) !== null);
  for (const a of deAgenda) anotarInicio(a.contact_id, a.starts_at);

  for (const { r, linha } of deCalendly) {
    if (!dentro(r.inicio, d.janela)) continue;
    completar(
      {
        origem: 'calendly',
        reuniaoId: r.id,
        inicio: r.inicio,
        fim: r.fim,
        evento: r.evento,
        link: r.link,
        reagendamento: r.reagendamento,
      },
      linha.contact_id,
      linha.recebido_em,
      null,
    );
  }

  // Agenda do CRM: cancelada não é reunião.
  for (const a of deAgenda) {
    if (!dentro(a.starts_at, d.janela)) continue;
    const inicio = ms(a.starts_at);
    if (inicio === null) continue;
    const fim = ms(a.ends_at);
    completar(
      {
        origem: 'agenda',
        reuniaoId: a.id,
        inicio: new Date(inicio).toISOString(),
        fim: fim === null ? null : new Date(fim).toISOString(),
        evento: comAlgo(a.titulo),
        link: comAlgo(a.local),
        reagendamento: false,
      },
      a.contact_id,
      a.created_at,
      a.conversation_id,
    );
  }

  reunioes.sort((a, b) => (ms(a.inicio) ?? 0) - (ms(b.inicio) ?? 0));

  const funis: Record<string, AlvosDoFunil> = {};
  for (const r of reunioes) {
    const p = r.negocio?.pipelineId;
    if (p && !funis[p]) funis[p] = alvosDoFunil(d.etapas, p);
  }
  return { reunioes, funis };
}
