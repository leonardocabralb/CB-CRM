// ============================================================
// O PRAZO do conteúdo dos turnos dos agentes de IA (1110; DC2 do operador,
// 26/10/2026) e a poda que o aplica.
//
// O turno (`cb_ia_turnos`) tem duas camadas: o ESQUELETO (agente, conexão,
// card, desfecho, ações sem valor, tokens, ids), que fica sem prazo, e o
// CONTEÚDO com texto do cliente (o retrato, a saída do modelo, o texto do
// desfecho, o valor e o detalhe cru das ações), que sai depois de
// `PRAZO_DO_CONTEUDO_DO_TURNO_DIAS` — e também na exclusão definitiva da
// ficha (a Lixeira, DC3), pelo banco.
//
// Quem decide o que limpar é o BANCO (`cb_ia_podar_conteudo_dos_turnos`, só
// do service_role): um lote por chamada, só turnos TERMINADOS, mais velhos
// que o prazo, ainda com o conteúdo. Aqui fica o laço sob o prazo do ciclo de
// manutenção das agendadas (`manutencao-do-ciclo.ts`) — sem rota nova nem
// mudança no agendador.
//
// ⚠️ NUNCA LANÇA: roda no `after()`, depois da resposta. O supabase-js
// DEVOLVE `error`; o resultado fora da forma PARA o laço (repetir giraria em
// falso até o prazo).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Por quantos dias o texto do cliente fica no registro do turno (DC2: 90,
 * o prazo da Lixeira; subir para 180 é trocar esta constante). O esqueleto
 * não tem prazo. A tela da aba Turnos diz o número daqui, nunca um fixo no
 * dicionário.
 */
export const PRAZO_DO_CONTEUDO_DO_TURNO_DIAS = 90;

/** Turnos por chamada da poda (o teto da função é 1.000). */
export const TURNOS_POR_LOTE_DA_PODA = 200;

export interface ResultadoDaPoda {
  /** Turnos que perderam o conteúdo neste ciclo. */
  limpos: number;
  /** Motivo, quando a poda parou no meio. */
  erro: string | null;
}

/**
 * Limpa o conteúdo dos turnos vencidos, um lote por chamada, até sobrar
 * menos que um lote ou estourar o `prazo` (instante, em ms). O que sobrar sai
 * no ciclo seguinte.
 */
export async function podarConteudoDosTurnos(
  admin: SupabaseClient,
  prazo: number
): Promise<ResultadoDaPoda> {
  let limpos = 0;
  try {
    while (Date.now() < prazo) {
      const { data, error } = await admin.rpc(
        'cb_ia_podar_conteudo_dos_turnos',
        {
          p_dias: PRAZO_DO_CONTEUDO_DO_TURNO_DIAS,
          p_limite: TURNOS_POR_LOTE_DA_PODA,
        }
      );
      if (error) throw new Error(error.message);
      if (typeof data !== 'number' || !Number.isInteger(data) || data < 0) {
        throw new Error(
          `a poda devolveu ${JSON.stringify(data)?.slice(0, 120)}`
        );
      }
      limpos += data;
      if (data < TURNOS_POR_LOTE_DA_PODA) break;
    }
    if (limpos > 0)
      console.log(
        `[ia-agentes] poda: o conteúdo de ${limpos} turno(s) saiu pelo prazo`
      );
    return { limpos, erro: null };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'erro desconhecido';
    console.error('[ia-agentes] poda do conteúdo dos turnos falhou:', motivo);
    return { limpos, erro: motivo };
  }
}
