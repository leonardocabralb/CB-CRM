// ============================================================
// "Quem escrever neste número entra naquele funil."
//
// POR QUE O GATILHO É POR ESTADO, E NÃO POR EVENTO
// O caminho óbvio seria pendurar isto no gatilho `first_inbound_message` das
// automações. Não serve: ele é contado por CONVERSA, e existe UMA conversa
// por contato por conta (`idx_conversations_account_contact`, migration 036).
// O cliente que já falou no número Trabalhista e um mês depois escreve no
// Bancário não dispararia nada — que é justamente o caso a cobrir.
//
// Então a pergunta aqui não é "é a primeira mensagem?" e sim "este contato
// já tem card neste funil?". Isso é convergente: se o insert falhar (rede,
// funil sem etapa, `after()` cortado), a próxima mensagem tenta de novo.
// Borda consumida não volta — o cliente ficaria fora do funil para sempre,
// em silêncio.
//
// CONTRATO: NUNCA LANÇA. Roda no fan-out da ingestão, ao lado das
// automações, depois do 200 devolvido ao provedor. Falhar aqui não pode
// derrubar a gravação da mensagem nem o resto do fan-out.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { createDeal } from '@/lib/deals/create-deal';

export interface RouteInboundArgs {
  /** Client de service-role (a ingestão ignora RLS — o filtro é explícito). */
  db: SupabaseClient;
  accountId: string;
  /** Canal por onde a mensagem entrou. Nulo = não roteia (ver guarda 1). */
  channelId: string | null | undefined;
  /** Contato dono da conversa. Nulo em grupo (ver guarda 2). */
  contactId: string | null | undefined;
  contactName?: string | null;
  /**
   * Conversa que originou o card. Os dois call sites já a têm em mão — é a
   * mesma que passam no contexto das automações —, então isto não custa
   * consulta nenhuma. É o que dá ao card um caminho de volta ao atendimento.
   */
  conversationId?: string | null;
}

/**
 * Coloca o contato no funil configurado da conexão, se houver um e se ele
 * ainda não estiver lá.
 */
export async function routeInboundToPipeline(args: RouteInboundArgs): Promise<void> {
  const { db, accountId, channelId, contactId } = args;

  // ---- Guarda 1: sem canal resolvido, não roteia ----
  // `channelInScope` do motor de automações faz o oposto (contexto sem canal
  // passa em QUALQUER escopo), e é por isso que aquele caminho vaza: um
  // inbound cujo canal não resolve dispara as regras de todos os números
  // juntas. Aqui o silêncio é a resposta certa — melhor não criar card do
  // que criar no funil errado.
  if (!channelId) return;

  // ---- Guarda 2: sem contato, não roteia ----
  // Conversa de GRUPO não tem contato individual, e `deals.contact_id` é
  // NULLABLE desde a migration 004 — ou seja, o banco NÃO barraria um card
  // órfão, que renderizaria em branco no Kanban. A guarda é obrigatória.
  if (!contactId) return;

  try {
    // ---- Guarda 3: a conexão roteia alguma coisa? ----
    // Consulta por chave primária, com o filtro de conta explícito. É a
    // primeira leitura de propósito: enquanto ninguém configurar um funil
    // (estado de toda conexão hoje), o custo por mensagem é este SELECT e
    // mais nada — nenhuma consulta a `deals`.
    const { data: canal, error: canalErr } = await db
      .from('cb_channels')
      .select('label, default_pipeline_id, default_stage_id')
      .eq('id', channelId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (canalErr || !canal?.default_pipeline_id) return;

    const pipelineId = canal.default_pipeline_id as string;

    // ---- Guarda 4: este contato já tem card? ----
    //
    // ⚠️ EM QUALQUER FUNIL, de propósito — e isto é o coração da regra.
    //
    // O modelo do produto é UM CARD POR CONTATO, que TRANSITA entre funis: o
    // operador move o lead do Bancário para o Trabalhista quando o assunto
    // muda. A conexão coloca o cliente num funil apenas na PRIMEIRA vez;
    // depois disso, quem manda é a decisão de quem moveu.
    //
    // A versão anterior filtrava por `pipeline_id`, e por isso desfazia a
    // transferência: card movido para o Trabalhista, cliente escreve de novo,
    // o roteador procura card no funil da CONEXÃO (Bancário), não acha, e
    // cria um segundo. O lead terminava nos dois — exatamente o que "um funil
    // por vez" existe para impedir.
    //
    // Continua larga quanto à origem: card aberto ou fechado, criado à mão,
    // por automação ou por aqui, todos contam. Quem já está no funil de
    // alguém não é problema desta função.
    const { data: existente, error: existenteErr } = await db
      .from('deals')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .limit(1)
      .maybeSingle();

    if (existenteErr) {
      console.warn('[pipeline-routing] checagem de duplicata falhou:', existenteErr.message);
      return;
    }
    if (existente) return;

    // ---- Dono do card ----
    // O dono da CONTA, não quem pareou o QR: `cb_channels.created_by` é
    // anulado quando o membro sai (ON DELETE SET NULL), e o dono é imutável.
    const { data: conta } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle();

    const nome = args.contactName?.trim();
    const rotulo = (canal.label as string | null)?.trim();
    // Canal e contato no título de propósito: `contact_id` é SET NULL quando
    // o contato é apagado, e sem isto o card ficaria sem nenhuma identificação.
    const titulo = [rotulo, nome].filter(Boolean).join(' — ') || 'Novo contato';

    const resultado = await createDeal({
      db,
      accountId,
      ownerUserId: (conta?.owner_user_id as string | undefined) ?? null,
      contactId,
      pipelineId,
      stageId: (canal.default_stage_id as string | null) ?? null,
      channelId,
      conversationId: args.conversationId ?? null,
      title: titulo,
      source: 'channel',
    });

    if (!resultado.ok) {
      // Alto de propósito: a configuração está de pé e mesmo assim ninguém
      // entrou no funil. É o sintoma que o operador vai reportar como
      // "parou de entrar gente", e sem esta linha não há por onde começar.
      console.error(
        `[pipeline-routing] não foi possível criar o negócio (${resultado.code}):`,
        resultado.message,
      );
    }
  } catch (err) {
    console.warn(
      '[pipeline-routing] falha inesperada (ignorada):',
      err instanceof Error ? err.message : err,
    );
  }
}
