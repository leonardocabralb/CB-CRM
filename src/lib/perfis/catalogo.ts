// ============================================================
// Catálogo de telas e seções — a lista FECHADA do que um perfil pode
// ligar ou desligar.
//
// ⚠️ É exaustivo de propósito. Rota nova que não ganhe entrada aqui nasce
// INVISÍVEL para todo perfil restrito, e o sintoma ("sumiu do menu de
// alguns") aparece longe da causa. O typecheck cobra: `TelaId` é union de
// literais, então o `Record<TelaId, …>` abaixo não compila com um id
// faltando.
//
// Por que texto e não enum no banco: tela nasce e morre com a UI. Enum
// obrigaria uma migration por rota nova, e `ALTER TYPE ... ADD VALUE` não
// roda dentro de transação — exatamente o que o replay do CI faz.
// ============================================================

/** Itens do menu lateral que um perfil pode ver ou não. */
export type TelaId =
  | "dashboard"
  | "radar"
  | "inbox"
  | "notifications"
  | "tarefas"
  | "contacts"
  | "agenda"
  | "pipelines"
  | "broadcasts"
  | "agendadas"
  | "automations"
  | "flows"
  | "agents"
  | "settings";

/** Seções da tela de Configurações. Espelha `settings-sections.ts`. */
export type SecaoId =
  | "overview"
  | "profile"
  | "security"
  | "appearance"
  | "channels"
  | "templates"
  | "quick-replies"
  // ⚠️ `acervo` ainda NÃO existe no settings-sections do main — está declarada
  // à frente, como `perfis` lá embaixo. A seção chega com a branch
  // `feat/acervo-de-midias` (em voo, migrations 953/954 JÁ APLICADAS em
  // produção). Removê-la aqui criaria a armadilha inversa: o merge do acervo
  // entraria sem entrada no catálogo e a seção nasceria invisível para
  // qualquer perfil restrito. Id declarado sem seção renderizada é inofensivo
  // — `podeVerSecao` responde true para uma seção que a tela não lista.
  | "acervo"
  | "fields"
  // ⚠️ NÃO existe "deals" — foi declarada na Fase 1 achando que Configurações
  // teria uma seção de negócios, que nunca nasceu (o assunto mora em
  // `fields`). O id fantasma rendia um SEGUNDO checkbox no editor de perfis,
  // caindo no rótulo de fallback — dois "Perfis de acesso" idênticos, e o
  // admin podia marcar o errado. O `"deals"` gravado no perfil Administrador
  // é filtrado por `ehSecaoConhecida` na leitura e na validação; não precisa
  // de limpeza no banco.
  | "assinatura"
  | "members"
  | "integracoes"
  | "api"
  // ⚠️ Declarada ANTES de existir na tela (a seção chega na Fase 5). O
  // catálogo é a lista fechada do que um perfil PODE ligar: seção ausente
  // daqui é seção que `podeVerSecao` nunca libera, então declará-la depois
  // faria a própria tela de perfis nascer inalcançável para perfil restrito.
  | "perfis";

/** Rota de cada tela — usada pelo menu e pela guarda de página. */
export const ROTA_DA_TELA: Record<TelaId, string> = {
  dashboard: "/dashboard",
  radar: "/radar",
  inbox: "/inbox",
  notifications: "/notifications",
  tarefas: "/tarefas",
  contacts: "/contacts",
  agenda: "/agenda",
  pipelines: "/pipelines",
  broadcasts: "/broadcasts",
  agendadas: "/agendadas",
  automations: "/automations",
  flows: "/flows",
  agents: "/agents",
  settings: "/settings",
};

export const TODAS_AS_TELAS = Object.keys(ROTA_DA_TELA) as TelaId[];

/**
 * Chave do dicionário (namespace `Sidebar`) que nomeia cada tela.
 *
 * ⚠️ Mora aqui, e não no componente, porque JÁ existiam duas cópias — uma no
 * `perfis-panel.tsx` e outra no `perfil-resumo.tsx` — e a terceira ia nascer
 * junto com o aviso de áreas sem ação. Cópia de mapa exaustivo é o caso em
 * que o typecheck deixa passar a divergência: cada cópia continua completa,
 * só que uma delas aponta para a chave velha depois de um rename.
 */
