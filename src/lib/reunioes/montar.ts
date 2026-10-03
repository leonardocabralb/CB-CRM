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
  /**
   * O campo "Data e Hora Reunião" de cada contato, já canônico
   * (`instanteCanonico`). É o que os lembretes leem; aqui ele REMARCA a última
   * reunião do Calendly (ver "remarcada pela ficha" em `montarPauta`).
   */
  datasDaFicha: ReadonlyMap<string, string>;
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
 *
 * ⚠️ Só entra card que JÁ EXISTIA no início da reunião (`inicio`): um card
 * criado depois (outro funil, outra área) não é da reunião — o botão o
 * moveria, e a trilha do card de verdade seria descartada pelo recorte por
 * `dealId` (Codex, PR #339). Sem nenhum, a reunião fica sem card e só
 * registra. Card sem `created_at` conta como existente (não se sabe).
 */
export function negocioDoContato(negocios: LinhaDoNegocio[], inicio?: string): LinhaDoNegocio | null {
  const inicioMs = ms(inicio);
  const daReuniao = inicioMs === null ? negocios : negocios.filter((n) => (ms(n.created_at) ?? -Infinity) <= inicioMs);
  const porCriacao = [...daReuniao].sort((a, b) => (ms(b.created_at) ?? 0) - (ms(a.created_at) ?? 0));
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
  // O horário do Calendly que a ficha remarcou: NÃO é reunião (a tela não o
  // cita como "a próxima"), mas fecha a janela da trilha da reunião anterior —
  // o no show daquele horário não a resolve.
  const cortesPorContato = new Map<string, number[]>();
  const anotarEm = (mapa: Map<string, number[]>, contactId: string | null, inicio: string) => {
    const v = ms(inicio);
    if (!contactId || v === null) return;
    const lista = mapa.get(contactId) ?? [];
    lista.push(v);
    mapa.set(contactId, lista);
  };
  const anotarInicio = (contactId: string | null, inicio: string) => anotarEm(iniciosPorContato, contactId, inicio);
  const seguinteDe = (mapa: Map<string, number[]>, contactId: string | null, inicio: string): number | null => {
    const v = ms(inicio);
    if (!contactId || v === null) return null;
    const seguintes = (mapa.get(contactId) ?? []).filter((x) => x > v);
    return seguintes.length > 0 ? Math.min(...seguintes) : null;
  };
  const isoOuNulo = (v: number | null): string | null => (v === null ? null : new Date(v).toISOString());

  const reunioes: ReuniaoDaPauta[] = [];
  const completar = (
    base: Pick<
      ReuniaoDaPauta,
      'origem' | 'reuniaoId' | 'inicio' | 'fim' | 'evento' | 'link' | 'reagendamento' | 'remarcadaDe'
    >,
    contactId: string | null,
    desde: string | null,
    conversaDaLinha: string | null,
  ) => {
    const chave = `${base.origem}:${base.reuniaoId}`;
    const marcos = d.marcos.get(chave) ?? [];
    const entradas = contactId ? (d.trilha.get(contactId) ?? []) : [];
    const n = contactId ? negocioDoContato(negociosPorContato.get(contactId) ?? [], base.inicio) : null;
    const conversa = contactId ? d.conversas.get(contactId) : undefined;
    const proxima = seguinteDe(iniciosPorContato, contactId, base.inicio);
    const corte = seguinteDe(cortesPorContato, contactId, base.inicio);
    const proximaEm = isoOuNulo(proxima);
    // A trilha desta reunião vai até a próxima reunião OU até o horário do
    // Calendly que a ficha remarcou, o que vier antes.
    const ateDaTrilha = isoOuNulo(
      proxima === null ? corte : corte === null ? proxima : Math.min(proxima, corte),
    );
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
      qualificada: qualificacaoDaReuniao({ desde, ate: ateDaTrilha, dealId, marcos, entradas, etapas: etapaPorId }),
      resultado: resultadoDaReuniao({ inicio: base.inicio, ate: ateDaTrilha, dealId, marcos, entradas, etapas: etapaPorId }),
      faltouAntes: faltouAntes({ inicio: base.inicio, entradas, etapas: etapaPorId }),
      aguardandoDesde: conversa?.aguardando_desde ?? null,
    });
  };

  const deAgenda = d.agenda.filter((a) => a.status !== 'cancelada' && ms(a.starts_at) !== null);
  for (const a of deAgenda) anotarInicio(a.contact_id, a.starts_at);

  // REMARCADA PELA FICHA. O operador move no Google Agenda a reunião que JÁ
  // PASSOU (o Calendly só remarca a futura, e aí avisa o CRM) e acerta à mão o
  // campo "Data e Hora Reunião", que os lembretes leem. Pedido do operador
  // (03/10/2026): a pauta acompanha o campo. A ÚLTIMA reunião de pé do
  // Calendly do contato vai para a data da ficha — a mesma chave, então o
  // marco da tela continua servindo (o registrado antes do horário novo não
  // conta, como na agenda que muda de data).
  //
  // ⚠️ Só remarca quando a data da ficha é MAIS NOVA que todo agendamento do
  // contato, inclusive os cancelados e os substituídos, e que a agenda do CRM:
  // - no caso comum o Calendly (e a iMotion, ~1 s depois) grava no campo o
  //   MESMO instante do agendamento — igual não é mais novo;
  // - o cancelamento não apaga o campo (1013): a data de um agendamento
  //   desistido é igual à dele e não arrasta a reunião anterior para ela.
  // Contato sem reunião de pé no Calendly não ganha reunião só pela ficha:
  // não há o que remarcar, nem chave para o marco.
  const ultimoAgendamento = new Map<string, number>();
  const anotarAgendamento = (contactId: string | null, inicio: string | null) => {
    const v = ms(inicio);
    if (!contactId || v === null) return;
    ultimoAgendamento.set(contactId, Math.max(ultimoAgendamento.get(contactId) ?? -Infinity, v));
  };
  for (const l of d.calendly) anotarAgendamento(l.contact_id, l.inicio);
  for (const a of deAgenda) anotarAgendamento(a.contact_id, a.starts_at);

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
  const deCalendly: { r: ReuniaoExterna; linha: LinhaDoCalendlyDaPauta; remarcadaPara: number | null }[] = [];
  for (const linhas of porContato.values()) {
    const porId = new Map(linhas.map((l) => [l.id, l]));
    const dePe: (typeof deCalendly)[number][] = [];
    for (const r of montarReunioesExternas(linhas, d.cancelados, [])) {
      const linha = porId.get(r.id);
      if (r.desmarcada !== null || !linha) continue;
      dePe.push({ r, linha, remarcadaPara: null });
    }
    const contactId = linhas[0]?.contact_id ?? null;
    const daFicha = contactId ? ms(d.datasDaFicha.get(contactId)) : null;
    const ultimo = contactId ? ultimoAgendamento.get(contactId) : undefined;
    if (daFicha !== null && ultimo !== undefined && daFicha > ultimo && dePe.length > 0) {
      const maisNova = dePe.reduce((a, b) => ((ms(b.r.inicio) ?? -Infinity) > (ms(a.r.inicio) ?? -Infinity) ? b : a));
      maisNova.remarcadaPara = daFicha;
    }
    for (const x of dePe) {
      if (x.remarcadaPara === null) {
        anotarInicio(x.linha.contact_id, x.r.inicio);
      } else {
        // A próxima reunião é a da ficha; o horário do Calendly só corta a trilha.
        anotarInicio(x.linha.contact_id, new Date(x.remarcadaPara).toISOString());
        anotarEm(cortesPorContato, x.linha.contact_id, x.r.inicio);
      }
    }
    deCalendly.push(...dePe);
  }

  for (const { r, linha, remarcadaPara } of deCalendly) {
    const inicio = remarcadaPara === null ? r.inicio : new Date(remarcadaPara).toISOString();
    if (!dentro(inicio, d.janela)) continue;
    // A duração do agendamento acompanha o horário novo.
    const inicioMs = ms(r.inicio);
    const fimMs = ms(r.fim);
    const fim =
      remarcadaPara === null || inicioMs === null || fimMs === null
        ? r.fim
        : new Date(remarcadaPara + (fimMs - inicioMs)).toISOString();
    completar(
      {
        origem: 'calendly',
        reuniaoId: r.id,
        inicio,
        fim,
        evento: r.evento,
        link: r.link,
        reagendamento: r.reagendamento || remarcadaPara !== null,
        remarcadaDe: remarcadaPara === null ? null : r.inicio,
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
        remarcadaDe: null,
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
