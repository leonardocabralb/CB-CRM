// ============================================================
// Ligar e atender pelo CRM (4b, `docs/PLANO-ligar-pelo-crm.md` §8.14).
//
// O computador de ligações (`maquina-de-ligacoes/`) liga e atende pelo
// WhatsApp Web de um número; o CRM é o dono da ligação:
//
//   - `ligar`: da conversa (1:1, no número DELA, que tem computador pronto),
//     cria a ligação `feita` (`call_id = 'crm:<uuid>'`) e a linha ao vivo e
//     pede à máquina a ponte e a discagem num pedido só; devolve a resposta
//     WebRTC. Até 20 por hora por número (D13).
//   - `atender`: reivindica a linha ao vivo que TOCA (a regra do trabalho
//     reivindicado), grava a marca do atendimento pelo CRM em `cb_ligacoes`
//     (a régua da Evolution para de decidir, `desfecho.ts`) e pede à máquina
//     a ponte e o aceite. Falhou: a marca sai e a régua de hoje decide.
//   - `desligar`.
//   - `receberAviso`: o que a máquina conta (sinal, chamando, atendida,
//     encerrada). Cada informação é gravada uma vez só ("só se vazia"); o fim
//     reivindica o desfecho (`desfecho IS NULL`) e só quem ganha grava a
//     faixa. O sinal fecha a ligação que a máquina deixou de ter (`sumiu`).
//   - `receberGravacao` e `enderecoDaGravacao`: o bucket PRIVADO `ligacoes`.
//
// ⚠️⚠️ A FAIXA É SÓ REGISTRO (D6 e D6b do operador): `agent` SEM autor e fora
// do celular — para a 972 e para a pausa da IA (1118) não é gente, e a
// retomada a ignora (1134). Não reabre, não sobe a conversa, não mexe nas não
// lidas: nada disso é chamado aqui. O que não roda, como em toda ligação:
// robô, automações, IA, webhook de saída (`ligacoes.chamadores.test.ts`).
//
// O número que vai à máquina é o do JID da conversa (o nono dígito do jeito
// que o WhatsApp o conhece), nunca o digitado; na recebida, o que o desfecho
// resolveria (`registrar.ts`).
// ============================================================

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolverDestinatario } from '@/lib/automations/destinatario';
import { routeContactToPipeline } from '@/lib/cb-channels/pipeline-routing';
import { gravarComCanal, preencherCanalDaConversa } from '@/lib/cb-channels/stamp';
import { isUniqueViolation } from '@/lib/contacts/dedupe';

import {
  computadorDoCanal,
  computadorPronto,
  pedirAoComputador,
  type Computador,
  type RespostaDoComputador,
} from './computador';
import { FOLGA_DO_DESFECHO_MS } from './desfecho';
import { decidirLigacao } from './registrar';
import { telefoneDoJid } from './telefone';

/** D13: até 20 ligações FEITAS por hora por número (anti-bloqueio). */
export const LIGACOES_POR_HORA = 20;

/** Os motivos do fim que a máquina conta (`MotivoDoFim` da máquina = o CHECK da 1134). */
export const MOTIVOS_DO_FIM = [
  'cliente_desligou',
  'atendente_desligou',
  'nao_atendida',
  'ocupado',
  'sem_whatsapp',
  'teto_30min',
  'ponte_caiu',
  'falhou',
] as const;
export type MotivoDoFim = (typeof MOTIVOS_DO_FIM)[number] | 'sumiu';

/**
 * A ligação que a máquina deixou de ter só é dada como sumida depois disto,
 * contado do pedido: cobre o pedido ainda a caminho da máquina e a diferença
 * de relógio entre ela e o banco.
 */
export const MARGEM_DO_SUMIDO_MS = 60_000;
/** Toque sem fim gravado além disto é resto (o WhatsApp desiste em ~1 min). */
export const TOQUE_VELHO_MS = 3 * 60_000;

export type Falha = { ok: false; status: number; codigo: string };
const falha = (status: number, codigo: string): Falha => ({ ok: false, status, codigo });

/** O `after()` da rota: o que roda depois da resposta (injetável nos testes). */
export type Agendar = (tarefa: () => Promise<void>) => void;
const agendarJa: Agendar = (tarefa) => void tarefa();

const pausa = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

interface Base {
  db: SupabaseClient;
  /** O segredo do CRM (`LIGACOES_SEGREDO`). */
  segredo: string;
  agora?: () => number;
  enviar?: typeof fetch;
}

const COLUNAS_DA_LIGACAO =
  'id, account_id, channel_id, call_id, direcao, pelo_crm, atendente_id, telefone, conversation_id, oferta_em, criada_em, atendimento_pelo_crm_desde, atendida_pelo_crm_em, desfecho, gravacao_recebida_em, message_id, motivo_do_fim, duracao_seg';

interface LinhaPeloCrm {
  id: string;
  account_id: string;
  channel_id: string | null;
  call_id: string;
  direcao: 'feita' | 'recebida';
  pelo_crm: boolean;
  atendente_id: string | null;
  telefone: string | null;
  conversation_id: string | null;
  oferta_em: string | null;
  criada_em: string;
  atendimento_pelo_crm_desde: string | null;
  atendida_pelo_crm_em: string | null;
  desfecho: string | null;
  gravacao_recebida_em: string | null;
  message_id: string | null;
  motivo_do_fim: string | null;
  duracao_seg: number | null;
}

