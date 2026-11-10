import { describe, expect, it } from 'vitest';

import { estadoDoLead, leadSemMudanca, nomeDaEtapa, type RespostaParaOLead } from './estado-do-lead';

const cliente: RespostaParaOLead = { role: 'user' };
const agente = (aceitas: Array<{ tipo: string; nome: string; valor?: string }>, extra: Partial<RespostaParaOLead> = {}) =>
  ({ role: 'assistant', acoes: { aceitas, recusadas: [] }, ...extra }) as RespostaParaOLead;

describe('estadoDoLead — a soma do que o agente teria feito', () => {
  it('conversa sem ação: nada muda, e a conversa segue com o agente', () => {
    const e = estadoDoLead([cliente, { role: 'assistant' }]);
    expect(leadSemMudanca(e)).toBe(true);
  });

  it('conta a resposta do AGENTE (1, 2…) em que cada coisa aconteceu', () => {
    const e = estadoDoLead([
      cliente,
      agente([]),
      cliente,
      agente([
        { tipo: 'preencher_campo', nome: 'Salário', valor: 'R$ 2.800' },
        { tipo: 'mover_etapa', nome: 'Trabalhista - Comercial · Foi Demitido' },
        { tipo: 'etiquetar', nome: 'Demitida' },
      ]),
    ]);
    expect(e.campos).toEqual([{ nome: 'Salário', valor: 'R$ 2.800', resposta: 2 }]);
    expect(e.etapa).toEqual({ nome: 'Trabalhista - Comercial · Foi Demitido', resposta: 2 });
    expect(e.etiquetas).toEqual([{ nome: 'Demitida', mudanca: 'aplicada', resposta: 2 }]);
    expect(e.atendimento).toBeNull();
  });

  it('o último valor de cada campo vale, na posição da primeira vez; a última etapa vale', () => {
    const e = estadoDoLead([
      agente([
        { tipo: 'preencher_campo', nome: 'A', valor: '1' },
        { tipo: 'preencher_campo', nome: 'B', valor: '2' },
        { tipo: 'mover_etapa', nome: 'Etapa 1' },
      ]),
      agente([
        { tipo: 'preencher_campo', nome: 'A', valor: '3' },
        { tipo: 'mover_etapa', nome: 'Etapa 2' },
      ]),
    ]);
    expect(e.campos.map((c) => `${c.nome}=${c.valor}@${c.resposta}`)).toEqual(['A=3@2', 'B=2@1']);
    expect(e.etapa?.nome).toBe('Etapa 2');
  });

  it('etiqueta aplicada e depois tirada fica TIRADA', () => {
    const e = estadoDoLead([agente([{ tipo: 'etiquetar', nome: 'X' }]), agente([{ tipo: 'tirar_etiqueta', nome: 'X' }])]);
    expect(e.etiquetas).toEqual([{ nome: 'X', mudanca: 'retirada', resposta: 2 }]);
  });

  it('tarefas, automações e reuniões se acumulam', () => {
    const e = estadoDoLead([
      agente([
        { tipo: 'criar_tarefa', nome: 'Ana', valor: 'Ligar' },
        { tipo: 'executar_automacao', nome: 'Boas-vindas' },
        { tipo: 'marcar_reuniao', nome: '28/09/2026 15:15', valor: 'Maria Silva' },
      ]),
      agente([{ tipo: 'criar_tarefa', nome: 'Bia' }]),
    ]);
    expect(e.tarefas).toEqual([
      { nome: 'Ana', valor: 'Ligar', resposta: 1 },
      { nome: 'Bia', resposta: 2 },
    ]);
    expect(e.automacoes).toEqual([{ nome: 'Boas-vindas', resposta: 1 }]);
    expect(e.reunioes).toEqual([{ nome: '28/09/2026 15:15', valor: 'Maria Silva', resposta: 1 }]);
  });

  it('a transferência: o sentinela, o "responda e passe" e a resposta retida', () => {
    expect(estadoDoLead([agente([], { handoff: true })]).atendimento).toEqual({ tipo: 'equipe', retida: false, resposta: 1 });
    expect(estadoDoLead([agente([{ tipo: 'transferir', nome: '' }])]).atendimento).toEqual({
      tipo: 'equipe',
      retida: false,
      resposta: 1,
    });
    expect(estadoDoLead([agente([], { retida: true })]).atendimento).toEqual({ tipo: 'equipe', retida: true, resposta: 1 });
  });

  it('a passagem para outro agente (e a transferência vence a passagem)', () => {
    expect(estadoDoLead([agente([], { passaPara: 'Cobrança' })]).atendimento).toEqual({
      tipo: 'agente',
      agente: 'Cobrança',
      retida: false,
      resposta: 1,
    });
    expect(estadoDoLead([agente([], { passaPara: 'Cobrança', handoff: true })]).atendimento?.tipo).toBe('equipe');
  });

  it('as RECUSADAS não entram (não aconteceriam)', () => {
    const e = estadoDoLead([
      { role: 'assistant', acoes: { aceitas: [], recusadas: [{ tipo: 'preencher_campo', motivo: 'nao_liberada' }] } },
    ]);
    expect(leadSemMudanca(e)).toBe(true);
  });
});

describe('nomeDaEtapa', () => {
  it('"Funil · Etapa" vira "Funil › Etapa"; sem funil, fica igual', () => {
    expect(nomeDaEtapa('Trabalhista - Comercial · Foi Demitido')).toBe('Trabalhista - Comercial › Foi Demitido');
    expect(nomeDaEtapa('Proposta')).toBe('Proposta');
  });
});
