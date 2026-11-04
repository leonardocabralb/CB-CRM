// ============================================================
// Alarmes de conexão no sino — o passo do ciclo do agendador (1122).
//
// Roda no `rodarManutencaoDoCiclo` (laço lento, ~15 min), com a service role:
// mede os dois alarmes de cada conexão de WhatsApp de todas as contas, decide
// pela régua pura (`alarmes-no-sino.ts`) e grava o aviso no sino, o
// `whatsapp_alert` da 1085, que já tem ícone, três linhas e fica fora das
// contagens do resumo do dia.
//
// ⚠️ Por que no ciclo, e não numa rota nova: rota nova no agendador exige
// mudar a stack e um `docker stack deploy` à mão em cada instalação
// (`.claude/rules/deploy.md`). O passo viaja com a imagem.
//
// ⚠️ O aviso sai só para quem GANHA a escrita cercada do estado (raiz, 8e):
// gravar o estado novo é a reivindicação, cercada pelo `avisado_em` e pelo
// `normalizou_em` lidos. Se o aviso não entra no sino, o estado volta ao de
// antes, cercado pelo que este ciclo gravou, e o próximo ciclo tenta de novo.
//
// ⚠️ Toda leitura é por CONTA (`.eq('account_id', …)`): a service role não tem
// RLS, e o aviso de uma conexão vai só à conta dona dela.
//
// NUNCA lança: o passo é isolado no ciclo, e mesmo assim cada conta roda
// dentro do próprio try.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { createTranslator } from 'next-intl';

import { FUSO_PADRAO } from '@/lib/agenda/fuso';
import type { AccountRole } from '@/lib/auth/roles';
import { cortarSemPartir } from '@/lib/notes/anexos';
import type { PerfilDeAcesso } from '@/lib/perfis/tipos';

import {
  decidir,
  destinatarios,
  emHorarioUtil,
  medirAtraso,
  medirSemRecibo,
  textosDoAviso,
  type DetalheDoAlarme,
  type EstadoDoAlarme,
  type Medicao,
  type MembroDaConta,
  type TipoDoAlarme,
  type Tradutor,
} from './alarmes-no-sino';
import { lerEnviosRecentes } from './sem-recibo';
import { ehEvolution, ehMeta } from './transporte';

/** Os tetos do sino, os mesmos da sentinela. */
const MAX_TITULO = 200;
const MAX_CORPO = 500;

const PAGINA_DE_CANAIS = 500;

interface LinhaDoCanal {
  id: string;
  account_id: string;
  kind: string | null;
  label: string;
  entrega_carimbo_em: string | null;
  entrega_recebida_em: string | null;
}

interface LinhaDoEstado {
  channel_id: string;
  tipo: TipoDoAlarme;
  desde: string;
  avisado_em: string | null;
  normalizou_em: string | null;
  detalhe: DetalheDoAlarme | null;
}

interface LinhaDoMembro {
  user_id: string | null;
  account_role: AccountRole | null;
  perfil_id: string | null;
}

const COLUNAS_DO_PERFIL =
  'id, account_id, nome, papel_base, telas, secoes_config, channel_ids, pipeline_ids, sistema';

function erroDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ------------------------------------------------------------
// Idioma da instalação (o locale é global e fixo, raiz §9)
// ------------------------------------------------------------
type Textos = { t: Tradutor; quando: (iso: string) => string };
let textosCarregados: Promise<Textos> | null = null;

