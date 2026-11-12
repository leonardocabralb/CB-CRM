// ============================================================
// "O lead depois desta conversa" (Playground, 10/11/2026): a SOMA do que o
// agente teria feito no CRM ao longo da conversa de teste — a etapa em que o
// card terminaria, as etiquetas, os campos (o último valor de cada um), as
// tarefas, as automações, a reunião e se a conversa terminaria com a equipe
// ou com outro agente. Puro: deriva das respostas que a tela já tem (nada é
// lido nem gravado), e só das ações ACEITAS — as recusadas não aconteceriam.
// ============================================================

import { ACAO_TRANSFERIR } from '@/lib/ia-agentes/acoes';
import type { AcoesSimuladas } from './tipos';

/** O que uma resposta do agente traz para a soma (o resto da bolha não importa aqui). */
export interface RespostaParaOLead {
  role: 'user' | 'assistant';
  acoes?: AcoesSimuladas;
  /** A conversa iria para gente (o sentinela, a resposta vazia, passagem inválida). */
  handoff?: boolean;
  /** Passaria a conversa para este agente (D25). */
  passaPara?: string;
  /** Na produção a resposta seria RETIDA (pedido vazado, link inventado, reunião ou ação prometida) e iria para gente. */
  retida?: boolean;
}

/** Em que resposta do agente (1, 2, 3…) aquilo teria acontecido. */
type Origem = { resposta: number };

export interface EstadoDoLead {
  etapa: ({ nome: string } & Origem) | null;
  etiquetas: Array<{ nome: string; mudanca: 'aplicada' | 'retirada' } & Origem>;
  campos: Array<{ nome: string; valor: string } & Origem>;
  tarefas: Array<{ nome: string; valor?: string } & Origem>;
  automacoes: Array<{ nome: string } & Origem>;
  reunioes: Array<{ nome: string; valor?: string } & Origem>;
  /** Com quem a conversa terminaria; nulo = continua com este agente. */
  atendimento: ({ tipo: 'equipe' | 'agente'; agente?: string; retida: boolean } & Origem) | null;
}

/**
 * O nome da opção de etapa vem como "Funil · Etapa" (`opcoesDoAgente`). Na
 * tela, "Funil › Etapa": o "·" já separa as ações umas das outras.
 */
export function nomeDaEtapa(nome: string): string {
  const i = nome.indexOf(' · ');
  return i < 0 ? nome : `${nome.slice(0, i)} › ${nome.slice(i + 3)}`;
}

export function estadoDoLead(turnos: readonly RespostaParaOLead[]): EstadoDoLead {
  let etapa: EstadoDoLead['etapa'] = null;
  const etiquetas = new Map<string, EstadoDoLead['etiquetas'][number]>();
  const campos = new Map<string, EstadoDoLead['campos'][number]>();
  const tarefas: EstadoDoLead['tarefas'] = [];
  const automacoes: EstadoDoLead['automacoes'] = [];
  const reunioes: EstadoDoLead['reunioes'] = [];
  let atendimento: EstadoDoLead['atendimento'] = null;

  let resposta = 0;
  for (const x of turnos) {
    if (x.role !== 'assistant') continue;
    resposta++;
    let transfere = x.handoff === true || x.retida === true;
    for (const a of x.acoes?.aceitas ?? []) {
      switch (a.tipo) {
        case 'mover_etapa':
          etapa = { nome: a.nome, resposta };
          break;
        case 'etiquetar':
        case 'tirar_etiqueta':
          // A última mudança de cada etiqueta vale (aplicar e depois tirar = tirada).
          etiquetas.delete(a.nome);
          etiquetas.set(a.nome, { nome: a.nome, mudanca: a.tipo === 'etiquetar' ? 'aplicada' : 'retirada', resposta });
          break;
        case 'preencher_campo': {
          // O último valor de cada campo vale; a posição é a da primeira vez.
          const valor = a.valor ?? '';
          campos.set(a.nome, { nome: a.nome, valor, resposta });
          break;
        }
        case 'criar_tarefa':
          tarefas.push({ nome: a.nome, ...(a.valor !== undefined ? { valor: a.valor } : {}), resposta });
          break;
        case 'executar_automacao':
          automacoes.push({ nome: a.nome, resposta });
          break;
        case 'marcar_reuniao':
          reunioes.push({ nome: a.nome, ...(a.valor !== undefined ? { valor: a.valor } : {}), resposta });
          break;
        case ACAO_TRANSFERIR:
          transfere = true;
          break;
      }
    }
    if (x.passaPara && !transfere) {
      // A passagem leva o card para a etapa do DESTINO (`passar()` no turno muda
      // funil e etapa): a etapa somada antes não vale mais (Codex, #495).
      etapa = null;
      atendimento = { tipo: 'agente', agente: x.passaPara, retida: false, resposta };
    } else if (transfere) {
      atendimento = { tipo: 'equipe', retida: x.retida === true, resposta };
    }
  }

  return {
    etapa,
    etiquetas: [...etiquetas.values()],
    campos: [...campos.values()],
    tarefas,
    automacoes,
    reunioes,
    atendimento,
  };
}

/** Nada a mostrar ainda: nenhuma ação e a conversa segue com o agente. */
export function leadSemMudanca(e: EstadoDoLead): boolean {
  return (
    e.etapa === null &&
    e.etiquetas.length === 0 &&
    e.campos.length === 0 &&
    e.tarefas.length === 0 &&
    e.automacoes.length === 0 &&
    e.reunioes.length === 0 &&
    e.atendimento === null
  );
}
