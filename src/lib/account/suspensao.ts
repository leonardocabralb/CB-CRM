// ============================================================
// Membro SUSPENSO (1067) — as duas regras que o navegador precisa.
//
// O corte de verdade mora no banco (a própria linha fica invisível e as
// funções de acesso respondem "não é membro"). Aqui só há o que a TELA faz
// com isso: reconhecer a recusa e tirar o suspenso das escolhas de trabalho.
// ============================================================

/**
 * A mensagem com que o banco recusa quem está suspenso (`touch_presence`,
 * `cb_marcar_conversa_aberta`, `set_member_role`, `remove_account_member`,
 * `cb_definir_suspensao`). É CONTRATO com a migration 1067 — há teste lendo
 * o SQL: o batimento de presença a reconhece para trocar a tela aberta de
 * quem acabou de ser suspenso pela tela de acesso suspenso.
 */
export const RECUSA_DE_SUSPENSO = 'membro_suspenso';

export function ehRecusaDeSuspenso(
  erro: { message?: string } | null | undefined,
): boolean {
  return erro?.message === RECUSA_DE_SUSPENSO;
}

/**
 * Quem pode receber trabalho NOVO (responsável, menção, dono de reunião):
 * todo mundo menos os suspensos. Só para as OPÇÕES de um seletor — para dar
 * nome a quem já é responsável, use a lista inteira, senão a conversa de um
 * suspenso aparece "sem nome".
 *
 * `suspenso_em` AUSENTE conta como ativo: é o dado de antes da 1067, e
 * esconder por ignorância sumiria com gente que pode trabalhar.
 */
export function membrosAtivos<T extends { suspenso_em?: string | null }>(
  lista: T[],
): T[] {
  return lista.filter((m) => !m.suspenso_em);
}

/**
 * As opções de um seletor de responsável: os ativos, MAIS o valor atual
 * mesmo que ele esteja suspenso. Sem o atual, o seletor mostra vazio (ou o id
 * cru) sobre uma atribuição que existe — e salvar o formulário a apagaria em
 * silêncio.
 */
export function opcoesDeResponsavel<T extends { suspenso_em?: string | null }>(
  lista: T[],
  ehAtual: (m: T) => boolean,
): T[] {
  return lista.filter((m) => !m.suspenso_em || ehAtual(m));
}
