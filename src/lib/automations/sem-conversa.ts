// ============================================================
// "Aguardar N sem conversa" (`wait` com `modo: 'sem_conversa'`, 03/10/2026).
//
// Pedido do operador para o funil Trabalhista: o card parado em Ag. Demissão,
// Pediu Demissão ou Foi Demitido vai para a Recuperação "15 dias depois da
// ÚLTIMA troca de mensagens, de qualquer uma das partes". O "Aguardar" comum
// não exprime isso: conta do início, e o "parar se o cliente responder" só
// enxerga o CLIENTE e para a automação de vez (não recomeça a contagem); a
// mensagem que a equipe manda pelo celular nem passa pelo motor.
//
// Como funciona — sem peça nova na fila:
//
// 1. Na CHEGADA ao passo, estaciona por N a partir de agora, como o
//    "Aguardar" comum, mas na POSIÇÃO DO PRÓPRIO PASSO (o deslocamento +0 da
//    retentativa, que `retomada.ts` já trata).
// 2. Ao ACORDAR, a retomada roda este mesmo passo de novo. Ele reconhece que é
//    a recontagem dele (a retomada em curso foi estacionada POR ELE:
//    `_passo_da_fila.id` = o id do passo) e lê a última mensagem da conversa do
//    contato — do cliente, da equipe pelo CRM ou pelo celular, do robô, de
//    ligação: qualquer linha de `messages`. Fez N desde ela → segue. Não fez →
//    estaciona de novo até completar N desde ela.
//
// O prazo efetivo é N a partir do MAIS RECENTE entre a chegada ao passo e a
// última mensagem: o card que acabou de entrar na etapa espera N inteiro, mesmo
// que a última conversa tenha sido há um mês.
//
// ⚠️ "Parar se o cliente responder" não combina com este modo (ele recomeça a
// contagem a cada mensagem; aquele encerraria a automação): a ativação recusa a
// combinação e o motor ignora a caixa aqui.
//
// ⚠️ Leitura que FALHA = passo FALHA, visível no registro — o mesmo trato da
// conferência de etapa e da resposta do cliente: seguir moveria o card de quem
// pode estar conversando; esperar mais em silêncio esconderia o defeito.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { partesNoFuso } from '@/lib/agenda/fuso';
import { FUSO_DO_ESCRITORIO } from '@/lib/contacts/campo-data';
import { lerPassoDaFila } from './retomada';

/** O registro da execução quando a última mensagem não pôde ser lida. */
export const MOTIVO_CONVERSA_NAO_CONFERIDA =
  'não consegui ler a última mensagem da conversa — a espera sem conversa não seguiu, para não agir sobre quem pode estar conversando';

const UNIDADES: Record<string, [string, string]> = {
  seconds: ['segundo', 'segundos'],
  minutes: ['minuto', 'minutos'],
  hours: ['hora', 'horas'],
  days: ['dia', 'dias'],
};

/** "15 dias", "1 hora" — para o registro da execução. */
function duracaoLida(amount: unknown, unit: unknown): string {
  const n = Number(amount);
  const [um, varios] = UNIDADES[String(unit)] ?? ['', ''];
  return `${Number.isFinite(n) ? n : '?'} ${n === 1 ? um : varios}`.trim();
}