/** Os desfechos que só a ligação pelo CRM grava — e que têm faixa. */
const DESFECHOS_COM_FAIXA = ['atendida', 'nao_atendida'] as const;

/** O status HTTP para o navegador quando a máquina recusa. */
export function statusDaRecusa(resposta: Extract<RespostaDoComputador, { ok: false }>): number {
  if (resposta.status === null) return 504;
  switch (resposta.erro) {
    case 'ocupada':
    case 'nada_tocando':
    case 'outra_chamada':
      return 409;
    case 'whatsapp_desconectado':
      return 503;
    case 'oferta_invalida':
      return 400;
    case 'nao_encontrada':
      return 404;
    default:
      return 502;
  }
}

/**
 * O número como o WhatsApp o conhece: o do JID de telefone da mensagem mais
 * recente da conversa; sem ele, o telefone da ficha. Nunca um LID.
 */
async function numeroDaConversa(
  db: SupabaseClient,
  conversationId: string,
  contactId: string | null,
): Promise<string | null | 'falhou'> {
  const { data: mensagens, error } = await db
    .from('messages')
    .select('remote_jid')
    .eq('conversation_id', conversationId)
    .like('remote_jid', '%@s.whatsapp.net')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return 'falhou';
  const doJid = telefoneDoJid((mensagens?.[0]?.remote_jid as string | undefined) ?? null);
  if (doJid) return doJid;
  if (!contactId) return null;
  const { data: contato, error: erroDoContato } = await db
    .from('contacts')
    .select('phone')
    .eq('id', contactId)
    .maybeSingle();
  if (erroDoContato) return 'falhou';
  const digitos = String(contato?.phone ?? '').replace(/\D/g, '');
  return /^\d{10,15}$/.test(digitos) && !/[A-Za-z]/.test(String(contato?.phone ?? '')) ? digitos : null;
}

async function apagarAoVivo(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('cb_ligacoes_ao_vivo').delete().eq('id', id);
  if (error) console.error('[ligacoes] apagar a linha ao vivo falhou:', id, error.message);
}

/** A ligação feita que nem começou (a máquina recusou): desfecho `falhou`, sem faixa. */
async function desistir(db: SupabaseClient, id: string, detalhe: string): Promise<void> {
  const { error } = await db
    .from('cb_ligacoes')
    .update({ desfecho: 'falhou', desfecho_em: new Date().toISOString(), detalhe })
    .eq('id', id)
    .is('desfecho', null);
  if (error) console.error('[ligacoes] registrar a desistência falhou:', id, error.message);
  await apagarAoVivo(db, id);
}

// ------------------------------------------------------------
// Ligar
// ------------------------------------------------------------

