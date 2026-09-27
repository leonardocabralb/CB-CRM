import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  CHAVE_DO_PASSO_DA_FILA,
  MOTIVO_PASSO_MOVIDO,
  MOTIVO_PASSO_NAO_CONFERIDO,
  MOTIVO_PASSO_REMOVIDO,
  MOTIVO_RAMO_REMOVIDO,
  comPassoDaFila,
  conferirRetomada,
  decidirRetomada,
  lerPassoDaFila,
  type EsperaNaFila,
} from './retomada';

// ============================================================
// Onde a espera retoma depois que a automação foi EDITADA. O caso que motivou
// (e2e de 26/09/2026): salvar com uma execução parada num "Aguardar" dentro
// de um ramo a desviava para o escopo de fora. O teste de ponta a ponta, com
// a gravação de verdade, está em `engine.test.ts` ("salvar a automação com
// uma espera parada num ramo").
// ============================================================

const espera = (over: Partial<EsperaNaFila> = {}): EsperaNaFila => ({
  parent_step_id: 'cond',
  branch: 'yes',
  next_step_position: 3,
  context: comPassoDaFila({}, { id: 'espera', position: 2 }),
  ...over,
});

describe('comPassoDaFila / lerPassoDaFila', () => {
  it('grava id e posição, e preserva o resto do contexto', () => {
    const ctx = comPassoDaFila({ deal_id: 'd1' }, { id: 'p1', position: 4 });
    expect(ctx).toEqual({ deal_id: 'd1', [CHAVE_DO_PASSO_DA_FILA]: { id: 'p1', pos: 4 } });
    expect(lerPassoDaFila(ctx)).toEqual({ id: 'p1', pos: 4 });
  });

  it('reescreve o passo de uma espera anterior (a chave nunca é herdada)', () => {
    const velho = comPassoDaFila({}, { id: 'antigo', position: 0 });
    expect(lerPassoDaFila(comPassoDaFila(velho, { id: 'novo', position: 5 }))).toEqual({
      id: 'novo',
      pos: 5,
    });
  });

  it('forma estranha vale "não sei" — nunca um palpite', () => {
    const estranhos = [
      null,
      'p1',
      { id: '', pos: 1 },
      { id: 'p1' },
      { id: 'p1', pos: '1' },
      { id: 'p1', pos: -1 },
      { id: 'p1', pos: 1.5 },
    ];
    for (const valor of estranhos) {
      expect(lerPassoDaFila({ [CHAVE_DO_PASSO_DA_FILA]: valor })).toBeNull();
    }
    expect(lerPassoDaFila(null)).toBeNull();
    expect(lerPassoDaFila({})).toBeNull();
  });
});

describe('decidirRetomada', () => {
  it('o passo continua no mesmo lugar: retoma na posição gravada', () => {
    expect(
      decidirRetomada(espera(), { id: 'espera', pos: 2 }, { parent_step_id: 'cond', branch: 'yes', position: 2 })
    ).toEqual({ tipo: 'segue', posicao: 3 });
  });

  it('⚠️ passo inserido ANTES da espera: retoma DEPOIS dela, na posição nova (sem repetir o "Aguardar")', () => {
    expect(
      decidirRetomada(espera(), { id: 'espera', pos: 2 }, { parent_step_id: 'cond', branch: 'yes', position: 4 })
    ).toEqual({ tipo: 'segue', posicao: 5 });
  });

  it('⚠️ passo removido ANTES da espera: não pula a mensagem seguinte', () => {
    expect(
      decidirRetomada(espera(), { id: 'espera', pos: 2 }, { parent_step_id: 'cond', branch: 'yes', position: 0 })
    ).toEqual({ tipo: 'segue', posicao: 1 });
  });

  it('a retentativa (+0) retoma no PRÓPRIO passo, na posição nova', () => {
    const e = espera({ next_step_position: 2 });
    expect(
      decidirRetomada(e, { id: 'espera', pos: 2 }, { parent_step_id: 'cond', branch: 'yes', position: 3 })
    ).toEqual({ tipo: 'segue', posicao: 3 });
  });

  it('o passo SUMIU: para, com o motivo', () => {
    expect(decidirRetomada(espera(), { id: 'espera', pos: 2 }, null)).toEqual({
      tipo: 'parar',
      motivo: MOTIVO_PASSO_REMOVIDO,
      passoId: 'espera',
    });
  });

  it('o passo foi para OUTRO ramo (ou outro escopo): para, com o motivo', () => {
    for (const agora of [
      { parent_step_id: 'cond', branch: 'no' as const, position: 2 },
      { parent_step_id: 'outra', branch: 'yes' as const, position: 2 },
      { parent_step_id: null, branch: null, position: 2 },
    ]) {
      expect(decidirRetomada(espera(), { id: 'espera', pos: 2 }, agora)).toMatchObject({
        tipo: 'parar',
        motivo: MOTIVO_PASSO_MOVIDO,
      });
    }
  });

  it('⚠️⚠️ ramo sem condição (a FK zerou o pai): para — mesmo na espera gravada ANTES desta entrega', () => {
    const orfa = espera({ parent_step_id: null });
    expect(decidirRetomada(orfa, { id: 'espera', pos: 2 }, null)).toMatchObject({
      tipo: 'parar',
      motivo: MOTIVO_RAMO_REMOVIDO,
    });
    expect(decidirRetomada({ ...orfa, context: {} }, null, null)).toMatchObject({
      tipo: 'parar',
      motivo: MOTIVO_RAMO_REMOVIDO,
      passoId: null,
    });
  });

  it('espera gravada antes desta entrega (sem a chave) retoma pela posição, como sempre', () => {
    expect(decidirRetomada(espera({ context: {} }), null, null)).toEqual({ tipo: 'segue', posicao: 3 });
    // O escopo de fora nasce com os dois nulos: não é órfão.
    expect(
      decidirRetomada(espera({ parent_step_id: null, branch: null, context: {} }), null, null)
    ).toEqual({ tipo: 'segue', posicao: 3 });
  });
});

