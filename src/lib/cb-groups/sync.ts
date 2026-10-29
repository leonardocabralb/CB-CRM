// ============================================================
// Sincronização de grupos com o WhatsApp.
//
// DUAS VELOCIDADES, e a separação é a razão de o recurso ser usável:
//
//   RÁPIDA (`sincronizarListaDeGrupos`) — um `findChats` devolve todos os
//   chats em segundos, JÁ COM o nome e a foto de cada grupo. Só isso preenche
//   a lista inteira do inbox de forma apresentável.
//
//   LENTA (`detalharGrupos`) — `findGroupInfos` custa ~850ms POR GRUPO
//   (medido em produção). Com 57 grupos são ~48s, que não cabem no clique de
//   um botão. Só ela sabe participantes, `announce`, se somos admin e o nosso
//   LID, então roda depois, em segundo plano.
//
// Cada grupo é gravado assim que é lido: um estouro de tempo no meio deixa
// progresso parcial, não zero.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chaveDePessoa } from '@/lib/contacts/dedupe';
import type { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';

/** Um grupo como o `findChats` entrega. */
export interface GrupoDaLista {
  jid: string;
  /** Nome do grupo. O `findChats` já traz — não precisa do findGroupInfos. */
  nome: string | null;
  fotoUrl: string | null;
}

/**
 * Filtra os grupos de uma resposta de `findChats`.
 *
 * O campo do nome muda de lugar entre versões da Evolution (`pushName` no
 * número de produção, `name`/`subject` em outras), então aceitamos os três —
 * um upgrade do servidor não pode fazer todo grupo virar "sem nome".
 */
export function parseChatsParaGrupos(chats: unknown[]): GrupoDaLista[] {
  const saida: GrupoDaLista[] = [];
  for (const bruto of chats) {
    if (!bruto || typeof bruto !== 'object') continue;
    const c = bruto as Record<string, unknown>;
    const jid = typeof c.remoteJid === 'string' ? c.remoteJid : typeof c.id === 'string' ? c.id : null;
    if (!jid || !jid.endsWith('@g.us')) continue;
    const nome = [c.pushName, c.name, c.subject].find(
      (v): v is string => typeof v === 'string' && v.trim().length > 0,
    );
    saida.push({
      jid,
      nome: nome?.trim() ?? null,
      fotoUrl: typeof c.profilePicUrl === 'string' ? c.profilePicUrl : null,
    });
  }
  return saida;
}

/** Detalhe de um grupo, já reduzido ao que a nossa tabela guarda. */
export interface DetalheDoGrupo {
  subject: string | null;
  description: string | null;
  pictureUrl: string | null;
  ownerJid: string | null;
  participantCount: number | null;
  isAnnounce: boolean | null;
  /** Somos administradores deste grupo? Libera renomear de verdade. */
  weAreAdmin: boolean | null;
  /**
   * Só admins mudam os dados do grupo (nome, descrição, foto)? É o `restrict`
   * da Baileys. `false` = qualquer participante muda, e o renomear vale para
   * nós mesmo sem sermos admin. Não é guardado: só serve ao vivo.
   */
  soAdminEdita: boolean | null;
  /**
   * O NOSSO lid, descoberto cruzando o telefone dos participantes
   * (`.jid` na Baileys 6, `.phoneNumber` na 7) com o nosso número.
   */
  ourLid: string | null;
}

const soDigitos = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/\D/g, '') : '';

/**
 * O telefone de um participante, na forma que a Evolution entregar:
 * `.jid` (Baileys 6.7.19, a forma medida em produção em 2026-07) ou, na
 * Baileys 7 (tipo `Contact`), `.phoneNumber` quando o `id` preferido é o LID
 * — ou o PRÓPRIO `.id`, quando o preferido é o telefone (e aí o LID vem em
 * `.lid`). `.jid` NÃO existe mais na 7. Ler só `.jid` faz a nossa linha nunca
 * ser achada depois do upgrade: `weAreAdmin` e `ourLid` viram `null` em
 * silêncio. Ver docs/PLANO-baileys-7.md, ajuste 3.
 */