export const ROTULO_DA_TELA: Record<TelaId, string> = {
  dashboard: "dashboard",
  radar: "radar",
  inbox: "inbox",
  notifications: "notifications",
  tarefas: "tasks",
  contacts: "contacts",
  agenda: "agenda",
  pipelines: "pipelines",
  broadcasts: "broadcasts",
  agendadas: "scheduled",
  automations: "automations",
  flows: "flows",
  agents: "aiAgents",
  settings: "settings",
};

export const TODAS_AS_SECOES: SecaoId[] = [
  "overview",
  "profile",
  "security",
  "appearance",
  "channels",
  "templates",
  "quick-replies",
  "acervo",
  "fields",
  "assinatura",
  "members",
  "integracoes",
  "api",
  "perfis",
];

// ============================================================
// Trancas — o que NENHUM perfil consegue desligar
// ============================================================

/**
 * Seções que todo mundo enxerga, sempre, em qualquer perfil.
 *
 * São as do próprio usuário: ver o próprio cadastro, trocar a própria senha,
 * escolher o tema. Decisão do operador em 2026-08-30 ("eles só vão precisar
 * ter acesso ao básico, que seria o próprio perfil dela para ela mudar sua
 * própria senha"). Nada aqui expõe dado de outra área — é a pessoa
 * administrando a si mesma.
 *
 * ⚠️ `security` fora desta lista significaria alguém sem caminho para trocar
 * a própria senha dentro do app.
 */
export const SECOES_PESSOAIS: readonly SecaoId[] = [
  "profile",
  "security",
  "appearance",
] as const;

/**
 * Seções que um perfil `admin` enxerga mesmo desmarcadas.
 *
 * ⚠️ Isto é a trava anti-auto-bloqueio, e não é hipotética: sem ela, desmarcar
 * "members" do perfil Administrador tranca o operador para fora da ÚNICA tela
 * que desfaria o erro, e a saída seria eu mexer no banco. `overview` entra
 * junto porque é a porta de entrada de Configurações — sem ela o rail abre
 * numa seção vazia.
 */
export const SECOES_TRAVADAS_PARA_ADMIN: readonly SecaoId[] = [
  "overview",
  "members",
  // ⚠️ `perfis` entra pela MESMA razão de `members`: é a tela que conserta
  // perfil mal configurado. Fora daqui, desmarcá-la do Administrador tranca o
  // operador para fora do único lugar que desfaria o erro — e desta vez sem
  // nem a rota de membros como saída, porque o estrago está no perfil.
  "perfis",
] as const;

/**
 * Seções que exigem o PAPEL de admin — a caixa marcada não basta.
 *
 * ⚠️ `secoes_config` responde "o que este perfil MOSTRA", não "o que esta
 * pessoa PODE". O editor oferece a caixa "Perfis de acesso" para perfil de
 * qualquer papel, e marcá-la num perfil `agent`/`viewer` entregava a tela
 * inteira de gestão de permissões a quem não administra nada: a leitura
 * funciona (a policy da 956 dá SELECT a qualquer membro da conta) e só as
 * escritas quebram, com 403 genérico. Ou seja, a pessoa via como a conta é
 * recortada — inclusive o recorte dos colegas — e descobria isso clicando.
 *
 * Só `perfis` entra aqui. `members` fica de fora DE PROPÓSITO: aquela aba
 * foi desenhada para ser lida por todo mundo, com as ações escondidas por
 * `canManageMembers`.
 */
export const SECOES_SO_DE_ADMIN: readonly SecaoId[] = ["perfis"] as const;

/**
 * Telas que TODO perfil enxerga, sempre.
 *
 * ⚠️ `settings` está aqui porque é o caminho até `SECOES_PESSOAIS`. Garantir
 * "todo mundo troca a própria senha" no nível da SEÇÃO não serve de nada se a
 * TELA que as contém puder ser desmarcada — a pessoa fica sem porta de entrada
 * e a garantia vira letra morta. Quem não tem nenhuma seção de conta liberada
 * abre Configurações e vê só o próprio cadastro, senha e tema, que é
 * exatamente o combinado com o operador.
 *
 * Também é o que impede o auto-bloqueio do admin: sem Configurações não há
 * como reabrir o que foi fechado.
 */
export const TELAS_SEMPRE_VISIVEIS: readonly TelaId[] = ["settings"] as const;

/** Type guard — protege contra id órfão vindo do banco (tela removida do app). */
export function ehTelaConhecida(valor: string): valor is TelaId {
  return (TODAS_AS_TELAS as string[]).includes(valor);
}

export function ehSecaoConhecida(valor: string): valor is SecaoId {
  return (TODAS_AS_SECOES as string[]).includes(valor);
}
