// ============================================================
// O perfil de acesso, como ele viaja pela aplicação.
// Espelha `cb_perfis_de_acesso` (migration 956).
// ============================================================

import type { AccountRole } from "@/lib/auth/roles";
import type { SecaoId, TelaId } from "./catalogo";

/**
 * `owner` não pode ser papel-base de um perfil — o CHECK da 956 barra no
 * banco, e o tipo barra aqui. Perfil que promovesse alguém a dono seria uma
 * transferência de posse por caminho lateral, sem o fluxo próprio dela.
 */
export type PapelBase = Exclude<AccountRole, "owner">;

export interface PerfilDeAcesso {
  id: string;
  account_id: string;
  nome: string;
  papel_base: PapelBase;
  /**
   * ⚠️⚠️ ATENÇÃO À ASSIMETRIA: aqui VAZIO = NENHUMA tela (fora as sempre
   * visíveis), o OPOSTO de `channel_ids` / `pipeline_ids` logo abaixo, onde
   * vazio = TODOS.
   *
   * Não é descuido, e os dois lados têm motivo:
   *   - Escopo (canais/funis) segue a convenção do projeto inteiro
   *     (`channelInScope`, `findEntryFlow`): vazio = sem recorte = tudo.
   *   - Visibilidade é uma LISTA DE PERMISSÕES: um perfil recém-criado sem
   *     nada marcado tem de mostrar nada, senão criar perfil por engano
   *     libera o sistema inteiro — falha para o lado errado.
   *
   * Quem for mexer nos dois no mesmo laço vai querer tratá-los igual. Não dá.
   */
  telas: TelaId[];
  secoes_config: SecaoId[];
  /** ⚠️ VAZIO = TODAS as conexões (convenção do projeto — ver acima). */
  channel_ids: string[];
  /** ⚠️ VAZIO = TODOS os funis. */
  pipeline_ids: string[];
  /** Perfil de fábrica: não editável, não apagável. */
  sistema: boolean;
}

/**
 * O que as funções de decisão precisam saber sobre quem está olhando.
 *
 * ⚠️ `papel` é o `profiles.account_role` — a fonte da verdade do que a pessoa
 * PODE FAZER. O perfil só acrescenta o que ela VÊ. Divergindo os dois, manda o
 * papel; por isso ele viaja junto e não é lido de dentro do perfil.
 *
 * ⚠️ `perfil: null` significa SEM RESTRIÇÃO, nunca "não vê nada" — é o estado
 * de todo mundo que já está na conta e de quem teve o perfil apagado
 * (`ON DELETE SET NULL`). Inverter isso faria apagar um perfil por engano
 * deixar a equipe olhando telas vazias.
 */
export interface ContextoDeAcesso {
  papel: AccountRole | null;
  perfil: PerfilDeAcesso | null;
}
