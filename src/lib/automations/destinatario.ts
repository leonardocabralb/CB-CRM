import type { SupabaseClient } from '@supabase/supabase-js'

import { fichaQueVenceu, findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'

/**
 * Ficha + conversa de um NÚMERO, quando o CRM precisa falar com ele e ainda
 * não há contato. TRÊS chamadores, e a diferença entre eles importa:
 *
 *   - `send_to_number` (977): o número da EQUIPE que a automação avisa.
 *   - o agendamento do Calendly (08/09/2026): o CLIENTE que marcou horário e
 *     nunca escreveu para o escritório. Decisão do operador, revendo a D2 do
 *     plano — até aqui a ficha dele nascia por acaso, quando o outro CRM
 *     mandava a primeira mensagem pelo celular pareado, e o Calendly ficava
 *     dependendo de um sistema que vai ser desligado.
 *   - o webhook de entrada (982): o lead de formulário (o Typebot). É o ÚNICO
 *     que pede a conversa nova ENCERRADA (`conversaNovaEncerrada`) — nos
 *     outros dois ela nasceria escondida em "Encerradas", e envio de robô
 *     não reabre conversa (`reopen.ts`).
 *
 * É o mesmo find-or-create da API pública (`resolveConversationByPhone`), com
 * duas diferenças de propósito:
 *   - NÃO renomeia contato que já existe: `contact_name` serve só para a
 *     ficha nascer com nome. O passo roda a cada agendamento, e reescrever o
 *     nome do advogado a cada aviso seria uma edição que ninguém fez.
 *   - Fica FORA de `resolve-conversation.ts`, porque aquele módulo importa
 *     `api/v1/contacts.ts` → `tag-events.ts` → este motor. Importá-lo daqui
 *     fecharia um ciclo de módulos.
 *
 * ⚠️ `user_id` das linhas criadas é o DONO DA CONTA (`accounts.owner_user_id`),
 * nunca o autor da automação: `contacts.user_id` e `conversations.user_id`
 * cascateiam de `auth.users`, e o dono é o único login que a conta impede
 * de apagar (971). Há varredura estrutural cobrando isto
 * (`src/lib/contacts/dono-duravel.test.ts`).
 */

export interface Destinatario {
  contactId: string
  conversationId: string
  criouContato: boolean
}

export async function resolverDestinatario(
  db: SupabaseClient,
  accountId: string,
  digitos: string,
  nome?: string | null,
  opcoes?: {
    /**
     * A conversa que NASCER aqui nasce ENCERRADA. Conversa que já existia não
     * é tocada — nem aberta, nem fechada. Só o webhook de entrada pede isto:
     * o lead de formulário ainda não escreveu, e uma conversa vazia em
     * "Abertas" é ruído na caixa da equipe. Não é o passo "Encerrar
     * conversa" da automação porque ele fecha TODAS as conversas do contato —
     * inclusive a que o SDR está atendendo agora.
     */
    conversaNovaEncerrada?: boolean
  },
): Promise<Destinatario> {
  const busca = await findExistingContact(db, accountId, digitos)
  // ⚠️ Erro de banco NÃO é "não encontrado": seguir criando duplicaria a
  // ficha (a variante de tronco passa pelo índice único).
  if (busca.falhou) throw new Error('destinatário: busca do contato falhou')

  let contactId: string | null = busca.contato?.id ?? null
  let criouContato = false
  let donoResolvido: string | null = null

  if (!contactId) {
    const dono = await donoDaConta(db, accountId)
    donoResolvido = dono
    const { data: criado, error } = await db
      .from('contacts')
      .insert({ account_id: accountId, user_id: dono, phone: digitos, name: nome?.trim() || digitos })
      .select('id')
      .single()
    if (error || !criado) {
      // Corrida com uma entrada do mesmo número (ou da irmã do nono dígito): o
      // índice único recusou — o exato da 022 ou o canônico da 1024.
      const de_novo = isUniqueViolation(error) ? (await fichaQueVenceu(db, accountId, digitos)).contato : null
      if (!de_novo) throw new Error(`destinatário: não foi possível criar o contato (${error?.message ?? '?'})`)
      contactId = de_novo.id
    } else {
      contactId = criado.id as string
      criouContato = true
    }
  }
  const contatoId: string = contactId
  const conversationId = await conversaDoContato(db, accountId, contatoId, {
    conversaNovaEncerrada: opcoes?.conversaNovaEncerrada,
    dono: donoResolvido,
  })
  return { contactId: contatoId, conversationId, criouContato }
}

/**
 * A conversa de um contato que JÁ EXISTE: a que ele tem (uma por conta e
 * contato, 036 — a mais antiga, como o webhook faz) ou uma nova, com o dono da
 * conta. Nunca toca na que já existia.
 *
 * Além de `resolverDestinatario`, o agendamento do Calendly chama direto para
 * a ficha que já existia SEM conversa. Desde 24/09/2026 a integração do
 * formulário cria a ficha pela API minutos antes de o lead agendar, e ficha
 * criada pela API não tem conversa: sem esta chamada o `{{conversation.link}}`
 * do aviso ao advogado saía vazio, e os lembretes e o No-show, que falam com o
 * cliente, falhariam por falta de conversa.
 *
 * `dono` evita reler `accounts` quando quem chama acabou de resolvê-lo.
 */
export async function conversaDoContato(
  db: SupabaseClient,
  accountId: string,
  contatoId: string,
  opcoes?: { conversaNovaEncerrada?: boolean; dono?: string | null },
): Promise<string> {
  const { data: existente, error: erroBusca } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contatoId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (erroBusca) throw new Error(`destinatário: busca da conversa falhou (${erroBusca.message})`)
  if (existente && existente.length > 0) return existente[0].id as string

  const dono = opcoes?.dono ?? (await donoDaConta(db, accountId))
  const { data: nova, error: erroNova } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: dono,
      contact_id: contatoId,
      ...(opcoes?.conversaNovaEncerrada ? { status: 'closed' } : {}),
    })
    .select('id')
    .single()
  if (erroNova || !nova) {
    if (isUniqueViolation(erroNova)) {
      const { data: raced } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contatoId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) return raced[0].id as string
    }
    throw new Error(`destinatário: não foi possível criar a conversa (${erroNova?.message ?? '?'})`)
  }
  return nova.id as string
}

async function donoDaConta(db: SupabaseClient, accountId: string): Promise<string> {
  const { data, error } = await db.from('accounts').select('owner_user_id').eq('id', accountId).maybeSingle()
  const dono = typeof data?.owner_user_id === 'string' ? data.owner_user_id : null
  if (error || !dono) throw new Error('destinatário: dono da conta não resolvido')
  return dono
}
