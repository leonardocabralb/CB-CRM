import { describe, expect, it } from 'vitest';
import {
  decidirSemConversa,
  ehRecontagemDaEspera,
  quandoNoEscritorio,
  ultimaMensagemDoContato,
} from './sem-conversa';

// Instantes UTC explícitos (Brasília = UTC-3).
const DIA = 86_400_000;
const AGORA = new Date('2026-10-03T17:20:00Z'); // 03/10 14:20 em Brasília

describe('quandoNoEscritorio', () => {
  it('escreve o instante no fuso do escritório, dia/mês hora:minuto', () => {
    expect(quandoNoEscritorio(AGORA)).toBe('03/10 14:20');
    // 01:30 UTC ainda é o dia anterior em Brasília.
    expect(quandoNoEscritorio(new Date('2026-10-04T01:30:00Z'))).toBe('03/10 22:30');
  });
});

describe('decidirSemConversa', () => {
  const base = { amount: 15, unit: 'days', duracaoMs: 15 * DIA, agora: AGORA };

  it('na CHEGADA espera N a partir de agora, sem olhar a conversa', () => {
    const d = decidirSemConversa({ ...base, recontagem: null });
    expect(d.tipo).toBe('espera');
    if (d.tipo !== 'espera') return;
    expect(d.ate.toISOString()).toBe('2026-10-18T17:20:00.000Z');
    expect(d.nota).toBe('15 dias sem conversa: aguarda até 18/10 14:20');
  });

  it('na recontagem, conversa há menos de N: espera até completar N desde a última mensagem', () => {
    const ultima = new Date('2026-10-01T12:00:00Z'); // 01/10 09:00
    const d = decidirSemConversa({ ...base, recontagem: { ultima } });
    expect(d.tipo).toBe('espera');
    if (d.tipo !== 'espera') return;
    expect(d.ate.toISOString()).toBe('2026-10-16T12:00:00.000Z');
    expect(d.nota).toBe('houve conversa em 01/10 09:00; aguarda até 16/10 09:00');
  });

  it('na recontagem, a última mensagem há N ou mais: segue', () => {
    const ultima = new Date(AGORA.getTime() - 15 * DIA);
    const d = decidirSemConversa({ ...base, recontagem: { ultima } });
    expect(d).toEqual({ tipo: 'segue', nota: 'sem conversa desde 18/09 14:20 (15 dias); segue' });
  });

  it('na recontagem, sem mensagem nenhuma na conversa: segue', () => {
    expect(decidirSemConversa({ ...base, recontagem: { ultima: null } })).toEqual({
      tipo: 'segue',
      nota: 'nenhuma mensagem na conversa; segue',
    });
  });

  it('mensagem com o relógio do aparelho ADIANTADO conta como agora: nunca segue antes, nunca espera além de N', () => {
    for (const adiantada of [60_000, 365 * DIA]) {
      const d = decidirSemConversa({ ...base, recontagem: { ultima: new Date(AGORA.getTime() + adiantada) } });
      expect(d.tipo).toBe('espera');
      if (d.tipo !== 'espera') return;
      expect(d.ate.getTime()).toBe(AGORA.getTime() + 15 * DIA);
    }
  });

  it('singular e outras unidades na nota', () => {
    const d = decidirSemConversa({ amount: 1, unit: 'hours', duracaoMs: 3_600_000, agora: AGORA, recontagem: null });
    expect(d.nota).toBe('1 hora sem conversa: aguarda até 03/10 15:20');
  });
});

