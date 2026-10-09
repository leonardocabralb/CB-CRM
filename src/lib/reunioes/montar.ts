import { montarReunioesExternas, type LinhaDoCalendly, type ReuniaoExterna } from '@/lib/agenda/reunioes-externas';

import {
  alvosDoFunil,
  faltouAntes,
  marcoValeParaAReuniao,
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

/** Uma reunião de pé do contato, como as vizinhas a enxergam (em ms). */
interface ReuniaoDePe {
  chave: string;
  inicio: number;
  /** Quando foi agendada (Calendly: `recebido_em`; agenda: `created_at`). */
  agendadaEm: number | null;
  /** Quando a pauta gravou o Reagendar para este horário (1081, pelo marco); nulo = não foi. */
  reagendadaEm: number | null;
}

/** A vizinhança de uma reunião (ms): ver `calcularVizinhancas` em `montarPauta`. */
interface Vizinhanca {
  proxima: number | null;
  anterior: number | null;
  /** Onde fecha a trilha da reunião. */
  ate: number | null;
  /** Onde fecha a janela da ENTRADA em "Reagendar" (`resultadoDaReuniao`). */
  ateDoReagendar: number | null;
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
  // o que diz qual é a próxima e a anterior. Montada antes, para a janela não
  // esconder a reunião vizinha que cai fora dela.
  const dePePorContato = new Map<string, ReuniaoDePe[]>();
  // O horário do Calendly que a ficha remarcou: NÃO é reunião (a tela não o
  // cita como "a próxima"), mas fecha a janela da trilha da reunião anterior —
  // o no show daquele horário não a resolve.
  const cortesPorContato = new Map<string, number[]>();
  const anotarCorte = (contactId: string | null, inicio: string) => {
    const v = ms(inicio);
    if (!contactId || v === null) return;
    const lista = cortesPorContato.get(contactId) ?? [];
    lista.push(v);
    cortesPorContato.set(contactId, lista);
  };
  // Quando o Reagendar da pauta foi gravado para ESTE horário (1081); nulo =
  // não foi. Pelo MARCO: é ele que sabe de qual horário o Reagendar é.
  const marcoDoReagendarEm = (chave: string, inicio: string): number | null => {
    const m = (d.marcos.get(chave) ?? []).find(
      (x) => x.marco === 'resultado' && x.resultado === 'reagendar' && marcoValeParaAReuniao(x, inicio),
    );
    return m ? ms(m.registrado_em) : null;
  };
  const anotarDePe = (contactId: string | null, chave: string, inicio: string, agendadaEm: string | null) => {
    const v = ms(inicio);
    if (!contactId || v === null) return;
    const lista = dePePorContato.get(contactId) ?? [];
    lista.push({ chave, inicio: v, agendadaEm: ms(agendadaEm), reagendadaEm: marcoDoReagendarEm(chave, inicio) });
    dePePorContato.set(contactId, lista);
  };
  const menor = (xs: (number | null)[]): number | null => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length > 0 ? Math.min(...v) : null;
  };
  const maior = (xs: number[]): number | null => (xs.length > 0 ? Math.max(...xs) : null);
  const isoOuNulo = (v: number | null): string | null => (v === null ? null : new Date(v).toISOString());

  // A VIZINHANÇA de cada reunião de pé: a próxima e a anterior do contato e
  // onde fecha a trilha dela. ⚠️ O Reagendar antes do horário (1081) mexe nas
  // vizinhas, e as regras saíram da revisão do PR #395 (Codex e revisor):
  // 1. A reagendada não vai acontecer: não é "a próxima" de quem começa DEPOIS
  //    do Reagendar dela (a substituta, inclusive a ANTECIPADA pelo link
  //    manual, ficaria só registrando, com a trilha cortada). Para quem já
  //    tinha começado, segue a próxima: o card é dela.
  // 2. Ela só sai da conta se o resultado FINAL dela continua Reagendar: a
  //    corrigida depois pelo quadro (No Show, Proposta) volta a ser fronteira,
  //    senão a entrada dela cairia na reunião anterior.
  // 3. A reagendada fecha a trilha no agendamento da SUBSTITUTA (agendada
  //    depois do Reagendar): senão herdava o no show ou a proposta dela.
  // 4. A ENTRADA em "Reagendar" só vale até o agendamento de outra reunião
  //    feito depois do início desta: dali em diante é o Reagendar ANTES do
  //    horário da outra, e resolveria esta por cima do no show dela.
  // A próxima de uma reunião só depende das POSTERIORES: por isso a conta vai
  // da mais nova para a mais antiga, sem ciclo. A anterior (só para
  // `comoMarcar`) sai numa segunda volta, com o resultado de todas.
  const vizinhancas = new Map<string, Vizinhanca>();
  const calcularVizinhancas = () => {
    for (const [contactId, lista] of dePePorContato) {
      const entradas = d.trilha.get(contactId) ?? [];
      const negocios = negociosPorContato.get(contactId) ?? [];
      const cortes = cortesPorContato.get(contactId) ?? [];
      // Quando a reunião foi reagendada, se o resultado FINAL dela é Reagendar.
      const reagendadaDeFato = new Map<string, number | null>();
      for (const x of [...lista].sort((a, b) => b.inicio - a.inicio)) {
        const outras = lista.filter((y) => y.chave !== x.chave);
        const proxima = menor(
          outras
            .filter((y) => {
              if (y.inicio <= x.inicio) return false;
              const em = reagendadaDeFato.get(y.chave) ?? null;
              return !(em !== null && x.inicio > em);
            })
            .map((y) => y.inicio),
        );
        // Até a próxima reunião OU o horário do Calendly que a ficha remarcou.
        let ate = menor([proxima, menor(cortes.filter((c) => c > x.inicio))]);
        if (x.reagendadaEm !== null) {
          const depois = x.reagendadaEm;
          ate = menor([ate, menor(outras.filter((y) => y.agendadaEm !== null && y.agendadaEm > depois).map((y) => y.agendadaEm))]);
        }
        const ateDoReagendar = menor([
          ate,
          menor(outras.filter((y) => y.agendadaEm !== null && y.agendadaEm > x.inicio).map((y) => y.agendadaEm)),
        ]);
        const v: Vizinhanca = { proxima, anterior: null, ate, ateDoReagendar };
        vizinhancas.set(x.chave, v);
        const inicio = new Date(x.inicio).toISOString();
        const resultado = resultadoDaReuniao({
          inicio,
          ate: isoOuNulo(ate),
          ateDoReagendar: isoOuNulo(ateDoReagendar),
          dealId: negocioDoContato(negocios, inicio)?.id ?? null,
          marcos: d.marcos.get(x.chave) ?? [],
          entradas,
          etapas: etapaPorId,
        });
        reagendadaDeFato.set(x.chave, x.reagendadaEm !== null && resultado?.tipo === 'reagendar' ? x.reagendadaEm : null);
      }
      for (const x of lista) {
        const v = vizinhancas.get(x.chave);
        if (v) {
          v.anterior = maior(
            lista
              .filter((y) => y.chave !== x.chave && y.inicio < x.inicio && (reagendadaDeFato.get(y.chave) ?? null) === null)
              .map((y) => y.inicio),
          );
        }
      }
    }
  };

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
    // Sem contato não há vizinha nem trilha: só o marco resolve.
    const v = vizinhancas.get(chave) ?? { proxima: null, anterior: null, ate: null, ateDoReagendar: null };
    const ateDaTrilha = isoOuNulo(v.ate);
    const dealId = n?.id ?? null;
    reunioes.push({
      ...base,
      chave,
      proximaEm: isoOuNulo(v.proxima),
      anteriorEm: isoOuNulo(v.anterior),
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
      resultado: resultadoDaReuniao({
        inicio: base.inicio,
        ate: ateDaTrilha,
        ateDoReagendar: isoOuNulo(v.ateDoReagendar),
        dealId,
        marcos,
        entradas,
        etapas: etapaPorId,
      }),
      faltouAntes: faltouAntes({ inicio: base.inicio, entradas, etapas: etapaPorId }),
      aguardandoDesde: conversa?.aguardando_desde ?? null,
    });
  };

  const deAgenda = d.agenda.filter((a) => a.status !== 'cancelada' && ms(a.starts_at) !== null);
  for (const a of deAgenda) anotarDePe(a.contact_id, `agenda:${a.id}`, a.starts_at, a.created_at);

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
      const chave = `calendly:${x.r.id}`;
      if (x.remarcadaPara === null) {
        anotarDePe(x.linha.contact_id, chave, x.r.inicio, x.linha.recebido_em);
      } else {
        // A próxima reunião é a da ficha; o horário do Calendly só corta a
        // trilha. O agendamento continua o do Calendly (a ficha não diz quando
        // foi remarcada).
        anotarDePe(x.linha.contact_id, chave, new Date(x.remarcadaPara).toISOString(), x.linha.recebido_em);
        anotarCorte(x.linha.contact_id, x.r.inicio);
      }
    }
    deCalendly.push(...dePe);
  }

  calcularVizinhancas();

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
