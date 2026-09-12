// ============================================================
// As contagens do Meu dia — puras, para o teste e para a tela não carregar
// regra nenhuma.
//
// Cada bloco reusa a régua da TELA para onde o clique leva, senão o número do
// resumo e o número da tela discordam: conversas pela régua da caixa de
// entrada (`atrasoDeResposta`, 10 min) e pelo recorte do perfil
// (`conversaNoEscopo`); tarefas por `agruparPorPrazo` (chamado direto pelo
// hook — o dia, nunca a hora); novidades por tipo de aviso.
//
// ⚠️ "Sem responsável" é ACERVO, não a urgência do dia: medido em 12/09/2026,
// 235 conversas sem responsável esperavam há mais de 10 min, 234 delas há
// mais de 30. Um "235" fixo toda manhã é o número que o olho aprende a
// pular. Por isso a fila é repartida pelo instante da confirmação anterior:
// quem começou a esperar DEPOIS dela é novidade; o resto é o acumulado, em
// texto apagado.
// ============================================================

import { atrasoDeResposta, type Atraso } from '@/lib/inbox/atraso';
import { conversaNoEscopo } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import type { Conversation, Notification } from '@/types';

/** Quantos itens cada bloco lista antes do "e mais N". */
export const TETO_DE_ITENS = 5;

export function limitar<T>(
  itens: readonly T[],
  teto: number = TETO_DE_ITENS,
): { itens: T[]; restantes: number } {
  return { itens: itens.slice(0, teto), restantes: Math.max(0, itens.length - teto) };
}

// ------------------------------------------------------------
// Novidades desde a última entrada
// ------------------------------------------------------------

export interface Novidades {
  /** `note_mention` — a pessoa foi citada numa anotação interna. */
  mencoes: number;
  /** `task_assigned` + `task_reply` — tarefa encaminhada ou respondida. */
  tarefas: number;
  /** `conversation_assigned`. */
  conversas: number;
  total: number;
}

/**
 * Só o que chegou DEPOIS de `desdeMs` (estrito: o aviso do próprio instante
 * da confirmação já estava na tela quando ela foi confirmada).
 */
export function resumirNovidades(
  avisos: ReadonlyArray<Pick<Notification, 'type' | 'created_at'>>,
  desdeMs: number,
): Novidades {
  const saida: Novidades = { mencoes: 0, tarefas: 0, conversas: 0, total: 0 };
  for (const a of avisos) {
    const em = Date.parse(a.created_at);
    if (Number.isNaN(em) || em <= desdeMs) continue;
    if (a.type === 'note_mention') saida.mencoes++;
    else if (a.type === 'task_assigned' || a.type === 'task_reply') saida.tarefas++;
    else if (a.type === 'conversation_assigned') saida.conversas++;
    else continue;
    saida.total++;
  }
  return saida;
}

// ------------------------------------------------------------
// Conversas
// ------------------------------------------------------------

export interface ConversaEsperando {
  conversa: Conversation;
  atraso: Atraso;
}

/** Mais antiga primeiro: quem espera há mais tempo é quem a pessoa vê primeiro. */
function porEsperaMaisLonga(a: ConversaEsperando, b: ConversaEsperando): number {
  return Date.parse(a.conversa.aguardando_desde!) - Date.parse(b.conversa.aguardando_desde!);
}

function esperando(c: Conversation, agoraMs: number): ConversaEsperando | null {
  const atraso = atrasoDeResposta(c, agoraMs);
  return atraso ? { conversa: c, atraso } : null;
}

export interface ResumoDasConversas {
  /** Abertas + pendentes atribuídas à pessoa, grupos incluídos, no escopo do perfil. */
  atribuidas: number;
  /**
   * Atribuídas num número FORA do perfil (D8/D5 do plano): contadas à parte e
   * sem link — a caixa de entrada as esconde, e omiti-las aqui calaria uma
   * obrigação atribuída à pessoa.
   */
  foraDoPerfil: number;
  /** As do escopo com cliente esperando há 10 min ou mais, mais antiga primeiro. */
  esperando: ConversaEsperando[];
}

export function resumirConversas(
  conversas: readonly Conversation[],
  ctx: ContextoDeAcesso,
  agoraMs: number,
): ResumoDasConversas {
  const saida: ResumoDasConversas = { atribuidas: 0, foraDoPerfil: 0, esperando: [] };
  for (const c of conversas) {
    if (c.status === 'closed') continue;
    if (!conversaNoEscopo(ctx, c)) {
      saida.foraDoPerfil++;
      continue;
    }
    saida.atribuidas++;
    const e = esperando(c, agoraMs);
    if (e) saida.esperando.push(e);
  }
  saida.esperando.sort(porEsperaMaisLonga);
  return saida;
}

// ------------------------------------------------------------
// Fila sem responsável
// ------------------------------------------------------------

export interface ResumoDaFila {
  /** Começaram a esperar depois da última confirmação, mais antiga primeiro. */
  novas: ConversaEsperando[];
  /** Já esperavam antes dela (o acervo). */
  antigas: number;
  /** A espera mais longa de toda a fila no escopo, para a frase do acumulado. */
  maisAntiga: Atraso | null;
}

export function resumirFila(
  conversas: readonly Conversation[],
  ctx: ContextoDeAcesso,
  agoraMs: number,
  desdeMs: number,
): ResumoDaFila {
  const todas: ConversaEsperando[] = [];
  for (const c of conversas) {
    if (c.assigned_agent_id || c.status === 'closed') continue;
    if (!conversaNoEscopo(ctx, c)) continue;
    const e = esperando(c, agoraMs);
    if (e) todas.push(e);
  }
  todas.sort(porEsperaMaisLonga);
  const novas = todas.filter((e) => Date.parse(e.conversa.aguardando_desde!) >= desdeMs);
  return {
    novas,
    antigas: todas.length - novas.length,
    maisAntiga: todas[0]?.atraso ?? null,
  };
}
