import { describe, expect, it } from 'vitest';
import type { Automation, CbAutomationEvent } from '@/types';

import { triggerMatches } from './engine';
import { contextoDoEvento, motivoParaNaoDisparar } from './drain-events';

// ------------------------------------------------------------
// Gatilho de funil (migration 933).
//
// Duas regras que parecem detalhe e não são:
//   - config VAZIA = qualquer etapa (convenção do projeto para escopo vazio);
//   - contexto sem etapa = NÃO casa (falha fechada), ao contrário do escopo
//     de canal, que deixa passar. A pergunta aqui é "entrou nesta etapa?", e
//     a resposta honesta para um disparo sem etapa é não.
// ------------------------------------------------------------

const auto = (
  trigger_type: Automation['trigger_type'],
  trigger_config: Record<string, unknown>,
): Automation =>
  ({ id: 'a1', trigger_type, trigger_config }) as unknown as Automation;

describe('triggerMatches — deal_stage_changed', () => {
  it('config vazia casa com QUALQUER etapa', () => {
    // "toda vez que um card se mexer, avise o responsável" é regra legítima,
    // e listar as 9 etapas para exprimi-la seria absurdo.
    expect(
      triggerMatches(auto('deal_stage_changed', {}), { to_stage_id: 'st-proposta' }),
    ).toBe(true);
    expect(
      triggerMatches(auto('deal_stage_changed', { stage_ids: [] }), {
        to_stage_id: 'st-proposta',
      }),
    ).toBe(true);
  });

  it('CRÍTICO: casa só na etapa listada', () => {
    const a = auto('deal_stage_changed', { stage_ids: ['st-proposta'] });
    expect(triggerMatches(a, { to_stage_id: 'st-proposta' })).toBe(true);
    expect(triggerMatches(a, { to_stage_id: 'st-descarte' })).toBe(false);
  });

  it('casa em qualquer uma de várias etapas', () => {
    const a = auto('deal_stage_changed', { stage_ids: ['st-a', 'st-b'] });
    expect(triggerMatches(a, { to_stage_id: 'st-b' })).toBe(true);
  });

  it('contexto SEM etapa não casa — falha fechada, ao contrário do escopo', () => {
    const a = auto('deal_stage_changed', { stage_ids: ['st-proposta'] });
    expect(triggerMatches(a, {})).toBe(false);
    expect(triggerMatches(a, { to_stage_id: null })).toBe(false);
  });
});

describe('triggerMatches — deal_status_changed', () => {
  it('config vazia casa com qualquer status', () => {
    expect(
      triggerMatches(auto('deal_status_changed', {}), { to_status: 'won' }),
    ).toBe(true);
  });

  it('casa só no status listado', () => {
    const a = auto('deal_status_changed', { statuses: ['won'] });
    expect(triggerMatches(a, { to_status: 'won' })).toBe(true);
    expect(triggerMatches(a, { to_status: 'lost' })).toBe(false);
  });
});

// ------------------------------------------------------------
// Drenagem da fila
// ------------------------------------------------------------

const evento = (over: Partial<CbAutomationEvent> = {}): CbAutomationEvent =>
  ({
    id: 'e1',
    account_id: 'acc1',
    tipo: 'deal_stage_changed',
    deal_id: 'deal-1',
    contact_id: 'c1',
    channel_id: 'ch-1',
    from_pipeline_id: null,
    to_pipeline_id: 'pl-1',
    from_stage_id: 'st-antes',
    to_stage_id: 'st-depois',
    from_status: null,
    to_status: null,
    origem: 'usuario',
    criado_em: new Date('2026-08-03T12:00:00Z').toISOString(),
    processado_em: null,
    tentativas: 0,
    erro: null,
    ...over,
  }) as CbAutomationEvent;

describe('contextoDoEvento', () => {
  it('leva o card EXATO, para a ação não ter de adivinhar qual negócio', () => {
    // Sem `deal_id` no contexto, uma ação de funil teria de escolher entre os
    // negócios abertos do contato — e escolheria errado quando há mais de um.
    expect(contextoDoEvento(evento())).toEqual({
      channel_id: 'ch-1',
      deal_id: 'deal-1',
      to_stage_id: 'st-depois',
      from_stage_id: 'st-antes',
      to_status: null,
    });
  });

  it('card CRIADO na etapa vem sem etapa de origem', () => {
    const ctx = contextoDoEvento(evento({ from_stage_id: null }));
    expect(ctx.from_stage_id).toBeNull();
    expect(ctx.to_stage_id).toBe('st-depois');
  });

  it('canal nulo é preservado — o escopo deixa passar, como todo disparo sem canal', () => {
    expect(contextoDoEvento(evento({ channel_id: null })).channel_id).toBeNull();
  });
});

describe('motivoParaNaoDisparar', () => {
  const agora = new Date('2026-08-03T12:10:00Z').getTime();

  it('evento fresco dispara', () => {
    expect(motivoParaNaoDisparar(evento(), agora)).toBeNull();
  });

  it('CRÍTICO: evento velho NÃO dispara — não despeja fila represada', () => {
    // Agendador fora do ar por horas + conserto mandaria de madrugada a
    // mensagem do card que se moveu ontem de manhã. A mesma guarda que a
    // mensagem agendada (925) já tem.
    const velho = motivoParaNaoDisparar(
      evento({ criado_em: new Date('2026-08-02T12:00:00Z').toISOString() }),
      agora,
    );
    expect(velho).toContain('atrasado');
    expect(velho).toContain('24h');
  });

  it('exatamente no limite de 1h ainda dispara', () => {
    const noLimite = motivoParaNaoDisparar(
      evento({ criado_em: new Date('2026-08-03T11:11:00Z').toISOString() }),
      agora,
    );
    expect(noLimite).toBeNull();
  });

  it('evento sem contato não dispara — não há a quem responder', () => {
    // Card de conversa de grupo, ou card cujo contato foi apagado (a FK é
    // SET NULL). O motor exige contato para qualquer passo que mande mensagem.
    expect(motivoParaNaoDisparar(evento({ contact_id: null }), agora)).toContain(
      'sem contato',
    );
  });
});
