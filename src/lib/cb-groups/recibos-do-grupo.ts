// ============================================================
// Recibo de mensagem de GRUPO, por participante (1119).
//
// Na Baileys 7 o recibo de grupo (entrega e leitura) é UM POR PARTICIPANTE,
// num evento à parte (`message-receipt.update`), e a Evolution 2.4 não o
// repassava: nenhuma mensagem de grupo passava de ✓ (medido em 04/11/2026,
// `docs/PLANO-recibos-de-grupo.md`). O 5º patch da imagem
// (`docker/evolution-cb/recibo-de-grupo.patch`) o manda como
// `messages.update` com `reciboDoGrupo` e SEM `status` — o CRM de antes o
// ignora, em vez de pintar ✓✓ no primeiro recibo.
//
// A bolha segue o WhatsApp (decisão do operador, 04/11/2026): ✓✓ quando
// TODOS os participantes de fora (sem os números da conta) receberam, azul
// quando todos leram. O denominador é `cb_groups.participantes_de_fora`, da
// última conferência da lista; nulo = não se sabe, e a bolha fica em ✓.
//
// ⚠️ O recibo de um número DA CONTA (outra conexão no mesmo grupo) não conta:
// ela recebe a mensagem em ~0,4 s e anteciparia o ✓✓ sobre o cliente. Ele é
// achado pelo `own_lid` da conexão ou pelo telefone (`participantAlt`, que o
// patch manda quando a Evolution conhece o par do LID) — o `own_lid` só se
// aprende com mensagem nossa vinda do celular num grupo.
//
// ⚠️ O TELEFONE de quem recebeu nunca é gravado (decisão do operador de
// 29/10/2026: os telefones dos participantes são lidos na hora e nunca
// guardados). Ele vive só aqui, na chegada: descarta o número da conta e acha
// a FICHA do cliente (`fichaDoRecibo`), e só a ficha vai ao banco.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { chaveDePessoa } from '@/lib/contacts/dedupe';
import { fichasPorTelefone } from '@/lib/cb-groups/nomes-dos-participantes';
import { isGroupJid } from '@/lib/whatsapp/transport/evolution-group-inbound';

export interface ReciboDoGrupo {
  /** O id da mensagem no WhatsApp (`messages.message_id`). */
  keyId: string;
  groupJid: string;
  /** O participante como o WhatsApp o chamou (LID ou telefone), sem o aparelho. */
  participante: string;
  /**
   * Só dígitos, com DDI. Nulo = a Evolution não sabe o par do LID. ⚠️ Só para
   * a chegada (número da conta, ficha): NUNCA é gravado.
   */
  telefone: string | null;
  lida: boolean;
  instante: Date;
}

/** `5583…:12@s.whatsapp.net` → `5583…@s.whatsapp.net`. Sem "@" = não é JID. */
function semAparelho(jid: unknown): string | null {
  if (typeof jid !== 'string') return null;
  const arroba = jid.indexOf('@');
  if (arroba <= 0) return null;
  const usuario = jid.slice(0, arroba).split(':')[0];
  return usuario ? `${usuario}${jid.slice(arroba)}` : null;
}

/** Só o JID de TELEFONE dá telefone; o LID jamais vira número. */
export function telefoneDoJid(jid: string | null): string | null {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return null;
  const digitos = jid.slice(0, jid.indexOf('@'));
  return /^\d{8,15}$/.test(digitos) ? digitos : null;
}

/** Instante em segundos, como a Baileys manda; fora da faixa plausível, agora. */
function instanteDoRecibo(valor: unknown, agora: Date): Date {
  if (typeof valor === 'number' && Number.isFinite(valor) && valor >= 1e9 && valor < 1e10) {
    return new Date(valor * 1000);
  }
  return agora;
}

/**
 * O aviso do 5º patch, ou nulo quando o corpo não é um recibo de grupo (o
 * `messages.update` de sempre segue o caminho dele).
 */
