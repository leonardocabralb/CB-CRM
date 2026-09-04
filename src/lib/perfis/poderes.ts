// ============================================================
// "O que este PAPEL pode fazer?" — puro, sem I/O, sem React.
//
// O perfil recorta o que a pessoa VÊ; o papel decide o que ela PODE. Até
// aqui a segunda metade não estava escrita em lugar nenhum da tela: o
// seletor de Papel do editor de perfis mostrava três nomes — Administrador,
// Atendente, Visualizador — e nada mais. A única explicação de papel que
// existia (`Settings.roles.*Hint`) só aparece no diálogo de convite, e a do
// Atendente estava desatualizada ("sem acesso às configurações": ele tem
// acesso às seções que o perfil liberar; o que não tem é escrita nelas).
//
// ⚠️ NADA AQUI CONCEDE OU BARRA COISA ALGUMA. Este módulo é DESCRIÇÃO: ele
// lê os mesmos predicados de `src/lib/auth/roles.ts` que a rota e o botão
// já consultam, para dizer em palavras o que eles fazem em silêncio. Quem
// mudar uma política mexe em `roles.ts` (ou na policy/rota correspondente);
// se mexer só aqui, a tela passa a mentir.
// ============================================================

import {
  canEditSettings,
  canManageAutomations,
  canManageMembers,
  canSendMessages,
  canWriteNotes,
  hasMinRole,
  type AccountRole,
} from "@/lib/auth/roles";

import {
  SECOES_PESSOAIS,
  SECOES_SO_DE_ADMIN,
  ehSecaoConhecida,
  ehTelaConhecida,
  type SecaoId,
  type TelaId,
} from "./catalogo";
import type { PapelBase } from "./tipos";

// ------------------------------------------------------------
// 1. As capacidades, na ordem em que a tela as mostra
// ------------------------------------------------------------

/**
 * ⚠️ Cada id é também a chave do dicionário (`PerfisPanel.poderes.<id>`), e
 * há teste lendo `messages/*.json` que cobra uma entrada por id — a mesma
 * amarração que `descrever-passo.ts` usa. Sem ela, acrescentar uma
 * capacidade aqui põe `PerfisPanel.poderes.foo`, cru, dentro do editor: o
 * fallback do next-intl é por ARQUIVO, não por chave.
 */
export type PoderId =
  | "send-messages"
  | "write-notes"
  | "manage-deals"
  | "manage-automations"
  | "edit-settings"
  | "manage-members";

/**
 * ⚠️ `permite` DELEGA para `roles.ts` — nunca compara papel na mão.
 *
 * Escrever `papel === "admin"` aqui criaria uma segunda cópia da política, e
 * a cópia diverge na primeira mudança: é a lição já registrada no CLAUDE.md
 * sobre `src/lib/tasks/permissoes.ts` ("regra reescrita em dois lugares
 * diverge, e a divergência aparece como 'some o botão mas a rota abre'").
 * Aqui seria pior, porque o sintoma é uma tela AFIRMANDO um poder que a
 * pessoa não tem.
 *
 * ⚠️ `delete-account` e `transfer-ownership` ficam de fora DE PROPÓSITO: são
 * do `owner`, e o CHECK da 956 barra `papel_base = 'owner'`. Nenhum perfil
 * pode concedê-las, então listá-las seria três "✗" idênticos em todos os
 * papéis — ruído que ensina o olho a pular a lista inteira.
 */
export const PODERES: readonly {
  id: PoderId;
  permite: (papel: PapelBase) => boolean;
}[] = [
  { id: "send-messages", permite: canSendMessages },
  { id: "write-notes", permite: canWriteNotes },
  // Mover card, mudar etapa, criar negócio: a policy de `deals` é 'agent'
  // (017). O FUNIL em si (criar, renomear, apagar etapa) é 'admin', e o
  // rótulo diz isso — a diferença é o que faz alguém achar que "Funis
  // marcado" basta para reestruturar o quadro.
  { id: "manage-deals", permite: (p) => hasMinRole(p, "agent") },
  { id: "manage-automations", permite: canManageAutomations },
  { id: "edit-settings", permite: canEditSettings },
  { id: "manage-members", permite: canManageMembers },
] as const;

export function poderesDoPapel(
  papel: PapelBase,
): { id: PoderId; permitido: boolean }[] {
  return PODERES.map((p) => ({ id: p.id, permitido: p.permite(papel) }));
}

