// ============================================================
// Avisos do próprio WhatsApp dentro de um grupo ("Fulano entrou").
//
// Viram mensagem com `content_type='system'` (906) na conversa do grupo, para
// aparecerem em ordem cronológica no meio do histórico sem a UI ter que
// fundir dois streams.
//
// ⚠️ O TEXTO É GRAVADO PRONTO, não estruturado. É divergência consciente do
// padrão da 912 (`cb_lead_events`, que guarda dados e descreve na UI), e o
// motivo é que aqui o texto É o registro histórico: "Fulano entrou em 12/03"
// não muda de sentido depois, e o locale do app é fixo por build. Guardar
// estruturado exigiria uma terceira tabela de eventos e um terceiro
// renderizador para ganhar tradução que ninguém vai usar.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export type AcaoParticipante = 'add' | 'remove' | 'promote' | 'demote' | 'leave';

/**
 * Nomes de participantes que a gente conhece, resolvidos pelo histórico.
 *
 * O payload de `group.participants.update` traz só JIDs, e em produção eles
 * vêm em `@lid` — um número interno que não diz nada a ninguém. Mas quem já
 * escreveu no grupo deixou o `pushName` gravado em `messages`, então dá para
 * traduzir sem nenhuma chamada à Evolution.
 *
 * Quem nunca falou continua desconhecido, e aí o texto usa uma forma genérica
 * em vez de despejar o LID cru na tela.
 */
export async function nomesConhecidos(
  db: SupabaseClient,
  accountId: string,
  jids: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (!jids.length) return mapa;

  // ⚠️ ESCOPADO POR CONTA, e isto não é zelo teórico: esta consulta roda com
  // service-role, que ignora RLS. `messages` não tem `account_id`, então o
  // recorte vai pelo pai — e sem ele o nome de um participante guardado por
  // OUTRO escritório apareceria aqui. Dois clientes do CRM podem
  // perfeitamente ter a mesma pessoa num grupo.
  const { data } = await db
    .from('messages')
    .select('group_sender_jid, group_sender_name, conversations!inner(account_id)')
    .eq('conversations.account_id', accountId)
    .in('group_sender_jid', jids)
    .not('group_sender_name', 'is', null)
    .limit(200);

  for (const linha of (data ?? []) as {
    group_sender_jid: string | null;
    group_sender_name: string | null;
  }[]) {
    if (linha.group_sender_jid && linha.group_sender_name && !mapa.has(linha.group_sender_jid)) {
      mapa.set(linha.group_sender_jid, linha.group_sender_name);
    }
  }
  return mapa;
}

const VERBO: Record<AcaoParticipante, { um: string; varios: string; anonimo: string }> = {
  add: { um: 'entrou no grupo', varios: 'entraram no grupo', anonimo: 'entrou no grupo' },
  remove: { um: 'saiu do grupo', varios: 'saíram do grupo', anonimo: 'saiu do grupo' },
  leave: { um: 'saiu do grupo', varios: 'saíram do grupo', anonimo: 'saiu do grupo' },
  promote: {
    um: 'agora é administrador',
    varios: 'agora são administradores',
    anonimo: 'agora é administrador',
  },
  demote: {
    um: 'deixou de ser administrador',
    varios: 'deixaram de ser administradores',
    anonimo: 'deixou de ser administrador',
  },
};

/**
 * Frase do aviso. Nomes conhecidos aparecem; os demais viram contagem.
 *
 * "Ana e mais 2 entraram no grupo" é melhor que "Ana, 2472…@lid e
 * 1938…@lid entraram" — e muito melhor que esconder que houve mudança.
 */
export function descreverParticipantes(
  acao: AcaoParticipante,
  jids: string[],
  nomes: Map<string, string>,
): string | null {
  if (!jids.length) return null;
  const verbo = VERBO[acao];
  if (!verbo) return null;

  const conhecidos = jids.map((j) => nomes.get(j)).filter((n): n is string => !!n);
  const anonimos = jids.length - conhecidos.length;
  const plural = jids.length > 1;

  if (!conhecidos.length) {
    return plural
      ? `${jids.length} participantes ${verbo.varios}`
      : `Um participante ${verbo.anonimo}`;
  }

  const lista =
    conhecidos.length === 1
      ? conhecidos[0]
      : `${conhecidos.slice(0, -1).join(', ')} e ${conhecidos[conhecidos.length - 1]}`;

  if (anonimos > 0) {
    return `${lista} e mais ${anonimos} ${verbo.varios}`;
  }
  return `${lista} ${conhecidos.length > 1 ? verbo.varios : verbo.um}`;
}