export async function ligar(
  args: Base & { accountId: string; userId: string; conversationId: string; oferta: string },
): Promise<{ ok: true; ligacao: string; resposta: string } | Falha> {
  const { db, accountId, userId, conversationId, oferta, segredo } = args;
  const agora = args.agora ?? Date.now;

  const { data: conversa, error: erroDaConversa } = await db
    .from('conversations')
    .select('id, contact_id, group_id, channel_id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (erroDaConversa) return falha(500, 'falhou');
  if (!conversa) return falha(404, 'conversa_nao_encontrada');
  if (conversa.group_id) return falha(400, 'grupo');
  // O número da ligação é o DA CONVERSA (o que o atendente vê no cabeçalho).
  const canal = conversa.channel_id as string | null;
  if (!canal) return falha(409, 'conversa_sem_numero');

  const computador = await computadorDoCanal(db, accountId, canal);
  if (computador === 'falhou') return falha(500, 'falhou');
  if (!computador) return falha(409, 'sem_computador');
  if (!computadorPronto(computador, agora())) return falha(409, 'computador_fora');

  const numero = await numeroDaConversa(db, conversa.id as string, (conversa.contact_id as string | null) ?? null);
  if (numero === 'falhou') return falha(500, 'falhou');
  if (!numero) return falha(409, 'sem_telefone');

  const { count, error: erroDaConta } = await db
    .from('cb_ligacoes')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('channel_id', canal)
    .eq('direcao', 'feita')
    .gte('criada_em', new Date(agora() - 3_600_000).toISOString());
  if (erroDaConta) return falha(500, 'falhou');
  if ((count ?? 0) >= LIGACOES_POR_HORA) return falha(429, 'limite_por_hora');

  // Com uma recebida TOCANDO no número, a máquina não disca (a tela dela tem
  // a chamada que toca). O toque velho (sem fim gravado) não conta.
  const { data: toques, error: erroDosToques } = await db
    .from('cb_ligacoes_ao_vivo')
    .select('id')
    .eq('account_id', accountId)
    .eq('channel_id', canal)
    .eq('estado', 'tocando')
    .gte('desde', new Date(agora() - TOQUE_VELHO_MS).toISOString())
    .limit(1);
  if (erroDosToques) return falha(500, 'falhou');
  if ((toques ?? []).length > 0) return falha(409, 'tocando_agora');

  const id = randomUUID();
  // 1) A linha ao vivo PRIMEIRO: é a trava (o índice único de uma ligação por
  //    número). Duas ao mesmo tempo no mesmo número: a segunda é 409.
  const { error: erroDaTrava } = await db.from('cb_ligacoes_ao_vivo').insert({
    id,
    account_id: accountId,
    channel_id: canal,
    direcao: 'feita',
    estado: 'conectando',
    telefone: numero,
    conversation_id: conversa.id,
    contact_id: conversa.contact_id ?? null,
    atendente_id: userId,
  });
  if (erroDaTrava) {
    if (isUniqueViolation(erroDaTrava)) return falha(409, 'ocupada');
    console.error('[ligacoes] abrir a linha ao vivo falhou:', erroDaTrava.message);
    return falha(500, 'falhou');
  }
  // 2) A ligação.
  const { error: erroDaLigacao } = await db.from('cb_ligacoes').insert({
    id,
    account_id: accountId,
    channel_id: canal,
    call_id: `crm:${id}`,
    direcao: 'feita',
    pelo_crm: true,
    atendente_id: userId,
    telefone: numero,
    conversation_id: conversa.id,
  });
  if (erroDaLigacao) {
    console.error('[ligacoes] gravar a ligação feita falhou:', erroDaLigacao.message);
    await apagarAoVivo(db, id);
    return falha(500, 'falhou');
  }
  // 3) A máquina: a ponte e a discagem. Sem a resposta, ela nunca disca — não
  //    disca antes de a ponte do atendente ligar (a máquina, `ligacao.ts`).
  const pedido = await pedirAoComputador(computador, segredo, '/ligar', { ligacao: id, numero, oferta }, args.enviar);
  if (!pedido.ok) {
    await desistir(db, id, `a máquina recusou: ${pedido.erro}`);
    return falha(statusDaRecusa(pedido), pedido.erro);
  }
  const resposta = pedido.corpo.resposta;
  if (typeof resposta !== 'string' || !resposta.startsWith('v=0')) {
    await desistir(db, id, 'a máquina não devolveu a resposta WebRTC');
    return falha(502, 'sem_resposta_webrtc');
  }
  return { ok: true, ligacao: id, resposta };
}

// ------------------------------------------------------------
// Atender
// ------------------------------------------------------------

export async function atender(
  args: Base & { accountId: string; userId: string; ligacaoId: string; oferta: string; agendar?: Agendar },
): Promise<{ ok: true; resposta: string } | Falha> {
  const { db, accountId, userId, ligacaoId, oferta, segredo } = args;
  const agora = args.agora ?? Date.now;
  const agendar = args.agendar ?? agendarJa;

  const { data: aoVivo, error: erroAoVivo } = await db
    .from('cb_ligacoes_ao_vivo')
    .select('id, channel_id, telefone, estado, desde')
    .eq('id', ligacaoId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (erroAoVivo) return falha(500, 'falhou');
  if (!aoVivo) return falha(404, 'nao_esta_tocando');
  if (aoVivo.estado !== 'tocando') return falha(409, 'ja_atendida');
  if (!aoVivo.telefone) return falha(409, 'sem_telefone');

  const computador = await computadorDoCanal(db, accountId, aoVivo.channel_id as string);
  if (computador === 'falhou') return falha(500, 'falhou');
  if (!computador || !computadorPronto(computador, agora())) return falha(409, 'computador_fora');

  // 1) A reivindicação: o primeiro "Atender" leva; a trava de uma ligação por
  //    número vale aqui também (o UPDATE para `conectando` bate no índice).
  const { data: minha, error: erroDaPosse } = await db
    .from('cb_ligacoes_ao_vivo')
    .update({ estado: 'conectando', atendente_id: userId, atualizada_em: new Date(agora()).toISOString() })
    .eq('id', ligacaoId)
    .eq('account_id', accountId)
    .eq('estado', 'tocando')
    .is('atendente_id', null)
    .select('id');
  if (erroDaPosse) {
    if (isUniqueViolation(erroDaPosse)) return falha(409, 'ocupada');
    return falha(500, 'falhou');
  }
  if (!minha || minha.length === 0) return falha(409, 'ja_atendida');

  // 2) A marca do atendimento pelo CRM: a régua da Evolution para de decidir
  //    "perdida" com o `terminate` que o próprio atendimento provoca.
  const { data: marcada, error: erroDaMarca } = await db
    .from('cb_ligacoes')
    .update({
      pelo_crm: true,
      atendente_id: userId,
      telefone: aoVivo.telefone,
      atendimento_pelo_crm_desde: new Date(agora()).toISOString(),
    })
    .eq('id', ligacaoId)
    .eq('account_id', accountId)
    .is('desfecho', null)
    .select('id, call_id, channel_id');
  if (erroDaMarca || !marcada || marcada.length === 0) {
    await apagarAoVivo(db, ligacaoId);
    return erroDaMarca ? falha(500, 'falhou') : falha(409, 'ja_encerrada');
  }
  const callId = marcada[0].call_id as string;

  // 3) A máquina: a ponte e o aceite (ela relê a tela e só aceita o mesmo número).
  const pedido = await pedirAoComputador(
    computador,
    segredo,
    '/atender',
    { ligacao: ligacaoId, numero: aoVivo.telefone, oferta },
    args.enviar,
  );
  const resposta = pedido.ok ? pedido.corpo.resposta : null;
  if (!pedido.ok || typeof resposta !== 'string' || !resposta.startsWith('v=0')) {
    await devolverARegua(db, accountId, ligacaoId, callId, computador, agendar);
    return pedido.ok ? falha(502, 'sem_resposta_webrtc') : falha(statusDaRecusa(pedido), pedido.erro);
  }
  return { ok: true, resposta };
}

/**
 * O atendimento pelo CRM não aconteceu: a marca sai, a linha ao vivo sai, e
 * a régua de hoje decide (perdida, ou atendida no celular) — DEPOIS da folga,
 * porque o `accept` do celular pode estar a caminho. A decisão que a marca
 * segurou não volta sozinha: o `terminate` já passou.
 */
async function devolverARegua(
  db: SupabaseClient,
  accountId: string,
  ligacaoId: string,
  callId: string,
  computador: Pick<Computador, 'channel_id'>,
  agendar: Agendar,
): Promise<void> {
  const { error } = await db
    .from('cb_ligacoes')
    .update({ pelo_crm: false, atendente_id: null, atendimento_pelo_crm_desde: null })
    .eq('id', ligacaoId)
    .is('desfecho', null)
    .is('atendida_pelo_crm_em', null);
  if (error) console.error('[ligacoes] tirar a marca do atendimento falhou:', ligacaoId, error.message);
  await apagarAoVivo(db, ligacaoId);
  agendar(async () => {
    await pausa(FOLGA_DO_DESFECHO_MS + 1_000);
    const { data: conexao } = await db
      .from('cb_channels')
      .select('own_lid')
      .eq('id', computador.channel_id)
      .maybeSingle();
    await decidirLigacao(
      db,
      { accountId, channelId: computador.channel_id, ownLid: (conexao?.own_lid as string | null) ?? null },
      callId,
    );
  });
}

// ------------------------------------------------------------
// Desligar
// ------------------------------------------------------------

export async function desligar(
  args: Base & { accountId: string; ligacaoId: string; agendar?: Agendar },
): Promise<{ ok: true } | Falha> {
  const { db, accountId, ligacaoId, segredo } = args;
  const { data: aoVivo, error } = await db
    .from('cb_ligacoes_ao_vivo')
    .select('id, channel_id, estado')
    .eq('id', ligacaoId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) return falha(500, 'falhou');
  // Já acabou: desligar de novo não é erro.
  if (!aoVivo) return { ok: true };
  if (aoVivo.estado === 'tocando') return falha(409, 'ainda_tocando');
  const computador = await computadorDoCanal(db, accountId, aoVivo.channel_id as string);
  if (computador === 'falhou') return falha(500, 'falhou');
  if (!computador) {
    await fecharSumida(db, accountId, ligacaoId, args.agendar ?? agendarJa);
    return { ok: true };
  }
  const pedido = await pedirAoComputador(computador, segredo, '/desligar', { ligacao: ligacaoId }, args.enviar);
  if (pedido.ok) return { ok: true };
  // A máquina não tem esta ligação (reiniciou no meio): a do CRM fecha aqui.
  if (pedido.erro === 'nao_encontrada') {
    await fecharSumida(db, accountId, ligacaoId, args.agendar ?? agendarJa);
    return { ok: true };
  }
  return falha(statusDaRecusa(pedido), pedido.erro);
}

// ------------------------------------------------------------
// Os avisos da máquina
// ------------------------------------------------------------

export type AvisoDaMaquina =
  | { tipo: 'sinal'; em: string; whatsapp: 'carregando' | 'qr' | 'conectado'; ligacao: string | null; chrome: string }
  | { tipo: 'chamando'; em: string; ligacao: string }
  | { tipo: 'atendida'; em: string; ligacao: string; atendida_em: string }
  | {
      tipo: 'encerrada';
      em: string;
      ligacao: string;
      motivo: (typeof MOTIVOS_DO_FIM)[number];
      atendida_em: string | null;
      duracao_seg: number | null;
    };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const instante = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** O corpo do aviso, conferido campo a campo; nulo = 400 (a máquina larga o aviso). */
export function lerAviso(corpo: unknown, nome: string): AvisoDaMaquina | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const c = corpo as Record<string, unknown>;
  if (c.computador !== nome || !instante(c.em)) return null;
  const em = c.em;
  switch (c.tipo) {
    case 'sinal': {
      if (c.whatsapp !== 'carregando' && c.whatsapp !== 'qr' && c.whatsapp !== 'conectado') return null;
      if (c.ligacao !== null && (typeof c.ligacao !== 'string' || c.ligacao.length > 64)) return null;
      const chrome = typeof c.chrome === 'string' ? c.chrome.slice(0, 40) : '';
      return { tipo: 'sinal', em, whatsapp: c.whatsapp, ligacao: c.ligacao as string | null, chrome };
    }
    case 'chamando':
      return typeof c.ligacao === 'string' && ID.test(c.ligacao) ? { tipo: 'chamando', em, ligacao: c.ligacao } : null;
    case 'atendida':
      return typeof c.ligacao === 'string' && ID.test(c.ligacao) && instante(c.atendida_em)
        ? { tipo: 'atendida', em, ligacao: c.ligacao, atendida_em: c.atendida_em }
        : null;
    case 'encerrada': {
      if (typeof c.ligacao !== 'string' || !ID.test(c.ligacao)) return null;
      if (!(MOTIVOS_DO_FIM as readonly unknown[]).includes(c.motivo)) return null;
      if (c.atendida_em !== null && !instante(c.atendida_em)) return null;
      const duracao = c.duracao_seg;
      if (duracao !== null && (typeof duracao !== 'number' || !Number.isInteger(duracao) || duracao < 0)) return null;
      return {
        tipo: 'encerrada',
        em,
        ligacao: c.ligacao,
        motivo: c.motivo as (typeof MOTIVOS_DO_FIM)[number],
        atendida_em: c.atendida_em as string | null,
        duracao_seg: duracao as number | null,
      };
    }
    default:
      return null;
  }
}

export type DesfechoDoAviso = 'ok' | 'desconhecida' | 'falhou';

export async function receberAviso(args: {
  db: SupabaseClient;
  computador: Computador;
  aviso: AvisoDaMaquina;
  agendar?: Agendar;
}): Promise<DesfechoDoAviso> {
  const { db, computador, aviso } = args;
  const agendar = args.agendar ?? agendarJa;
  switch (aviso.tipo) {
    case 'sinal':
      return receberSinal(db, computador, aviso, agendar);
    case 'chamando': {
      const { error } = await db
        .from('cb_ligacoes_ao_vivo')
        .update({ estado: 'chamando', atualizada_em: new Date().toISOString() })
        .eq('id', aviso.ligacao)
        .eq('channel_id', computador.channel_id)
        .eq('estado', 'conectando');
      return error ? 'falhou' : 'ok';
    }
    case 'atendida': {
      const { error } = await db
        .from('cb_ligacoes')
        .update({ atendida_pelo_crm_em: aviso.atendida_em })
        .eq('id', aviso.ligacao)
        .eq('account_id', computador.account_id)
        .eq('channel_id', computador.channel_id)
        .eq('pelo_crm', true)
        .is('atendida_pelo_crm_em', null);
      if (error) return 'falhou';
      const { error: erroAoVivo } = await db
        .from('cb_ligacoes_ao_vivo')
        .update({ estado: 'em_ligacao', atualizada_em: new Date().toISOString() })
        .eq('id', aviso.ligacao)
        .eq('channel_id', computador.channel_id)
        .neq('estado', 'tocando');
      return erroAoVivo ? 'falhou' : 'ok';
    }
    case 'encerrada':
      return finalizar(db, computador, {
        ligacaoId: aviso.ligacao,
        motivo: aviso.motivo,
        atendidaEm: aviso.atendida_em,
        duracaoSeg: aviso.duracao_seg,
        fimEm: aviso.em,
        agendar,
      });
  }
}

async function receberSinal(
  db: SupabaseClient,
  computador: Computador,
  aviso: Extract<AvisoDaMaquina, { tipo: 'sinal' }>,
  agendar: Agendar,
): Promise<DesfechoDoAviso> {
  const { error } = await db
    .from('cb_computadores_de_ligacao')
    .update({
      whatsapp: aviso.whatsapp,
      ligacao_em_curso: aviso.ligacao,
      chrome: aviso.chrome || null,
      ultimo_sinal_em: new Date().toISOString(),
    })
    .eq('id', computador.id);
  if (error) {
    console.error('[ligacoes] gravar o sinal falhou:', computador.nome, error.message);
    return 'falhou';
  }
  // O que a máquina NÃO tem mais (o contêiner reiniciou no meio, o aviso do
  // fim se perdeu) fecha aqui. Os avisos saem em fila (FIFO): quando o sinal
  // chega, o fim que ela mandou antes já chegou ou foi largado.
  const limite = Date.parse(aviso.em) - MARGEM_DO_SUMIDO_MS;
  const { data: abertas, error: erroDasAbertas } = await db
    .from('cb_ligacoes')
    .select('id, direcao, criada_em, atendimento_pelo_crm_desde')
    .eq('account_id', computador.account_id)
    .eq('channel_id', computador.channel_id)
    .eq('pelo_crm', true)
    .is('desfecho', null);
  if (erroDasAbertas) return 'falhou';
  for (const l of abertas ?? []) {
    if (l.id === aviso.ligacao) continue;
    const desde = (l.direcao === 'feita' ? l.criada_em : l.atendimento_pelo_crm_desde) as string | null;
    // Datas como NÚMERO: o PostgREST devolve `+00:00` e micros, o JS `Z`.
    if (!desde || !(Date.parse(desde) < limite)) continue;
    await fecharSumida(db, computador.account_id, l.id as string, agendar);
  }
  // A faixa que não entrou (falha passageira depois do desfecho) num fim que a
  // máquina não vai repetir (o `sumiu`, ou o aviso largado depois de 30 min):
  // o sinal a retoma, por um dia.
  const { data: semFaixa, error: erroSemFaixa } = await db
    .from('cb_ligacoes')
    .select('id')
    .eq('account_id', computador.account_id)
    .eq('channel_id', computador.channel_id)
    .eq('pelo_crm', true)
    .in('desfecho', [...DESFECHOS_COM_FAIXA])
    .is('message_id', null)
    .gte('criada_em', new Date(Date.parse(aviso.em) - 24 * 3_600_000).toISOString());
  if (erroSemFaixa) return 'falhou';
  for (const l of semFaixa ?? []) {
    await finalizar(db, computador, {
      ligacaoId: l.id as string,
      motivo: 'sumiu',
      atendidaEm: null,
      duracaoSeg: null,
      fimEm: aviso.em,
      agendar,
    });
  }
  // Toque sem fim gravado além do teto é resto (o aviso do fim não veio).
  const { error: erroDosToques } = await db
    .from('cb_ligacoes_ao_vivo')
    .delete()
    .eq('channel_id', computador.channel_id)
    .eq('estado', 'tocando')
    .lt('desde', new Date(Date.now() - TOQUE_VELHO_MS).toISOString());
  if (erroDosToques) console.error('[ligacoes] limpar toque velho falhou:', erroDosToques.message);
  return 'ok';
}

/** A ligação que a máquina não tem mais: fecha com o motivo `sumiu`. */
async function fecharSumida(
  db: SupabaseClient,
  accountId: string,
  ligacaoId: string,
  agendar: Agendar,
): Promise<void> {
  const { data: linha } = await db
    .from('cb_ligacoes')
    .select('channel_id')
    .eq('id', ligacaoId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!linha?.channel_id) {
    await apagarAoVivo(db, ligacaoId);
    return;
  }
  await finalizar(
    db,
    { account_id: accountId, channel_id: linha.channel_id as string },
    { ligacaoId, motivo: 'sumiu', atendidaEm: null, duracaoSeg: null, fimEm: new Date().toISOString(), agendar },
  );
}

/**
 * O fim da ligação pelo CRM. Reivindica o desfecho (`desfecho IS NULL`): só
 * quem ganha grava a faixa. A recebida que a máquina não chegou a atender
 * volta à régua de hoje.
 */
async function finalizar(
  db: SupabaseClient,
  computador: Pick<Computador, 'account_id' | 'channel_id'>,
  fim: {
    ligacaoId: string;
    motivo: MotivoDoFim;
    atendidaEm: string | null;
    duracaoSeg: number | null;
    fimEm: string;
    agendar: Agendar;
  },
): Promise<DesfechoDoAviso> {
  const { data, error } = await db
    .from('cb_ligacoes')
    .select(COLUNAS_DA_LIGACAO)
    .eq('id', fim.ligacaoId)
    .eq('account_id', computador.account_id)
    .eq('channel_id', computador.channel_id)
    .maybeSingle();
  if (error) return 'falhou';
  const linha = data as LinhaPeloCrm | null;
  if (!linha) return 'desconhecida';
  if (!linha.pelo_crm) {
    // Devolvido à régua de hoje: só a linha ao vivo sai.
    await apagarAoVivo(db, linha.id);
    return 'ok';
  }
  if (linha.desfecho) {
    await apagarAoVivo(db, linha.id);
    // Já decidido. A faixa que não entrou (falha passageira depois do
    // desfecho: a resposta foi 500 e a máquina repetiu) entra AGORA — o aviso
    // repetido é a nova tentativa, e a linha guarda o fim.
    const comFaixa = (DESFECHOS_COM_FAIXA as readonly string[]).includes(linha.desfecho);
    if (!comFaixa || linha.message_id) return 'ok';
    return gravarFaixa(db, linha, {
      desfecho: linha.desfecho as (typeof DESFECHOS_COM_FAIXA)[number],
      atendidaEm: linha.atendida_pelo_crm_em,
      motivo: (linha.motivo_do_fim as MotivoDoFim | null) ?? fim.motivo,
      duracaoSeg: linha.duracao_seg ?? fim.duracaoSeg,
      fimEm: fim.fimEm,
    });
  }

  const atendidaEm = linha.atendida_pelo_crm_em ?? fim.atendidaEm;
  if (linha.direcao === 'recebida' && !atendidaEm) {
    await devolverARegua(db, linha.account_id, linha.id, linha.call_id, { channel_id: computador.channel_id }, fim.agendar);
    return 'ok';
  }

  const desfecho = atendidaEm ? 'atendida' : 'nao_atendida';
  const { data: minha, error: erroDaPosse } = await db
    .from('cb_ligacoes')
    .update({
      desfecho,
      desfecho_em: new Date().toISOString(),
      motivo_do_fim: fim.motivo,
      duracao_seg: fim.duracaoSeg,
      atendida_pelo_crm_em: atendidaEm,
      // A recebida tem o fim do TOQUE (o `terminate` da Evolution); a feita, o da ligação.
      ...(linha.direcao === 'feita' ? { encerrada_em: fim.fimEm } : {}),
    })
    .eq('id', linha.id)
    .is('desfecho', null)
    .select('id');
  await apagarAoVivo(db, linha.id);
  if (erroDaPosse) return 'falhou';
  if (!minha || minha.length === 0) return 'ok';

  // O atendimento conhecido (o aviso `atendida` OU o do fim) vence o do fim.
  // Falha passageira devolve 'falhou' (500): a máquina repete o aviso, e a
  // repetição refaz a faixa (acima).
  return gravarFaixa(db, linha, { ...fim, desfecho, atendidaEm });
}

// ------------------------------------------------------------
// A faixa no fio (só registro)
// ------------------------------------------------------------

async function nomeDe(db: SupabaseClient, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await db.from('profiles').select('full_name').eq('user_id', userId).maybeSingle();
  const nome = String(data?.full_name ?? '').trim();
  return nome || null;
}

async function marcarErro(db: SupabaseClient, id: string, detalhe: string): Promise<void> {
  const { error } = await db.from('cb_ligacoes').update({ detalhe }).eq('id', id);
  if (error) console.error('[ligacoes] registrar o erro da faixa falhou:', id, error.message);
}

/**
 * Grava a faixa e a liga à ligação. `falhou` = passageiro (o banco não
 * respondeu): quem chama devolve 500, e a máquina repete o aviso. O que não
 * se resolve repetindo (sem o telefone, a conversa apagada) fica no
 * `detalhe` e responde `ok`.
 */
async function gravarFaixa(
  db: SupabaseClient,
  linha: LinhaPeloCrm,
  fim: {
    desfecho: 'atendida' | 'nao_atendida';
    atendidaEm: string | null;
    motivo: MotivoDoFim;
    duracaoSeg: number | null;
    fimEm: string;
  },
): Promise<DesfechoDoAviso> {
  // A conversa: a feita saiu de uma; a recebida é a do número que ligou,
  // criada se o número nunca escreveu (dono durável, como toda ligação).
  let conversationId = linha.conversation_id;
  let contactId: string | null = null;
  if (linha.direcao === 'recebida') {
    if (!linha.telefone) {
      await marcarErro(db, linha.id, 'faixa: sem o telefone de quem ligou');
      return 'ok';
    }
    try {
      const destino = await resolverDestinatario(db, linha.account_id, linha.telefone, undefined, {
        origem: { via: 'ligacao' },
      });
      conversationId = destino.conversationId;
      contactId = destino.contactId;
    } catch (err) {
      await marcarErro(db, linha.id, `faixa: ficha ou conversa: ${err instanceof Error ? err.message : String(err)}`);
      return 'falhou';
    }
  }
  if (!conversationId) {
    await marcarErro(db, linha.id, 'faixa: a conversa não existe mais');
    return 'ok';
  }

  const inicio = linha.direcao === 'feita' ? linha.criada_em : linha.oferta_em;
  // A hora da faixa: o atendimento; sem ele, o começo da discagem.
  const carimbo = new Date(fim.atendidaEm ?? inicio ?? fim.fimEm).toISOString();
  const atendente = linha.atendente_id ? { id: linha.atendente_id, nome: await nomeDe(db, linha.atendente_id) } : null;

  const { resultado, canal } = await gravarComCanal(linha.channel_id, (canal) =>
    db
      .from('messages')
      .insert({
        conversation_id: conversationId,
        // ⚠️ Só registro (D6/D6b): `agent` SEM autor e fora do celular não é
        // gente para a 972 nem para a pausa da IA, e a retomada a ignora.
        sender_type: 'agent',
        sender_id: null,
        content_type: 'call',
        content_text: null,
        message_id: `call:${linha.call_id}`,
        from_me: true,
        from_device: false,
        status: 'sent',
        channel_id: canal,
        created_at: carimbo,
        ligacao: {
          desfecho: fim.desfecho,
          video: false,
          inicio,
          fim: fim.fimEm,
          tocou_seg: null,
          encerramento: null,
          pelo_crm: true,
          direcao: linha.direcao,
          atendente,
          atendida_em: fim.atendidaEm,
          duracao_seg: fim.duracaoSeg,
          motivo: fim.motivo,
          gravacao: linha.gravacao_recebida_em !== null,
          // O ▶ da faixa (4c) pede a gravação por ele
          // (`/api/cb/ligacoes/<id>/gravacao`): a mensagem não sabe a linha.
          ligacao_id: linha.id,
        },
      })
      .select('id')
      .single(),
  );
  let mensagem = resultado.data as { id: string } | null;
  if (resultado.error || !mensagem) {
    if (!isUniqueViolation(resultado.error)) {
      await marcarErro(db, linha.id, `faixa: ${resultado.error?.message ?? 'sem retorno'}`);
      return 'falhou';
    }
    // 23505: a faixa já entrou (numa tentativa cujo vínculo falhou) — liga a que existe.
    const { data: existente, error: erroDaBusca } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('message_id', `call:${linha.call_id}`)
      .maybeSingle();
    if (erroDaBusca || !existente) return 'falhou';
    mensagem = { id: existente.id as string };
  }

  // A conversa que nasceu agora (a recebida de número novo) ganha o número
  // da ligação; a que já tem número fica como está (a faixa não a move).
  await preencherCanalDaConversa(db, linha.account_id, conversationId, canal);
  if (linha.direcao === 'recebida' && contactId) {
    // O card no funil padrão da conexão, se o contato ainda não tem — o mesmo
    // de toda ligação (decisão do operador, 25/09/2026). Nunca lança.
    const { data: contato } = await db.from('contacts').select('name').eq('id', contactId).maybeSingle();
    await routeContactToPipeline({
      db,
      accountId: linha.account_id,
      channelId: canal,
      contactId,
      contactName: (contato?.name as string | null | undefined) ?? linha.telefone ?? '',
      conversationId,
    });
  }

  const { error: erroDoVinculo } = await db
    .from('cb_ligacoes')
    .update({ conversation_id: conversationId, message_id: mensagem.id })
    .eq('id', linha.id);
  if (erroDoVinculo) {
    // Sem o vínculo, a repetição do aviso volta aqui (o 23505 acima liga a faixa).
    console.error('[ligacoes] ligar a faixa à ligação falhou:', erroDoVinculo.message);
    return 'falhou';
  }

  // A gravação pode ter chegado entre a leitura e o INSERT (são pedidos
  // separados da máquina): escrever-e-reler dos dois lados — um vê o outro.
  if (linha.gravacao_recebida_em === null) {
    const { data: agora } = await db.from('cb_ligacoes').select('gravacao_recebida_em').eq('id', linha.id).maybeSingle();
    if (agora?.gravacao_recebida_em) await marcarGravacaoNaFaixa(db, mensagem.id);
  }
  return 'ok';
}

// ------------------------------------------------------------
// A gravação (bucket PRIVADO `ligacoes`)
// ------------------------------------------------------------

export const BUCKET_DAS_GRAVACOES = 'ligacoes';
export const ARQUIVOS_DA_GRAVACAO = ['estereo.ogg', 'cliente.ogg', 'atendente.ogg'] as const;
/** O teto do bucket (1134) e o do corpo que o Next guarda com o middleware. */
export const TETO_DA_GRAVACAO = 10 * 1024 * 1024;
/** Ouvir: a URL assinada vive só isto (a rota estável gera outra a cada vez). */
export const VIDA_DA_URL_ASSINADA_S = 10 * 60;

export function caminhoDaGravacao(accountId: string, ligacaoId: string, arquivo: string): string {
  return `account-${accountId}/ligacoes/${ligacaoId}/${arquivo}`;
}

async function marcarGravacaoNaFaixa(db: SupabaseClient, messageId: string): Promise<void> {
  const { data } = await db.from('messages').select('ligacao').eq('id', messageId).maybeSingle();
  const ligacao = (data?.ligacao ?? null) as Record<string, unknown> | null;
  if (!ligacao || ligacao.gravacao === true) return;
  const { error } = await db
    .from('messages')
    .update({ ligacao: { ...ligacao, gravacao: true } })
    .eq('id', messageId);
  if (error) console.error('[ligacoes] marcar a gravação na faixa falhou:', error.message);
}

export async function receberGravacao(args: {
  db: SupabaseClient;
  computador: Pick<Computador, 'account_id' | 'channel_id'>;
  ligacaoId: string;
  arquivo: string;
  corpo: Buffer;
}): Promise<DesfechoDoAviso> {
  const { db, computador, ligacaoId, arquivo, corpo } = args;
  const { data: linha, error } = await db
    .from('cb_ligacoes')
    .select('id, account_id')
    .eq('id', ligacaoId)
    .eq('account_id', computador.account_id)
    .eq('channel_id', computador.channel_id)
    .eq('pelo_crm', true)
    .maybeSingle();
  if (error) return 'falhou';
  if (!linha) return 'desconhecida';
  const { error: erroDoEnvio } = await db.storage
    .from(BUCKET_DAS_GRAVACOES)
    .upload(caminhoDaGravacao(computador.account_id, ligacaoId, arquivo), corpo, {
      contentType: 'audio/ogg',
      upsert: true,
    });
  if (erroDoEnvio) {
    console.error('[ligacoes] guardar a gravação falhou:', ligacaoId, arquivo, erroDoEnvio.message);
    return 'falhou';
  }
  if (arquivo !== 'estereo.ogg') return 'ok';
  const { error: erroDaMarca } = await db
    .from('cb_ligacoes')
    .update({ gravacao_recebida_em: new Date().toISOString() })
    .eq('id', ligacaoId)
    .is('gravacao_recebida_em', null);
  if (erroDaMarca) return 'falhou';
  const { data: depois } = await db.from('cb_ligacoes').select('message_id').eq('id', ligacaoId).maybeSingle();
  if (depois?.message_id) await marcarGravacaoNaFaixa(db, depois.message_id as string);
  return 'ok';
}

/**
 * O endereço para OUVIR: URL assinada de vida curta. Quem chama confere antes
 * que a pessoa vê a conversa da ligação ("ouve quem vê a conversa", D7).
 */
export async function enderecoDaGravacao(
  db: SupabaseClient,
  accountId: string,
  ligacaoId: string,
): Promise<{ url: string; conversationId: string | null } | null | 'falhou'> {
  const { data: linha, error } = await db
    .from('cb_ligacoes')
    .select('id, conversation_id, gravacao_recebida_em')
    .eq('id', ligacaoId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) return 'falhou';
  if (!linha?.gravacao_recebida_em) return null;
  const { data, error: erroDaUrl } = await db.storage
    .from(BUCKET_DAS_GRAVACOES)
    .createSignedUrl(caminhoDaGravacao(accountId, ligacaoId, 'estereo.ogg'), VIDA_DA_URL_ASSINADA_S);
  if (erroDaUrl || !data?.signedUrl) return 'falhou';
  return { url: data.signedUrl, conversationId: (linha.conversation_id as string | null) ?? null };
}
