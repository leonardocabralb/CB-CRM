import type { SupabaseClient } from '@supabase/supabase-js';

import { instanteCanonico } from '@/lib/contacts/campo-data';
import { identidadeDoContato, type ContatoIdentificavel } from '@/lib/contacts/identidade';
import { DEGRAUS, ehDegrau, indiceDoDegrau } from '@/lib/funil/degraus';

import type { DadosDaPauta, LinhaDaAgenda, LinhaDoCalendlyDaPauta, LinhaDoNegocio } from './montar';
import type { EntradaDaTrilha, EtapaDoFunil, LinhaDoMarco, MarcaDaEtapa } from './pauta';
import type { PassoDeFunil } from './resumo';

/**
 * A CARGA da pauta de reuniões: tudo o que `montarPauta` precisa, lido com o
 * service role e cercado pela conta em TODA consulta. Serve às duas rotas —
 * a pauta (`/api/cb/reunioes`, a tela `/reunioes`) e o resumo do Desempenho
 * (`/api/cb/reunioes/resumo`) —, para as duas verem as MESMAS reuniões com o
 * MESMO resultado. Erro de leitura LANÇA (a rota responde 500, nunca lista
 * vazia).
 *
 * ⚠️ O que pode passar de 1000 linhas (o PostgREST corta sem avisar) é
 * paginado pela CHAVE (`paginarPorChave`): as reuniões da janela — o resumo
 * pede "Total" —, a data da ficha da conta inteira, o histórico (agenda,
 * Calendly e negócios) de cada lote de contatos e a trilha. Por posição, a
 * escrita concorrente (o Calendly, a iMotion, quem move o card) pula ou repete
 * linha.
 */

/** Ids por `.in()`: a lista vai na URL do PostgREST. */
const LOTE = 100;
/** Página das leituras que podem passar do teto de 1000 linhas do PostgREST. */
const PAGINA = 1000;

const CAMPOS = { tamanho_da_divida: 'divida', tempo_de_atraso: 'atraso', origem_da_divida: 'origem' } as const;
type ChaveDoCampo = keyof typeof CAMPOS;
/** "Data e Hora Reunião": a data que os lembretes leem e que remarca a reunião na pauta (`montarPauta`). */
const CAMPO_DA_REUNIAO = 'data_e_hora_reuniao';

const SELECT_DO_CALENDLY =
  'id, contact_id, invitee_uri, event_type_uri, event_type_nome, inicio, fim, link, recebido_em, situacao:variaveis->>agendamento_situacao';
const SELECT_DA_AGENDA = 'id, contact_id, conversation_id, titulo, local, starts_at, ends_at, status, created_at';

function lotes<T>(lista: T[]): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < lista.length; i += LOTE) saida.push(lista.slice(i, i + LOTE));
  return saida;
}