/** "18/10 14:20" — um instante no fuso do escritório, como o registro o mostra. */
export function quandoNoEscritorio(instante: Date, fuso: string = FUSO_DO_ESCRITORIO): string {
  const p = partesNoFuso(instante, fuso);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${dois(p.dia)}/${dois(p.mes)} ${dois(p.hora)}:${dois(p.minuto)}`;
}

/**
 * Esta passagem pelo passo é a RECONTAGEM dele (a retomada de uma espera que
 * ele mesmo estacionou) ou a chegada? Só a retomada em curso diz: a
 * `esperaEmCurso` existe e o passo gravado na fila é este. Uma cópia velha de
 * `_passo_da_fila` viajando no contexto de uma execução nova não engana (sem
 * `esperaEmCurso`), e o passo de outra espera também não (outro id).
 */
export function ehRecontagemDaEspera(
  context: unknown,
  stepId: string,
  esperaEmCurso: string | null | undefined,
): boolean {
  if (!esperaEmCurso) return false;
  return lerPassoDaFila(context)?.id === stepId;
}

export type DecisaoSemConversa =
  | { tipo: 'segue'; nota: string }
  | { tipo: 'espera'; ate: Date; nota: string };

/**
 * Segue ou espera? E a nota para o registro da execução.
 *
 * - Chegada (`recontagem: null`): espera N a partir de agora.
 * - Recontagem: sem mensagem nenhuma, ou a última há N ou mais → segue; a
 *   última há menos de N → espera até completar N desde ela.
 */
export function decidirSemConversa(args: {
  amount: unknown;
  unit: unknown;
  duracaoMs: number;
  agora: Date;
  recontagem: { ultima: Date | null } | null;
  fuso?: string;
}): DecisaoSemConversa {
  const { duracaoMs, agora, recontagem } = args;
  const fuso = args.fuso ?? FUSO_DO_ESCRITORIO;
  const duracao = duracaoLida(args.amount, args.unit);
  if (!recontagem) {
    const ate = new Date(agora.getTime() + duracaoMs);
    return {
      tipo: 'espera',
      ate,
      nota: `${duracao} sem conversa: aguarda até ${quandoNoEscritorio(ate, fuso)}`,
    };
  }
  if (!recontagem.ultima) return { tipo: 'segue', nota: 'nenhuma mensagem na conversa; segue' };
  // A mensagem ao vivo traz o relógio do BANCO (`gravada_em`), e o do servidor
  // do app pode estar um instante atrás: a que acabou de chegar sai "do futuro"
  // por milissegundos e conta como agora. No despertar seguinte ela já ficou no
  // passado — sem laço. A de histórico com data no futuro nem chega aqui: a
  // leitura a deixa de fora (ver `ultimaMensagemDoContato`).
  const ultima = recontagem.ultima.getTime() > agora.getTime() ? agora : recontagem.ultima;
  const limite = new Date(ultima.getTime() + duracaoMs);
  if (limite.getTime() <= agora.getTime()) {
    return {
      tipo: 'segue',
      nota: `sem conversa desde ${quandoNoEscritorio(ultima, fuso)} (${duracao}); segue`,
    };
  }
  return {
    tipo: 'espera',
    ate: limite,
    nota: `houve conversa em ${quandoNoEscritorio(ultima, fuso)}; aguarda até ${quandoNoEscritorio(limite, fuso)}`,
  };
}

/** O instante de uma coluna de data lida, ou `null`; `'erro'` se veio ilegível. */
function instanteLido(linha: unknown, coluna: 'gravada_em' | 'created_at'): Date | null | 'erro' {
  const valor = (linha as Record<string, unknown> | undefined)?.[coluna];
  if (typeof valor !== 'string') return null;
  const instante = new Date(valor);
  return Number.isNaN(instante.getTime()) ? 'erro' : instante;
}

/**
 * O instante da última mensagem trocada com o contato, em qualquer conversa
 * dele na conta. `null` = nenhuma; `'erro'` = não deu para ler. Nunca lança.
 *
 * Toda linha de `messages` conta, de propósito: é "a última troca de
 * mensagens, de qualquer uma das partes" — cliente, equipe pelo CRM e pelo
 * celular, robô, ligação, mensagem apagada depois. Grupo não entra (a conversa
 * de grupo não tem `contact_id`).
 *
 * ⚠️ O RELÓGIO DO BANCO (`gravada_em`, 1003) para toda mensagem gravada ao vivo;
 * o do aparelho (`created_at`) só para a que não tem `gravada_em` (a carga de
 * histórico e o que é anterior à 1003). Pelo `created_at`, um celular com a data
 * adiantada gravaria a mensagem "no futuro", e cada despertar a releria e
 * estacionaria de novo até essa data passar — a régua da segunda linha do
 * "parar se responder" (`clienteRespondeuDesde`) é a mesma.
 *
 * ⚠️ A de histórico com data DEPOIS de `agora` fica de fora (Codex, PR #383):
 * histórico é passado, e a data no futuro é relógio errado na carga. Contá-la
 * como agora a cada despertar adiaria a espera N de novo a cada vez, até a data
 * passar (um ano à frente = um ano preso). Fora dela, vale a mais recente das
 * outras. Em 03/10/2026 não havia nenhuma linha assim na base.
 */
export async function ultimaMensagemDoContato(
  db: SupabaseClient,
  accountId: string,
  contactId: string | null,
  agora: Date,
): Promise<Date | null | 'erro'> {
  if (!contactId) return null;
  try {
    const { data: conversas, error: erroDaConversa } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId);
    if (erroDaConversa) {
      console.error('[automations] sem-conversa: leitura da conversa falhou:', erroDaConversa.message);
      return 'erro';
    }
    const ids = (conversas ?? []).map((c) => (c as { id: string }).id);
    if (ids.length === 0) return null;
    const [aoVivo, semCarimbo] = await Promise.all([
      db
        .from('messages')
        .select('gravada_em')
        .in('conversation_id', ids)
        // A tentativa do robô que NÃO saiu (1080) não é conversa.
        .eq('nao_saiu', false)
        .not('gravada_em', 'is', null)
        .order('gravada_em', { ascending: false })
        .limit(1),
      db
        .from('messages')
        .select('created_at')
        .in('conversation_id', ids)
        .eq('nao_saiu', false)
        .is('gravada_em', null)
        .lte('created_at', agora.toISOString())
        .order('created_at', { ascending: false })
        .limit(1),
    ]);
    const erro = aoVivo.error ?? semCarimbo.error;
    if (erro) {
      console.error('[automations] sem-conversa: leitura das mensagens falhou:', erro.message);
      return 'erro';
    }
    const a = instanteLido(aoVivo.data?.[0], 'gravada_em');
    const b = instanteLido(semCarimbo.data?.[0], 'created_at');
    if (a === 'erro' || b === 'erro') return 'erro';
    if (!a) return b;
    if (!b) return a;
    return a.getTime() >= b.getTime() ? a : b;
  } catch (err) {
    console.error('[automations] sem-conversa: leitura estourou:', err);
    return 'erro';
  }
}
