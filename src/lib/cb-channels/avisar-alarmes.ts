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
// ⚠️⚠️ O estado e o aviso vão JUNTOS, numa transação só
// (`cb_gravar_alarme_de_conexao`, 1122): a escrita cercada do estado é a
// reivindicação (raiz, 8e) — só quem a ganha avisa — e, se o aviso não entra,
// o estado também não muda e o próximo ciclo tenta de novo. O texto é montado
// ANTES: nada que possa falhar fica entre a reivindicação e o aviso.
//
// ⚠️ As conexões se leem de TODAS as contas, de propósito; cada uma é tratada
// só com a conta dona dela. As leituras da conta (membros, perfis, estado) e
// a escrita são cercadas pela conta: a service role não tem RLS.
//
// NUNCA lança: o passo é isolado no ciclo, e mesmo assim cada conexão roda
// dentro do próprio try. A ordem é embaralhada a cada ciclo, e o prazo próprio
// corta a rodada sem deixar sempre as mesmas conexões de fora.
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
const PAGINA_DE_ESTADOS = 1000;

/**
 * O passo roda PRIMEIRO no ciclo e não pode comer o prazo dos outros quatro
 * com o banco lento (o teto de conexões, `banco-no-teto-de-conexoes`): passado
 * este tempo, as conexões que faltam ficam para o ciclo seguinte.
 */
export const PRAZO_DOS_ALARMES_MS = 60_000;

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
  devido_em: string | null;
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

/**
 * O estado dos alarmes da conta, por `<canal>:<tipo>`. `null` = falhou.
 *
 * ⚠️ Paginado (Codex, #460): o PostgREST corta em 1000 linhas sem avisar, e o
 * estado que faltasse seria lido como "não há" — o aceso tentaria nascer de
 * novo (e perderia para a chave), o normalizado nunca sairia. Página por
 * `range`: só este passo escreve aqui, um ciclo por vez.
 */
async function lerEstados(
  admin: SupabaseClient,
  accountId: string,
): Promise<Map<string, EstadoDoAlarme> | null> {
  const linhas: LinhaDoEstado[] = [];
  for (let de = 0; ; de += PAGINA_DE_ESTADOS) {
    const { data, error } = await admin
      .from('cb_alarmes_de_conexao')
      .select('channel_id, tipo, desde, avisado_em, normalizou_em, devido_em, detalhe')
      .eq('account_id', accountId)
      .order('channel_id', { ascending: true })
      .order('tipo', { ascending: true })
      .range(de, de + PAGINA_DE_ESTADOS - 1);
    if (error) {
      console.warn('[alarmes] não leu o estado dos alarmes:', error.message);
      return null;
    }
    const lote = (data ?? []) as LinhaDoEstado[];
    linhas.push(...lote);
    if (lote.length < PAGINA_DE_ESTADOS) break;
  }
  const mapa = new Map<string, EstadoDoAlarme>();
  for (const l of linhas) {
    mapa.set(`${l.channel_id}:${l.tipo}`, {
      desdeIso: l.desde,
      avisadoEmIso: l.avisado_em,
      normalizouEmIso: l.normalizou_em,
      devidoEmIso: l.devido_em,
      detalhe: l.detalhe ?? {},
    });
  }
  return mapa;
}

// ------------------------------------------------------------
// A escrita: estado cercado + aviso, numa transação (1122)
// ------------------------------------------------------------
interface ChaveDoAlarme {
  accountId: string;
  channelId: string;
  tipo: TipoDoAlarme;
}

interface Aviso {
  destinatarios: string[];
  titulo: string;
  corpo: string;
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
    mesmoInstante(a.devidoEmIso, b.devidoEmIso) &&
    a.detalhe.atrasoSeg === b.detalhe.atrasoSeg &&
    mesmoInstante(a.detalhe.medidoEmIso ?? null, b.detalhe.medidoEmIso ?? null)
  );
}

function jsonDoEstado(e: EstadoDoAlarme | null) {
  if (e === null) return null;
  return {
    desde: e.desdeIso,
    avisado_em: e.avisadoEmIso,
    normalizou_em: e.normalizouEmIso,
    devido_em: e.devidoEmIso,
    detalhe: e.detalhe,
  };
}

/**
 * Leva o estado de `de` (o lido) para `para`, cercado por `de`, com o aviso
 * na mesma transação. `valeu` = a escrita (e o aviso) entraram; `erro` = a
 * chamada falhou e NADA mudou. `valeu` falso sem erro = outro escritor mudou
 * a linha antes.
 */
