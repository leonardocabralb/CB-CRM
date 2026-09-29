import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { identidadeDoContato, type ContatoIdentificavel } from '@/lib/contacts/identidade';
import { DEGRAUS, ehDegrau, indiceDoDegrau } from '@/lib/funil/degraus';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  montarPauta,
  type LinhaDaAgenda,
  type LinhaDoCalendlyDaPauta,
  type LinhaDoNegocio,
} from '@/lib/reunioes/montar';
import type { EntradaDaTrilha, EtapaDoFunil, LinhaDoMarco, MarcaDaEtapa } from '@/lib/reunioes/pauta';

/** A janela mais larga que a tela pede: a semana à vista + os 30 dias da rede de segurança. */
const JANELA_MAXIMA_MS = 120 * 24 * 60 * 60_000;
/** Ids por `.in()`: a lista vai na URL do PostgREST. */
const LOTE = 100;
/** Página das leituras que podem passar do teto de 1000 linhas do PostgREST. */
const PAGINA = 1000;

const CAMPOS = { tamanho_da_divida: 'divida', tempo_de_atraso: 'atraso', origem_da_divida: 'origem' } as const;
type ChaveDoCampo = keyof typeof CAMPOS;

function lotes<T>(lista: T[]): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < lista.length; i += LOTE) saida.push(lista.slice(i, i + LOTE));
  return saida;
}