describe('ehRecontagemDaEspera', () => {
  const ctx = { _passo_da_fila: { id: 'espera-1', pos: 0 } };

  it('é a recontagem só DENTRO de uma retomada estacionada por ESTE passo', () => {
    expect(ehRecontagemDaEspera(ctx, 'espera-1', 'pend-1')).toBe(true);
  });

  it('execução nova (sem espera em curso) é chegada, mesmo com a chave velha no contexto', () => {
    expect(ehRecontagemDaEspera(ctx, 'espera-1', null)).toBe(false);
    expect(ehRecontagemDaEspera(ctx, 'espera-1', undefined)).toBe(false);
  });

  it('retomada de OUTRA espera é chegada a esta', () => {
    expect(ehRecontagemDaEspera(ctx, 'espera-2', 'pend-1')).toBe(false);
  });

  it('contexto sem a chave ou estranho é chegada', () => {
    expect(ehRecontagemDaEspera({}, 'espera-1', 'pend-1')).toBe(false);
    expect(ehRecontagemDaEspera(null, 'espera-1', 'pend-1')).toBe(false);
    expect(ehRecontagemDaEspera({ _passo_da_fila: 'espera-1' }, 'espera-1', 'pend-1')).toBe(false);
  });
});

describe('ultimaMensagemDoContato', () => {
  type Resposta = { data: unknown; error: { message: string } | null };
  /** Banco falso: devolve as respostas na ordem das consultas e guarda os filtros. */
  function banco(respostas: Resposta[]) {
    const chamadas: Array<{ tabela: string; ops: unknown[][] }> = [];
    const db = {
      from(tabela: string) {
        const ops: unknown[][] = [];
        chamadas.push({ tabela, ops });
        const q = {
          select: (...a: unknown[]) => (ops.push(['select', ...a]), q),
          eq: (...a: unknown[]) => (ops.push(['eq', ...a]), q),
          in: (...a: unknown[]) => (ops.push(['in', ...a]), q),
          order: (...a: unknown[]) => (ops.push(['order', ...a]), q),
          limit: (...a: unknown[]) => (ops.push(['limit', ...a]), q),
          then: (resolve: (r: Resposta) => unknown) => resolve(respostas.shift() as Resposta),
        };
        return q;
      },
    };
    return { db: db as never, chamadas };
  }

  it('lê as conversas do contato NA CONTA e a mensagem mais recente delas, de qualquer lado', async () => {
    const { db, chamadas } = banco([
      { data: [{ id: 'conv-1' }, { id: 'conv-2' }], error: null },
      { data: [{ created_at: '2026-10-01T12:00:00+00:00' }], error: null },
    ]);
    const r = await ultimaMensagemDoContato(db, 'acct-1', 'c1');
    expect(r).toEqual(new Date('2026-10-01T12:00:00Z'));
    expect(chamadas[0].ops).toEqual(
      expect.arrayContaining([
        ['eq', 'account_id', 'acct-1'],
        ['eq', 'contact_id', 'c1'],
      ])
    );
    expect(chamadas[1].tabela).toBe('messages');
    expect(chamadas[1].ops).toEqual(
      expect.arrayContaining([
        ['in', 'conversation_id', ['conv-1', 'conv-2']],
        ['order', 'created_at', { ascending: false }],
        ['limit', 1],
      ])
    );
    // Nenhum recorte por quem mandou: cliente, equipe, robô e ligação contam.
    expect(chamadas[1].ops.filter((o) => o[0] === 'eq')).toEqual([]);
  });

  it('sem conversa, ou conversa sem mensagem: null', async () => {
    expect(await ultimaMensagemDoContato(banco([{ data: [], error: null }]).db, 'acct-1', 'c1')).toBeNull();
    expect(
      await ultimaMensagemDoContato(
        banco([
          { data: [{ id: 'conv-1' }], error: null },
          { data: [], error: null },
        ]).db,
        'acct-1',
        'c1'
      )
    ).toBeNull();
    expect(await ultimaMensagemDoContato(banco([]).db, 'acct-1', null)).toBeNull();
  });

  it('leitura que falha é "erro", nunca "sem mensagem"', async () => {
    expect(
      await ultimaMensagemDoContato(banco([{ data: null, error: { message: 'x' } }]).db, 'acct-1', 'c1')
    ).toBe('erro');
    expect(
      await ultimaMensagemDoContato(
        banco([
          { data: [{ id: 'conv-1' }], error: null },
          { data: null, error: { message: 'y' } },
        ]).db,
        'acct-1',
        'c1'
      )
    ).toBe('erro');
  });
});
