// ============================================================
// O perfil do cliente do Instagram: nome, @ e foto, lidos pela API com o
// token do canal DEPOIS de a mensagem estar gravada — a falha aqui não
// pode segurar a DM. Só de servidor.
//
// A foto vai pelo mesmo caminho da do WhatsApp (`guardarFoto`, 973): cópia
// nossa em `chat-media`, caminho estável, `avatar_checked_at` carimbado.
// O nome só entra quando a ficha NÃO tem nome — no WhatsApp o pushName
// sobrescreve sempre (é a queixa registrada no CLAUDE.md sobre o Calendly);
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
  temNome: boolean;
  cliente?: ClienteInstagram;
}): Promise<'ok' | 'falhou'> {
  const { db, accountId, contactId, igsid, temNome } = args;
  try {
    const cliente = args.cliente ?? criarClienteInstagram(args.token);
    const perfil = await cliente.perfil(igsid);

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (perfil.username) patch.instagram_username = perfil.username;
    if (!temNome) {
      const nome =
        perfil.nome ?? (perfil.username ? `@${perfil.username}` : null);
      if (nome) patch.name = nome;
    }
    const { error } = await db
      .from('contacts')
      .update(patch)
      .eq('id', contactId)
      .eq('account_id', accountId);
    if (error) {
      console.error(`${TAG} gravar perfil falhou:`, error.message);
      return 'falhou';
    }
    if (perfil.fotoUrl) {
      await guardarFoto({ db, accountId, contactId, url: perfil.fotoUrl });
    }
    return 'ok';
  } catch (err) {
    // A mensagem do erro já vem sem o token (semSegredo).
    console.warn(
      `${TAG} perfil de ${igsid} não lido:`,
      err instanceof Error ? err.message : err
    );
    return 'falhou';
  }
}
