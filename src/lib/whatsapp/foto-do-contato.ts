// ============================================================
// Foto de perfil do contato — busca na Evolution, cópia para o Storage e
// gravação em `contacts` (pedido do operador, 2026-09-03). As regras puras
// (revalidação, caminho, casamento por telefone) moram em
// `lib/contacts/foto-de-perfil`; aqui é só I/O, server-side (service-role).
//
// Dois caminhos, o mesmo destino:
//  - UNITÁRIO (`atualizarFotoDoContato`): chamado pela ingestão quando o
//    contato nunca foi conferido ou passou de 30 dias. Uma chamada por
//    contato, em segundo plano, depois de a mensagem já estar gravada.
//  - EM LOTE (`conferirFotosDaConexao`): o botão "Buscar fotos" da conexão.
//    `chat/findChats` devolve a foto de TODOS os chats numa chamada só — é o
//    que cobre os ~200 contatos que já existem.
//
// ⚠️ Foto ausente NÃO apaga a que já temos: `null` da Evolution é tanto "não
// tem" quanto "esconde de quem não é contato", e apagar por isso tiraria a
// foto de quem só mexeu na privacidade. Só o carimbo avança.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  FOTO_MAX_BYTES,
  caminhoDaFoto,
  casarContatosComFotos,
  comCarimboDeVersao,
  fotosDosChats,
  urlDaFotoNaResposta,
} from '@/lib/contacts/foto-de-perfil';
import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';
import type { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';

export type ResultadoDaFoto = 'atualizada' | 'sem_foto' | 'falhou';

/**
 * Baixa a imagem da URL assinada e grava no bucket, sobrescrevendo a versão
 * anterior (caminho estável). Nunca lança: falha vira `'falhou'` e um log.
 */
export async function guardarFoto(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  url: string;
  agoraMs?: number;
}): Promise<ResultadoDaFoto> {
  const agora = args.agoraMs ?? Date.now();
  try {
    const r = await fetch(args.url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) {
      console.warn(`[foto-do-contato] download ${r.status} para ${args.contactId}`);
      return 'falhou';
    }
    const tipo = r.headers.get('content-type')?.split(';')[0].trim() || 'image/jpeg';
    if (!tipo.startsWith('image/')) return 'falhou';
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > FOTO_MAX_BYTES) return 'falhou';

    const path = caminhoDaFoto(args.accountId, args.contactId);
    const { error: erroUpload } = await args.db.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(path, bytes, { contentType: tipo, upsert: true, cacheControl: '3600' });
    if (erroUpload) {
      console.error('[foto-do-contato] upload falhou:', erroUpload.message);
      return 'falhou';
    }
    const {
      data: { publicUrl },
    } = args.db.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);

    const { error } = await args.db
      .from('contacts')
      .update({
        avatar_url: comCarimboDeVersao(publicUrl, agora),
        avatar_checked_at: new Date(agora).toISOString(),
      })
      .eq('id', args.contactId)
      .eq('account_id', args.accountId);
    if (error) {
      console.error('[foto-do-contato] update falhou:', error.message);
      return 'falhou';
    }
    return 'atualizada';
  } catch (err) {
    console.error('[foto-do-contato] guardar falhou:', err instanceof Error ? err.message : err);
    return 'falhou';
  }
}

/** Caminho unitário: pergunta à Evolution pelo número e guarda o que vier. */
export async function atualizarFotoDoContato(args: {
  db: SupabaseClient;
  client: EvolutionClient;
  accountId: string;
  contactId: string;
  phone: string;
  agoraMs?: number;
}): Promise<ResultadoDaFoto> {
  const agora = args.agoraMs ?? Date.now();
  let url: string | null;
  try {
    url = urlDaFotoNaResposta(await args.client.fetchProfilePictureUrl(args.phone));
  } catch (err) {
    console.warn('[foto-do-contato] Evolution não respondeu:', err instanceof Error ? err.message : err);
    return 'falhou';
  }
  if (!url) {
    // Só o carimbo: sem ele, o contato sem foto seria consultado a cada
    // mensagem, para sempre.
    const { error } = await args.db
      .from('contacts')
      .update({ avatar_checked_at: new Date(agora).toISOString() })
      .eq('id', args.contactId)
      .eq('account_id', args.accountId);
    if (error) console.error('[foto-do-contato] carimbo falhou:', error.message);
    return 'sem_foto';
  }
  return guardarFoto({ ...args, url, agoraMs: agora });
}

export interface ResumoDoLote {
  chatsComFoto: number;
  candidatos: number;
  atualizadas: number;
  falhas: number;
}

/**
 * Caminho em lote, por conexão. Sequencial de propósito: são downloads de
 * ~50 KB contra o CDN do WhatsApp, e paralelizar 200 deles derrubaria o
 * limite de conexões do processo por nada — dois minutos é aceitável para
 * um botão que se aperta uma vez.
 */
export async function conferirFotosDaConexao(args: {
  db: SupabaseClient;
  client: EvolutionClient;
  accountId: string;
  forcar?: boolean;
  agoraMs?: number;
}): Promise<ResumoDoLote> {
  const agora = args.agoraMs ?? Date.now();
  const fotos = fotosDosChats(await args.client.findChats());

  // ⚠️ PAGINADO, com ordem estável: o PostgREST devolve no máximo ~1000
  // linhas por consulta e NÃO avisa — uma conta com mais contatos que isso
  // teria o lote "concluído" com metade dos contatos sem foto (achado do
  // Codex no PR #110). A mesma armadilha da busca por texto (929).
  const contatos: { id: string; phone: string; avatar_checked_at: string | null }[] = [];
  const PAGINA = 500;
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await args.db
      .from('contacts')
      .select('id, phone, avatar_checked_at')
      .eq('account_id', args.accountId)
      .order('id', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`contatos: ${error.message}`);
    const lote = (data ?? []) as typeof contatos;
    contatos.push(...lote);
    if (lote.length < PAGINA) break;
  }

  const pares = casarContatosComFotos(contatos, fotos, agora, args.forcar ?? false);
  const resumo: ResumoDoLote = {
    chatsComFoto: fotos.length,
    candidatos: pares.length,
    atualizadas: 0,
    falhas: 0,
  };
  for (const par of pares) {
    const r = await guardarFoto({
      db: args.db,
      accountId: args.accountId,
      contactId: par.contactId,
      url: par.url,
      agoraMs: agora,
    });
    if (r === 'atualizada') resumo.atualizadas++;
    else resumo.falhas++;
  }
  return resumo;
}