/**
 * Grava o aviso na conversa do grupo.
 *
 * ⚠️ NÃO mexe em `last_message_*` nem em `unread_count`, de propósito. Um
 * grupo grande tem gente entrando e saindo o dia todo; deixar isso reordenar
 * o inbox faria o grupo pular para o topo sem ninguém ter falado nada, e
 * acender o contador de não lidas por movimento que não pede resposta.
 * O aviso aparece no histórico, no lugar cronológico dele, e só.
 *
 * Silencioso quando o grupo ainda não existe no CRM: sem conversa não há onde
 * pendurar, e criar uma conversa vazia a partir de um "fulano entrou" poria
 * no inbox um grupo em que ninguém nunca falou.
 */
export async function registrarAvisoDeSistema(
  db: SupabaseClient,
  args: {
    accountId: string;
    groupJid: string;
    texto: string;
    /** Unix seconds; usa agora se ausente. */
    timestamp?: number;
    channelId?: string | null;
  },
): Promise<void> {
  const { data: grupo } = await db
    .from('cb_groups')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('jid', args.groupJid)
    .maybeSingle();
  if (!grupo) return;

  const { data: conversa } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('group_id', (grupo as { id: string }).id)
    .maybeSingle();
  if (!conversa) return;

  const { error } = await db.from('messages').insert({
    conversation_id: (conversa as { id: string }).id,
    // Nenhum valor descreve bem "aviso do WhatsApp": o CHECK só admite
    // customer/agent/bot. Fica `customer` porque é o único que não afirma
    // que NÓS produzimos a linha. Quem precisar distinguir olha
    // `content_type='system'`, que é o campo com a resposta certa.
    sender_type: 'customer',
    content_type: 'system',
    content_text: args.texto,
    from_me: false,
    status: 'delivered',
    channel_id: args.channelId ?? null,
    created_at: new Date((args.timestamp ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  });
  if (error) console.error('[cb-groups] gravar aviso de sistema falhou:', error.message);
}

/** Payload de `group.participants.update`, na forma que a Evolution entrega. */
export interface ParticipantesAtualizados {
  groupJid: string;
  acao: AcaoParticipante;
  jids: string[];
}

export function parseParticipantsUpdate(data: unknown): ParticipantesAtualizados | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { id?: unknown; action?: unknown; participants?: unknown };
  const groupJid = typeof d.id === 'string' ? d.id : null;
  const acao = typeof d.action === 'string' ? (d.action as AcaoParticipante) : null;
  if (!groupJid || !acao || !VERBO[acao]) return null;
  const jids = Array.isArray(d.participants)
    ? d.participants.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];
  if (!jids.length) return null;
  return { groupJid, acao, jids };
}

/**
 * Payload de `groups.upsert`. Chega como array de grupos; o que interessa é o
 * par (jid, subject) para manter o nome fresco.
 *
 * ⚠️ `GROUPS_UPDATE` NÃO EXISTE nesta versão da Evolution (o enum recusa —
 * conferido em 2026-07-28). Então este é o único evento que pode trazer
 * mudança de nome, e não há garantia de que ele dispare em renomeação. O
 * botão de re-sincronizar da Fase 4 é o caminho confiável.
 */
export function parseGroupsUpsert(data: unknown): { jid: string; subject: string | null }[] {
  const itens = Array.isArray(data) ? data : [data];
  const saida: { jid: string; subject: string | null }[] = [];
  for (const bruto of itens) {
    if (!bruto || typeof bruto !== 'object') continue;
    const g = bruto as { id?: unknown; subject?: unknown };
    if (typeof g.id !== 'string' || !g.id.endsWith('@g.us')) continue;
    saida.push({ jid: g.id, subject: typeof g.subject === 'string' ? g.subject : null });
  }
  return saida;
}
