// ============================================================
// Leitura da trilha de atividade (migration 912) — funções PURAS.
//
// Tudo que decide "como esta linha é lida" mora aqui, e não dentro do
// componente: a mesma linha aparece em três telas (thread do chat, ficha do
// contato no inbox, ficha de contato inteira) e três cópias da regra
// divergiriam. Aqui dá para testar sem montar React.
//
// Mora aqui também a montagem da LINHA DO TEMPO do chat (`intercalar`), que
// hoje mistura três coisas: mensagens, eventos do lead (912) e anotações
// internas (918). A anotação não é evento derivado — é ato de gente, com
// autor e intenção —, mas a mecânica de ordenar e desempatar é a mesma, e
// duplicá-la produziria duas ordens diferentes para o mesmo fio.
// ============================================================

import { VIAS, type ViaDaConversa } from '@/lib/conversations/origem-da-escrita';
import type { ItemDeExecucao } from '@/lib/execucoes/desfecho';
import type { ConversationNote, LeadEvent, LeadEventType } from '@/types';

/**
 * Direção do movimento entre etapas.
 *
 * ⚠️ Vem de `position`, não do rótulo. "Avançou" é a pergunta que o operador
 * faz, e nomes de etapa não a respondem — só a ordem no funil responde.
 * `null` quando não dá para saber: etapa apagada (a 912 guarda o rótulo, mas
 * a posição pode faltar em linha reconstruída) ou movimento entre funis
 * diferentes, onde comparar posições seria comparar réguas distintas.
 */
export type Direcao = 'avanco' | 'retorno' | 'lateral' | null;

export function direcaoDoMovimento(evento: LeadEvent): Direcao {
  // Entre funis, `position` de um não é comparável com a do outro: o funil
  // Bancário pode ter 8 etapas e o Trabalhista 3. Dizer "avançou" ali seria
  // inventar uma escala comum que não existe.
  if (evento.event_type !== 'stage_changed') return null;

  const de = evento.from_stage_position;
  const para = evento.to_stage_position;
  if (de === null || para === null) return null;
  if (para > de) return 'avanco';
  if (para < de) return 'retorno';
  return 'lateral';
}

/**
 * Tipos que aparecem intercalados na conversa do WhatsApp.
 *
 * ⚠️ `deal_deleted` fica de FORA — decisão do operador. Apagar um funil
 * cascateia todos os negócios dele (`deals_pipeline_account_fkey` é CASCADE) e
 * gera um evento por card: com 200 cards isso despejaria uma linha solta em
 * 200 conversas de clientes que não têm nada a ver entre si. A exclusão
 * continua registrada e visível no histórico completo da ficha — some da
 * conversa, não da auditoria.
 */
const TIPOS_NA_CONVERSA: ReadonlySet<LeadEventType> = new Set([
  'deal_created',
  'stage_changed',
  'pipeline_changed',
  'status_changed',
  'tag_added',
  'tag_removed',
  // Quem abriu, encerrou, deixou pendente ou trocou o responsável (1083):
  // pedido do operador, DENTRO da conversa.
  'conversation_status_changed',
  'conversation_assigned',
]);

/**
 * Vias em que a conversa nasce da MENSAGEM de alguém: a primeira bolha já
 * diz quem começou, e a linha "Conversa iniciada" cairia logo DEPOIS dela (o
 * carimbo da mensagem é o do aparelho, anterior ao INSERT da conversa). Fica
 * no Histórico da ficha, que não esconde nada.
 */
const VIAS_DA_MENSAGEM: ReadonlySet<ViaDaConversa> = new Set(['cliente', 'celular', 'ligacao']);

export function apareceNaConversa(evento: LeadEvent): boolean {
  // Linha reconstruída pela migration não é fato observado: mostrá-la no meio
  // da conversa, com a data de criação do card, colocaria um "negócio criado"
  // antes da primeira mensagem sem que ninguém tenha visto isso acontecer.
  // Ela vale como registro, e é lá que fica.
  if (evento.reconstructed) return false;
  if (ehCriacaoDaConversa(evento)) {
    const via = viaDoEvento(evento);
    if (via && VIAS_DA_MENSAGEM.has(via)) return false;
  }
  return TIPOS_NA_CONVERSA.has(evento.event_type);
}

