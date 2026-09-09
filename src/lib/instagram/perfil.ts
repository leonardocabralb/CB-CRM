// ============================================================
// O perfil do cliente do Instagram: nome, @ e foto, lidos pela API com o
// token do canal DEPOIS de a mensagem estar gravada — a falha aqui não
// pode segurar a DM. Só de servidor.
//
// A foto vai pelo mesmo caminho da do WhatsApp (`guardarFoto`, 973): cópia
// nossa em `chat-media`, caminho estável, `avatar_checked_at` carimbado.
// ⚠️ O carimbo é gravado MESMO quando o perfil vem sem foto ou sem @: é
// ele que impede a leitura a cada mensagem para uma conta que
// permanentemente não tem foto — a mesma lição da Evolution (973), onde
// `null` também significa "não tem". Falha da API (rede, token) NÃO
// carimba: a próxima mensagem tenta de novo (Codex, PR #173).
//
// O nome só entra quando a ficha NÃO tem nome — no WhatsApp o pushName
// sobrescreve sempre (a queixa registrada no CLAUDE.md sobre o Calendly);
// aqui o operador que corrigiu o nome à mão não é sobrescrito de novo.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { guardarFoto } from '@/lib/whatsapp/foto-do-contato';

import { criarClienteInstagram, type ClienteInstagram } from './graph';

const TAG = '[instagram/perfil]';

export async function completarPerfilDoContato(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  igsid: string;
  /** Token DECIFRADO do canal. */
  token: string;
  nomeAtual: string | null;
  cliente?: ClienteInstagram;
  agoraMs?: number;
}): Promise<{ name: string | null } | null> {
  const { db, accountId, contactId, igsid, nomeAtual } = args;
  const agora = args.agoraMs ?? Date.now();
  try {
    const cliente = args.cliente ?? criarClienteInstagram(args.token);
    const perfil = await cliente.perfil(igsid);

    const nomeNovo = nomeAtual
      ? null
      : (perfil.nome ?? (perfil.username ? `@${perfil.username}` : null));
    const patch: Record<string, unknown> = {
      updated_at: new Date(agora).toISOString(),
      // Perfil lido: a próxima leitura só em 30 dias, com ou sem foto.
      avatar_checked_at: new Date(agora).toISOString(),
    };
    if (perfil.username) patch.instagram_username = perfil.username;
    if (nomeNovo) patch.name = nomeNovo;

    const { error } = await db
      .from('contacts')
      .update(patch)
      .eq('id', contactId)
      .eq('account_id', accountId);
    if (error) {
      console.error(`${TAG} gravar perfil falhou:`, error.message);
      return null;
    }
    if (perfil.fotoUrl) {
      await guardarFoto({
        db,
        accountId,
        contactId,
        url: perfil.fotoUrl,
        agoraMs: agora,
      });
    }
    return { name: nomeAtual ?? nomeNovo };
  } catch (err) {
    // A mensagem do erro já vem sem o token (semSegredo).
    console.warn(
      `${TAG} perfil de ${igsid} não lido:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