const telefoneDoParticipante = (p: Record<string, unknown>): string =>
  soDigitos(p.phoneNumber) ||
  soDigitos(p.jid) ||
  (typeof p.id === 'string' && p.id.endsWith('@s.whatsapp.net') ? soDigitos(p.id) : '');

/** O LID de um participante: `.lid` quando vem, senão o `.id` se ele for `@lid`. */
const lidDoParticipante = (p: Record<string, unknown>): string | null => {
  for (const v of [p.lid, p.id]) {
    if (typeof v === 'string' && v.endsWith('@lid')) return v;
  }
  return null;
};

/**
 * É a NOSSA linha? Pela chave de pessoa (`chaveDePessoa`), nunca pela grafia:
 * o WhatsApp entrega o número antigo sem o nono dígito, e o `display_phone`
 * do canal pode estar gravado com ele — pela grafia, "somos admin?" saía
 * `false` para o próprio admin.
 */
const ehONossoNumero = (p: Record<string, unknown>, nosso: string): boolean => {
  const telefone = telefoneDoParticipante(p);
  return !!nosso && !!telefone && chaveDePessoa(telefone) === nosso;
};

const participantesDe = (raw: unknown): Record<string, unknown>[] => {
  const lista = (raw as { participants?: unknown } | null)?.participants;
  return Array.isArray(lista)
    ? lista.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    : [];
};

/**
 * Lê a resposta de `findGroupInfos`.
 *
 * `nossoTelefone` é o `display_phone` do canal. É com ele que achamos a nossa
 * linha entre os participantes — e é a única forma de descobrir o nosso LID,
 * porque o `participants[].id` vem em `@lid` e só o telefone do participante
 * (`.jid` ou `.phoneNumber`, conforme a versão) casa com o nosso número. Sem
 * esse cruzamento, menção a nós nunca acende (ver 916).
 */
export function parseGroupInfo(raw: unknown, nossoTelefone: string | null): DetalheDoGrupo {
  const vazio: DetalheDoGrupo = {
    subject: null,
    description: null,
    pictureUrl: null,
    ownerJid: null,
    participantCount: null,
    isAnnounce: null,
    weAreAdmin: null,
    soAdminEdita: null,
    ourLid: null,
  };
  if (!raw || typeof raw !== 'object') return vazio;
  const g = raw as Record<string, unknown>;

  const participantes = participantesDe(raw);

  let weAreAdmin: boolean | null = participantes.length ? false : null;
  let ourLid: string | null = null;
  const nosso = nossoTelefone ? chaveDePessoa(nossoTelefone) : '';
  if (nosso) {
    const eu = participantes.find((p) => ehONossoNumero(p, nosso));
    if (eu) {
      // `admin` vem como 'admin' | 'superadmin' | null.
      weAreAdmin = !!eu.admin;
      ourLid = lidDoParticipante(eu);
    }
  }

  return {
    subject: typeof g.subject === 'string' ? g.subject : null,
    description: typeof g.desc === 'string' ? g.desc : null,
    pictureUrl: typeof g.pictureUrl === 'string' ? g.pictureUrl : null,
    ownerJid: typeof g.owner === 'string' ? g.owner : null,
    participantCount:
      typeof g.size === 'number' ? g.size : participantes.length || null,
    isAnnounce: typeof g.announce === 'boolean' ? g.announce : null,
    weAreAdmin,
    soAdminEdita: typeof g.restrict === 'boolean' ? g.restrict : null,
    ourLid,
  };
}

/**
 * O renomear NO WHATSAPP vale para nós? Admin, ou grupo que deixa qualquer
 * participante mudar os dados. `null` em qualquer dos dois = não sei, e não
 * destrava (o WhatsApp responderia com erro cru).
 */
