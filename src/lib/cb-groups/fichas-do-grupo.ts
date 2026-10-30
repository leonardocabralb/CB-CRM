// ============================================================
// Quais FICHAS estão no grupo (1117) — o vínculo que põe o grupo na aba
// Relacionados do cliente, e a conversa individual de cada participante.
//
// O vínculo é refeito a cada leitura COMPLETA da lista de participantes (o
// painel do grupo, o "Sincronizar" e o detalhe na chegada), pela função
// `cb_gravar_fichas_do_grupo`: apaga quem saiu, grava quem está e carimba
// `cb_groups.participantes_conferidos_em` numa transação, com o grupo
// travado — duas conferências ao mesmo tempo não se cruzam. Entre duas
// leituras ele envelhece: quem entrou ou saiu depois só aparece na próxima; a
// chegada de mensagem num grupo conferido há mais de
// `VALIDADE_DA_CONFERENCIA_MS` confere de novo.
//
// ⚠️ Só com a lista, as fichas e os números do escritório lidos por inteiro:
// lista vazia é falha (o número da conexão está no grupo), e um conjunto pela
// metade apagaria o vínculo de quem não se leu. Nada aqui lança.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { chaveDePessoa } from '@/lib/contacts/dedupe';
import { fichasPorTelefone } from '@/lib/cb-groups/nomes-dos-participantes';
import type { ParticipanteDoGrupo } from '@/lib/cb-groups/sync';

const FATIA_DE_IDS = 100;

/** Grupo conferido há mais que isto é conferido de novo na chegada de mensagem. */
export const VALIDADE_DA_CONFERENCIA_MS = 24 * 60 * 60_000;

/** A lista do grupo precisa ser conferida de novo? (Nunca conferida = sim.) */
export function conferenciaVencida(conferidaEm: string | null | undefined, agoraMs: number): boolean {
  if (!conferidaEm) return true;
  const ms = Date.parse(conferidaEm);
  return Number.isNaN(ms) || agoraMs - ms > VALIDADE_DA_CONFERENCIA_MS;
}

/**
 * As chaves de pessoa dos números do ESCRITÓRIO (todas as conexões da
 * conta). NULO = não se leu: sem saber quem é do escritório, a conferência
 * não grava.
 */
export async function chavesDasConexoes(db: SupabaseClient, accountId: string): Promise<Set<string> | null> {
  const { data, error } = await db.from('cb_channels').select('display_phone').eq('account_id', accountId);
  if (error) {
    console.error('[cb-groups] ler os números das conexões falhou:', error.message);
    return null;
  }
  const chaves = new Set<string>();
  for (const c of (data ?? []) as { display_phone: string | null }[]) {
    const chave = c.display_phone ? chaveDePessoa(c.display_phone) : '';
    if (chave) chaves.add(chave);
  }
  return chaves;
}

/**
 * O que a conferência grava: as fichas de quem está no grupo, sem o nosso
 * número e sem os outros números do escritório (a ficha de uma conexão do CRM
 * não é cliente do grupo). NULO = a leitura não diz quem é quem — ninguém além
 * de nós com telefone (a Evolution mudou o campo, ou perdeu o par do LID):
 * gravar "ninguém" apagaria o vínculo de todos, então só se carimba.
 */
export function fichasParaGravar<T extends ParticipanteDoGrupo>(
  participantes: T[],
  fichaDe: (p: T) => string | null | undefined,
  doEscritorio: Set<string>,
): string[] | null {
  const outros = participantes.filter((p) => !p.somosNos);
  if (outros.length > 0 && outros.every((p) => !p.telefone)) return null;
  const ids = outros.flatMap((p) => {
    if (!p.telefone || doEscritorio.has(chaveDePessoa(p.telefone))) return [];
    const id = fichaDe(p);
    return id ? [id] : [];
  });
  return [...new Set(ids)];
}

/**
 * Refaz o vínculo do grupo (`fichasParaGravar`; NULO só carimba). Devolve se
 * a função gravou: falhou, a próxima chegada (ou o painel) confere de novo.
 */
export async function gravarFichasDoGrupo(
  db: SupabaseClient,
  args: { accountId: string; groupId: string; contatoIds: string[] | null },
): Promise<boolean> {
  const { data, error } = await db.rpc('cb_gravar_fichas_do_grupo', {
    p_account_id: args.accountId,
    p_group_id: args.groupId,
    p_contact_ids: args.contatoIds,
  });
  if (error) {
    console.error('[cb-groups] gravar as fichas do grupo falhou:', error.message);
    return false;
  }
  return data === true;
}

/**
 * O caminho do detalhamento (o "Sincronizar" e a chegada): acha as fichas
 * dos participantes e refaz o vínculo. O painel do grupo, que já leu as
 * fichas para dar nome, chama `fichasParaGravar` + `gravarFichasDoGrupo`.
 */
export async function conferirFichasDoGrupo(
  db: SupabaseClient,
  args: { accountId: string; groupId: string; participantes: ParticipanteDoGrupo[] },
): Promise<boolean> {
  if (!args.participantes.length) return false;
  const doEscritorio = await chavesDasConexoes(db, args.accountId);
  if (!doEscritorio) return false;
  const telefones = args.participantes.flatMap((p) => (p.telefone && !p.somosNos ? [p.telefone] : []));
  const { mapa, completa } = await fichasPorTelefone(db, args.accountId, telefones);
  if (!completa) return false;
  return gravarFichasDoGrupo(db, {
    accountId: args.accountId,
    groupId: args.groupId,
    contatoIds: fichasParaGravar(
      args.participantes,
      (p) => (p.telefone ? mapa.get(chaveDePessoa(p.telefone))?.id : null),
      doEscritorio,
    ),
  });
}

/**
 * A conversa individual de cada ficha (uma por ficha, 036). A fatia que falha
 * fica fora do mapa: o participante dela fica sem o "abrir a conversa", e a
 * lista continua na tela.
 */
export async function conversasDasFichas(
  db: SupabaseClient,
  accountId: string,
  contatoIds: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const ids = [...new Set(contatoIds)];
  // Em fatias: 100 uuids cabem com folga na URL do `.in()`.
  for (let i = 0; i < ids.length; i += FATIA_DE_IDS) {
    const { data, error } = await db
      .from('conversations')
      .select('id, contact_id')
      .eq('account_id', accountId)
      .in('contact_id', ids.slice(i, i + FATIA_DE_IDS));
    if (error) {
      console.error('[cb-groups] ler as conversas dos participantes falhou:', error.message);
      continue;
    }
    for (const c of (data ?? []) as { id: string; contact_id: string | null }[]) {
      if (c.contact_id && !mapa.has(c.contact_id)) mapa.set(c.contact_id, c.id);
    }
  }
  return mapa;
}