// ------------------------------------------------------------
// 2. Qual papel cada área EXIGE para ser operada
// ------------------------------------------------------------
//
// ⚠️ São `Record<TelaId, …>` / `Record<SecaoId, …>` de propósito: o
// typecheck cobra uma entrada por tela e por seção, exatamente como o
// `ROTA_DA_TELA` do catálogo. Tela nova sem entrada aqui não compila — o
// contrário (cair num `?? 'viewer'`) faria a área nascer descrita como
// "todo mundo opera", que é a afirmação errada de graça.
//
// ⚠️ O valor é o piso para ESCREVER/OPERAR, não para ver. `viewer` aqui
// significa "não há operação privativa nesta área" (dashboard, avisos), e é
// o que impede a tela de marcar como somente-leitura algo que não é.

/** Piso de papel para OPERAR cada tela. Fonte: rotas + policies, listadas ao lado. */
export const ESCRITA_DA_TELA: Record<TelaId, AccountRole> = {
  dashboard: "viewer", // só leitura por natureza
  radar: "agent", // /api/cb/radar/[id]/estado, .../reanalisar
  // ⚠️ `viewer`, e não `agent`, apesar de enviar mensagem exigir `agent`.
  // O aviso diz "aparece só para leitura, sem os botões", e no inbox isso
  // seria MENTIRA para o Visualizador: `canWriteNotes` é deliberadamente mais
  // permissivo (ver a docstring dele) e a caixa de anotação interna aparece
  // para ele. Acompanhar sem atender, anotando, é uma configuração legítima —
  // não um beco sem saída, que é o que este mapa existe para apontar. Que o
  // Visualizador não responde ao cliente já está dito na lista de poderes,
  // logo acima, com "Responder clientes no WhatsApp" riscado.
  inbox: "viewer",
  notifications: "viewer",
  tarefas: "viewer", // /api/cb/tasks decide por permissoes.ts, não por papel
  // ⚠️ `viewer` pela MESMA razão do inbox — e esta linha nasceu `agent`
  // (policies `contacts_*` da 017) até o Codex apontar no PR #107: a ficha
  // do contato (`contact-detail-view`) tem uma aba Notas cujo compositor
  // NÃO passa por `podeEditar`, e a rota `POST /api/cb/notes` aceita
  // `viewer`. O Visualizador abre Contatos e ANOTA — logo a tela não é "só
  // leitura, sem os botões". A régua deste mapa é "há alguma operação
  // disponível para este papel nesta tela?", e anotação interna CONTA.
  // Funis, Radar e Agendadas ficam em `agent` porque NÃO montam o
  // compositor de nota (medido: só inbox e contatos o montam).
  contacts: "viewer",
  agenda: "viewer", // /api/cb/agenda confere só a conta
  pipelines: "agent", // `deals` é agent; `pipelines`/`pipeline_stages` é admin
  broadcasts: "admin", // canManageAutomations + policies da 964
  agendadas: "agent", // /api/cb/scheduled
  automations: "admin", // canManageAutomations + policies da 964
  flows: "admin", // idem
  agents: "admin", // /api/ai/config
  settings: "viewer", // depende da SEÇÃO — ver o mapa abaixo
};

/** Piso de papel para ESCREVER em cada seção de Configurações. */
export const ESCRITA_DA_SECAO: Record<SecaoId, AccountRole> = {
  overview: "viewer",
  profile: "viewer", // pessoal: a pessoa administrando a si mesma
  security: "viewer",
  appearance: "viewer",
  channels: "admin", // requireRole('admin') nas 5 rotas + policies da 901
  templates: "admin", // policies `message_templates_*` (017) + submit/sync
  "quick-replies": "agent", // policies da 035 — a única seção que o agent escreve
  acervo: "admin", // POST/DELETE /api/cb/acervo
  fields: "admin", // policies `custom_fields_*` / `tags_*` (017) e da 966
  assinatura: "admin", // grava em `accounts`; a tela usa canEditSettings
  members: "admin", // canManageMembers
  integracoes: "admin", // /api/ai/config, /api/cb/integracoes/status
  api: "admin", // /api/account/api-keys
  perfis: "admin", // e mais que isso: invisível fora do admin (SECOES_SO_DE_ADMIN)
};

// ------------------------------------------------------------
// 3. O que o rascunho promete e o papel não entrega
// ------------------------------------------------------------

