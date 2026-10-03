// ============================================================
// Modo anônimo — a regra pura (decisão do operador, 01/10/2026).
//
// O administrador abre conversas SEM deixar rastro para a equipe: as não
// lidas não zeram e ele não aparece na presença da conversa ("Fulano está
// com a conversa aberta"). RESPONDER zera, como sempre. Liga e desliga no
// menu do nome, no cabeçalho, e dura até ele desligar — neste navegador.
//
// Quem consome: `useModoAnonimo` (o estado), o cabeçalho (o interruptor e a
// pastilha), a página do inbox (presença e os espelhos da lista) e o fio
// (zerar ao ver e ao responder). Pino: `modo-anonimo.chamadores.test.ts`.
// ============================================================

import { canManageMembers, type AccountRole } from "@/lib/auth/roles";

/**
 * A chave no `localStorage`. O VALOR é o `user.id` de quem ligou: outra
 * pessoa que entre neste navegador não herda o modo, e por isso ele não é
 * apagado ao sair (o operador pediu "até eu desligar").
 */
export const CHAVE_DO_MODO_ANONIMO = "cb-modo-anonimo";

/**
 * Ligar é de administrador (admin ou dono), pelo papel REAL: na lente "Ver
 * como" o admin continua escrevendo e aparecendo como ele mesmo
 * (`.claude/rules/perfis.md`), então o modo dele também segue valendo.
 */
export function podeUsarModoAnonimo(
  papelReal: AccountRole | null | undefined,
): boolean {
  return papelReal != null && canManageMembers(papelReal);
}

/**
 * O modo vale AGORA para esta pessoa? Só com a chave guardada pelo PRÓPRIO
 * login. Com o papel CONHECIDO, só administrador: chave plantada à mão por
 * um atendente é ignorada (a mesma régua da lente "Ver como"), e quem deixou
 * de ser admin perde o modo sem precisar desligá-lo.
 *
 * ⚠️ Papel DESCONHECIDO (o perfil não carregou: a casca segue com o alerta
 * de conta) mantém o modo de quem o ligou. O erro não pode virar rastro:
 * cair em "desligado" faria o admin abrir a conversa zerando as não lidas
 * que ele pediu para preservar. O cabeçalho oferece o desligar nesse caso.
 */
export function modoAnonimoAtivo(
  guardado: string | null,
  userId: string | null | undefined,
  papelReal: AccountRole | null | undefined,
): boolean {
  if (!userId || guardado !== userId) return false;
  return papelReal == null || podeUsarModoAnonimo(papelReal);
}
