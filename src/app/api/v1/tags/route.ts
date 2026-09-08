// ============================================================
// GET /api/v1/tags — o catálogo de tags da conta (scope: contacts:read)
//
// Existe porque `POST /api/v1/contacts/{id}/tags` trabalha por NOME, e
// quem integra precisa de alguma forma de ver quais nomes existem —
// sem isso, a única maneira de descobrir o catálogo seria abrir o
// dashboard e ler a tela.
//
// Escopo `contacts:read` em vez de um `tags:read` próprio: tag só
// existe para etiquetar contato, e uma chave que lê contato já recebe
// as tags dele embutidas em `GET /api/v1/contacts`. Um escopo a mais
// não esconderia nada.
//
// Não paginado: o catálogo é de dezenas de linhas, não de milhares (a
// tabela não tem UNIQUE em `name`, mas o operador é quem cria).
// Ordem ALFABÉTICA, estável — é a mesma régua das outras listas planas
// da v1.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ApiError, ok, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');

    const { data, error } = await ctx.supabase
      .from('tags')
      .select('id, name, color')
      .eq('account_id', ctx.accountId)
      .order('name');

    if (error) {
      console.error('[api/v1/tags] list error:', error);
      throw new ApiError('internal', 'Failed to list tags', 500);
    }

    return ok(data ?? []);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
