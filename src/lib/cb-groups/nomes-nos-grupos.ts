// ------------------------------------------------------------
// Os nomes de quem está em cada grupo (1126): a busca da caixa de entrada
// acha o grupo pelo nome de um participante.
//
// ⚠️ São os nomes que o CRM SABE — os clientes com ficha ligados ao grupo e o
// nome com que cada pessoa escreveu nele —, nunca a lista inteira, que não é
// guardada (`.claude/rules/grupos.md`). Quem nunca escreveu e não tem ficha
// não é achado.
//
// PAGINADA pelo grupo: o PostgREST corta em 1000 linhas sem avisar. `null` =
// a leitura falhou ("não sei"), nunca mapa vazio.
// ------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';

const PAGINA = 1000;

export type NomesNosGrupos = ReadonlyMap<string, readonly string[]>;

export async function lerNomesNosGrupos(
  supabase: SupabaseClient,
  conta: string,
): Promise<Map<string, string[]> | null> {
  const mapa = new Map<string, string[]>();
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .rpc('cb_nomes_nos_grupos', { p_conta: conta })
      .order('group_id')
      .range(de, de + PAGINA - 1);
    if (error) {
      console.warn('[grupos] não deu para ler os nomes de quem está nos grupos:', error.message);
      return null;
    }
    const linhas = (data ?? []) as { group_id: string; nomes: string[] | null }[];
    for (const l of linhas) {
      if (l.group_id && Array.isArray(l.nomes)) mapa.set(l.group_id, l.nomes);
    }
    if (linhas.length < PAGINA) return mapa;
  }
}
