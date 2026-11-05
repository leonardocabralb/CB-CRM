// ============================================================
// O estado dos alarmes de conexão (`cb_alarmes_de_conexao`, 1122), lido.
//
// Dois leitores: o passo do ciclo que avisa no sino (`avisar-alarmes.ts`, o
// único que ESCREVE) e a sonda da saúde, que leva os episódios abertos à faixa
// do topo (E1, `health.ts`). A tabela é fechada ao navegador: os dois leem com
// a service role, sempre cercados pela conta.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { DetalheDoAlarme, EstadoDoAlarme, TipoDoAlarme } from './alarmes-no-sino';

const PAGINA_DE_ESTADOS = 1000;

interface LinhaDoEstado {
  channel_id: string;
  tipo: TipoDoAlarme;
  desde: string;
  avisado_em: string | null;
  normalizou_em: string | null;
  devido_em: string | null;
  detalhe: DetalheDoAlarme | null;
}

/**
 * O estado dos alarmes da conta, por `<canal>:<tipo>`. `null` = falhou.
 *
 * ⚠️ Paginado (Codex, #460): o PostgREST corta em 1000 linhas sem avisar, e o
 * estado que faltasse seria lido como "não há" — o aceso tentaria nascer de
 * novo (e perderia para a chave), o normalizado nunca sairia. Página por
 * `range`: só o passo do ciclo escreve aqui, um ciclo por vez, e ele lê antes
 * de escrever. A sonda lê com o ciclo escrevendo: com mais de 1000 linhas na
 * conta, uma linha pode escapar daquela leitura — e volta na seguinte (1 min).
 */
export async function lerEstadosDosAlarmes(
  admin: SupabaseClient,
  accountId: string,
): Promise<Map<string, EstadoDoAlarme> | null> {
  const linhas: LinhaDoEstado[] = [];
  for (let de = 0; ; de += PAGINA_DE_ESTADOS) {
    const { data, error } = await admin
      .from('cb_alarmes_de_conexao')
      .select('channel_id, tipo, desde, avisado_em, normalizou_em, devido_em, detalhe')
      .eq('account_id', accountId)
      .order('channel_id', { ascending: true })
      .order('tipo', { ascending: true })
      .range(de, de + PAGINA_DE_ESTADOS - 1);
    if (error) {
      console.warn('[alarmes] não leu o estado dos alarmes:', error.message);
      return null;
    }
    const lote = (data ?? []) as LinhaDoEstado[];
    linhas.push(...lote);
    if (lote.length < PAGINA_DE_ESTADOS) break;
  }
  const mapa = new Map<string, EstadoDoAlarme>();
  for (const l of linhas) {
    mapa.set(`${l.channel_id}:${l.tipo}`, {
      desdeIso: l.desde,
      avisadoEmIso: l.avisado_em,
      normalizouEmIso: l.normalizou_em,
      devidoEmIso: l.devido_em,
      detalhe: l.detalhe ?? {},
    });
  }
  return mapa;
}
