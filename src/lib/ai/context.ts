import type { SupabaseClient } from '@supabase/supabase-js'
import { removerAssinatura } from '@/lib/assinatura/assinatura'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
}

/**
 * Fetch the last N text messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Non-text messages (media,
 * templates, interactive) are excluded — they carry no text to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text')
    .eq('conversation_id', conversationId)
    .eq('content_type', 'text')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .filter((m) => m.content_text && m.content_text.trim())
    .map((m) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      // ⚠️ A assinatura SAI do historico do modelo (923).
      //
      // O prefixo `*Nome:*` e gravado no `content_text` porque o CRM tem de
      // mostrar o que o cliente recebeu — mas o modelo le este mesmo campo.
      // Vendo `*CB Advogados:*` no comeco de cada resposta anterior, ele
      // aprende que aquilo faz parte da resposta e passa a escreve-lo dentro
      // do texto que gera. Esse texto e entao prefixado DE NOVO no envio, e o
      // cliente recebe a assinatura duas vezes.
      //
      // Tirar aqui tambem deixa o historico mais limpo: o modelo nao precisa
      // gastar atencao com quem assinou o que.
      content: (removerAssinatura(m.content_text) ?? '').trim(),
    }))
}
