// ============================================================
// Nome de quem está no grupo.
//
// O `findGroupInfos` não traz nome nenhum (medido no fonte da Evolution de
// produção, 29/10/2026), e o nome que a Evolution guarda vem dos contatos do
// celular e das conversas 1:1 — não de quem fala no grupo. Então o nome sai,
// nesta ordem:
//
//   1. a FICHA do cliente no CRM, pela chave de pessoa do telefone
//      (`telefone_canonico`, a chave única de `contacts` — nunca pelos 8
//      últimos dígitos, que fundiriam duas pessoas);
//   2. o nome com que a pessoa ESCREVEU neste grupo (`group_sender_name`,
//      o `pushName` gravado na mensagem);
//   3. nenhum: a tela mostra o telefone, ou "número oculto".
//
// Leitura que falha não derruba a lista: o nome é enfeite, o telefone e o
// papel já vieram do WhatsApp. A falha fica no log.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { chaveDePessoa } from '@/lib/contacts/dedupe';
import type { ParticipanteDoGrupo } from '@/lib/cb-groups/sync';

export interface ParticipanteComNome extends ParticipanteDoGrupo {
  nome: string | null;
  /** De onde veio o nome: a ficha do cliente ou o que ele usou no grupo. */
  fonteDoNome: 'ficha' | 'grupo' | null;
  /** A ficha do cliente com este telefone, quando há. */
  contatoId: string | null;
}

/** Fatia do `.in()`: 200 telefones de 13 dígitos cabem com folga na URL. */
const FATIA = 200;

/**
 * Quantas mensagens do grupo são lidas atrás de nomes. É um teto de propósito
 * (o PostgREST cortaria em 1000 de qualquer jeito): quem só escreveu antes
 * das últimas 1000 mensagens aparece pelo telefone.
 */
export const MENSAGENS_LIDAS_PARA_NOMES = 1000;

async function fichasPorTelefone(
  db: SupabaseClient,
  accountId: string,
  telefones: string[],
): Promise<Map<string, { id: string; nome: string | null }>> {
  const mapa = new Map<string, { id: string; nome: string | null }>();
  const chaves = [...new Set(telefones.map((t) => chaveDePessoa(t)).filter(Boolean))];
  for (let i = 0; i < chaves.length; i += FATIA) {
    const { data, error } = await db
      .from('contacts')
      .select('id, name, telefone_canonico')
      .eq('account_id', accountId)
      .in('telefone_canonico', chaves.slice(i, i + FATIA));
    if (error) {
      console.error('[cb-groups] ler as fichas dos participantes falhou:', error.message);
      continue;
    }
    for (const c of (data ?? []) as { id: string; name: string | null; telefone_canonico: string | null }[]) {
      if (c.telefone_canonico) mapa.set(c.telefone_canonico, { id: c.id, nome: c.name?.trim() || null });
    }
  }
  return mapa;
}

async function nomesUsadosNoGrupo(
  db: SupabaseClient,
  conversationId: string,
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const { data, error } = await db
    .from('messages')
    .select('group_sender_jid, group_sender_name')
    .eq('conversation_id', conversationId)
    .not('group_sender_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(MENSAGENS_LIDAS_PARA_NOMES);
  if (error) {
    console.error('[cb-groups] ler os nomes usados no grupo falhou:', error.message);
    return mapa;
  }
  // Da mais nova para a mais antiga: fica o nome MAIS RECENTE de cada um. O
  // remetente de telefone entra pela CHAVE DE PESSOA (o nono dígito do
  // remetente gravado pode diferir do da lista); o de LID, pelo LID.
  for (const m of (data ?? []) as { group_sender_jid: string | null; group_sender_name: string | null }[]) {
    const nome = m.group_sender_name?.trim();
    if (!m.group_sender_jid || !nome) continue;
    const [antes, dominio] = m.group_sender_jid.split('@');
    const chave = dominio === 's.whatsapp.net' ? chaveDePessoa(antes) : m.group_sender_jid;
    if (!mapa.has(chave)) mapa.set(chave, nome);
  }
  return mapa;
}

/**
 * Dá nome aos participantes. `conversationId` nulo (grupo sem conversa) pula
 * a 2ª fonte. A linha deste número não ganha nome: a tela a chama de "este
 * número".
 */
export async function nomearParticipantes(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string | null; participantes: ParticipanteDoGrupo[] },
): Promise<ParticipanteComNome[]> {
  const telefones = args.participantes.flatMap((p) => (p.telefone ? [p.telefone] : []));
  const [fichas, usados] = await Promise.all([
    fichasPorTelefone(db, args.accountId, telefones),
    args.conversationId ? nomesUsadosNoGrupo(db, args.conversationId) : Promise.resolve(new Map<string, string>()),
  ]);

  return args.participantes.map((p) => {
    const ficha = p.telefone ? fichas.get(chaveDePessoa(p.telefone)) : undefined;
    // O remetente gravado prefere o telefone (`remetenteDoGrupo`), mas a
    // mensagem antiga ou a sem par chega pelo LID: as três formas.
    const doGrupo = [p.telefone ? chaveDePessoa(p.telefone) : null, p.id, p.lid]
      .map((chave) => (chave ? usados.get(chave) : undefined))
      .find(Boolean);
    const nome = p.somosNos ? null : (ficha?.nome ?? doGrupo ?? null);
    return {
      ...p,
      nome,
      fonteDoNome: nome == null ? null : ficha?.nome ? 'ficha' : 'grupo',
      contatoId: ficha?.id ?? null,
    };
  });
}

const PESO_DO_PAPEL = { criador: 0, admin: 1 } as const;

/**
 * Ordem da lista: este número, os admins (o criador primeiro), quem tem nome
 * em ordem alfabética, e por fim quem só tem telefone.
 */
export function ordenarParticipantes(lista: ParticipanteComNome[]): ParticipanteComNome[] {
  const peso = (p: ParticipanteComNome) =>
    p.somosNos ? -1 : p.papel ? PESO_DO_PAPEL[p.papel] : 2;
  return [...lista].sort((a, b) => {
    const porPapel = peso(a) - peso(b);
    if (porPapel !== 0) return porPapel;
    if (a.nome && b.nome) return a.nome.localeCompare(b.nome, undefined, { sensitivity: 'base' });
    if (a.nome || b.nome) return a.nome ? -1 : 1;
    // Sem telefone ("Número oculto") por último. Explícito: na colação do
    // ICU um marcador como `~` vem ANTES dos dígitos.
    if (!a.telefone || !b.telefone) return a.telefone ? -1 : b.telefone ? 1 : 0;
    return a.telefone < b.telefone ? -1 : a.telefone > b.telefone ? 1 : 0;
  });
}
