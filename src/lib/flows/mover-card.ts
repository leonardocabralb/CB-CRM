// ============================================================
// O nó "Mover card de etapa" do robô (CB, 26/09/2026, migration 1053).
//
// Pedido do operador para o robô do previdenciário: separar os leads por
// ETAPA do funil, não por etiqueta — então o robô tem de levar o card de uma
// etapa a outra no meio da conversa. Até aqui só a automação movia card.
//
// ⚠️⚠️ O CARD É O QUE AS AUTOMAÇÕES ACHARIAM (`negocioAlvo`, exportado de
// `src/lib/automations/engine.ts`, sem cópia): o aberto mais recente; sem
// aberto, o perdido — menos de quem tem card GANHO, que é cliente. Uma
// segunda régua aqui divergiria da das automações na primeira mudança, e o
// robô e a automação do mesmo lead mexeriam em cards diferentes. Quem mudar
// `negocioAlvo` muda o robô junto — de propósito.
//
// ⚠️⚠️ MOVE PELA MESMA RPC DAS AUTOMAÇÕES (`cb_atualizar_negocio`, 1031), e
// nunca por `.update()` direto: funil e etapa mudam no MESMO update (senão a
// trilha da 912 grava que o lead saiu e voltou), o perdido levado a etapa
// neutra reabre DENTRO do UPDATE (1031), e a escrita só acontece se o card
// continua no status em que a busca o viu (`p_status_esperado`) — sem isso, o
// card marcado ganho por alguém entre a busca e a escrita voltaria ao funil.
// A fila do funil (933) é enchida pelo gatilho do banco; quem a esvazia é o
// cron de automações (laço rápido, ~15 s), como para o passo "Mover card" da
// automação. NÃO há dreno imediato aqui, e é decisão — mas ela só protege os
// envios do MESMO laço de avanço, e isto precisa estar escrito: se a etapa de
// destino tem automação que aciona OUTRO robô (`run_flow`, o robô Comercial
// ao entrar em "Qualificado (MQL)"), o cron a roda em segundos e
// `startFlowForContact` ENCERRA este run (`replaced_by_automation`). Um
// "Mover card" seguido de uma pergunta (botões, "Coletar resposta") perde a
// resposta para o outro robô. Por isso a ajuda do passo manda deixá-lo por
// último, logo antes de "Fim"/"Transferir". Drenado aqui, a substituição
// viria antes até das mensagens seguintes do próprio laço.
//
// ⚠️ Na PRIMEIRA mensagem do contato o robô roda ANTES do roteador da conexão
// (`routeContactToPipeline`, na ingestão): um "Mover card" logo no começo
// encontra o contato SEM card e o cria direto na etapa do nó — o roteador
// depois vê "já tem card" e desiste, a etapa de entrada da conexão nunca é
// visitada e as automações dela não rodam. A lista de origem não vale na
// criação (não há de onde sair). Nada quebra; a ajuda do passo diz isso.
//
// ⚠️ A cadeia anti-ciclo (936) leva a chave DESTE robô: se a automação que o
// movimento dispara tentar acionar o MESMO robô de novo, `encadear` recusa
// ("ciclo detectado"). Parcial, e dito: o robô não recebe a cadeia de quem o
// acionou (`startFlowForContact` não a carrega), então um laço que atravessa
// DOIS robôs não é visto.
//
// Resultados que NÃO são falha (o robô segue e o motivo vai para o registro
// do run): o card fora das etapas de origem permitidas, o contato que tem
// card GANHO e nenhum aberto (cliente), o card que já está na etapa, o card
// que outro caminho criou no mesmo instante, e a conversa sem contato (grupo).
// Falha de banco ou recusa da RPC LANÇA — quem chama registra e SEGUE o robô
// também (ver o nó em `engine.ts`).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { negocioAlvo } from '@/lib/automations/engine';
import { chaveDeFluxo } from '@/lib/automations/cadeia';
import { nomeDoContato } from '@/lib/contacts/identidade';
import { createDeal } from '@/lib/deals/create-deal';
import { TITULO_SEM_NOME } from '@/lib/deals/titulo-do-card';

export interface ConfigDoMoverCard {
  funilId: string;
  etapaId: string;
  /** Vazio = qualquer etapa de origem. */
  origens: string[];
}

/**
 * Puro: o `config` do nó, lido campo a campo (é JSONB — pode ter sido
 * gravado por uma versão que não conhecia um campo de hoje). `null` = falta
 * funil ou etapa de destino.
 */
