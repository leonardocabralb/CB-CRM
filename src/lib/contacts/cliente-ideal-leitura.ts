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