export function podeRenomearAoVivo(info: Pick<DetalheDoGrupo, 'weAreAdmin' | 'soAdminEdita'>): boolean {
  return info.weAreAdmin === true || info.soAdminEdita === false;
}

/**
 * O que o detalhe grava em `cb_groups`. Uma lista só para o detalhamento em
 * lote e para a leitura ao vivo do painel: duas cópias divergiriam, e um dos
 * caminhos voltaria a apagar o nome com NULL.
 */
export function camposDoDetalhe(info: DetalheDoGrupo, agora: string): Record<string, unknown> {
  const campos: Record<string, unknown> = {
    participant_count: info.participantCount,
    is_announce: info.isAnnounce,
    we_are_admin: info.weAreAdmin,
    synced_at: agora,
  };
  if (info.subject) campos.subject = info.subject;
  if (info.description) campos.description = info.description;
  if (info.pictureUrl) campos.picture_url = info.pictureUrl;
  if (info.ownerJid) campos.owner_jid = info.ownerJid;
  return campos;
}

/** Papel de um participante. `superadmin` é quem criou o grupo. */
export type PapelNoGrupo = 'criador' | 'admin' | null;

/** Um participante como a Evolution o entrega, já reduzido ao que a tela usa. */
export interface ParticipanteDoGrupo {
  /** O identificador preferido, como veio (LID ou telefone). Chave da linha. */
  id: string;
  /** Só dígitos, com DDI. `null` = a pessoa esconde o número (só o LID). */
  telefone: string | null;
  /** O LID, quando houver. Casa com o `group_sender_jid` de quem escreveu. */
  lid: string | null;
  papel: PapelNoGrupo;
  /** A linha do número desta conexão. */
  somosNos: boolean;
}

/**
 * Lê os participantes da resposta de `findGroupInfos` — as mesmas três formas
 * de `parseGroupInfo` (`{id: lid, jid}`, `{id: lid, phoneNumber}`,
 * `{id: telefone, lid}`). Item sem `id` é descartado; nada aqui lança.
 */
export function lerParticipantes(raw: unknown, nossoTelefone: string | null): ParticipanteDoGrupo[] {
  const nosso = nossoTelefone ? chaveDePessoa(nossoTelefone) : '';
  const saida: ParticipanteDoGrupo[] = [];
  for (const p of participantesDe(raw)) {
    if (typeof p.id !== 'string' || !p.id) continue;
    saida.push({
      id: p.id,
      telefone: telefoneDoParticipante(p) || null,
      lid: lidDoParticipante(p),
      papel: p.admin === 'superadmin' ? 'criador' : p.admin === 'admin' ? 'admin' : null,
      somosNos: ehONossoNumero(p, nosso),
    });
  }
  return saida;
}

export interface ResultadoSync {
  encontrados: number;
  gravados: number;
  detalhados: number;
  falhas: number;
}

/**
 * PARTE RÁPIDA. Descobre os grupos e grava nome e foto.
 *
 * ⚠️ `subject` só é ATUALIZADO quando o WhatsApp devolveu um nome. Um
 * `findChats` que venha sem nome não pode apagar o que já sabíamos —
 * sobrescrever com NULL faria o grupo "perder o nome" a cada sincronização
 * de uma versão da Evolution que use outro campo.
 */