describe('conferirRetomada — a leitura', () => {
  /** Banco falso: `from('automation_steps').select().eq().eq().maybeSingle()`. */
  function banco(resposta: { data?: unknown; error?: { message: string } | null } | 'lança') {
    const filtros: [string, unknown][] = [];
    const db = {
      from: (tabela: string) => {
        expect(tabela).toBe('automation_steps');
        const b = {
          select: () => b,
          eq: (k: string, v: unknown) => (filtros.push([k, v]), b),
          maybeSingle: async () => {
            if (resposta === 'lança') throw new Error('rede');
            return { data: resposta.data ?? null, error: resposta.error ?? null };
          },
        };
        return b;
      },
    };
    return { db: db as unknown as SupabaseClient, filtros };
  }

  it('procura o passo POR AUTOMAÇÃO e id', async () => {
    const { db, filtros } = banco({ data: { parent_step_id: 'cond', branch: 'yes', position: 5 } });
    expect(await conferirRetomada(db, 'auto-1', espera())).toEqual({ tipo: 'segue', posicao: 6 });
    expect(filtros).toEqual([
      ['automation_id', 'auto-1'],
      ['id', 'espera'],
    ]);
  });

  it('⚠️ leitura que falha (erro ou exceção) PARA — nunca "segue pela posição" às cegas', async () => {
    for (const r of [{ error: { message: 'timeout' } }, 'lança' as const]) {
      expect(await conferirRetomada(banco(r).db, 'auto-1', espera())).toMatchObject({
        tipo: 'parar',
        motivo: MOTIVO_PASSO_NAO_CONFERIDO,
      });
    }
  });

  it('não consulta nada para a espera sem a chave, nem para o ramo órfão', async () => {
    const semConsulta = {
      from: () => {
        throw new Error('não devia consultar');
      },
    } as unknown as SupabaseClient;
    expect(await conferirRetomada(semConsulta, 'a', espera({ context: {} }))).toMatchObject({ tipo: 'segue' });
    expect(await conferirRetomada(semConsulta, 'a', espera({ parent_step_id: null }))).toMatchObject({
      tipo: 'parar',
    });
  });
});

// Pinos estruturais: o motor é quem grava a chave e quem a confere.
describe('o motor usa as duas pontas', () => {
  const motor = readFileSync(join(process.cwd(), 'src/lib/automations/engine.ts'), 'utf8');

  it('os DOIS estacionamentos (o "Aguardar" e a retentativa) gravam o passo', () => {
    const inicio = motor.indexOf('async function executeStepsFrom');
    const corpo = motor.slice(inicio, motor.indexOf('async function runStep', inicio));
    expect(corpo.split("'cb_estacionar_espera'").length - 1).toBe(2);
    expect(corpo.split('context: comPassoDaFila(').length - 1).toBe(2);
  });

  it('a retomada confere ANTES de rodar passo e começa pela posição conferida', () => {
    const inicio = motor.indexOf('export async function resumePendingExecution');
    const corpo = motor.slice(inicio, motor.indexOf('export async function', inicio + 10));
    const confere = corpo.indexOf('conferirRetomada(db, automation.id, pending)');
    expect(confere).toBeGreaterThan(-1);
    expect(confere).toBeLessThan(corpo.indexOf('executeStepsFrom('));
    expect(corpo).toMatch(/startPosition:\s*retomada\.posicao/);
    expect(corpo).not.toMatch(/startPosition:\s*pending\.next_step_position/);
  });
});
