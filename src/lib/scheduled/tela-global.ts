// ============================================================
// O recorte da TELA GLOBAL de agendadas (Fase C) — funções puras.
//
// A ordenação já existe e não é reescrita aqui: `ordenarParaTela`, em
// `display.ts`, põe a fila em cima (a mais próxima primeiro) e o acervo
// embaixo (o mais recente primeiro). Este arquivo acrescenta só o que a tela
// global tem e a faixa da conversa não tem: separar por situação e contar
// cada grupo.
// ============================================================

import { estaNaFila } from './display';
import type { ScheduledMessage } from '@/types';

/**
 * Os grupos do filtro.
 *
 * ⚠️ São TRÊS, e não um por `status`, porque `sending` não é uma situação que
 * o operador reconheça — é um estado interno de meio segundo que só fica
 * visível quando algo deu errado. Juntá-lo a `pending` sob "Fila" responde a
 * pergunta que ele faz de verdade: "o que ainda vai sair?".
 */
export type Situacao = 'todas' | 'fila' | 'enviadas' | 'falhas';

export const SITUACOES: readonly Situacao[] = [
  'todas',
  'fila',
  'enviadas',
  'falhas',
] as const;

/**
 * A situação de UMA linha, do jeito que a tela agrupa.
 *
 * ⚠️ `entrega_incerta` NÃO ganha grupo próprio, de propósito. Ela vem sempre
 * junto de `failed` (926: o envio estourou depois de o WhatsApp aceitar), e um
 * quarto grupo com uma linha dentro esconderia justamente o caso que mais
 * precisa de gente — quem procura "o que falhou" tem de encontrá-la ali.
 */
export function situacaoDe(a: ScheduledMessage): Exclude<Situacao, 'todas'> {
  if (estaNaFila(a.status)) return 'fila';
  if (a.status === 'sent') return 'enviadas';
  return 'falhas';
}

/** Recorta a lista pelo grupo escolhido. `todas` não recorta nada. */
export function filtrarPorSituacao(
  lista: readonly ScheduledMessage[],
  situacao: Situacao,
): ScheduledMessage[] {
  if (situacao === 'todas') return [...lista];
  return lista.filter((a) => situacaoDe(a) === situacao);
}

export type ContagemPorSituacao = Record<Situacao, number>;

/**
 * Quantas em cada grupo — os números das abas.
 *
 * ⚠️ Conta sobre a lista INTEIRA que veio do banco, nunca sobre o que está
 * filtrado na tela. Contar o filtrado faria toda aba mostrar o mesmo número da
 * que está aberta, e as outras zerarem — o operador leria "não há falhas"
 * enquanto olha a aba Fila.
 */
export function contarPorSituacao(
  lista: readonly ScheduledMessage[],
): ContagemPorSituacao {
  const c: ContagemPorSituacao = {
    todas: lista.length,
    fila: 0,
    enviadas: 0,
    falhas: 0,
  };
  for (const a of lista) c[situacaoDe(a)] += 1;
  return c;
}

/**
 * Quantas linhas a tela mostra antes de pedir "carregar mais".
 *
 * ⚠️ Diferente da lista de conversas, que carrega tudo de propósito: lá o
 * conjunto é limitado pelo número de clientes (64 hoje) e os filtros rodam em
 * JS sobre ele. Aqui o acervo SÓ CRESCE — cada mensagem enviada fica para
 * sempre —, então carregar tudo é uma conta que piora todo dia.
 */
export const PAGINA = 50;

/**
 * O aviso "a lista tem mais do que isto".
 *
 * ⚠️ Existe porque a alternativa é pior que feia: uma lista cortada em 50 sem
 * nada dizendo tem exatamente a cara de uma lista completa. O operador
 * procuraria uma agendada que existe, não acharia, e concluiria que ela foi
 * apagada.
 */
export function temMais(carregadas: number, limite: number): boolean {
  return carregadas >= limite;
}