function carregarTextos(): Promise<Textos> {
  textosCarregados ??= (async () => {
    let locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en';
    let messages: Record<string, unknown>;
    try {
      messages = (await import(`../../../messages/${locale}.json`)).default;
    } catch {
      locale = 'en';
      messages = (await import('../../../messages/en.json')).default;
    }
    const t = createTranslator({
      locale,
      messages,
      namespace: 'AlarmesDeConexao',
    }) as unknown as Tradutor;
    const formato = new Intl.DateTimeFormat(locale, {
      timeZone: FUSO_PADRAO,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    return { t, quando: (iso: string) => formato.format(new Date(iso)) };
  })();
  return textosCarregados;
}

// ------------------------------------------------------------
// Leituras
// ------------------------------------------------------------

/** Todas as conexões, por página de chave (o PostgREST corta em 1000). */
async function lerCanais(admin: SupabaseClient): Promise<LinhaDoCanal[] | null> {
  const todos: LinhaDoCanal[] = [];
  let depoisDe: string | null = null;
  for (;;) {
    let consulta = admin
      .from('cb_channels')
      .select('id, account_id, kind, label, entrega_carimbo_em, entrega_recebida_em');
    if (depoisDe) consulta = consulta.gt('id', depoisDe);
    const { data, error } = await consulta.order('id', { ascending: true }).limit(PAGINA_DE_CANAIS);
    if (error) {
      console.warn('[alarmes] não leu as conexões:', error.message);
      return null;
    }
    const lote = (data ?? []) as LinhaDoCanal[];
    todos.push(...lote);
    if (lote.length < PAGINA_DE_CANAIS) return todos;
    depoisDe = lote[lote.length - 1].id;
  }
}

/** Os membros ATIVOS da conta, com o perfil real de cada um. `null` = falhou. */
async function lerMembros(admin: SupabaseClient, accountId: string): Promise<MembroDaConta[] | null> {
  const [perfis, membros] = await Promise.all([
    admin.from('cb_perfis_de_acesso').select(COLUNAS_DO_PERFIL).eq('account_id', accountId),
    admin
      .from('profiles')
      .select('user_id, account_role, perfil_id')
      .eq('account_id', accountId)
      .is('suspenso_em', null),
  ]);
  const falha = perfis.error ?? membros.error;
  if (falha) {
    console.warn('[alarmes] não leu os membros da conta:', falha.message);
    return null;
  }
  const porId = new Map(((perfis.data ?? []) as PerfilDeAcesso[]).map((p) => [p.id, p]));
  return ((membros.data ?? []) as LinhaDoMembro[])
    .filter((m): m is LinhaDoMembro & { user_id: string } => !!m.user_id)
    .map((m) => ({
      userId: m.user_id,
      papel: m.account_role,
      perfil: m.perfil_id ? (porId.get(m.perfil_id) ?? null) : null,
    }));
}

/** O estado dos alarmes da conta, por `<canal>:<tipo>`. `null` = falhou. */
async function lerEstados(
  admin: SupabaseClient,
  accountId: string,
): Promise<Map<string, EstadoDoAlarme> | null> {
  const { data, error } = await admin
    .from('cb_alarmes_de_conexao')
    .select('channel_id, tipo, desde, avisado_em, normalizou_em, detalhe')
    .eq('account_id', accountId);
  if (error) {
    console.warn('[alarmes] não leu o estado dos alarmes:', error.message);
    return null;
  }
  const mapa = new Map<string, EstadoDoAlarme>();
  for (const l of (data ?? []) as LinhaDoEstado[]) {
    mapa.set(`${l.channel_id}:${l.tipo}`, {
      desdeIso: l.desde,
      avisadoEmIso: l.avisado_em,
      normalizouEmIso: l.normalizou_em,
      detalhe: l.detalhe ?? {},
    });
  }
  return mapa;
}

// ------------------------------------------------------------
// A escrita cercada do estado
// ------------------------------------------------------------
interface ChaveDoAlarme {
  accountId: string;
  channelId: string;
  tipo: TipoDoAlarme;
}

function mesmoInstante(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

function mesmoEstado(a: EstadoDoAlarme, b: EstadoDoAlarme): boolean {
  return (
    mesmoInstante(a.desdeIso, b.desdeIso) &&
    mesmoInstante(a.avisadoEmIso, b.avisadoEmIso) &&
    mesmoInstante(a.normalizouEmIso, b.normalizouEmIso) &&
    a.detalhe.atrasoSeg === b.detalhe.atrasoSeg &&
    mesmoInstante(a.detalhe.medidoEmIso ?? null, b.detalhe.medidoEmIso ?? null)
  );
}

function colunasDe(e: EstadoDoAlarme) {
  return {
    desde: e.desdeIso,
    avisado_em: e.avisadoEmIso,
    normalizou_em: e.normalizouEmIso,
    detalhe: e.detalhe,
  };
}

/**
 * Leva o estado de `de` (o que foi lido, ou gravado por este ciclo) para
 * `para`, cercado por `de`. `true` = a escrita valeu (ou não havia o que
 * escrever); `false` = outro escritor mudou a linha antes, ou a escrita falhou.
 */
async function gravarEstado(
  admin: SupabaseClient,
  chave: ChaveDoAlarme,
  de: EstadoDoAlarme | null,
  para: EstadoDoAlarme | null,
): Promise<boolean> {
  const tabela = () => admin.from('cb_alarmes_de_conexao');
  try {
    if (de === null && para === null) return true;
    if (de === null) {
      const { data, error } = await tabela()
        .upsert(
          { account_id: chave.accountId, channel_id: chave.channelId, tipo: chave.tipo, ...colunasDe(para!) },
          { onConflict: 'channel_id,tipo', ignoreDuplicates: true },
        )
        .select('channel_id');
      if (error) throw new Error(error.message);
      return (data ?? []).length === 1;
    }
    if (para !== null && mesmoEstado(de, para)) return true;

    // A cerca: a linha só muda se ainda está como `de` (raiz, 8e).
    let consulta = (para === null ? tabela().delete() : tabela().update(colunasDe(para)))
      .eq('account_id', chave.accountId)
      .eq('channel_id', chave.channelId)
      .eq('tipo', chave.tipo);
    consulta =
      de.avisadoEmIso === null
        ? consulta.is('avisado_em', null)
        : consulta.eq('avisado_em', de.avisadoEmIso);
    consulta =
      de.normalizouEmIso === null
        ? consulta.is('normalizou_em', null)
        : consulta.eq('normalizou_em', de.normalizouEmIso);
    const { data, error } = await consulta.select('channel_id');
    if (error) throw new Error(error.message);
    return (data ?? []).length === 1;
  } catch (err) {
    console.warn('[alarmes] não gravou o estado de %s (%s):', chave.channelId, chave.tipo, erroDe(err));
    return false;
  }
}

// ------------------------------------------------------------
// O passo
// ------------------------------------------------------------
interface ContextoDaConta {
  admin: SupabaseClient;
  accountId: string;
  membros: MembroDaConta[];
  agoraMs: number;
  horarioUtil: boolean;
  textos: Textos;
}

async function aplicar(
  ctx: ContextoDaConta,
  canal: LinhaDoCanal,
  tipo: TipoDoAlarme,
  atual: EstadoDoAlarme | null,
  medicao: Medicao,
): Promise<void> {
  const chave: ChaveDoAlarme = { accountId: ctx.accountId, channelId: canal.id, tipo };
  const passo = decidir(tipo, atual, medicao, ctx.agoraMs, ctx.horarioUtil);

  if (passo.motivo === null) {
    await gravarEstado(ctx.admin, chave, atual, passo.depois);
    return;
  }

  const ids = destinatarios(ctx.membros, canal.id);
  if (ids.length === 0) {
    // Sem ninguém para avisar: o episódio fica guardado, como visto.
    console.warn('[alarmes] sem destinatário para %s (%s)', canal.id, tipo);
    await gravarEstado(ctx.admin, chave, atual, passo.seFalhar);
    return;
  }

  // A reivindicação: só quem grava o estado novo manda o aviso.
  if (!(await gravarEstado(ctx.admin, chave, atual, passo.depois))) return;

  const { titulo, corpo } = textosDoAviso(
    ctx.textos.t,
    ctx.textos.quando,
    tipo,
    passo.motivo,
    passo.seFalhar!,
    canal.label,
  );
  const linhas = ids.map((userId) => ({
    account_id: ctx.accountId,
    user_id: userId,
    type: 'whatsapp_alert',
    title: cortarSemPartir(titulo, MAX_TITULO),
    body: cortarSemPartir(corpo, MAX_CORPO),
  }));
  let falhou: string | null = null;
  try {
    const { error } = await ctx.admin.from('notifications').insert(linhas);
    falhou = error ? error.message : null;
  } catch (err) {
    falhou = erroDe(err);
  }
  if (falhou !== null) {
    console.warn('[alarmes] o aviso de %s (%s) não entrou no sino:', canal.id, tipo, falhou);
    // Volta ao estado de antes do aviso, cercado pelo que este ciclo gravou.
    await gravarEstado(ctx.admin, chave, passo.depois, passo.seFalhar);
  }
}

async function avisarDaConta(
  admin: SupabaseClient,
  accountId: string,
  canais: LinhaDoCanal[],
  agoraMs: number,
  horarioUtil: boolean,
  textos: Textos,
): Promise<void> {
  const [membros, estados] = await Promise.all([lerMembros(admin, accountId), lerEstados(admin, accountId)]);
  // Sem saber quem recebe ou o que já foi avisado, nada se decide.
  if (membros === null || estados === null) return;
  const ctx: ContextoDaConta = { admin, accountId, membros, agoraMs, horarioUtil, textos };

  for (const canal of canais) {
    const deRecibo = estados.get(`${canal.id}:sem_recibo`) ?? null;
    const deAtraso = estados.get(`${canal.id}:atraso`) ?? null;
    const envios = await lerEnviosRecentes(admin, canal.id, agoraMs);
    await aplicar(ctx, canal, 'sem_recibo', deRecibo, medirSemRecibo(envios, deRecibo?.desdeIso ?? null, agoraMs));
    await aplicar(
      ctx,
      canal,
      'atraso',
      deAtraso,
      medirAtraso({ carimboIso: canal.entrega_carimbo_em, recebidaIso: canal.entrega_recebida_em }, agoraMs),
    );
  }
}

/** NUNCA lança. `agoraMs` é injetável no teste. */
export async function avisarAlarmesDeConexao(
  admin: SupabaseClient,
  agoraMs: number = Date.now(),
): Promise<void> {
  try {
    const canais = await lerCanais(admin);
    if (canais === null) return;
    // O Instagram fica fora: o Direct não manda recibo de entrega, e o atraso
    // da 1002 não o mede. Pelo predicado, nunca pelo literal (raiz, 8d).
    const porConta = new Map<string, LinhaDoCanal[]>();
    for (const c of canais) {
      if (!ehEvolution(c) && !ehMeta(c)) continue;
      const daConta = porConta.get(c.account_id) ?? [];
      daConta.push(c);
      porConta.set(c.account_id, daConta);
    }
    if (porConta.size === 0) return;

    const textos = await carregarTextos();
    const horarioUtil = emHorarioUtil(new Date(agoraMs));
    for (const [accountId, daConta] of porConta) {
      try {
        await avisarDaConta(admin, accountId, daConta, agoraMs, horarioUtil, textos);
      } catch (err) {
        console.warn('[alarmes] a conta %s estourou:', accountId, erroDe(err));
      }
    }
  } catch (err) {
    console.warn('[alarmes] o passo estourou:', erroDe(err));
  }
}
