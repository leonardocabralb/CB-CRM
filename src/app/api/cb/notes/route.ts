import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { createClient } from '@/lib/supabase/server'
import { canWriteNotes, isAccountRole } from '@/lib/auth/roles'
import { quemAvisarDaResposta, type NotaDaConversa } from '@/lib/notes/resposta'

/**
 * Criação de anotação interna (migration 918).
 *
 * ⚠️ POR QUE UMA ROTA, SE A ANTIGA `contact_notes` ERA INSERT DIRETO DO
 * NAVEGADOR. Três motivos, e o primeiro é impeditivo:
 *
 * 1. A menção precisa gravar em `notifications`, que NÃO tem policy de
 *    INSERT — a 027 diz por escrito que aquelas linhas nascem só do trigger
 *    SECURITY DEFINER. Menção vinda do cliente daria 42501. Nota e
 *    notificação têm de sair do mesmo lugar, e esse lugar é o servidor.
 * 2. `autor_nome` é carimbado no momento da escrita e não pode ser escolhido
 *    por quem chama — é isso que faz a autoria sobreviver à saída do membro.
 * 3. Os mencionados precisam ser validados contra a conta. Sem isso, um
 *    cliente malicioso poria qualquer uuid ali e notificaria estranhos.
 *
 * Por isso `cb_conversation_notes` não tem policy de INSERT e o papel
 * `authenticated` teve o INSERT revogado: não existe caminho de escrita fora
 * daqui. Apagar, sim, continua indo direto do navegador — lá a RLS decide
 * sozinha (autor ou admin) e não há o que validar no meio.
 */
/**
 * Teto do texto da anotação.
 *
 * A coluna é `text` e não tem limite no banco, então sem isto um POST fora da
 * tela grava megabytes numa linha que o fio do chat renderiza inteira. 4000
 * é folgado para o uso real (o campo tem 3 linhas) e ainda cabe confortável
 * numa bolha.
 */
const MAX_TEXTO = 4000

/**
 * Teto de menções por anotação. Uma conta real tem uma dezena de pessoas; o
 * número existe para o array não chegar sem tamanho no `.in(...)`.
 */
const MAX_MENCOES = 50