async function gravar(
  admin: SupabaseClient,
  chave: ChaveDoAlarme,
  de: EstadoDoAlarme | null,
  para: EstadoDoAlarme | null,
  aviso: Aviso | null,
): Promise<{ valeu: boolean; erro: string | null }> {
  if (de === null && para === null) return { valeu: true, erro: null };
  if (aviso === null && de !== null && para !== null && mesmoEstado(de, para)) {
    return { valeu: true, erro: null };
  }
  try {
    const { data, error } = await admin.rpc('cb_gravar_alarme_de_conexao', {
      p_account_id: chave.accountId,
      p_channel_id: chave.channelId,
      p_tipo: chave.tipo,
      p_de: jsonDoEstado(de),
      p_para: jsonDoEstado(para),
      p_destinatarios: aviso?.destinatarios ?? [],
      p_titulo: aviso?.titulo ?? null,
      p_corpo: aviso?.corpo ?? null,
    });
    if (error) return { valeu: false, erro: error.message };
    return { valeu: data === true, erro: null };
  } catch (err) {
    return { valeu: false, erro: erroDe(err) };
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
    const { erro } = await gravar(ctx.admin, chave, atual, passo.depois, null);
    if (erro) console.warn('[alarmes] não gravou o estado de %s (%s):', canal.id, tipo, erro);
    return;
  }

  // O texto ANTES da escrita: nada que possa falhar fica entre ela e o aviso.
  const { titulo, corpo } = textosDoAviso(
    ctx.textos.t,
    ctx.textos.quando,
    tipo,
    passo.motivo,
    passo.seFalhar!,
    canal.label,
  );
  const ids = destinatarios(ctx.membros, canal.id);
  if (ids.length === 0) {
    // Sem ninguém para avisar: o episódio fica guardado como devido.
    console.warn('[alarmes] sem destinatário para %s (%s)', canal.id, tipo);
    await gravar(ctx.admin, chave, atual, passo.seFalhar, null);
    return;
  }

  const { erro } = await gravar(ctx.admin, chave, atual, passo.depois, {
    destinatarios: ids,
    titulo: cortarSemPartir(titulo, MAX_TITULO),
    corpo: cortarSemPartir(corpo, MAX_CORPO),
  });
  if (erro !== null) {
    console.warn('[alarmes] o aviso de %s (%s) não entrou no sino:', canal.id, tipo, erro);
    // Nada mudou (a transação voltou inteira). Marca o aviso como devido, para
    // o fim virar "Aconteceu e já normalizou"; o próximo ciclo tenta de novo.
    await gravar(ctx.admin, chave, atual, passo.seFalhar, null);
  }
}

/**
 * A ordem das conexões nesta rodada: embaralhada a cada ciclo (Codex, #460).
 * Com o prazo do passo esgotando sempre no mesmo lugar, a ordem fixa deixaria
 * as MESMAS conexões de fora para sempre, sem aviso nem "Normalizou"; embaralhada,
 * toda conexão chega à frente em algum ciclo, sem cursor guardado.
 */
export function ordemDaRodada<T>(itens: readonly T[], aleatorio: () => number = Math.random): T[] {
  const ordem = [...itens];
  for (let i = ordem.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
  }
  return ordem;
}

interface Conta {
  ctx: ContextoDaConta;
  estados: Map<string, EstadoDoAlarme>;
}

/** Membros e estado da conta, lidos UMA vez por rodada. `null` = falhou. */
async function carregarConta(
  admin: SupabaseClient,
  accountId: string,
  agoraMs: number,
  horarioUtil: boolean,
  textos: Textos,
): Promise<Conta | null> {
  const [membros, estados] = await Promise.all([lerMembros(admin, accountId), lerEstados(admin, accountId)]);
  // Sem saber quem recebe ou o que já foi avisado, nada se decide.
  if (membros === null || estados === null) return null;
  return { ctx: { admin, accountId, membros, agoraMs, horarioUtil, textos }, estados };
}

async function avaliarConexao(conta: Conta, canal: LinhaDoCanal): Promise<void> {
  const { ctx, estados } = conta;
  const deRecibo = estados.get(`${canal.id}:sem_recibo`) ?? null;
  const deAtraso = estados.get(`${canal.id}:atraso`) ?? null;
  const envios = await lerEnviosRecentes(ctx.admin, canal.id, ctx.agoraMs);
  await aplicar(ctx, canal, 'sem_recibo', deRecibo, medirSemRecibo(envios, deRecibo?.desdeIso ?? null, ctx.agoraMs));
  await aplicar(
    ctx,
    canal,
    'atraso',
    deAtraso,
    medirAtraso({ carimboIso: canal.entrega_carimbo_em, recebidaIso: canal.entrega_recebida_em }, ctx.agoraMs),
  );
}

/** NUNCA lança. `agoraMs` e `aleatorio` são injetáveis no teste. */
export async function avisarAlarmesDeConexao(
  admin: SupabaseClient,
  agoraMs: number = Date.now(),
  aleatorio: () => number = Math.random,
): Promise<void> {
  const prazo = Date.now() + PRAZO_DOS_ALARMES_MS;
  try {
    const canais = await lerCanais(admin);
    if (canais === null) return;
    // O Instagram fica fora: o Direct não manda recibo de entrega, e o atraso
    // da 1002 não o mede. Pelo predicado, nunca pelo literal (raiz, 8d).
    const vigiadas = canais.filter((c) => ehEvolution(c) || ehMeta(c));
    if (vigiadas.length === 0) return;

    const textos = await carregarTextos();
    const horarioUtil = emHorarioUtil(new Date(agoraMs));
    const contas = new Map<string, Promise<Conta | null>>();
    for (const canal of ordemDaRodada(vigiadas, aleatorio)) {
      if (Date.now() > prazo) {
        console.warn('[alarmes] prazo do passo esgotado: o resto fica para o próximo ciclo');
        return;
      }
      try {
        let conta = contas.get(canal.account_id);
        if (!conta) {
          conta = carregarConta(admin, canal.account_id, agoraMs, horarioUtil, textos);
          contas.set(canal.account_id, conta);
        }
        const carregada = await conta;
        if (carregada) await avaliarConexao(carregada, canal);
      } catch (err) {
        console.warn('[alarmes] a conexão %s estourou:', canal.id, erroDe(err));
      }
    }
  } catch (err) {
    console.warn('[alarmes] o passo estourou:', erroDe(err));
  }
}
