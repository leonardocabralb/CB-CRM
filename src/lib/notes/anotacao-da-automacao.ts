// ============================================================
// "Escrever anotação interna" — o passo de automação (15/10/2026).
//
// Pedido do operador para a automação "Contato do Banco": encaminhar o
// contato e deixar na conversa a instrução para quem vai cuidar, marcando a
// pessoa. A anotação é a MESMA que a equipe escreve (`cb_conversation_notes`)
// e a marcação é a MESMA menção (o aviso `note_mention` no sino, como na rota
// `POST /api/cb/notes`). O que muda:
//
// - não há gente do outro lado: o autor é a automação (`author_user_id`
//   nulo, `autor_nome` = `Automação "<nome>"`, do dicionário, montado pelo
//   motor com `textosDaAnotacaoDaAutomacao` — só admin apaga);
// - quem é marcado vem da CONFIGURAÇÃO (ids de login), não do texto
//   digitado; o `@Nome` entra no começo do texto na hora de gravar, com o
//   nome de AGORA (quem mudou de nome continua marcado);
// - marcado que saiu da conta ou está suspenso (1067) não é marcado nem
//   avisado, e o resultado diz quantos — o motor transforma isso em falha
//   VISÍVEL depois de gravar (ver o `case 'add_note'` de `engine.ts`).
//
// Sem import de servidor: `validate.ts` e `pendencias.ts` (que rodam também
// no construtor) leem os tetos e a forma daqui.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/** Teto do texto gravado (marcações incluídas) — o mesmo da rota de anotações do painel. */
export const MAX_TEXTO_DA_ANOTACAO = 4000

/** Teto de pessoas marcadas — o mesmo da rota de anotações. */
export const MAX_MARCADOS = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A forma que a ativação aceita em `mencionados`: lista de ids, até o teto. */
export function ehListaDeMarcados(valor: unknown): boolean {
  return (
    Array.isArray(valor) &&
    valor.length <= MAX_MARCADOS &&
    valor.every((v) => typeof v === 'string' && UUID.test(v))
  )
}

/** Os ids marcados, sem repetição e na ordem da configuração. */
export function lerMarcados(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  const ids = valor.filter((v): v is string => typeof v === 'string' && UUID.test(v))
  return [...new Set(ids)].slice(0, MAX_MARCADOS)
}

/** O texto gravado: as marcações no começo, como a equipe escreve ("@Ana Dias confere…"). */
export function textoComMarcacoes(texto: string, nomes: readonly string[]): string {
  const marcas = nomes.map((n) => `@${n}`).join(' ')
  return marcas ? `${marcas} ${texto}` : texto
}

export interface ResultadoDaAnotacao {
  notaId: string
  /** Os nomes de quem foi marcado e avisado, na ordem da configuração. */
  avisados: string[]
  /** Marcados que não são mais membros ativos da conta: nem marcados nem avisados. */
  foraDaConta: number
  /** O aviso no sino falhou — a anotação existe. */
  erroDoAviso: string | null
}

/**
 * Grava a anotação e avisa os marcados. Leitura ou gravação da anotação que
 * falha LANÇA (nada foi escrito); o aviso que falha volta em `erroDoAviso`
 * (a anotação já existe, e é ela o ato).
 */
export async function escreverAnotacaoDaAutomacao(
  db: SupabaseClient,
  entrada: {
    accountId: string
    conversationId: string
    /** Quem assina a anotação e o aviso (`Automação "<nome>"`, já no idioma da instalação). */
    autor: string
    /** O rótulo do marcado sem nome ("membro sem nome"), já no idioma da instalação. */
    semNome: string
    /** Já interpolado e aparado; sem as marcações. */
    texto: string
    /** Ids de login, já lidos por `lerMarcados`. */
    marcados: string[]
  },
): Promise<ResultadoDaAnotacao> {
  const { data: conversa, error: erroConversa } = await db
    .from('conversations')
    .select('id, contact_id')
    .eq('id', entrada.conversationId)
    .eq('account_id', entrada.accountId)
    .maybeSingle()
  if (erroConversa) throw new Error(`anotação: leitura da conversa falhou: ${erroConversa.message}`)
  if (!conversa) throw new Error('anotação: conversa não encontrada nesta conta')

  // Os marcados são conferidos contra a CONTA, como na rota: a lista foi
  // escrita quando a regra foi montada, e a equipe muda depois.
  let marcados: { userId: string; nome: string }[] = []
  if (entrada.marcados.length > 0) {
    const { data: perfis, error: erroPerfis } = await db
      .from('profiles')
      .select('user_id, full_name, suspenso_em')
      .eq('account_id', entrada.accountId)
      .in('user_id', entrada.marcados)
    if (erroPerfis) throw new Error(`anotação: leitura de quem marcar falhou: ${erroPerfis.message}`)
    const porId = new Map(
      ((perfis ?? []) as {
        user_id: string
        full_name: string | null
        suspenso_em: string | null
      }[]).map((p) => [p.user_id, p]),
    )
    marcados = entrada.marcados.flatMap((id) => {
      const p = porId.get(id)
      if (!p || p.suspenso_em) return []
      // O nome, aparado (há nome gravado com espaço no fim). ⚠️ Sem nome, o
      // rótulo neutro — NUNCA o e-mail, como faria o `memberLabel`: a lista
      // de membros só mostra e-mail a admin, e a anotação e o aviso são lidos
      // por todos (Codex, #412).
      return [{ userId: id, nome: p.full_name?.trim() || entrada.semNome }]
    })
  }

  const autor = entrada.autor
  const texto = textoComMarcacoes(
    entrada.texto,
    marcados.map((m) => m.nome),
  )
  if (texto.length > MAX_TEXTO_DA_ANOTACAO)
    throw new Error(`anotação: o texto passou de ${MAX_TEXTO_DA_ANOTACAO} caracteres`)

  const { data: nota, error: erroNota } = await db
    .from('cb_conversation_notes')
    .insert({
      account_id: entrada.accountId,
      conversation_id: conversa.id,
      contact_id: conversa.contact_id ?? null,
      author_user_id: null,
      autor_nome: autor,
      texto,
      mencionados: marcados.map((m) => m.userId),
    })
    .select('id')
    .single()
  if (erroNota) throw new Error(`anotação: gravar falhou: ${erroNota.message}`)

  let erroDoAviso: string | null = null
  if (marcados.length > 0) {
    // Texto cru, sem dicionário — como o da rota (e o trigger da 027).
    const { error } = await db.from('notifications').insert(
      marcados.map((m) => ({
        account_id: entrada.accountId,
        user_id: m.userId,
        type: 'note_mention',
        conversation_id: conversa.id,
        contact_id: conversa.contact_id ?? null,
        actor_user_id: null,
        title: `${autor} mencionou você numa anotação`,
        body: texto.slice(0, 280),
      })),
    )
    if (error) erroDoAviso = error.message
  }

  return {
    notaId: (nota as { id: string }).id,
    avisados: marcados.map((m) => m.nome),
    foraDaConta: entrada.marcados.length - marcados.length,
    erroDoAviso,
  }
}