/** Instante com fuso escrito (`Z` ou `±HH:MM`): sem ele o Postgres leria como UTC. */
export function instanteDoParametro(v: string | null): Date | null {
  if (!v || !/(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function marcaDaEtapa(v: unknown): MarcaDaEtapa | null {
  return v === 'qualificada' || v === 'compareceu' || v === 'faltou' || v === 'reagendar' ? v : null;
}

type Pagina = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * Lê TODAS as páginas de uma consulta ordenada por `id`: cada página pede o
 * que vem depois do último id recebido (`pagina(depoisDe)` aplica o
 * `.order('id')`, o `.limit(PAGINA)` e o `.gt('id', depoisDe)`).
 */
async function paginarPorChave<T extends { id: string }>(rotulo: string, pagina: (depoisDe: string | null) => Pagina): Promise<T[]> {
  const saida: T[] = [];
  let depoisDe: string | null = null;
  for (;;) {
    const { data, error } = await pagina(depoisDe);
    if (error) throw new Error(`${rotulo}: ${error.message}`);
    const linhas = (data ?? []) as T[];
    saida.push(...linhas);
    if (linhas.length < PAGINA) return saida;
    depoisDe = linhas[linhas.length - 1].id;
  }
}

/**
 * As reuniões que começam na janela `[de, ate]` (Calendly e agenda do CRM) e
 * tudo o que a pauta precisa delas. A janela é da ROTA (a pauta limita a 120
 * dias; o resumo aceita desde o começo).
 */
export async function carregarDadosDaPauta(
  admin: SupabaseClient,
  conta: string,
  janela: { de: Date; ate: Date },
): Promise<DadosDaPauta> {
  const { de, ate } = janela;

  // 1. As reuniões que começam na janela.
  const [linhasDaJanela, linhasDaAgenda] = await Promise.all([
    paginarPorChave<LinhaDoCalendlyDaPauta>('calendly', (depoisDe) => {
      let q = admin
        .from('cb_calendly_eventos')
        .select(SELECT_DO_CALENDLY)
        .eq('account_id', conta)
        .eq('evento', 'invitee.created')
        .gte('inicio', de.toISOString())
        .lte('inicio', ate.toISOString())
        .order('id')
        .limit(PAGINA);
      if (depoisDe) q = q.gt('id', depoisDe);
      return q;
    }),
    paginarPorChave<LinhaDaAgenda>('agenda', (depoisDe) => {
      let q = admin
        .from('cb_meetings')
        .select(SELECT_DA_AGENDA)
        .eq('account_id', conta)
        .gte('starts_at', de.toISOString())
        .lte('starts_at', ate.toISOString())
        .neq('status', 'cancelada')
        .order('id')
        .limit(PAGINA);
      if (depoisDe) q = q.gt('id', depoisDe);
      return q;
    }),
  ]);

  // 1b. A data da FICHA de todos os contatos: ela remarca a última reunião do
  //     Calendly (`montarPauta`). Toda, e não só a da janela: o contato cuja
  //     reunião do Calendly está na janela pode ter sido remarcado para FORA
  //     dela, e o remarcado PARA a janela tem o agendamento fora dela. O
  //     valor é TEXT (formas diferentes do mesmo instante): a janela se
  //     confere aqui, pelo instante canônico, nunca no SQL.
  const datasDaFicha = new Map<string, string>();
  const campoDaReuniao = await admin
    .from('custom_fields')
    .select('id')
    .eq('account_id', conta)
    .eq('field_key', CAMPO_DA_REUNIAO);
  if (campoDaReuniao.error) throw new Error(`campo da reunião: ${campoDaReuniao.error.message}`);
  const idsDoCampo = ((campoDaReuniao.data ?? []) as { id: string }[]).map((c) => c.id);
  if (idsDoCampo.length > 0) {
    // Paginada pela CHAVE: o Calendly e a iMotion gravam no campo a qualquer
    // momento, e a página por posição pularia linha.
    const valores = await paginarPorChave<{ id: string; contact_id: string; value: string | null }>(
      'datas da ficha',
      (depoisDe) => {
        let q = admin
          .from('contact_custom_values')
          .select('id, contact_id, value, contacts!inner(account_id)')
          .in('custom_field_id', idsDoCampo)
          .eq('contacts.account_id', conta)
          .order('id')
          .limit(PAGINA);
        if (depoisDe) q = q.gt('id', depoisDe);
        return q;
      },
    );
    for (const l of valores) {
      const instante = instanteCanonico(l.value);
      if (instante) datasDaFicha.set(l.contact_id, instante);
    }
  }
  const remarcadosParaAJanela = [...datasDaFicha]
    .filter(([, instante]) => {
      const v = Date.parse(instante);
      return v >= de.getTime() && v <= ate.getTime();
    })
    .map(([contactId]) => contactId);

  const contatos = [
    ...new Set(
      [
        ...linhasDaJanela.map((l) => l.contact_id),
        ...linhasDaAgenda.map((a) => a.contact_id),
        ...remarcadosParaAJanela,
      ].filter((id): id is string => typeof id === 'string'),
    ),
  ];

  // 2. TODO o Calendly desses contatos: a inferência do convite substituído
  //    por reagendamento compara com agendamentos fora da janela também.
  const calendly: LinhaDoCalendlyDaPauta[] = [...linhasDaJanela.filter((l) => !l.contact_id)];
  // E TODA a agenda do CRM desses contatos: a próxima reunião de um contato
  // (que decide se o card ainda é desta reunião) pode cair fora da janela.
  const agendaPorId = new Map(linhasDaAgenda.map((a) => [a.id, a]));
  // Pela CHAVE também: no "Total" do resumo os contatos podem ser a conta
  // inteira, e um lote com mil agendamentos antigos estourava (Codex, PR #396).
  for (const ids of lotes(contatos)) {
    const linhas = await paginarPorChave<LinhaDaAgenda>('agenda dos contatos', (depoisDe) => {
      let q = admin
        .from('cb_meetings')
        .select(SELECT_DA_AGENDA)
        .eq('account_id', conta)
        .neq('status', 'cancelada')
        .in('contact_id', ids)
        .order('id')
        .limit(PAGINA);
      if (depoisDe) q = q.gt('id', depoisDe);
      return q;
    });
    for (const a of linhas) agendaPorId.set(a.id, a);
  }
  for (const ids of lotes(contatos)) {
    const linhas = await paginarPorChave<LinhaDoCalendlyDaPauta>('calendly dos contatos', (depoisDe) => {
      let q = admin
        .from('cb_calendly_eventos')
        .select(SELECT_DO_CALENDLY)
        .eq('account_id', conta)
        .eq('evento', 'invitee.created')
        .in('contact_id', ids)
        .order('id')
        .limit(PAGINA);
      if (depoisDe) q = q.gt('id', depoisDe);
      return q;
    });
    calendly.push(...linhas);
  }
  const cancelados = new Set<string>();
  for (const uris of lotes([...new Set(calendly.map((l) => l.invitee_uri))])) {
    const { data, error } = await admin
      .from('cb_calendly_eventos')
      .select('invitee_uri')
      .eq('account_id', conta)
      .eq('evento', 'invitee.canceled')
      .in('invitee_uri', uris);
    if (error) throw new Error(`cancelamentos: ${error.message}`);
    for (const l of data ?? []) cancelados.add(l.invitee_uri as string);
  }

  // 3. Funis e etapas da conta (o mapa de destinos dos botões e a leitura da trilha).
  const [pipelines, etapasCruas, campos] = await Promise.all([
    admin.from('pipelines').select('id, name').eq('account_id', conta),
    admin
      .from('pipeline_stages')
      .select('id, pipeline_id, name, position, degrau, desfecho_da_reuniao, pipelines!inner(account_id)')
      .eq('pipelines.account_id', conta),
    admin.from('custom_fields').select('id, field_key').eq('account_id', conta).in('field_key', Object.keys(CAMPOS)),
  ]);
  if (pipelines.error) throw new Error(`funis: ${pipelines.error.message}`);
  if (etapasCruas.error) throw new Error(`etapas: ${etapasCruas.error.message}`);
  if (campos.error) throw new Error(`campos: ${campos.error.message}`);

  const etapas: EtapaDoFunil[] = (
    (etapasCruas.data ?? []) as {
      id: string;
      pipeline_id: string;
      name: string;
      position: number;
      degrau: string | null;
      desfecho_da_reuniao: string | null;
    }[]
  ).map((e) => ({
    id: e.id,
    pipelineId: e.pipeline_id,
    nome: e.name,
    posicao: e.position,
    degrau: e.degrau,
    marca: marcaDaEtapa(e.desfecho_da_reuniao),
  }));
  // Só as etapas que a pauta lê na trilha: as marcadas e as de proposta em
  // diante. É o que mantém a leitura da trilha pequena.
  const INDICE_DA_PROPOSTA = DEGRAUS.indexOf('proposta');
  const etapasQueContam = etapas
    .filter((e) => e.marca !== null || (ehDegrau(e.degrau) && indiceDoDegrau(e.degrau) >= INDICE_DA_PROPOSTA))
    .map((e) => e.id);

  const campoPorId = new Map(
    ((campos.data ?? []) as { id: string; field_key: string }[]).map((c) => [c.id, c.field_key as ChaveDoCampo]),
  );

  // 4. Por contato: nome, conversa, card, campos e trilha.
  const nomes = new Map<string, string | null>();
  const conversas = new Map<string, { id: string; aguardando_desde: string | null }>();
  const negocios: LinhaDoNegocio[] = [];
  const valores = new Map<string, { divida: string | null; atraso: string | null; origem: string | null }>();
  const trilha = new Map<string, EntradaDaTrilha[]>();

  for (const ids of lotes(contatos)) {
    const [c, conv, deals, vals] = await Promise.all([
      admin
        .from('contacts')
        .select('id, name, phone, wa_username, instagram_username')
        .eq('account_id', conta)
        .in('id', ids),
      admin
        .from('conversations')
        .select('id, contact_id, aguardando_desde')
        .eq('account_id', conta)
        .is('group_id', null)
        .in('contact_id', ids),
      paginarPorChave<LinhaDoNegocio>('negócios', (depoisDe) => {
        let q = admin
          .from('deals')
          .select('id, contact_id, pipeline_id, stage_id, value, status, created_at')
          .eq('account_id', conta)
          .in('contact_id', ids)
          .order('id')
          .limit(PAGINA);
        if (depoisDe) q = q.gt('id', depoisDe);
        return q;
      }),
      campoPorId.size > 0
        ? admin
            .from('contact_custom_values')
            .select('contact_id, custom_field_id, value')
            .in('contact_id', ids)
            .in('custom_field_id', [...campoPorId.keys()])
            .limit(PAGINA)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (c.error) throw new Error(`contatos: ${c.error.message}`);
    if (conv.error) throw new Error(`conversas: ${conv.error.message}`);
    if (vals.error) throw new Error(`campos: ${vals.error.message}`);

    // O nome, senão o telefone, senão o `@` (ficha só do Instagram ou só com
    // o BSUID do WhatsApp). Nulo = a tela escreve o seu "sem nome".
    for (const x of (c.data ?? []) as (ContatoIdentificavel & { id: string })[]) {
      nomes.set(x.id, x.name?.trim() || identidadeDoContato(x));
    }
    for (const x of (conv.data ?? []) as { id: string; contact_id: string; aguardando_desde: string | null }[]) {
      conversas.set(x.contact_id, { id: x.id, aguardando_desde: x.aguardando_desde });
    }
    negocios.push(...deals);
    for (const v of (vals.data ?? []) as { contact_id: string; custom_field_id: string; value: string | null }[]) {
      const chave = campoPorId.get(v.custom_field_id);
      const texto = v.value?.trim();
      if (!chave || !texto) continue;
      const atual = valores.get(v.contact_id) ?? { divida: null, atraso: null, origem: null };
      atual[CAMPOS[chave]] = texto;
      valores.set(v.contact_id, atual);
    }

    // A trilha: entradas em etapas que contam, paginada pela chave (um
    // contato antigo pode ter dezenas de movimentos, e o card anda enquanto
    // se lê).
    if (etapasQueContam.length > 0) {
      const linhas = await paginarPorChave<{
        id: string;
        contact_id: string | null;
        deal_id: string | null;
        occurred_at: string;
        to_stage_id: string;
        to_stage_label: string | null;
        actor_label: string | null;
      }>('trilha', (depoisDe) => {
        let q = admin
          .from('cb_lead_events')
          .select('id, contact_id, deal_id, occurred_at, to_stage_id, to_stage_label, actor_label')
          .eq('account_id', conta)
          .in('contact_id', ids)
          .in('event_type', ['stage_changed', 'deal_created', 'pipeline_changed'])
          .in('to_stage_id', etapasQueContam)
          .order('id')
          .limit(PAGINA);
        if (depoisDe) q = q.gt('id', depoisDe);
        return q;
      });
      for (const l of linhas) {
        if (!l.contact_id) continue;
        const lista = trilha.get(l.contact_id) ?? [];
        lista.push({
          em: l.occurred_at,
          dealId: l.deal_id,
          etapaId: l.to_stage_id,
          etapa: l.to_stage_label,
          por: l.actor_label,
        });
        trilha.set(l.contact_id, lista);
      }
    }
  }

  // 5. O que a tela já marcou nestas reuniões.
  const marcos = new Map<string, LinhaDoMarco[]>();
  const idsDasReunioes = [...calendly.map((l) => l.id), ...agendaPorId.keys()];
  for (const ids of lotes([...new Set(idsDasReunioes)])) {
    const { data, error } = await admin
      .from('cb_reunioes_marcos')
      .select('origem, reuniao_id, marco, resultado, valor, registrado_por_nome, registrado_em, inicio')
      .eq('account_id', conta)
      .in('reuniao_id', ids);
    if (error) throw new Error(`marcos: ${error.message}`);
    for (const m of (data ?? []) as LinhaDoMarco[]) {
      const chave = `${m.origem}:${m.reuniao_id}`;
      const lista = marcos.get(chave) ?? [];
      lista.push({ ...m, valor: m.valor === null ? null : Number(m.valor) });
      marcos.set(chave, lista);
    }
  }

  return {
    janela: { de, ate },
    calendly,
    cancelados,
    agenda: [...agendaPorId.values()],
    contatos: nomes,
    conversas,
    negocios,
    pipelines: new Map(((pipelines.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])),
    etapas,
    campos: valores,
    trilha,
    marcos,
    datasDaFicha,
  };
}

/**
 * As ENTRADAS de cada negócio num funil (`deal_created`, `stage_changed`,
 * `pipeline_changed`), com o funil de destino: é de onde o resumo do
 * Desempenho tira o funil do card no início da reunião (`funilNoInstante`).
 * A trilha da pauta não serve: ela só lê as etapas marcadas e as de proposta
 * em diante, e não traz o funil. `status_changed` fica de fora (repete a etapa
 * em que o card já estava).
 */
export async function carregarPassosDosNegocios(
  admin: SupabaseClient,
  conta: string,
  dealIds: readonly string[],
): Promise<Map<string, PassoDeFunil[]>> {
  const passos = new Map<string, PassoDeFunil[]>();
  for (const ids of lotes([...new Set(dealIds)])) {
    const linhas = await paginarPorChave<{ id: string; deal_id: string | null; occurred_at: string; to_pipeline_id: string | null }>(
      'passos dos negócios',
      (depoisDe) => {
        let q = admin
          .from('cb_lead_events')
          .select('id, deal_id, occurred_at, to_pipeline_id')
          .eq('account_id', conta)
          .in('deal_id', ids)
          .in('event_type', ['deal_created', 'stage_changed', 'pipeline_changed'])
          .order('id')
          .limit(PAGINA);
        if (depoisDe) q = q.gt('id', depoisDe);
        return q;
      },
    );
    for (const l of linhas) {
      if (!l.deal_id) continue;
      const lista = passos.get(l.deal_id) ?? [];
      lista.push({ id: l.id, em: l.occurred_at, funil: l.to_pipeline_id });
      passos.set(l.deal_id, lista);
    }
  }
  return passos;
}