export async function sincronizarListaDeGrupos(
  db: SupabaseClient,
  args: { accountId: string; channelId: string; client: EvolutionClient },
): Promise<{ grupos: GrupoDaLista[]; gravados: number }> {
  const chats = await args.client.findChats();
  const grupos = parseChatsParaGrupos(chats);
  if (!grupos.length) return { grupos, gravados: 0 };

  // DUAS idas ao banco, não duas por grupo. A versão anterior fazia um SELECT
  // e um write para cada grupo: com os 58 grupos do número de produção deram
  // 116 viagens e 11,9s de espera com o operador olhando um botão girar.
  // Agora é uma leitura em bloco + um upsert em bloco (~2s).
  const jids = grupos.map((g) => g.jid);
  const { data: existentes } = await db
    .from('cb_groups')
    .select('jid, subject, picture_url')
    .eq('account_id', args.accountId)
    .in('jid', jids);

  const anterior = new Map<string, { subject: string | null; picture_url: string | null }>();
  for (const e of (existentes ?? []) as {
    jid: string;
    subject: string | null;
    picture_url: string | null;
  }[]) {
    anterior.set(e.jid, { subject: e.subject, picture_url: e.picture_url });
  }

  // ⚠️ O upsert em bloco exige colunas UNIFORMES, então cada linha precisa
  // trazer um valor para `subject`/`picture_url`. Por isso o valor anterior é
  // repetido quando o WhatsApp não mandou nada agora: sem esse cuidado, o
  // upsert gravaria NULL e o grupo PERDERIA o nome que já tínhamos a cada
  // sincronização — exatamente o que a versão por linha evitava omitindo a
  // coluna.
  const agora = new Date().toISOString();
  const linhas = grupos.map((g) => ({
    account_id: args.accountId,
    channel_id: args.channelId,
    jid: g.jid,
    subject: g.nome ?? anterior.get(g.jid)?.subject ?? null,
    picture_url: g.fotoUrl ?? anterior.get(g.jid)?.picture_url ?? null,
    synced_at: agora,
  }));

  // `cb_groups_account_jid_idx` é único e NÃO é parcial, então serve de alvo
  // para o ON CONFLICT (ver a nota do CLAUDE.md sobre índices parciais, que
  // não valem como alvo — este não é o caso).
  const { error } = await db
    .from('cb_groups')
    .upsert(linhas, { onConflict: 'account_id,jid' });

  if (error) {
    console.error('[cb-groups sync] gravar grupos falhou:', error.message);
    return { grupos, gravados: 0 };
  }
  return { grupos, gravados: linhas.length };
}

/**
 * PARTE LENTA. Uma chamada por grupo; grava cada um antes de ir ao próximo.
 *
 * Sequencial de propósito: paralelizar cortaria o tempo, mas dispararia
 * dezenas de chamadas simultâneas contra a mesma Evolution que atende o
 * tráfego real de mensagens do escritório. Isto aqui é trabalho de fundo —
 * pode demorar.
 *
 * Quando descobre o nosso LID, grava no canal e para de procurar: é o mesmo
 * identificador em todos os grupos.
 */
export async function detalharGrupos(
  db: SupabaseClient,
  args: {
    accountId: string;
    channelId: string;
    client: EvolutionClient;
    displayPhone: string | null;
    jids: string[];
    /** Já sabemos o nosso lid? Então não precisa procurar de novo. */
    ownLidConhecido?: string | null;
  },
): Promise<{ detalhados: number; falhas: number; ourLid: string | null }> {
  let detalhados = 0;
  let falhas = 0;
  let ourLid: string | null = args.ownLidConhecido ?? null;

  for (const jid of args.jids) {
    try {
      const info = parseGroupInfo(await args.client.findGroupInfos(jid), args.displayPhone);

      const { error } = await db
        .from('cb_groups')
        .update(camposDoDetalhe(info, new Date().toISOString()))
        .eq('account_id', args.accountId)
        .eq('jid', jid);
      if (error) throw new Error(error.message);
      detalhados++;

      if (!ourLid && info.ourLid) {
        ourLid = info.ourLid;
        const { error: lidErr } = await db
          .from('cb_channels')
          .update({ own_lid: ourLid })
          .eq('id', args.channelId);
        if (lidErr) {
          console.warn('[cb-groups sync] gravar own_lid falhou (ignorado):', lidErr.message);
        }
      }
    } catch (err) {
      // Um grupo que falha não pode levar os outros 56 junto.
      falhas++;
      console.error(
        `[cb-groups sync] detalhar grupo falhou (${jid}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { detalhados, falhas, ourLid };
}
