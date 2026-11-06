// ------------------------------------------------------------
// Leitura de `cb_clientes_ideais` (1124) pelo navegador.
//
// ⚠️ PAGINADA: o PostgREST corta em 1000 linhas sem avisar, e uma conta com
// mais de mil clientes marcados mostraria contagem e selo pela metade, com
// cara de certo. A função devolve uma linha por contato; a ordem por
// `contact_id` é pedida de fora também, para as páginas não se sobreporem.
// `null` = a leitura falhou ("não sei"), nunca lista vazia.
// ------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ClienteIdeal } from './cliente-ideal';

const PAGINA = 1000;

export async function lerClientesIdeais(
  supabase: SupabaseClient,
  conta: string,
): Promise<ClienteIdeal[] | null> {
  const todos: ClienteIdeal[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .rpc('cb_clientes_ideais', { p_conta: conta })
      .order('contact_id')
      .range(de, de + PAGINA - 1);
    if (error) return null;
    const linhas = (data ?? []) as ClienteIdeal[];
    todos.push(...linhas);
    if (linhas.length < PAGINA) return todos;
  }
}

// ------------------------------------------------------------
// Os NEGÓCIOS dos clientes ideais — o interruptor "Só clientes ideais" do
// quadro do funil (Fase 3).
//
// ⚠️ Pergunta à parte, e só com o interruptor LIGADO: a lista enxuta do quadro
// (`DEAL_SELECT_ENXUTO`) não traz o contato, e pôr `contact_id` nela faria
// TODO funil pagar ~20% a mais por card, em toda carga, por um filtro de uso
// eventual. Aqui vão só os contatos ideais, em lotes (a lista vai na URL do
// `in`), cada lote paginado pelo `id` (o teto de 1000 do PostgREST). De todos
// os funis: o card transferido continua com o mesmo id.
// `null` = a leitura falhou ("não sei"), nunca conjunto vazio.
// ------------------------------------------------------------

/** Contatos por consulta: ~3,7 KB de ids na URL. */
export const CONTATOS_POR_LOTE = 100;

export async function lerNegociosDosContatos(
  supabase: SupabaseClient,
  contatos: readonly string[],
): Promise<Set<string> | null> {
  const ids = new Set<string>();
  for (let i = 0; i < contatos.length; i += CONTATOS_POR_LOTE) {
    const lote = contatos.slice(i, i + CONTATOS_POR_LOTE);
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await supabase
        .from('deals')
        .select('id')
        .in('contact_id', lote)
        .order('id')
        .range(de, de + PAGINA - 1);
      if (error) return null;
      const linhas = (data ?? []) as { id: string }[];
      for (const l of linhas) ids.add(l.id);
      if (linhas.length < PAGINA) break;
    }
  }
  return ids;
}