export interface AreasQueNaoOperam {
  /** Marcadas, visíveis, e sem nenhuma ação disponível para este papel. */
  telas: TelaId[];
  secoes: SecaoId[];
  /** Marcadas e que este papel não vê DE JEITO NENHUM — a caixa não faz nada. */
  secoesOcultas: SecaoId[];
}

/**
 * Confere o rascunho do editor contra o papel escolhido.
 *
 * Existe por um caso real, medido em 2026-09-02: os perfis "Gestor Geral" e
 * "Trabalhista - Gestor" desta conta são `papel_base = 'agent'` com
 * Conexões, Membros, Modelos, Campos, Acervo e Assinatura marcadas, mais as
 * telas de Automações e Disparos. Nada disso é operável por um `agent` — o
 * "Gestor" enxerga tudo e não mexe em nada. A configuração está fazendo
 * exatamente o que foi pedida a fazer; o que faltava era a tela dizer o que
 * aquilo significa ANTES de salvar.
 *
 * ⚠️ As duas listas são separadas porque os sintomas são diferentes, e
 * juntá-las esconderia o pior: seção somente-leitura APARECE (a pessoa vê os
 * dados e não tem botão); seção oculta NÃO APARECE, e a caixa marcada é
 * silenciosamente inerte. Quem marcasse "Perfis de acesso" num perfil
 * `agent` sairia da tela achando ter delegado a gestão de permissões.
 *
 * Consumidores (2026-09-03, `editor.ts`): `gruposDoEditor` faz do
 * `telas`/`secoes` o grupo "Só leitura para este papel" e omite as
 * `secoesOcultas`; `semSecoesOcultas` as descarta do rascunho.
 */
export function areasQueNaoOperam(
  papel: PapelBase,
  telas: readonly TelaId[],
  secoes: readonly SecaoId[],
): AreasQueNaoOperam {
  const soDeAdmin = SECOES_SO_DE_ADMIN as readonly string[];
  const pessoais = SECOES_PESSOAIS as readonly string[];

  // ⚠️⚠️ ID ÓRFÃO É IGNORADO, e isto NÃO é defensividade genérica — há um
  // órfão VIVO no banco hoje: o perfil "Administrador" desta conta guarda
  // `"deals"` em `secoes_config`, seção que nunca existiu na tela (a nota
  // está em `catalogo.ts`). O tipo diz `SecaoId[]`, mas o valor vem do banco
  // e o editor NÃO o filtra ao montar o rascunho — `duplicar()` o copia
  // verbatim, e duplicar o Administrador é o ÚNICO botão que aquele cartão
  // oferece.
  //
  // Sem este filtro, `ESCRITA_DA_SECAO["deals"]` é `undefined`,
  // `hasMinRole(papel, undefined)` compara `3 >= undefined` = false, e a
  // seção fantasma entra no aviso — que passaria a dizer, num perfil
  // ADMINISTRADOR, "estas áreas aparecem só para leitura: deals". Não
  // estoura em lugar nenhum: `roleRank` não tem `default`, devolve
  // `undefined`, e a comparação é só falsa.
  //
  // A regra da casa para id órfão é ignorar contra a lista viva (956, sobre
  // canais e funis; `descrever-passo.ts`, sobre tag apagada). Aqui ignorar é
  // a resposta CERTA, não a conservadora: área que não existe não é
  // somente-leitura, é nada.
  const telasVivas = telas.filter(ehTelaConhecida);
  const secoesVivas = secoes.filter(ehSecaoConhecida);

  const secoesOcultas = secoesVivas.filter(
    (s) => soDeAdmin.includes(s) && !hasMinRole(papel, "admin"),
  );

  return {
    telas: telasVivas.filter((t) => !hasMinRole(papel, ESCRITA_DA_TELA[t])),
    secoes: secoesVivas.filter(
      (s) =>
        // Já contada como oculta: repeti-la nas duas listas faria a tela
        // pedir dois consertos para um problema só.
        !secoesOcultas.includes(s) &&
        // Pessoal nunca é "somente leitura": trocar a própria senha é de
        // todo mundo, e listá-la aqui viraria um aviso permanente e falso.
        !pessoais.includes(s) &&
        !hasMinRole(papel, ESCRITA_DA_SECAO[s]),
    ),
    secoesOcultas,
  };
}