/** A linha que diz que a conversa NASCEU (1083: `from_status` nulo). */
function ehCriacaoDaConversa(evento: LeadEvent): boolean {
  return evento.event_type === 'conversation_status_changed' && evento.from_status === null;
}

/**
 * Texto de `details` (JSONB de fora): só string não vazia vale. O gatilho
 * grava ids e nomes como texto; qualquer outra coisa é linha mexida à mão.
 */
function textoDoDetalhe(evento: LeadEvent, chave: string): string | null {
  const valor = evento.details?.[chave];
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

/** De onde veio a escrita (1083), só se for uma das vias conhecidas. */
export function viaDoEvento(evento: LeadEvent): ViaDaConversa | null {
  const via = textoDoDetalhe(evento, 'via');
  return via && (VIAS as readonly string[]).includes(via) ? (via as ViaDaConversa) : null;
}

/** Chave de i18n do texto da linha. */
export function chaveDoTexto(evento: LeadEvent): string {
  if (evento.event_type === 'stage_changed') {
    const direcao = direcaoDoMovimento(evento);
    if (direcao === 'avanco') return 'stageAdvanced';
    if (direcao === 'retorno') return 'stageReturned';
    return 'stageChanged';
  }
  if (evento.event_type === 'status_changed') {
    if (evento.to_status === 'won') return 'statusWon';
    if (evento.to_status === 'lost') return 'statusLost';
    return 'statusReopened';
  }
  if (evento.event_type === 'conversation_status_changed') {
    const de = evento.from_status;
    const para = evento.to_status;
    if (de === null) {
      if (para === 'closed') return 'conversationCreatedClosed';
      if (para === 'pending') return 'conversationCreatedPending';
      return 'conversationStarted';
    }
    if (para === 'closed') return 'conversationClosed';
    if (de === 'closed') return para === 'pending' ? 'conversationReopenedPending' : 'conversationReopened';
    if (para === 'pending') return 'conversationPending';
    return 'conversationOpened';
  }
  if (evento.event_type === 'conversation_assigned') {
    // Pelo ID, não pelo nome: o nome falta quando o membro já saiu da conta.
    if (!textoDoDetalhe(evento, 'para_responsavel_id')) return 'conversationUnassigned';
    if (!textoDoDetalhe(evento, 'de_responsavel_id')) return 'conversationAssigned';
    return 'conversationReassigned';
  }
  return evento.event_type;
}

/** Nomes do responsável de antes e de depois, congelados pelo gatilho (1083). */
export function responsaveisDoEvento(evento: LeadEvent): { de: string | null; para: string | null } {
  return {
    de: textoDoDetalhe(evento, 'de_responsavel'),
    para: textoDoDetalhe(evento, 'para_responsavel'),
  };
}

/**
 * O responsável que mudou JUNTO com a situação — uma linha só para um fato
 * só (encerrar solta o responsável; o robô deixa pendente com alguém).
 *
 * - Encerrada: "(estava com Bruno)", a pergunta que motivou a 1083 ("quem
 *   estava atendendo quando fecharam?").
 * - Aberta/pendente/criada com alguém: "e atribuída a Ana".
 * - ⚠️ Quando o responsável É quem agiu, nada: quem reabre enviando fica
 *   responsável por regra, e "Conversa reaberta e atribuída a Ana · por
 *   Ana" diria duas vezes a mesma coisa.
 */
export function complementoDoResponsavel(
  evento: LeadEvent,
): { chave: 'suffixWasWith' | 'suffixAssignedTo'; nome: string | null } | null {
  if (evento.event_type !== 'conversation_status_changed') return null;
  // `=== true`: booleano vindo de JSONB (`"true"` e `1` são truthy).
  const mudou = evento.details?.responsavel_mudou === true || ehCriacaoDaConversa(evento);
  if (!mudou) return null;
  const deId = textoDoDetalhe(evento, 'de_responsavel_id');
  const paraId = textoDoDetalhe(evento, 'para_responsavel_id');
  const { de, para } = responsaveisDoEvento(evento);
  if (evento.to_status === 'closed') {
    return deId && deId !== evento.actor_user_id ? { chave: 'suffixWasWith', nome: de } : null;
  }
  return paraId && paraId !== evento.actor_user_id ? { chave: 'suffixAssignedTo', nome: para } : null;
}

/**
 * Quem fez, em texto. `actor_label` é a foto do nome no momento do evento —
 * quando existe, ganha de qualquer nome atual, porque a trilha responde
 * "quem era" e não "quem é". Sem ator, cai na origem.
 */
export type ChaveDoAutor =
  | 'actorPerson'
  | 'actorChannel'
  | 'actorAutomation'
  | 'actorSystem'
  | 'actorReconstructed'
  // As vias da trilha da conversa (1083), lidas de `details.via`.
  | 'actorCustomer'
  | 'actorPhone'
  | 'actorCall'
  | 'actorApi'
  | 'actorAutomationNamed'
  | 'actorBilling'
  | 'actorFlow'
  | 'actorFlowNamed'
  | 'actorAgent'
  | 'actorAgentNamed'
  | 'actorScheduling'
  | 'actorIntegration';

export function chaveDoAutor(evento: LeadEvent): { chave: ChaveDoAutor; nome: string | null } {
  if (evento.actor_label) return { chave: 'actorPerson', nome: evento.actor_label };

  // A via (1083) é mais precisa que a origem: "pelo cliente" em vez de "pela
  // conexão", "pela API" em vez de "pelo sistema". Sem via, a origem decide,
  // como na 912.
  const ref = textoDoDetalhe(evento, 'ref_nome');
  switch (viaDoEvento(evento)) {
    case 'cliente':
      return { chave: 'actorCustomer', nome: null };
    case 'celular':
      return { chave: 'actorPhone', nome: null };
    case 'ligacao':
      return { chave: 'actorCall', nome: null };
    case 'api':
      return { chave: 'actorApi', nome: null };
    case 'automacao':
      return ref ? { chave: 'actorAutomationNamed', nome: ref } : { chave: 'actorAutomation', nome: null };
    case 'regua':
      return ref ? { chave: 'actorAutomationNamed', nome: ref } : { chave: 'actorBilling', nome: null };
    case 'robo':
      return ref ? { chave: 'actorFlowNamed', nome: ref } : { chave: 'actorFlow', nome: null };
    case 'agente':
      return ref ? { chave: 'actorAgentNamed', nome: ref } : { chave: 'actorAgent', nome: null };
    case 'agendamento':
      return { chave: 'actorScheduling', nome: null };
    case 'webhook':
      return { chave: 'actorIntegration', nome: null };
    // `envio` sem ator (a pessoa já não é da conta) e sem via: cai na origem.
    default:
      break;
  }

  switch (evento.origin) {
    case 'conexao':
      return { chave: 'actorChannel', nome: evento.channel_label };
    case 'automacao':
      return { chave: 'actorAutomation', nome: null };
    case 'retroativo':
      return { chave: 'actorReconstructed', nome: null };
    default:
      // Inclui 'usuario' sem `actor_label`: alguém agiu, mas o perfil sumiu.
      // Melhor "pelo sistema" do que inventar um nome.
      return { chave: 'actorSystem', nome: null };
  }
}

/**
 * Ordena do mais antigo para o mais novo, que é a ordem da conversa.
 *
 * Desempate pelo `id` para a ordem ser ESTÁVEL: `occurred_at` usa
 * `clock_timestamp()` e praticamente não empata, mas linha retroativa pode
 * repetir `created_at` do negócio, e sem desempate a lista trocaria de ordem
 * entre renderizações.
 */
export function ordenarPorTempo(eventos: readonly LeadEvent[]): LeadEvent[] {
  return [...eventos].sort(
    (a, b) => cmp(a.occurred_at, b.occurred_at) || cmp(a.id, b.id),
  );
}

/**
 * Junta duas listas da trilha sem repetir evento e devolve na ordem da
 * conversa. No `id` repetido vale a versão da PRIMEIRA lista.
 *
 * É a peça do tempo real (1059): o evento que chega pelo canal entra na lista
 * que já está na tela (`juntarEventos(atuais, [novo])`), e a busca que volta
 * depois de um evento ter chegado não o perde — a foto dela pode ser anterior
 * a ele (`juntarEventos(buscados, chegados)`, a versão buscada vence).
 */
export function juntarEventos(
  primeira: readonly LeadEvent[],
  segunda: readonly LeadEvent[],
): LeadEvent[] {
  const porId = new Map<string, LeadEvent>();
  for (const evento of [...primeira, ...segunda]) {
    if (!porId.has(evento.id)) porId.set(evento.id, evento);
  }
  return ordenarPorTempo([...porId.values()]);
}

/**
 * ⚠️ Comparação byte a byte, NÃO `localeCompare`: em vários locales o
 * colador padrão trata `-` e `:` como pontuação ignorável, e duas datas ISO
 * que só diferem na pontuação comparariam iguais. Em ISO com o mesmo fuso
 * (é o que o PostgREST devolve — sempre `+00:00`) o `<`/`>` cru é exato até o
 * microssegundo, sem passar por `Date`, que arredondaria para milissegundo e
 * empataria eventos gravados na mesma transação.
 */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Um item do fio do chat. Exatamente UMA das três fatias vem preenchida.
 *
 * ⚠️ Não é união discriminada — são campos opcionais, e quem renderiza
 * discrimina por truthiness. Ao acrescentar uma fatia, o ramo dela no laço de
 * render tem de vir ANTES do `item.mensagem!` (message-thread.tsx), porque o
 * `!` desliga a checagem e o TypeScript não avisa: o item novo cairia no ramo
 * de mensagem e derrubaria o fio com TypeError em runtime.
 */
export interface ItemDaLinhaDoTempo<M> {
  chave: string;
  quando: string;
  mensagem?: M;
  evento?: LeadEvent;
  nota?: ConversationNote;
  /** Execução de automação que terminou (985) — a quarta fatia do fio. */
  execucao?: ItemDeExecucao;
}

/**
 * Intercala mensagens, eventos do lead e anotações internas numa lista só,
 * em ordem cronológica.
 *
 * Genérico na mensagem de propósito: o módulo não precisa conhecer o tipo
 * `Message` do inbox para ordenar por data, e assim o teste roda sem arrastar
 * meio `src/types` junto. `LeadEvent` e `ConversationNote` são concretos
 * porque são tipos nossos e pequenos.
 *
 * ⚠️ Cada fatia tem PREFIXO DE CHAVE próprio (`m:`, `e:`, `n:`, `x:`). A chave
 * tem dois papéis — key do React e desempate da ordenação — e ids de tabelas
 * diferentes podem coincidir. Sem prefixo distinto, dois itens do mesmo
 * instante trocariam de lugar entre renderizações.
 *
 * ⚠️ A fatia de EXECUÇÃO já vem colapsada e com teto (`itensDoFio`, em
 * `lib/execucoes/desfecho.ts`). Aqui não há filtro: quem decide o que merece
 * uma linha é aquela régua, no molde de `apareceNaConversa` para os eventos.
 * A chave dela é a do grupo (`automação|dia|desfecho`), não um id de linha —
 * é o que faz três conclusões do mesmo dia ocuparem UMA posição estável.
 */
export function intercalar<M extends { id: string; created_at: string }>(
  mensagens: readonly M[],
  eventos: readonly LeadEvent[],
  notas: readonly ConversationNote[] = [],
  execucoes: readonly ItemDeExecucao[] = [],
): ItemDaLinhaDoTempo<M>[] {
  const itens: ItemDaLinhaDoTempo<M>[] = [
    ...mensagens.map((m) => ({ chave: `m:${m.id}`, quando: m.created_at, mensagem: m })),
    ...eventos
      .filter(apareceNaConversa)
      .map((e) => ({ chave: `e:${e.id}`, quando: e.occurred_at, evento: e })),
    ...notas.map((n) => ({ chave: `n:${n.id}`, quando: n.created_at, nota: n })),
    ...execucoes.map((x) => ({ chave: `x:${x.chave}`, quando: x.quando, execucao: x })),
  ];

  return itens.sort((a, b) => cmp(a.quando, b.quando) || cmp(a.chave, b.chave));
}
