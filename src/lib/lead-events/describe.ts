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
]);

export function apareceNaConversa(evento: LeadEvent): boolean {
  // Linha reconstruída pela migration não é fato observado: mostrá-la no meio
  // da conversa, com a data de criação do card, colocaria um "negócio criado"
  // antes da primeira mensagem sem que ninguém tenha visto isso acontecer.
  // Ela vale como registro, e é lá que fica.
  if (evento.reconstructed) return false;
  return TIPOS_NA_CONVERSA.has(evento.event_type);
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
  return evento.event_type;
}

/**
 * Quem fez, em texto. `actor_label` é a foto do nome no momento do evento —
 * quando existe, ganha de qualquer nome atual, porque a trilha responde
 * "quem era" e não "quem é". Sem ator, cai na origem.
 */
export function chaveDoAutor(evento: LeadEvent): {
  chave: 'actorPerson' | 'actorChannel' | 'actorAutomation' | 'actorSystem' | 'actorReconstructed';
  nome: string | null;
} {
  if (evento.actor_label) return { chave: 'actorPerson', nome: evento.actor_label };
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
 * ⚠️ Cada fatia tem PREFIXO DE CHAVE próprio (`m:`, `e:`, `n:`). A chave tem
 * dois papéis — key do React e desempate da ordenação — e ids de tabelas
 * diferentes podem coincidir. Sem prefixo distinto, dois itens do mesmo
 * instante trocariam de lugar entre renderizações.
 */
export function intercalar<M extends { id: string; created_at: string }>(
  mensagens: readonly M[],
  eventos: readonly LeadEvent[],
  notas: readonly ConversationNote[] = [],
): ItemDaLinhaDoTempo<M>[] {
  const itens: ItemDaLinhaDoTempo<M>[] = [
    ...mensagens.map((m) => ({ chave: `m:${m.id}`, quando: m.created_at, mensagem: m })),
    ...eventos
      .filter(apareceNaConversa)
      .map((e) => ({ chave: `e:${e.id}`, quando: e.occurred_at, evento: e })),
    ...notas.map((n) => ({ chave: `n:${n.id}`, quando: n.created_at, nota: n })),
  ];

  return itens.sort((a, b) => cmp(a.quando, b.quando) || cmp(a.chave, b.chave));
}
