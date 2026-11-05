// ============================================================
// Os alarmes de conexão ABERTOS da sentinela da VPS (1123), lidos para o
// botão das conexões do cabeçalho (E1, Fase 4 dos alarmes de conexão). Quem
// grava é a sentinela (`ops/vps/saude-whatsapp/sentinela.py`), a cada
// execução; aqui só se lê, com a service role, cercado pela conta.
//
// ⚠️ Linha não confirmada há mais de `VALIDADE_DO_ALARME_DA_SENTINELA_MS` não
// vale: a sentinela roda de hora em hora, e parada (ou com a VPS fora do ar)
// não deixa alarme preso no botão.
//
// ⚠️ Só existe na NOSSA VPS: em qualquer outra instalação a tabela vem vazia.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** As chaves do CHECK da 1123 (o prefixo da chave da sentinela, sem a instância). */
export const CHAVES_DA_SENTINELA = ['sem_entrada', 'nao_gravadas', 'falhas', 'quedas'] as const;
export type ChaveDaSentinela = (typeof CHAVES_DA_SENTINELA)[number];

/** Três execuções da sentinela: uma ou duas perdidas não apagam o alarme. */
export const VALIDADE_DO_ALARME_DA_SENTINELA_MS = 3 * 60 * 60_000;

export interface AlarmeDaSentinela {
  chave: ChaveDaSentinela;
  desdeIso: string;
}

const PAGINA = 1000;

function ehChave(valor: string): valor is ChaveDaSentinela {
  return (CHAVES_DA_SENTINELA as readonly string[]).includes(valor);
}

/**
 * Os alarmes abertos da conta, por conexão. `null` = a leitura falhou ("não
 * sei"). Paginado por `range`: o PostgREST corta em 1000 linhas sem avisar.
 */
export async function lerAlarmesDaSentinela(
  admin: SupabaseClient,
  accountId: string,
  agoraMs: number,
): Promise<Map<string, AlarmeDaSentinela[]> | null> {
  const corte = new Date(agoraMs - VALIDADE_DO_ALARME_DA_SENTINELA_MS).toISOString();
  const porConexao = new Map<string, AlarmeDaSentinela[]>();
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from('cb_alarmes_da_sentinela')
      .select('channel_id, chave, desde')
      .eq('account_id', accountId)
      .gte('visto_em', corte)
      .order('channel_id', { ascending: true })
      .order('chave', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) {
      console.warn('[alarmes] não leu os alarmes da sentinela:', error.message);
      return null;
    }
    const lote = (data ?? []) as { channel_id: string; chave: string; desde: string }[];
    for (const linha of lote) {
      if (!ehChave(linha.chave)) continue;
      const lista = porConexao.get(linha.channel_id) ?? [];
      lista.push({ chave: linha.chave, desdeIso: linha.desde });
      porConexao.set(linha.channel_id, lista);
    }
    if (lote.length < PAGINA) break;
  }
  return porConexao;
}