/** Instante com fuso escrito (`Z` ou `±HH:MM`): sem ele o Postgres leria como UTC. */
function instanteDoParametro(v: string | null): Date | null {
  if (!v || !/(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function marcaDaEtapa(v: unknown): MarcaDaEtapa | null {
  return v === 'qualificada' || v === 'compareceu' || v === 'faltou' ? v : null;
}

/**
 * GET /api/cb/reunioes?de=<ISO>&ate=<ISO> — a pauta de reuniões da tela
 * `/reunioes` (plano: `docs/PLANO-pauta-de-reunioes.md`): as reuniões do
 * Calendly e da agenda do CRM que começam na janela, cada uma com o contato, a
 * conversa, o card, o que o formulário deixou na ficha (dívida, atraso,
 * origem), se foi marcada qualificada, o resultado e se o lead já faltou antes.
 * Mais, por funil, para qual etapa cada botão leva o card.
 *
 * ⚠️ Por ROTA porque `cb_calendly_eventos` é fechada ao navegador (guarda
 * telefone, e-mail e as respostas do formulário): do cliente devolveria vazio
 * com `error: null`, e a tela afirmaria "nenhuma reunião". Daqui sai só o que
 * a tela mostra.
 *
 * Qualquer membro lê; o recorte por funil do perfil é feito na tela (a mesma
 * régua do painel da conversa, `funilNoEscopo`). Toda consulta leva
 * `account_id`. Erro de leitura é 500, nunca lista vazia.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(`cb:reunioes:${ctx.userId}`, RATE_LIMITS.pautaDeReunioes);
    if (!limit.success) return rateLimitResponse(limit);

    const url = new URL(request.url);
    const de = instanteDoParametro(url.searchParams.get('de'));
    const ate = instanteDoParametro(url.searchParams.get('ate'));
    if (!de || !ate || ate <= de || ate.getTime() - de.getTime() > JANELA_MAXIMA_MS) {
      return NextResponse.json({ error: 'janela_invalida' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const conta = ctx.accountId;

    // 1. As reuniões que começam na janela.
    const SELECT_DO_CALENDLY =
      'id, contact_id, invitee_uri, event_type_uri, event_type_nome, inicio, fim, link, recebido_em, situacao:variaveis->>agendamento_situacao';
    const [naJanela, agenda] = await Promise.all([
      admin
        .from('cb_calendly_eventos')
        .select(SELECT_DO_CALENDLY)
        .eq('account_id', conta)
        .eq('evento', 'invitee.created')
        .gte('inicio', de.toISOString())
        .lte('inicio', ate.toISOString())
        .limit(PAGINA),
      admin
        .from('cb_meetings')
        .select('id, contact_id, conversation_id, titulo, local, starts_at, ends_at, status, created_at')
        .eq('account_id', conta)
        .gte('starts_at', de.toISOString())
        .lte('starts_at', ate.toISOString())
        .neq('status', 'cancelada')
        .limit(PAGINA),
    ]);
    if (naJanela.error) throw new Error(`calendly: ${naJanela.error.message}`);
    if (agenda.error) throw new Error(`agenda: ${agenda.error.message}`);
    // ⚠️ Mais de mil numa janela de 120 dias não acontece aqui (~30 por
    // semana); se acontecer, falha VISÍVEL em vez de pauta pela metade.
    if ((naJanela.data ?? []).length >= PAGINA || (agenda.data ?? []).length >= PAGINA) {
      throw new Error('janela com reuniões demais para uma leitura');
    }

    const linhasDaJanela = (naJanela.data ?? []) as unknown as LinhaDoCalendlyDaPauta[];
    const linhasDaAgenda = (agenda.data ?? []) as LinhaDaAgenda[];
    const contatos = [
      ...new Set(
        [...linhasDaJanela.map((l) => l.contact_id), ...linhasDaAgenda.map((a) => a.contact_id)].filter(
          (id): id is string => typeof id === 'string',
        ),
      ),
    ];

    // 2. TODO o Calendly desses contatos: a inferência do convite substituído
    //    por reagendamento compara com agendamentos fora da janela também.
    const calendly: LinhaDoCalendlyDaPauta[] = [...linhasDaJanela.filter((l) => !l.contact_id)];
    for (const ids of lotes(contatos)) {
      const { data, error } = await admin
        .from('cb_calendly_eventos')
        .select(SELECT_DO_CALENDLY)
        .eq('account_id', conta)
        .eq('evento', 'invitee.created')
        .in('contact_id', ids)
        .limit(PAGINA);
      if (error) throw new Error(`calendly dos contatos: ${error.message}`);
      if ((data ?? []).length >= PAGINA) throw new Error('agendamentos demais para uma leitura');
      calendly.push(...((data ?? []) as unknown as LinhaDoCalendlyDaPauta[]));
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
        admin
          .from('deals')
          .select('id, contact_id, pipeline_id, stage_id, value, status, created_at')
          .eq('account_id', conta)
          .in('contact_id', ids)
          .limit(PAGINA),
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
      if (deals.error) throw new Error(`negócios: ${deals.error.message}`);
      if ((deals.data ?? []).length >= PAGINA) throw new Error('negócios demais para uma leitura');
      if (vals.error) throw new Error(`campos: ${vals.error.message}`);

      // O nome, senão o telefone, senão o `@` (ficha só do Instagram ou só com
      // o BSUID do WhatsApp). Nulo = a tela escreve o seu "sem nome".
      for (const x of (c.data ?? []) as (ContatoIdentificavel & { id: string })[]) {
        nomes.set(x.id, x.name?.trim() || identidadeDoContato(x));
      }
      for (const x of (conv.data ?? []) as { id: string; contact_id: string; aguardando_desde: string | null }[]) {
        conversas.set(x.contact_id, { id: x.id, aguardando_desde: x.aguardando_desde });
      }
      negocios.push(...((deals.data ?? []) as LinhaDoNegocio[]));
      for (const v of (vals.data ?? []) as { contact_id: string; custom_field_id: string; value: string | null }[]) {
        const chave = campoPorId.get(v.custom_field_id);
        const texto = v.value?.trim();
        if (!chave || !texto) continue;
        const atual = valores.get(v.contact_id) ?? { divida: null, atraso: null, origem: null };
        atual[CAMPOS[chave]] = texto;
        valores.set(v.contact_id, atual);
      }

      // A trilha: entradas em etapas que contam, paginada (um contato antigo
      // pode ter dezenas de movimentos).
      if (etapasQueContam.length > 0) {
        for (let pagina = 0; ; pagina++) {
          const { data, error } = await admin
            .from('cb_lead_events')
            .select('id, contact_id, occurred_at, to_stage_id, to_stage_label, actor_label')
            .eq('account_id', conta)
            .in('contact_id', ids)
            .in('event_type', ['stage_changed', 'deal_created', 'pipeline_changed'])
            .in('to_stage_id', etapasQueContam)
            .order('id')
            .range(pagina * PAGINA, (pagina + 1) * PAGINA - 1);
          if (error) throw new Error(`trilha: ${error.message}`);
          const linhas = (data ?? []) as {
            contact_id: string | null;
            occurred_at: string;
            to_stage_id: string;
            to_stage_label: string | null;
            actor_label: string | null;
          }[];
          for (const l of linhas) {
            if (!l.contact_id) continue;
            const lista = trilha.get(l.contact_id) ?? [];
            lista.push({ em: l.occurred_at, etapaId: l.to_stage_id, etapa: l.to_stage_label, por: l.actor_label });
            trilha.set(l.contact_id, lista);
          }
          if (linhas.length < PAGINA) break;
        }
      }
    }

    // 5. O que a tela já marcou nestas reuniões.
    const marcos = new Map<string, LinhaDoMarco[]>();
    const idsDasReunioes = [...calendly.map((l) => l.id), ...linhasDaAgenda.map((a) => a.id)];
    for (const ids of lotes([...new Set(idsDasReunioes)])) {
      const { data, error } = await admin
        .from('cb_reunioes_marcos')
        .select('origem, reuniao_id, marco, resultado, valor, registrado_por_nome, registrado_em')
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

    const pauta = montarPauta({
      janela: { de, ate },
      calendly,
      cancelados,
      agenda: linhasDaAgenda,
      contatos: nomes,
      conversas,
      negocios,
      pipelines: new Map(((pipelines.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])),
      etapas,
      campos: valores,
      trilha,
      marcos,
    });
    return NextResponse.json(pauta);
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      console.error('[reunioes] leitura falhou:', err.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
