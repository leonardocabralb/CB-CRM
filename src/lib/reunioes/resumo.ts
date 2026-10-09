import { ehResultado, type ReuniaoDaPauta, type Resultado } from './pauta';

/**
 * As reuniões que o DESEMPENHO do funil conta (Fase 4 de
 * `docs/PLANO-reagendamento.md`; D4/D5 do operador, 09/10/2026): cada reunião
 * que já começou vira uma linha SEM dado do cliente — quando foi, em que funil
 * o card estava naquele instante e o resultado. A conta por período e por funil
 * mora em `src/lib/funil/comparecimento.ts`, no navegador.
 *
 * ⚠️ O resultado é o da PAUTA, nunca uma cópia: a rota monta a pauta com a
 * mesma carga (`carregar.ts`) e a mesma régua (`montarPauta` →
 * `resultadoDaReuniao`). Uma régua só para cada tela faria a pauta e o
 * Desempenho discordarem sobre a mesma reunião.
 *
 * Puro.
 */

/** Uma reunião que já começou, como o Desempenho a conta. */
export interface ReuniaoDoResumo {
  inicio: string;
  /**
   * O funil em que o card da reunião estava no INÍCIO dela (`funilNoInstante`);
   * nulo = reunião sem card, ou card sem passo na trilha até lá.
   */
  funil: string | null;
  /** O resultado pela régua da pauta; nulo = sem resultado. */
  resultado: Resultado | null;
}

/** Uma entrada do negócio num funil (`deal_created`, `stage_changed`, `pipeline_changed`). */
export interface PassoDeFunil {
  id: string;
  em: string;
  funil: string | null;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const v = Date.parse(iso);
  return Number.isNaN(v) ? null : v;
}

/**
 * O funil do negócio no instante: o destino da última entrada até ele, na
 * ordem da RPC do funil (`occurred_at`, depois `id`).
 *
 * ⚠️ Nunca o `deals.pipeline_id` de hoje: o negócio transferido continua
 * contando no funil de ORIGEM (regra do funil comercial — "fechou → transfere
 * para o Jurídico → continua ganho"); pelo funil de hoje, a reunião do cliente
 * que fechou e foi para o Jurídico sumiria do Comercial. E `occurred_at`,
 * nunca `created_at`: a carga da Kommo gravou o passado depois do fato.
 */
export function funilNoInstante(passos: readonly PassoDeFunil[], instante: string): string | null {
  const limite = ms(instante);
  if (limite === null) return null;
  let melhor: PassoDeFunil | null = null;
  let melhorMs = -Infinity;
  for (const p of passos) {
    const em = ms(p.em);
    if (em === null || em > limite) continue;
    if (em > melhorMs || (em === melhorMs && melhor !== null && p.id > melhor.id)) {
      melhor = p;
      melhorMs = em;
    }
  }
  return melhor?.funil ?? null;
}

/**
 * As reuniões da pauta que JÁ COMEÇARAM, cada uma com o funil do card no
 * início dela. A futura fica de fora mesmo com resultado: o Reagendar gravado
 * antes do horário (1081) já a resolve na pauta, e ela entra quando começar.
 */
export function reunioesDoResumo(
  reunioes: readonly ReuniaoDaPauta[],
  passosPorNegocio: ReadonlyMap<string, readonly PassoDeFunil[]>,
  agora: Date,
): ReuniaoDoResumo[] {
  const saida: ReuniaoDoResumo[] = [];
  for (const r of reunioes) {
    const inicio = ms(r.inicio);
    if (inicio === null || inicio > agora.getTime()) continue;
    saida.push({
      inicio: r.inicio,
      funil: r.negocio ? funilNoInstante(passosPorNegocio.get(r.negocio.id) ?? [], r.inicio) : null,
      resultado: r.resultado?.tipo ?? null,
    });
  }
  return saida;
}

/**
 * Confere a resposta da rota no navegador. Forma estranha → `null` ("não
 * sei"), nunca lista vazia: vazio seria lido como "nenhuma reunião".
 */
export function lerResumoDeReunioes(json: unknown): ReuniaoDoResumo[] | null {
  if (!json || typeof json !== 'object') return null;
  const lista = (json as { reunioes?: unknown }).reunioes;
  if (!Array.isArray(lista)) return null;
  const saida: ReuniaoDoResumo[] = [];
  for (const item of lista) {
    if (!item || typeof item !== 'object') return null;
    const r = item as Record<string, unknown>;
    if (typeof r.inicio !== 'string' || ms(r.inicio) === null) return null;
    if (r.funil !== null && typeof r.funil !== 'string') return null;
    if (r.resultado !== null && !ehResultado(r.resultado)) return null;
    saida.push({ inicio: r.inicio, funil: r.funil, resultado: r.resultado });
  }
  return saida;
}
