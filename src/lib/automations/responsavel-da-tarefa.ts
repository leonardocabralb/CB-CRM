// ============================================================
// Para QUEM o passo "Criar tarefa" abre a tarefa (Fase 2.4 do
// `docs/PLANO-previdenciario.md`).
//
// Até aqui só havia o responsável FIXO, escolhido na montagem da regra. O
// setor previdenciário precisa de "quem está com este cliente": a tarefa
// "conferir os documentos" vai para o closer que atende a conversa, não para
// um nome gravado meses antes.
//
// Três modos (`responsavel_modo`):
//   - `fixo` (ausente = fixo, que é toda automação gravada antes disto):
//     `responsavel_user_id`, como sempre.
//   - `conversa`: o responsável pela CONVERSA do contato
//     (`conversations.assigned_agent_id`).
//   - `card`: o responsável pelo NEGÓCIO (`deals.assigned_to`).
//
// ⚠️⚠️ As duas colunas guardam ids DIFERENTES, e trocá-las dá "ninguém" sem
// erro nenhum: `assigned_agent_id` é o id de LOGIN (`auth.users.id` =
// `profiles.user_id`); `assigned_to` é `profiles.id`. A tarefa guarda o id de
// LOGIN (`cb_tasks.responsavel_user_id`). Quem traduz é o motor, pela lista
// de membros da conta; aqui chegam os dois já como id de LOGIN.
//
// ⚠️ SEM responsável (ninguém atribuído, quem estava saiu da conta, ou o
// contato nem tem conversa/card): cai no `responsavel_user_id` do passo, que
// nesses modos vira a RESERVA — OBRIGATÓRIA na ativação (`validate.ts`). Ela
// é obrigatória porque o caso SEM ninguém é o comum: medido em 26/09/2026,
// nenhum negócio da conta tem `assigned_to` (só o formulário do negócio o
// grava) e 8 conversas têm responsável. Opcional, a tarefa no meio de uma
// sequência falhava de madrugada e o `break` do motor parava as mensagens
// seguintes ao cliente. O motor ainda FALHA com o motivo quando não há
// reserva que sirva (config gravada antes, ou a reserva saiu da conta) —
// abrir a tarefa para o autor da regra, ou para ninguém, esconderia que ela
// não chegou a quem devia.
// ============================================================

export const MODOS_DO_RESPONSAVEL = ['fixo', 'conversa', 'card'] as const
export type ModoDoResponsavel = (typeof MODOS_DO_RESPONSAVEL)[number]

/** O modo gravado, ou `null` quando o valor é lixo. Ausente = `fixo`. */
export function lerModoDoResponsavel(valor: unknown): ModoDoResponsavel | null {
  if (valor === undefined || valor === null || valor === '') return 'fixo'
  return (MODOS_DO_RESPONSAVEL as readonly unknown[]).includes(valor)
    ? (valor as ModoDoResponsavel)
    : null
}

/**
 * Por que a tarefa NÃO foi para quem está atribuído (modos `conversa`/`card`):
 * `sem_alvo` = o contato não tem conversa (ou card); `ninguem` = tem, sem
 * ninguém atribuído; `saiu` = quem estava atribuído não é mais membro;
 * `suspenso` = continua membro, mas com o acesso suspenso (1062) — a tarefa
 * iria para quem não consegue abri-la.
 */
export type PorqueDaReserva = 'sem_alvo' | 'ninguem' | 'saiu' | 'suspenso'

export type EscolhaDoResponsavel =
  | { ok: true; userId: string; porReserva: false }
  | { ok: true; userId: string; porReserva: true; porque: PorqueDaReserva }
  | {
      ok: false
      /**
       * `sem_responsavel`: ninguém atribuído e sem reserva (ou, no modo
       *   `fixo`, o passo sem pessoa);
       * `responsavel_saiu`: havia alguém atribuído, que não é mais membro, e
       *   nenhuma reserva;
       * `fixo_fora_da_conta`: o responsável fixo (ou a reserva) não é membro;
       * `fixo_suspenso`: é membro, mas está com o acesso suspenso (1062).
       */
      motivo: 'sem_responsavel' | 'responsavel_saiu' | 'fixo_fora_da_conta' | 'fixo_suspenso'
      /** Nos modos `conversa`/`card`: por que o atribuído não serviu. */
      porque?: PorqueDaReserva
    }

