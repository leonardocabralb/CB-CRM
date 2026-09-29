'use client';

// ============================================================
// useVistaDaTarefa — marca a tarefa como VISTA quando ela fica na tela do
// RESPONSÁVEL (1068; decisão do operador, 29/09/2026). Devolve um `ref` para
// a linha: ficou 60% visível por 1 s, com a aba à vista, conta.
//
// Quem grava é a rota `POST /api/cb/tasks/vistas`, com a cerca na consulta
// (só a tarefa aberta, ainda não vista, de quem chama). Aqui só se decide
// QUANDO pedir — `contaComoVista` evita mandar o que a rota recusaria.
//
// ⚠️ Estado de MÓDULO, de propósito: um observador para a tela inteira (a
// lista de Tarefas monta dezenas de linhas) e a memória do que já foi
// mandado nesta carga de página — a mesma tarefa aparece na lista e no
// painel da conversa, e cada aparição mandaria de novo. Os ids se juntam
// por `JANELA_DO_LOTE_MS` e saem num pedido só.
//
// ⚠️ A linha não muda na tela quando a rota grava: o destaque de "não lida"
// fica até a próxima carga, e é o certo — a pessoa acabou de chegar e vê o
// que era novo. Quem conta de verdade (a etiqueta do menu, o card da
// equipe) lê o banco.
//
// ⚠️ Aba OCULTA não vê nada: o relógio confere `visibilityState` quando
// vence, e a volta à aba recomeça o relógio de quem já estava na tela (o
// observador não avisa de novo sem rolagem).
// ============================================================

import { useCallback } from 'react';

import {
  contaComoVista,
  FRACAO_VISIVEL,
  IDS_POR_PEDIDO,
  TEMPO_NA_TELA_MS,
  type TarefaParaVista,
} from '@/lib/tasks/vista';

/** Quanto esperar para juntar as linhas que entram na tela juntas. */
const JANELA_DO_LOTE_MS = 1_500;

/** Ids já mandados (ou em voo) nesta carga de página. */
const enviadas = new Set<string>();
const fila = new Set<string>();
let loteAgendado: ReturnType<typeof setTimeout> | null = null;

/** O id da tarefa de cada linha observada. */
const idDoElemento = new Map<Element, string>();
/** Linhas que estão na tela agora (acima da fração). */
const naTela = new Set<Element>();
const relogios = new Map<Element, ReturnType<typeof setTimeout>>();

let observador: IntersectionObserver | null = null;
let ouvindoAVolta = false;

async function mandarLote(): Promise<void> {
  loteAgendado = null;
  const ids = [...fila].slice(0, IDS_POR_PEDIDO);
  for (const id of ids) fila.delete(id);
  if (fila.size > 0) loteAgendado = setTimeout(mandarLote, JANELA_DO_LOTE_MS);
  if (ids.length === 0) return;
  try {
    const r = await fetch('/api/cb/tasks/vistas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    // Falhou: esquece o envio, e a próxima aparição da linha tenta de novo.
    // Nada na tela depende disto — é registro, não estado da linha.
    for (const id of ids) enviadas.delete(id);
    console.warn(
      '[useVistaDaTarefa] não consegui marcar como vista:',
      e instanceof Error ? e.message : e,
    );
  }
}

function enfileirar(id: string): void {
  if (enviadas.has(id)) return;
  enviadas.add(id);
  fila.add(id);
  loteAgendado ??= setTimeout(mandarLote, JANELA_DO_LOTE_MS);
}

function pararRelogio(el: Element): void {
  const r = relogios.get(el);
  if (r) clearTimeout(r);
  relogios.delete(el);
}

function ligarRelogio(el: Element): void {
  if (relogios.has(el)) return;
  relogios.set(
    el,
    setTimeout(() => {
      relogios.delete(el);
      const id = idDoElemento.get(el);
      if (!id || !naTela.has(el)) return;
      if (document.visibilityState !== 'visible') return;
      enfileirar(id);
    }, TEMPO_NA_TELA_MS),
  );
}

function aoVoltarParaAAba(): void {
  if (document.visibilityState !== 'visible') return;
  for (const el of naTela) ligarRelogio(el);
}

function obterObservador(): IntersectionObserver {
  if (observador) return observador;
  observador = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (e.isIntersecting && e.intersectionRatio >= FRACAO_VISIVEL) {
          naTela.add(e.target);
          ligarRelogio(e.target);
        } else {
          naTela.delete(e.target);
          pararRelogio(e.target);
        }
      }
    },
    { threshold: [0, FRACAO_VISIVEL] },
  );
  if (!ouvindoAVolta) {
    document.addEventListener('visibilitychange', aoVoltarParaAAba);
    ouvindoAVolta = true;
  }
  return observador;
}

function soltar(el: Element): void {
  observador?.unobserve(el);
  idDoElemento.delete(el);
  naTela.delete(el);
  pararRelogio(el);
}

/**
 * O `ref` da linha da tarefa. Sem efeito quando a aparição não conta (não é
 * a responsável, já vista, concluída) ou quando o navegador não tem
 * `IntersectionObserver`.
 */
export function useVistaDaTarefa(
  tarefa: TarefaParaVista & { id: string },
  userId: string | null,
): (el: Element | null) => (() => void) | undefined {
  const conta = contaComoVista(tarefa, userId);
  const id = tarefa.id;
  return useCallback(
    (el: Element | null) => {
      if (!el || !conta || enviadas.has(id)) return undefined;
      if (typeof IntersectionObserver === 'undefined') return undefined;
      idDoElemento.set(el, id);
      obterObservador().observe(el);
      return () => soltar(el);
    },
    [conta, id],
  );
}