export function lerReciboDoGrupo(dados: unknown, agora: Date = new Date()): ReciboDoGrupo | null {
  if (!dados || typeof dados !== 'object') return null;
  const d = dados as Record<string, unknown>;
  const lida = d.reciboDoGrupo === 'READ' ? true : d.reciboDoGrupo === 'DELIVERY_ACK' ? false : null;
  if (lida === null) return null;
  const keyId = typeof d.keyId === 'string' && d.keyId ? d.keyId : null;
  const groupJid = typeof d.remoteJid === 'string' && isGroupJid(d.remoteJid) ? d.remoteJid : null;
  const participante = semAparelho(d.participant);
  if (!keyId || !groupJid || !participante || isGroupJid(participante)) return null;
  return {
    keyId,
    groupJid,
    participante,
    telefone: telefoneDoJid(participante) ?? telefoneDoJid(semAparelho(d.participantAlt)),
    lida,
    instante: instanteDoRecibo(d.instante, agora),
  };
}

export interface NumeroDaConta {
  own_lid: string | null;
  display_phone: string | null;
}

/** O recibo veio de um número de alguma conexão da conta? */
export function ehNumeroDaConta(recibo: ReciboDoGrupo, conexoes: NumeroDaConta[]): boolean {
  const chave = recibo.telefone ? chaveDePessoa(recibo.telefone) : '';
  return conexoes.some(
    (c) =>
      (c.own_lid != null && semAparelho(c.own_lid) === recibo.participante) ||
      (chave !== '' && c.display_phone != null && chaveDePessoa(c.display_phone) === chave),
  );
}

export interface ContagemDoGrupo {
  entregues: number;
  lidas: number;
  /** Nulo = o grupo nunca foi conferido, ou a lista não disse quem é quem. */
  participantesDeFora: number | null;
}

/**
 * O status da bolha: `read` quando todos os de fora leram, `delivered` quando
 * todos receberam; nulo = ainda não (ou não se sabe o denominador).
 */
export function statusDoGrupo(c: ContagemDoGrupo): 'delivered' | 'read' | null {
  if (c.participantesDeFora == null || c.participantesDeFora <= 0) return null;
  if (c.lidas >= c.participantesDeFora) return 'read';
  if (c.entregues >= c.participantesDeFora) return 'delivered';
  return null;
}

/**
 * A ficha do cliente que mandou o recibo, pelo telefone (a chave de pessoa,
 * como no painel de participantes). Nula = sem telefone, sem ficha, ou a
 * leitura falhou: o nome é enfeite e o recibo conta do mesmo jeito.
 */
export async function fichaDoRecibo(
  db: SupabaseClient,
  accountId: string,
  recibo: ReciboDoGrupo,
): Promise<string | null> {
  if (!recibo.telefone) return null;
  const { mapa } = await fichasPorTelefone(db, accountId, [recibo.telefone]);
  return mapa.get(chaveDePessoa(recibo.telefone))?.id ?? null;
}

/**
 * Grava o recibo (só avança) e devolve a contagem da mensagem, numa chamada
 * só e sob trava por mensagem (`cb_registrar_recibo_do_grupo`). Grava a FICHA
 * (`contatoId`), nunca o telefone. Nulo = falhou (o log diz); nunca lança.
 */
export async function gravarReciboDoGrupo(
  db: SupabaseClient,
  accountId: string,
  recibo: ReciboDoGrupo,
  contatoId: string | null,
): Promise<ContagemDoGrupo | null> {
  const { data, error } = await db.rpc('cb_registrar_recibo_do_grupo', {
    p_account_id: accountId,
    p_group_jid: recibo.groupJid,
    p_message_id: recibo.keyId,
    p_participante: recibo.participante,
    p_contact_id: contatoId,
    p_lida: recibo.lida,
    p_instante: recibo.instante.toISOString(),
  });
  if (error) {
    console.error('[cb-groups] gravar o recibo do grupo falhou:', error.message);
    return null;
  }
  const linha = (Array.isArray(data) ? data[0] : data) as
    | { entregues?: unknown; lidas?: unknown; participantes_de_fora?: unknown }
    | null
    | undefined;
  if (!linha || typeof linha.entregues !== 'number' || typeof linha.lidas !== 'number') {
    console.error('[cb-groups] gravar o recibo do grupo: resposta sem a contagem');
    return null;
  }
  return {
    entregues: linha.entregues,
    lidas: linha.lidas,
    participantesDeFora: typeof linha.participantes_de_fora === 'number' ? linha.participantes_de_fora : null,
  };
}