/**
 * @param dinamico o id de LOGIN de quem está atribuído (conversa ou card);
 *   `null` = ninguém. Ignorado no modo `fixo`.
 * @param alvoExiste o contato TEM a conversa (ou o card)? Ausente = sim. Só
 *   muda a frase do registro ("não tem conversa" × "ninguém atribuído").
 * @param fixo `responsavel_user_id` do passo: o responsável no modo `fixo`, a
 *   reserva nos outros dois.
 * @param ehMembro a pessoa pode RECEBER tarefa nesta conta hoje? (membro e,
 *   desde a 1062, não suspensa)
 * @param ehSuspenso a pessoa é membro com o acesso suspenso? Só muda a frase
 *   do registro ("está suspensa" × "saiu da conta"). Ausente = ninguém está.
 */
export function escolherResponsavel(e: {
  modo: ModoDoResponsavel
  dinamico: string | null
  alvoExiste?: boolean
  fixo: string | null
  ehMembro: (userId: string) => boolean
  ehSuspenso?: (userId: string) => boolean
}): EscolhaDoResponsavel {
  const fixo = e.fixo?.trim() || null
  const suspenso = (id: string) => e.ehSuspenso?.(id) ?? false
  const foraDaConta = (id: string): 'fixo_suspenso' | 'fixo_fora_da_conta' =>
    suspenso(id) ? 'fixo_suspenso' : 'fixo_fora_da_conta'
  if (e.modo === 'fixo') {
    if (!fixo) return { ok: false, motivo: 'sem_responsavel' }
    if (!e.ehMembro(fixo)) return { ok: false, motivo: foraDaConta(fixo) }
    return { ok: true, userId: fixo, porReserva: false }
  }
  if (e.dinamico && e.ehMembro(e.dinamico)) {
    return { ok: true, userId: e.dinamico, porReserva: false }
  }
  const porque: PorqueDaReserva =
    e.alvoExiste === false
      ? 'sem_alvo'
      : e.dinamico
        ? suspenso(e.dinamico)
          ? 'suspenso'
          : 'saiu'
        : 'ninguem'
  if (fixo && e.ehMembro(fixo)) return { ok: true, userId: fixo, porReserva: true, porque }
  if (fixo) return { ok: false, motivo: foraDaConta(fixo), porque }
  return { ok: false, motivo: e.dinamico ? 'responsavel_saiu' : 'sem_responsavel', porque }
}

const FRASE_DO_PORQUE: Record<'conversa' | 'card', Record<PorqueDaReserva, string>> = {
  conversa: {
    sem_alvo: 'o contato não tem conversa',
    ninguem: 'ninguém está atribuído à conversa',
    saiu: 'quem estava atribuído à conversa não é mais membro desta conta',
    suspenso: 'quem está atribuído à conversa está com o acesso suspenso',
  },
  card: {
    sem_alvo: 'o contato não tem card',
    ninguem: 'ninguém está atribuído ao card',
    saiu: 'quem estava atribuído ao card não é mais membro desta conta',
    suspenso: 'quem está atribuído ao card está com o acesso suspenso',
  },
}

/**
 * A frase do REGISTRO da automação para a escolha — o que o operador lê no
 * histórico. `null` quando a tarefa foi para quem o passo pedia (nada a
 * explicar). Sufixo do sucesso pela reserva, ou a falha inteira.
 */
export function fraseDaEscolha(
  modo: ModoDoResponsavel,
  escolha: EscolhaDoResponsavel
): string | null {
  if (escolha.ok) {
    if (!escolha.porReserva || modo === 'fixo') return null
    return `para o responsável reserva (${FRASE_DO_PORQUE[modo][escolha.porque]})`
  }
  if (modo === 'fixo') {
    if (escolha.motivo === 'fixo_suspenso') return 'responsável está com o acesso suspenso'
    return escolha.motivo === 'fixo_fora_da_conta'
      ? 'responsável não é membro desta conta'
      : 'o passo não tem responsável'
  }
  const porque =
    escolha.porque ?? (escolha.motivo === 'responsavel_saiu' ? 'saiu' : 'ninguem')
  const motivo = FRASE_DO_PORQUE[modo][porque]
  if (escolha.motivo === 'fixo_suspenso')
    return `${motivo}, e o responsável reserva está com o acesso suspenso`
  return escolha.motivo === 'fixo_fora_da_conta'
    ? `${motivo}, e o responsável reserva não é membro desta conta`
    : `${motivo}, e o passo não tem responsável reserva`
}
