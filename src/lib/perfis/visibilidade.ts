// ============================================================
// "Esta pessoa enxerga esta tela?" — puro, sem I/O, sem React.
//
// ⚠️ ESTE É O ÚNICO LUGAR ONDE A REGRA MORA. A guarda da página, o filtro do
// menu e o `useCan` da tela chamam A MESMA função. É a lição já registrada no
// CLAUDE.md sobre `src/lib/tasks/permissoes.ts`: regra reescrita em dois
// lugares diverge na primeira mudança, e a divergência aparece como "some o
// item do menu mas a rota abre".
//
// ⚠️ E lembrar do que isto NÃO é: esconder a tela não protege o dado. Não há
// RLS por área (decisão do operador, 2026-08-30) — quem chamar o PostgREST
// direto continua lendo tudo da conta. Isto organiza a visão de funcionários,
// não contém um adversário.
// ============================================================

import {
  SECOES_PESSOAIS,
  SECOES_SO_DE_ADMIN,
  SECOES_TRAVADAS_PARA_ADMIN,
  TELAS_SEMPRE_VISIVEIS,
  type SecaoId,
  type TelaId,
} from "./catalogo";
import type { ContextoDeAcesso } from "./tipos";

/**
 * O dono enxerga tudo, sempre — curto-circuito antes de qualquer consulta a
 * perfil. Ele não tem linha em `cb_perfis_de_acesso` (o CHECK da 956 barra
 * `papel_base = 'owner'`), então sem este atalho ele cairia na regra de
 * "perfil nulo" por acidente em vez de por decisão.
 */
function ehDono(ctx: ContextoDeAcesso): boolean {
  return ctx.papel === "owner";
}

export function podeVerTela(ctx: ContextoDeAcesso, tela: TelaId): boolean {
  if (ehDono(ctx)) return true;

  // Telas que nenhum perfil consegue esconder — hoje só Configurações, que é
  // a porta até as seções pessoais (trocar a própria senha) e a única saída de
  // um perfil mal configurado.
  if ((TELAS_SEMPRE_VISIVEIS as readonly string[]).includes(tela)) return true;

  // Sem perfil = sem restrição. Estado de todo mundo antes da Fase 5 e de
  // quem teve o perfil apagado.
  if (!ctx.perfil) return true;

  return ctx.perfil.telas.includes(tela);
}

export function podeVerSecao(ctx: ContextoDeAcesso, secao: SecaoId): boolean {
  if (ehDono(ctx)) return true;

  // Seções do próprio usuário (cadastro, senha, tema) não são recortáveis por
  // perfil: são a pessoa administrando a si mesma, e tirá-las deixaria alguém
  // sem caminho para trocar a própria senha dentro do app.
  if ((SECOES_PESSOAIS as readonly string[]).includes(secao)) return true;

  // ⚠️ ANTES do fail-open de "sem perfil": gestão de permissão é do PAPEL, e
  // papel existe mesmo quando o perfil foi apagado. Depois do `!ctx.perfil`,
  // o membro no estado fail-open (perfil apagado, documentado abaixo) ganhava
  // a tela de perfis junto com o resto — a mesma classe do furo da caixa
  // marcada. O dono já saiu no curto-circuito; admin passa aqui e recebe a
  // seção pelas travas logo abaixo.
  if (
    ctx.papel !== "admin" &&
    (SECOES_SO_DE_ADMIN as readonly string[]).includes(secao)
  ) {
    return false;
  }

  if (!ctx.perfil) return true;

  // ⚠️ Olha `ctx.papel` (o `profiles.account_role`), NÃO `perfil.papel_base`.
  // As duas colunas podem divergir — a rota da Fase 5 as sincroniza, mas um
  // UPDATE à mão no banco não —, e quem decide o que a pessoa PODE fazer é o
  // papel. Lendo o perfil aqui, um admin de verdade cujo perfil dissesse
  // "agent" perderia a tela de Membros: exatamente o auto-bloqueio que esta
  // trava existe para impedir.
  if (
    ctx.papel === "admin" &&
    (SECOES_TRAVADAS_PARA_ADMIN as readonly string[]).includes(secao)
  ) {
    return true;
  }

  // `SECOES_SO_DE_ADMIN` já foi resolvida lá em cima, antes do fail-open —
  // quem chega aqui só disputa as seções comuns pela caixa marcada.
  return ctx.perfil.secoes_config.includes(secao);
}

/**
 * Resolve a tela a partir do caminho, para a guarda de rota.
 *
 * ⚠️ Casa por PREFIXO porque as rotas reais têm sufixo (`/pipelines/abc`,
 * `/automations/new`). E ordena do caminho mais longo para o mais curto, senão
 * `/agenda` engoliria `/agendadas` — a mesma armadilha de `startsWith` que o
 * CLAUDE.md registra sobre o `protectedPaths` do middleware, onde ela é
 * conveniente e aqui seria um bug: quem não vê "agenda" perderia "agendadas"
 * junto, sem nada dizendo por quê.
 */
export function telaDoCaminho(
  caminho: string,
  rotas: Record<TelaId, string>,
): TelaId | null {
  const candidatos = (Object.entries(rotas) as [TelaId, string][]).sort(
    (a, b) => b[1].length - a[1].length,
  );

  for (const [tela, rota] of candidatos) {
    if (caminho === rota || caminho.startsWith(`${rota}/`)) return tela;
  }
  return null;
}
