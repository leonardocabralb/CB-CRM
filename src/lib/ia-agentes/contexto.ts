// ============================================================
// A conversa que o agente lê (docs/PLANO-agentes-de-ia.md, 5.5, D4, E9).
//
// ⚠️ SÓ a conexão do turno (D4): uma conversa por contato corre por várias
// conexões, e o agente lê só a dele. Mensagem sem carimbo de conexão
// (histórico anterior ao multi-canal) NÃO entra — atribuí-la a uma conexão
// seria inventar. Sem as apagadas. Áudio pela TRANSCRIÇÃO; imagem, documento
// e vídeo como descrição, com a legenda.
//
// `montarConversa` é PURA (testada); `lerConversaDaConexao` é o I/O.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { removerAssinatura } from '@/lib/assinatura/assinatura'
import { aiContextMessageLimit } from '@/lib/ai/defaults'
import type { ChatMessage } from '@/lib/ai/types'

export interface MensagemDoContexto {
  sender_type: 'customer' | 'agent' | 'bot' | string
  content_type: string
  content_text: string | null
  media_filename?: string | null
  transcricao?: string | null
  transcricao_status?: string | null
}

function descrever(m: MensagemDoContexto): string {
  const texto = (removerAssinatura(m.content_text) ?? '').trim()
  switch (m.content_type) {
    case 'text':
      return texto
    case 'audio': {
      const ouvida = m.transcricao_status === 'pronta' ? (m.transcricao ?? '').trim() : ''
      return ouvida ? `[audio message, transcribed] ${ouvida}` : '[audio message, not transcribed]'
    }
    case 'image':
      return texto ? `[image] ${texto}` : '[image]'
    case 'video':
      return texto ? `[video] ${texto}` : '[video]'
    case 'document': {
      const nome = (m.media_filename ?? '').trim()
      const rotulo = nome ? `[document: ${nome}]` : '[document]'
      // Nas linhas antigas da Meta o nome está DENTRO do texto: não repetir.
      return texto && texto !== nome ? `${rotulo} ${texto}` : rotulo
    }
    case 'sticker':
      return '[sticker]'
    case 'location':
      return '[location]'
    default:
      return texto
  }
}

/** As linhas (mais antigas primeiro) → o formato neutro dos provedores. */
export function montarConversa(linhas: MensagemDoContexto[]): ChatMessage[] {
  return linhas
    .map((m) => ({
      role: (m.sender_type === 'customer' ? 'user' : 'assistant') as ChatMessage['role'],
      content: descrever(m),
    }))
    .filter((m) => m.content.length > 0)
}

/**
 * As últimas N mensagens DESTA conexão, sem as apagadas, na ordem em que
 * aconteceram. Lança em erro de leitura (o turno registra `falhou`).
 */
export async function lerConversaDaConexao(
  db: SupabaseClient,
  args: { conversationId: string; canalId: string; limite?: number },
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_type, content_text, media_filename, transcricao, transcricao_status')
    .eq('conversation_id', args.conversationId)
    .eq('channel_id', args.canalId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(args.limite ?? aiContextMessageLimit())
  if (error) throw new Error(`[ia-agentes] leitura da conversa falhou: ${error.message}`)
  return montarConversa(((data ?? []) as MensagemDoContexto[]).reverse())
}