/** Forma de UUID — o que o Postgres aceita em `uuid`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role, full_name, email')
    .eq('user_id', user.id)
    .maybeSingle()

  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }

  // Anotar é deliberadamente mais permissivo que enviar mensagem: `viewer`
  // pode. Ver `canWriteNotes`.
  const papel = profile?.account_role
  if (!isAccountRole(papel) || !canWriteNotes(papel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { conversation_id, contact_id, texto, mencionados, resposta_de } = (body ??
    {}) as {
    conversation_id?: unknown
    contact_id?: unknown
    texto?: unknown
    mencionados?: unknown
    /** A anotação que esta responde (1075). Ausente = anotação comum. */
    resposta_de?: unknown
  }

  // Aceita os dois caminhos de entrada. O inbox sabe a conversa; a ficha do
  // contato, na tela de Contatos, não tem conversa nenhuma à mão — resolver
  // ali no cliente exigiria uma segunda ida ao banco em toda tela que quiser
  // anotar, e é justamente o tipo de regra que tem de morar num lugar só.
  const porConversa = typeof conversation_id === 'string' && conversation_id
  const porContato = typeof contact_id === 'string' && contact_id
  if (!porConversa && !porContato) {
    return NextResponse.json(
      { error: 'conversation_id or contact_id is required' },
      { status: 400 },
    )
  }
  if (typeof texto !== 'string' || !texto.trim()) {
    return NextResponse.json({ error: 'texto is required' }, { status: 400 })
  }
  if (texto.length > MAX_TEXTO) {
    return NextResponse.json({ error: 'Note is too long' }, { status: 400 })
  }
  const respostaDe =
    resposta_de === undefined || resposta_de === null ? null : resposta_de
  if (respostaDe !== null && (typeof respostaDe !== 'string' || !UUID.test(respostaDe))) {
    return NextResponse.json({ error: 'resposta_de must be a UUID' }, { status: 400 })
  }

  const pedidos = Array.isArray(mencionados)
    ? [...new Set(mencionados.filter((m): m is string => typeof m === 'string'))]
        // ⚠️ Teto e forma. Sem os dois, um POST fora da tela manda um array de
        // tamanho arbitrário direto para o `.in(...)`, e um único valor que
        // não seja UUID faz o PostgREST devolver 22P02 — erro que, engolido,
        // derrubaria TODAS as menções da anotação em silêncio.
        .filter((m) => UUID.test(m))
        .slice(0, MAX_MENCOES)
    : []

  // ⚠️ Lido com o cliente DO USUÁRIO, sob RLS: é o que garante que a conversa
  // é de uma conta que ele enxerga. O insert logo abaixo roda em service-role
  // e ignoraria RLS — sem esta leitura, um `conversation_id` de outra conta
  // passaria pela FK composta (que só confere conversa+conta batendo entre si)
  // e a anotação nasceria no lugar errado. Pelo contato vale o mesmo: o filtro
  // por `account_id` é o que impede anotar contato de outro escritório.
  const busca = supabase
    .from('conversations')
    .select('id, contact_id, account_id')
    .eq('account_id', accountId)
  const { data: conversa } = porConversa
    ? await busca.eq('id', conversation_id).maybeSingle()
    : // `idx_conversations_account_contact` é UNIQUE em (account_id,
      // contact_id) desde a 036, então isto devolve no máximo uma linha.
      await busca.eq('contact_id', contact_id).maybeSingle()

  if (!conversa) {
    return NextResponse.json(
      {
        error: porConversa
          ? 'Conversation not found'
          : // Caso real e não um erro do chamador: contato cadastrado à mão
            // que nunca trocou mensagem não tem conversa, e a anotação é
            // chaveada por conversa. Quem chama traduz este código.
            'CONTACT_WITHOUT_CONVERSATION',
      },
      { status: porConversa ? 404 : 409 },
    )
  }

  // Mesma cascata do `memberLabel` e da 912 — `full_name` é NOT NULL mas o
  // trigger de signup grava `COALESCE(..., '')`, então vazio é possível.
  const autorNome = profile?.full_name?.trim() || profile?.email || null

  // ⚠️ Os mencionados são VALIDADOS contra a conta, e é o motivo número 3 de
  // esta rota existir. Quem chama manda uma lista de uuids; sem conferir,
  // bastaria trocar o corpo do POST para notificar qualquer usuário do
  // sistema — inclusive de outro escritório. A leitura vai pelo cliente do
  // usuário, sob RLS, então nem a existência de gente de outra conta vaza.
  //
  // O próprio autor sai da lista: mencionar a si mesmo é comum ao escrever
  // ("@fulano e eu vimos isso") e ninguém quer sino do que acabou de digitar.
  let validos: string[] = []
  // ⚠️ `mencoesOk` acompanha se a menção realmente chegou ao destino. Sem
  // ele, os dois tropeços possíveis daqui para baixo (a consulta de membros
  // falhar, o insert no sino falhar) somem: a anotação salva, a resposta é
  // 201, e quem escreveu vai embora certo de que o colega foi avisado. Numa
  // anotação de "confere esse prazo comigo", esse silêncio é o pior desfecho.
  let mencoesOk = true
  if (pedidos.length > 0) {
    const { data: membros, error: erroMembros } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .in('user_id', pedidos)
    if (erroMembros) {
      console.error('[POST /api/cb/notes] falha ao validar menções:', erroMembros.message)
      mencoesOk = false
    }
    validos = (membros ?? [])
      .map((m) => m.user_id as string)
      .filter((id) => id !== user.id)
  }

  // 1075: a resposta. A respondida é lida com o cliente DO USUÁRIO (RLS) e
  // tem de ser DESTA conversa — a FK composta recusaria outra, mas aqui a
  // recusa sai com nome. Erro de leitura é 500, nunca "não encontrada".
  let daConversa: NotaDaConversa[] = []
  // Como `mencoesOk`: `false` só quando havia a quem avisar e algo falhou.
  let respostaOk = true
  if (respostaDe) {
    const { data: respondida, error: erroRespondida } = await supabase
      .from('cb_conversation_notes')
      .select('id')
      .eq('id', respostaDe)
      .eq('conversation_id', conversa.id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (erroRespondida) {
      return NextResponse.json({ error: erroRespondida.message }, { status: 500 })
    }
    if (!respondida) {
      // Apagada enquanto a pessoa escrevia. Quem chama traduz o código.
      return NextResponse.json({ error: 'REPLIED_NOTE_NOT_FOUND' }, { status: 409 })
    }
    // Só para saber QUEM avisar: falhar aqui não derruba a resposta, só o
    // aviso (e a tela diz isso). Na ordem em que foram escritas.
    const { data: notasDaConversa, error: erroNotas } = await supabase
      .from('cb_conversation_notes')
      .select('id, resposta_de, author_user_id')
      .eq('conversation_id', conversa.id)
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(1000)
    if (erroNotas) {
      console.error('[POST /api/cb/notes] falha ao ler a conversa da anotação:', erroNotas.message)
      respostaOk = false
    }
    daConversa = (notasDaConversa ?? []) as NotaDaConversa[]
  }

  const admin = supabaseAdmin()
  const { data: nota, error } = await admin
    .from('cb_conversation_notes')
    .insert({
      account_id: accountId,
      // ⚠️ `conversa.id`, NUNCA o `conversation_id` do corpo: quando a ficha
      // do contato chama, o corpo traz `contact_id` e aquele campo vem
      // `undefined`. A coluna é NOT NULL, então isso seria erro na cara — mas
      // o tipo não acusa, porque o campo é opcional no corpo.
      conversation_id: conversa.id,
      // Nulo em conversa de grupo — grupo não tem contato.
      contact_id: conversa.contact_id ?? null,
      author_user_id: user.id,
      autor_nome: autorNome,
      texto: texto.trim(),
      mencionados: validos,
      // Só quando é resposta: anotação comum não depende da coluna da 1075.
      ...(respostaDe ? { resposta_de: respostaDe } : {}),
    })
    .select('*')
    .single()

  if (error) {
    // A respondida sumiu entre a conferência e o insert: a FK da 1075 recusa.
    if (respostaDe && error.code === '23503') {
      return NextResponse.json({ error: 'REPLIED_NOTE_NOT_FOUND' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ⚠️ Depois da anotação, e sem derrubá-la se falhar. A anotação é o ato; o
  // sino é aviso sobre ele. Perder o aviso é chato, perder a anotação que a
  // pessoa acabou de escrever é inaceitável — e o `type` novo depende da 919
  // ter sido aplicada, que é justamente o tipo de coisa que pode faltar num
  // ambiente e não em outro.
  if (validos.length > 0) {
    const { error: erroSino } = await admin.from('notifications').insert(
      validos.map((destinatario) => ({
        account_id: accountId,
        user_id: destinatario,
        type: 'note_mention',
        // `conversa.id`, pelo mesmo motivo do insert acima: chamada pela
        // ficha do contato, o corpo não traz `conversation_id`. Aqui a coluna
        // é ANULÁVEL, então não estouraria — o aviso é que ficaria sem
        // destino, e clicar nele no sino não abriria conversa nenhuma.
        conversation_id: conversa.id,
        contact_id: conversa.contact_id ?? null,
        actor_user_id: user.id,
        // ⚠️ Texto CRU, sem passar pelo dicionário: `notifications.title` e
        // `body` são colunas TEXT, gravadas no idioma de quem escreveu. É o
        // mesmo que o trigger da 027 faz (em inglês). Unificar os dois
        // idiomas do sino é assunto de outra passada.
        title: `${autorNome ?? 'Alguém da equipe'} mencionou você numa anotação`,
        body: texto.trim().slice(0, 280),
      })),
    )
    if (erroSino) {
      console.error('[POST /api/cb/notes] falha ao notificar menção:', erroSino.message)
      mencoesOk = false
    }
  }

  // 1075: o aviso da RESPOSTA — ao autor da respondida e a quem já escreveu
  // na conversa dela (decisão do operador). Quem foi mencionado nesta mesma
  // resposta já recebeu o `note_mention` acima e não ganha um segundo.
  if (respostaDe && respostaOk) {
    const candidatos = quemAvisarDaResposta(daConversa, respostaDe, user.id, validos)
    if (candidatos.length > 0) {
      // ⚠️ Conferido contra a conta, como a menção: o autor de uma anotação
      // antiga pode ter saído do escritório (o profile vai para outra conta),
      // e o aviso levaria a ele o texto de um caso que ele não vê mais.
      const { data: daConta, error: erroConta } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .in('user_id', candidatos)
      if (erroConta) {
        console.error('[POST /api/cb/notes] falha ao validar quem avisar da resposta:', erroConta.message)
        respostaOk = false
      }
      const membros = new Set((daConta ?? []).map((m) => m.user_id as string))
      const autorDaRespondida =
        daConversa.find((n) => n.id === respostaDe)?.author_user_id ?? null
      const destinatarios = candidatos.filter((id) => membros.has(id))
      if (destinatarios.length > 0) {
        const { error: erroSino } = await admin.from('notifications').insert(
          destinatarios.map((destinatario) => ({
            account_id: accountId,
            user_id: destinatario,
            type: 'note_reply',
            conversation_id: conversa.id,
            contact_id: conversa.contact_id ?? null,
            actor_user_id: user.id,
            // Texto cru, como o da menção (ver a nota lá em cima).
            title:
              destinatario === autorDaRespondida
                ? `${autorNome ?? 'Alguém da equipe'} respondeu à sua anotação`
                : `${autorNome ?? 'Alguém da equipe'} respondeu numa anotação em que você escreveu`,
            body: texto.trim().slice(0, 280),
          })),
        )
        if (erroSino) {
          console.error('[POST /api/cb/notes] falha ao notificar a resposta:', erroSino.message)
          respostaOk = false
        }
      }
    }
  }

  // 201 mesmo quando o aviso falhou — a anotação existe, e é ela que importa.
  // Mas `mencoesNotificadas` vai junto para a tela poder dizer "salvei, só não
  // consegui avisar", em vez de deixar quem escreveu supondo que o colega foi
  // chamado. Só é `false` quando havia menção para entregar e algo falhou.
  // `respostaNotificada` é o mesmo sinal para o aviso da resposta (1075).
  return NextResponse.json(
    { note: nota, mencoesNotificadas: mencoesOk, respostaNotificada: respostaOk },
    { status: 201 },
  )
}