export function lerConfigDoMoverCard(config: unknown): ConfigDoMoverCard | null {
  const c = (config ?? {}) as Record<string, unknown>;
  const funilId = typeof c.pipeline_id === 'string' ? c.pipeline_id.trim() : '';
  const etapaId = typeof c.stage_id === 'string' ? c.stage_id.trim() : '';
  if (!funilId || !etapaId) return null;
  const origens = Array.isArray(c.origem_stage_ids)
    ? [
        ...new Set(
          c.origem_stage_ids
            .filter((v): v is string => typeof v === 'string')
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  return { funilId, etapaId, origens };
}

/** Puro: a etapa em que o card está deixa ele sair? Lista vazia = qualquer. */
export function origemPermite(origens: readonly string[], etapaAtual: string | null): boolean {
  if (origens.length === 0) return true;
  return etapaAtual !== null && origens.includes(etapaAtual);
}

export type ResultadoDoMoverCard =
  | { resultado: 'movido'; dealId: string; statusGravado: string | null }
  /** `dealId` nulo só se o INSERT não devolveu a linha — o card existe. */
  | { resultado: 'criado'; dealId: string | null }
  /** `createDeal` achou o card criado por outro caminho no mesmo instante
   * (corrida com o índice único): nada foi criado AQUI, e o card de lá não é
   * movido por este nó — o que se registra é isso, nunca "criado". */
  | { resultado: 'ja_existia' }
  | { resultado: 'ja_estava'; dealId: string }
  | { resultado: 'fora_da_origem'; dealId: string; etapaAtual: string | null }
  | { resultado: 'so_ganho' }
  | { resultado: 'sem_contato' };

/**
 * Puro: o que vai para o registro do run (`flow_run_events.payload`). Em
 * inglês, como os outros motivos do motor; `deal` é a chave que a tela de
 * execuções mostra quando não há `reason`.
 */
export function payloadDoMoverCard(r: ResultadoDoMoverCard): Record<string, unknown> {
  const base = { node_type: 'move_deal_stage' };
  switch (r.resultado) {
    case 'movido':
      return { ...base, deal: 'moved', deal_id: r.dealId, deal_status: r.statusGravado };
    case 'criado':
      return { ...base, deal: 'created', deal_id: r.dealId };
    case 'ja_existia':
      return {
        ...base,
        deal: 'not_moved',
        reason: 'card not created: another card for this contact was created at the same moment — it was not moved',
      };
    case 'ja_estava':
      return { ...base, deal: 'already_there', deal_id: r.dealId };
    case 'fora_da_origem':
      return {
        ...base,
        deal: 'not_moved',
        deal_id: r.dealId,
        from_stage_id: r.etapaAtual,
        reason: 'card not moved: it is in a stage outside the allowed origin stages',
      };
    case 'so_ganho':
      return {
        ...base,
        deal: 'not_moved',
        reason: 'card not moved: the contact has a WON deal and no open one (a client) — none is moved or created',
      };
    case 'sem_contato':
      return {
        ...base,
        deal: 'not_moved',
        reason: 'card not moved: the conversation has no contact (group)',
      };
  }
}

type ArgsDoAlvo = Parameters<typeof negocioAlvo>[1];

/**
 * ⚠️ `negocioAlvo` recebe o `ExecuteArgs` inteiro do motor de automações, mas
 * lê SÓ quatro campos: `context.deal_id`, `context.deal_status_fixado`,
 * `contactId` e `automation.account_id`. O robô não tem execução de
 * automação — monta só esses, e o contexto vazio faz a busca ser pelo
 * CONTATO. Há pino (`mover-card.test.ts`) lendo o corpo de `negocioAlvo`: se
 * ela passar a ler outro campo, o teste reprova antes de o robô receber
 * `undefined` calado.
 */
function argsDoAlvo(accountId: string, contactId: string): ArgsDoAlvo {
  return {
    automation: { account_id: accountId },
    contactId,
    context: {},
  } as unknown as ArgsDoAlvo;
}

export interface EntradaDoMoverCard {
  accountId: string;
  /** Autor do robô: dono de registro do card criado (a coluna é SET NULL). */
  userId: string;
  flowId: string;
  contactId: string | null;
  conversationId: string | null;
  channelId: string | null;
}

export async function moverCardDoNo(
  db: SupabaseClient,
  e: EntradaDoMoverCard,
  configBruta: unknown,
): Promise<ResultadoDoMoverCard> {
  const cfg = lerConfigDoMoverCard(configBruta);
  if (!cfg) throw new Error('move_deal_stage needs a pipeline and a destination stage');

  // Grupo NUNCA: conversa de grupo não tem contato (CHECK XOR da 906), e card
  // sem contato renderiza em branco no Kanban. O robô não roda em grupo hoje
  // (a ingestão de grupo não importa os motores); esta é a segunda tranca.
  if (!e.contactId) return { resultado: 'sem_contato' };

  const alvo = await negocioAlvo(db, argsDoAlvo(e.accountId, e.contactId));

  if (!alvo) {
    // Sem aberto nem perdido elegível. Ou o contato não tem card NENHUM (cria)
    // ou tem card GANHO (e nenhum aberto) — é cliente: o ganho nunca é alvo, e
    // o perdido de quem tem ganho também não (a régua das automações). Não se
    // move nem se cria um segundo card.
    const { data: qualquer, error } = await db
      .from('deals')
      .select('id')
      .eq('account_id', e.accountId)
      .eq('contact_id', e.contactId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`deal lookup failed: ${error.message}`);
    if (qualquer) return { resultado: 'so_ganho' };

    const { data: contato, error: contatoErr } = await db
      .from('contacts')
      .select('name, phone, wa_username, instagram_username')
      .eq('id', e.contactId)
      .eq('account_id', e.accountId)
      .maybeSingle();
    if (contatoErr) throw new Error(`contact lookup failed: ${contatoErr.message}`);

    // ⚠️ Título pela regra da 1007: o NOME da pessoa e nada mais (sem nome, a
    // identidade — telefone ou `@`; sem nada, o rótulo de reserva que o
    // gatilho da 1008 conhece). SEM marca (`tituloFixadoEm: null`): o título
    // é DERIVADO da ficha, e é o gatilho da 1007 que o mantém em dia quando a
    // pessoa responder o nome ao robô.
    const titulo = nomeDoContato(contato ?? null, TITULO_SEM_NOME);

    const criado = await createDeal({
      db,
      accountId: e.accountId,
      ownerUserId: e.userId,
      contactId: e.contactId,
      pipelineId: cfg.funilId,
      stageId: cfg.etapaId,
      channelId: e.channelId,
      conversationId: e.conversationId,
      title: titulo,
      tituloFixadoEm: null,
      // É regra (o robô), não gente: a coluna distingue o card digitado à mão.
      source: 'automation',
    });
    if (!criado.ok) throw new Error(`deal creation failed: ${criado.message}`);
    // `created: false` = o índice único barrou (outro caminho criou o card no
    // mesmo instante). Inalcançável hoje — o índice da 911 só cobre
    // `source = 'channel'` —, mas o registro não pode dizer "criado" com o id
    // nulo: seria afirmar um card que este nó não fez.
    if (!criado.created) return { resultado: 'ja_existia' };
    const id = criado.deal && typeof criado.deal.id === 'string' ? criado.deal.id : null;
    return { resultado: 'criado', dealId: id };
  }

  const { data: card, error: cardErr } = await db
    .from('deals')
    .select('stage_id, status')
    .eq('id', alvo.id)
    .eq('account_id', e.accountId)
    .maybeSingle();
  if (cardErr) throw new Error(`deal lookup failed: ${cardErr.message}`);
  if (!card) throw new Error('deal vanished before the move');

  const etapaAtual = (card.stage_id as string | null) ?? null;

  // Já na etapa, e aberto: nada a fazer (e a lista de origem não se aplica —
  // recusar "está fora da origem" sobre quem já chegou seria mentira). O
  // PERDIDO parado na etapa de destino segue adiante e passa pela trava de
  // origem como qualquer card: com a origem vazia (ou incluindo a própria
  // etapa de destino), a RPC o reabre (1031), como faria o "Mover card" da
  // automação; com uma lista que NÃO inclui o destino, ele fica perdido
  // (`fora_da_origem`) — reabrir é tirar o lead da perda, e quem restringiu
  // a origem não pediu isso. Há teste fixando os dois lados.
  if (etapaAtual === cfg.etapaId && card.status === 'open') {
    return { resultado: 'ja_estava', dealId: alvo.id };
  }

  if (!origemPermite(cfg.origens, etapaAtual)) {
    return { resultado: 'fora_da_origem', dealId: alvo.id, etapaAtual };
  }

  // A RPC deriva o funil da ETAPA e ignora o funil do nó. Etapa que não é do
  // funil configurado só acontece com a config inconsistente gravada depois
  // da ativação (`PUT /api/flows/[id]` não revalida robô ativo) — e aí o
  // card iria para o funil da etapa enquanto a criação (`createDeal`)
  // recusaria. Conferir aqui mantém os dois caminhos com a mesma resposta.
  const { data: etapa, error: etapaErr } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('id', cfg.etapaId)
    .eq('pipeline_id', cfg.funilId)
    .maybeSingle();
  if (etapaErr) throw new Error(`stage lookup failed: ${etapaErr.message}`);
  if (!etapa) throw new Error('the destination stage is not in the chosen pipeline (or was deleted)');

  const { data, error } = await db.rpc('cb_atualizar_negocio', {
    p_deal_id: alvo.id,
    p_account_id: e.accountId,
    // A RPC descobre o funil pela etapa (e confere que ele é da conta).
    p_pipeline_id: null,
    p_stage_id: cfg.etapaId,
    p_status: null,
    p_cadeia: [chaveDeFluxo(e.flowId)],
    p_status_esperado: alvo.statusVisto,
  });
  if (error) throw new Error(`move failed: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; motivo?: string | null; status_gravado?: string | null }
    | null;
  if (!r?.ok) throw new Error(`move refused: ${r?.motivo ?? 'unknown reason'}`);

  return { resultado: 'movido', dealId: alvo.id, statusGravado: r.status_gravado ?? null };
}
