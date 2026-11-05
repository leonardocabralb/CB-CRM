// ============================================================
// Recorte por funil da chave de API (1121) — a régua única.
//
// Chave com `funis` (a do funcionário do Trabalhista, por exemplo) enxerga
// SÓ os clientes cujo card está num desses funis, e deles enxerga tudo:
// conversa, mensagens, anotações, tarefas, campos, etiquetas, execuções.
// "O cliente está no funil" = algum card dele (`deals.contact_id`) tem
// `pipeline_id` na lista. Um card por cliente (911), que transita entre
// funis: quando o card sai para um funil fora da lista, a chave perde o
// cliente na hora; cliente sem card não aparece (decisões do operador,
// 04/11/2026, `docs/PLANO-chave-por-funcionario.md`).
//
// ⚠️ Fora do recorte = a MESMA resposta de "não existe" (404 da rota), nunca
// 403: o 403 contaria que o cliente existe.
// ⚠️ Só as rotas que declaram `aceitaRecorte` a `requireApiKey` chegam
// aqui com uma chave recortada; as outras a recusam (default-deny). Rota
// que declara TEM de recortar toda leitura que faz.
// ⚠️ Erro da leitura do recorte é 500, nunca "fora do recorte" (o
// integrador leria um 404 falso como "não existe").
// ============================================================

import type { ApiKeyContext } from '@/lib/auth/api-context';
import { ApiError, badRequest } from './respond';

type CtxDoRecorte = Pick<ApiKeyContext, 'supabase' | 'accountId' | 'funis'>;

/**
 * Os funis da chave, ou `null` quando ela vê a conta inteira. `requireApiKey`
 * já recusou a lista vazia; aqui ela continuaria RECORTADA (nada casa).
 */
export function funisDaChave(ctx: Pick<ApiKeyContext, 'funis'>): string[] | null {
  return Array.isArray(ctx.funis) ? ctx.funis : null;
}

/** O funil está no recorte? Sem recorte, todo funil está. */
export function funilNoRecorte(
  ctx: Pick<ApiKeyContext, 'funis'>,
  pipelineId: string | null | undefined
): boolean {
  const funis = funisDaChave(ctx);
  if (!funis) return true;
  return typeof pipelineId === 'string' && funis.includes(pipelineId);
}

/**
 * O cliente está no recorte? Sem recorte, sempre. Contato nulo (tarefa sem
 * cliente, conversa de grupo) nunca está num recorte.
 */
export async function contatoNoRecorte(
  ctx: CtxDoRecorte,
  contactId: string | null | undefined
): Promise<boolean> {
  const funis = funisDaChave(ctx);
  if (!funis) return true;
  if (!contactId) return false;

  const { data, error } = await ctx.supabase
    .from('deals')
    .select('id')
    .eq('account_id', ctx.accountId)
    .eq('contact_id', contactId)
    .in('pipeline_id', funis)
    .limit(1);
  if (error) {
    console.error('[api/v1/recorte-por-funil] lookup error:', error);
    throw new ApiError('internal', 'Failed to check the pipelines of this API key', 500);
  }
  return (data ?? []).length > 0;
}

/**
 * Lista que só sabe recortar PELO CLIENTE (anotações, tarefas, conversas)
 * exige o filtro do cliente da chave recortada: sem ele, listaria a conta
 * inteira. Sem recorte, não exige nada (o contrato de sempre).
 */
export function exigirFiltroDoCliente(
  ctx: Pick<ApiKeyContext, 'funis'>,
  temFiltro: boolean,
  parametro = "'contact_id'"
): void {
  if (funisDaChave(ctx) && !temFiltro) {
    throw badRequest(
      `This API key is limited to selected pipelines: ${parametro} is required on this endpoint`
    );
  }
}
