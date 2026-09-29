// ============================================================
// Etapas recomendadas: para onde o botão "avançar" do painel da conversa
// leva o card (decisão do operador, 29/09/2026).
//
// - Com `proximas_etapas` preenchida na etapa (Gerenciar funil, migration
//   1061), vale a escolha À MÃO, na ordem gravada: a primeira é o botão
//   principal, as outras viram links. Lista vazia = nenhuma (o botão some).
// - Sem escolha (NULL), o AUTOMÁTICO: as etapas PARA A FRENTE (posição
//   maior, no mesmo funil) mais usadas nos últimos 30 dias, com pelo menos
//   `MINIMO_DE_MOVIMENTOS`. ⚠️ Para trás nunca: a primeira versão (o preview
//   de 28/09) sugeria voltar de MQL 2 para Reunião Agendada, e o operador a
//   devolveu — "na prática, dificilmente ocorreria". Quem precisa de um
//   caminho para trás (No Show → Reunião Agendada) escolhe à mão.
//
// ⚠️ Etapa de PERDA (`resultado = 'perdido'`) nunca vira o botão principal
// do automático: vai para os links, depois das outras. "Avançar" é
// progresso; com só perda na lista, o botão some e ficam os links ("Mover
// para …"). E etapa de ganho ou perda não recomenda nada no automático — o
// negócio acabou ali (o ganho que segue para o Jurídico muda de FUNIL, e o
// botão move dentro do funil).
//
// Puro: quem busca os movimentos (`cb_movimentos_entre_etapas`, 1061) e
// quem desenha ficam fora. Os movimentos vêm contados por `occurred_at` —
// ver a migration.
// ============================================================

/** Janela do automático, em dias. É o que a tela de funis diz ao operador. */
export const JANELA_DO_AUTOMATICO_DIAS = 30;

/**
 * Movimentos mínimos para uma etapa entrar no automático. Um só é ruído
 * (medido em 29/09: "Contato Avulso → Proposta Realizada", 1 vez em 30 dias,
 * ao lado de "→ MQL 1", 38 vezes).
 */
export const MINIMO_DE_MOVIMENTOS = 2;

/** Botão principal + links. O visual escolhido tem um botão e dois links. */
export const MAXIMO_DE_OPCOES = 3;

export interface EtapaDoFunil {
  id: string;
  pipeline_id: string;
  position: number;
  resultado?: string | null;
  proximas_etapas?: string[] | null;
}

/** Uma linha de `cb_movimentos_entre_etapas`. */
export interface Movimento {
  de: string;
  para: string;
  vezes: number;
}

export interface Recomendacao {
  /** O botão principal; `null` = só links ("Mover para …"). */
  principal: string | null;
  /** Os links, na ordem. */
  outras: string[];
  origem: 'manual' | 'automatico';
}

const ehPerda = (etapa: EtapaDoFunil) => etapa.resultado === 'perdido';

/**
 * O que o botão oferece para um card em `atual`. `null` = nada (o botão não
 * aparece).
 *
 * @param etapas as etapas conhecidas (de qualquer funil — só as do funil de
 *   `atual` entram).
 * @param movimentos os movimentos do funil na janela, ou `null` quando ainda
 *   não carregaram ou a leitura falhou: o automático não afirma nada sem
 *   eles (a escolha à mão não precisa).
 */
export function recomendarEtapas(
  atual: EtapaDoFunil,
  etapas: EtapaDoFunil[],
  movimentos: Movimento[] | null,
): Recomendacao | null {
  const doFunil = new Map(
    etapas
      .filter((e) => e.pipeline_id === atual.pipeline_id && e.id !== atual.id)
      .map((e) => [e.id, e]),
  );

  if (Array.isArray(atual.proximas_etapas)) {
    const escolhidas = [...new Set(atual.proximas_etapas)]
      .filter((id) => doFunil.has(id))
      .slice(0, MAXIMO_DE_OPCOES);
    if (escolhidas.length === 0) return null;
    return { principal: escolhidas[0], outras: escolhidas.slice(1), origem: 'manual' };
  }

  if (atual.resultado || movimentos === null) return null;

  const candidatas = movimentos
    .filter((m) => m.de === atual.id && m.vezes >= MINIMO_DE_MOVIMENTOS)
    .map((m) => ({ etapa: doFunil.get(m.para), vezes: m.vezes }))
    .filter(
      (c): c is { etapa: EtapaDoFunil; vezes: number } =>
        c.etapa !== undefined && c.etapa.position > atual.position,
    )
    .sort(
      (a, b) =>
        Number(ehPerda(a.etapa)) - Number(ehPerda(b.etapa)) ||
        b.vezes - a.vezes ||
        a.etapa.position - b.etapa.position,
    )
    .slice(0, MAXIMO_DE_OPCOES)
    .map((c) => c.etapa);

  if (candidatas.length === 0) return null;
  const principal = ehPerda(candidatas[0]) ? null : candidatas[0].id;
  return {
    principal,
    outras: candidatas.slice(principal ? 1 : 0).map((e) => e.id),
    origem: 'automatico',
  };
}

/** A recomendação como lista ordenada — o formato de `proximas_etapas`. */
export function emLista(recomendacao: Recomendacao | null): string[] {
  if (!recomendacao) return [];
  return recomendacao.principal
    ? [recomendacao.principal, ...recomendacao.outras]
    : [...recomendacao.outras];
}
