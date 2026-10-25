import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// A espera presa em `running` vira FALHA VISÍVEL (1106) — e nada é
// re-executado. O cron reivindica a espera e roda a retomada; se o processo
// morre no meio (deploy, reinício), a linha ficava `running` para sempre e a
// execução sumia em silêncio. O original (#672) a devolve à fila e a RODA DE
// NOVO; aqui isso mandaria de novo a mensagem que pode ter saído antes da
// queda (CLAUDE.md, 8e).
//
// O banco falso APLICA os filtros (`eq`, `is`, `lt`, `in`, `neq`, `or`): a
// cerca do recolhimento é um WHERE, e um filtro esquecido apareceria aqui como
// a linha errada fechada.
// ============================================================

type Linha = Record<string, unknown>;
type Filtro = [string, string, unknown];

const h = vi.hoisted(() => ({
  tabelas: {} as Record<string, Record<string, unknown>[]>,
  chamadas: [] as { tabela: string; op: string; payload: unknown; filtros: [string, string, unknown][] }[],
  rpcs: [] as string[],
  erroNaFila: null as string | null,
}));

function compara(v: unknown, alvo: unknown): number {
  if (typeof v === 'number' && typeof alvo === 'number') return v - alvo;
  return String(v) < String(alvo) ? -1 : String(v) > String(alvo) ? 1 : 0;
}

function casa(l: Linha, [op, col, val]: Filtro): boolean {
  const v = l[col];
  switch (op) {
    case 'eq':
      return v === val;
    case 'neq':
      return v !== val;
    case 'is':
      return val === null ? v === null || v === undefined : v === val;
    case 'in':
      return (val as unknown[]).includes(v);
    // NULL nunca casa comparação (a semântica do SQL): é por isso que a linha
    // sem carimbo precisa da segunda cerca.
    case 'lt':
      return v != null && compara(v, val) < 0;
    case 'gte':
      return v != null && compara(v, val) >= 0;
    case 'or':
      return String(val)
        .split(',')
        .some((parte) => {
          const [c, o, ...resto] = parte.split('.');
          const x = resto.join('.');
          return casa(l, [o, c, x === 'null' ? null : x]);
        });
    default:
      throw new Error(`filtro sem dublê: ${op}`);
  }
}

vi.mock('./admin-client', () => {
  function builder(tabela: string) {
    const e = {
      op: 'select',
      payload: undefined as unknown,
      filtros: [] as Filtro[],
      devolve: false,
      unico: false,
      limite: undefined as number | undefined,
    };
    const executar = () => {
      const linhas = (h.tabelas[tabela] ??= []);
      const alvo = linhas.filter((l) => e.filtros.every((f) => casa(l, f)));
      h.chamadas.push({ tabela, op: e.op, payload: e.payload, filtros: e.filtros });
      if (e.op === 'update') {
        if (tabela === 'automation_pending_executions' && h.erroNaFila) {
          return { data: null, error: { message: h.erroNaFila } };
        }
        for (const l of alvo) Object.assign(l, e.payload);
        const data = e.devolve ? alvo.map((l) => ({ ...l })) : null;
        return { data: e.unico ? (data?.[0] ?? null) : data, error: null };
      }
      if (e.op === 'insert') {
        linhas.push({ ...(e.payload as Linha) });
        return { data: null, error: null };
      }
      const lista = e.limite === undefined ? alvo : alvo.slice(0, e.limite);
      if (e.unico) return { data: lista[0] ? { ...lista[0] } : null, error: null };
      return { data: lista.map((l) => ({ ...l })), error: null };
    };
    const b: Record<string, unknown> = {
      select: () => {
        if (e.op !== 'select') e.devolve = true;
        return b;
      },
      update: (p: unknown) => ((e.op = 'update'), (e.payload = p), b),
      insert: (p: unknown) => ((e.op = 'insert'), (e.payload = p), b),
      eq: (c: string, v: unknown) => (e.filtros.push(['eq', c, v]), b),
      neq: (c: string, v: unknown) => (e.filtros.push(['neq', c, v]), b),
      is: (c: string, v: unknown) => (e.filtros.push(['is', c, v]), b),
      in: (c: string, v: unknown) => (e.filtros.push(['in', c, v]), b),
      lt: (c: string, v: unknown) => (e.filtros.push(['lt', c, v]), b),
      gte: (c: string, v: unknown) => (e.filtros.push(['gte', c, v]), b),
      or: (expr: string) => (e.filtros.push(['or', '', expr]), b),
      order: () => b,
      limit: (n: number) => ((e.limite = n), b),
      single: async () => ((e.unico = true), executar()),
      maybeSingle: async () => ((e.unico = true), executar()),
      then: (ok: (v: unknown) => unknown, erro?: (x: unknown) => unknown) =>
        Promise.resolve(executar()).then(ok, erro),
    };
    return b;
  }
  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
      rpc: (nome: string) => {
        h.rpcs.push(nome);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
});

const envio = vi.hoisted(() => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: 'm1' })),
}));
vi.mock('./meta-send', () => envio);

import {
  TETO_DA_ESPERA_SEM_CARIMBO_MS,
  TETO_DA_RETOMADA_MS,
  recolherEsperasPresas,
  resumePendingExecution,
} from './engine';
import { MOTIVO_RETOMADA_INTERROMPIDA } from './retomada';

const AGORA = new Date('2026-10-25T12:00:00.000Z');
const antes = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();
const MIN = 60_000;

const espera = (over: Linha): Linha => ({
  automation_id: 'auto-1',
  account_id: 'acct-1',
  user_id: 'u-1',
  contact_id: 'c-1',
  parent_step_id: null,
  branch: null,
  next_step_position: 2,
  context: {},
  claimed_at: null,
  run_at: antes(30 * MIN),
  created_at: antes(2 * 60 * MIN),
  ...over,
});

const registro = (id: string, over: Linha = {}): Linha => ({
  id,
  automation_id: 'auto-1',
  account_id: 'acct-1',
  status: 'partial',
  steps_executed: [
    { step_id: 's-msg', step_type: 'send_message', status: 'success', detail: 'sent (x)' },
    { step_id: 's-esp', step_type: 'wait', status: 'success', detail: 'waiting 1 hours' },
  ],
  error_message: null,
  desfecho: null,
  finalizado_em: null,
  interrompida_em: null,
  ...over,
});

const fila = () => h.tabelas.automation_pending_executions;
const statusDa = (id: string) => fila().find((l) => l.id === id)?.status;
const log = (id: string) => h.tabelas.automation_logs.find((l) => l.id === id) as Linha;

beforeEach(() => {
  h.tabelas = {
    automation_pending_executions: [
      // Reivindicada há 20 min e nunca terminou: o processo morreu.
      espera({ id: 'velha', log_id: 'log-velha', status: 'running', claimed_at: antes(20 * MIN) }),
      // Reivindicada há 5 min: ainda pode estar rodando — não se toca.
      espera({ id: 'viva', log_id: 'log-viva', status: 'running', claimed_at: antes(5 * MIN) }),
      // Do código anterior à 1106 (sem carimbo): vencida há 3 dias…
      espera({ id: 'legado-velho', log_id: 'log-legado', status: 'running', run_at: antes(3 * 24 * 60 * MIN) }),
      // …e vencida há 2 h (fila atrasada: pode estar viva).
      espera({ id: 'legado-novo', log_id: 'log-legado-novo', status: 'running', run_at: antes(2 * 60 * MIN) }),
      // Estacionada, ainda não reivindicada: nem é `running`.
      espera({ id: 'parada', log_id: 'log-parada', status: 'pending', run_at: antes(3 * 24 * 60 * MIN) }),
      espera({ id: 'feita', log_id: 'log-feita', status: 'done', claimed_at: antes(3 * 60 * MIN) }),
    ],
    automation_logs: [
      registro('log-velha'),
      registro('log-viva'),
      registro('log-legado'),
      registro('log-legado-novo'),
      registro('log-parada'),
      registro('log-feita'),
    ],
  };
  h.chamadas = [];
  h.rpcs = [];
  h.erroNaFila = null;
  for (const f of Object.values(envio)) f.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('recolherEsperasPresas — a cerca', () => {
  it('fecha SÓ a reivindicada além do teto e a antiga sem carimbo vencida há mais de 24 h', async () => {
    expect(await recolherEsperasPresas(AGORA)).toBe(2);

    expect(statusDa('velha')).toBe('failed');
    expect(statusDa('legado-velho')).toBe('failed');
    // A retomada viva, a antiga de 2 h, a estacionada e a feita ficam como estavam.
    expect(statusDa('viva')).toBe('running');
    expect(statusDa('legado-novo')).toBe('running');
    expect(statusDa('parada')).toBe('pending');
    expect(statusDa('feita')).toBe('done');
  });

  it('o corte está no WHERE do UPDATE (com status = running), nunca numa leitura antes', async () => {
    await recolherEsperasPresas(AGORA);

    const naFila = h.chamadas.filter((c) => c.tabela === 'automation_pending_executions');
    // As duas primeiras idas à fila SÃO os UPDATEs: nenhuma leitura escolhe a
    // linha antes (entre ler e escrever, a retomada viva poderia terminar). A
    // única leitura que vem depois é a guarda de `fecharLog`, por registro.
    expect(naFila.slice(0, 2).map((c) => c.op)).toEqual(['update', 'update']);
    for (const c of naFila.filter((x) => x.op === 'select')) {
      expect(c.filtros[0][1]).toBe('log_id');
    }
    const updates = naFila.filter((c) => c.op === 'update');
    expect(updates.map((c) => c.payload)).toEqual([{ status: 'failed' }, { status: 'failed' }]);
    expect(updates[0].filtros).toEqual([
      ['eq', 'status', 'running'],
      ['lt', 'claimed_at', antes(TETO_DA_RETOMADA_MS)],
    ]);
    expect(updates[1].filtros).toEqual([
      ['eq', 'status', 'running'],
      ['is', 'claimed_at', null],
      ['lt', 'run_at', antes(TETO_DA_ESPERA_SEM_CARIMBO_MS)],
    ]);
    expect(TETO_DA_RETOMADA_MS).toBe(15 * MIN);
    expect(TETO_DA_ESPERA_SEM_CARIMBO_MS).toBe(24 * 60 * MIN);
  });

  it('o ciclo seguinte (ou um sobreposto) não fecha de novo: a linha já não casa', async () => {
    await recolherEsperasPresas(AGORA);
    const linhasDoMotivo = () =>
      (log('log-velha').steps_executed as Linha[]).filter((p) => p.detail === MOTIVO_RETOMADA_INTERROMPIDA);
    expect(linhasDoMotivo()).toHaveLength(1);

    expect(await recolherEsperasPresas(AGORA)).toBe(0);
    expect(linhasDoMotivo()).toHaveLength(1);
  });

  it('UPDATE que falha: devolve 0, não lança e não fecha registro nenhum', async () => {
    h.erroNaFila = 'banco fora';
    await expect(recolherEsperasPresas(AGORA)).resolves.toBe(0);
    expect(log('log-velha').desfecho).toBeNull();
    expect(log('log-velha').steps_executed).toHaveLength(2);
  });
});

describe('recolherEsperasPresas — a falha VISÍVEL, pelo caminho da espera que não pode retomar', () => {
  it('o registro ganha a linha do motor com o motivo, o erro e o desfecho falhou com hora de fim', async () => {
    await recolherEsperasPresas(AGORA);

    for (const id of ['log-velha', 'log-legado']) {
      const l = log(id);
      expect(l.steps_executed).toEqual([
        { step_id: 's-msg', step_type: 'send_message', status: 'success', detail: 'sent (x)' },
        { step_id: 's-esp', step_type: 'wait', status: 'success', detail: 'waiting 1 hours' },
        // `step_id` vazio: linha do MOTOR — o "Já rodou" não diz "falhou no Aguardar".
        { step_id: '', step_type: 'wait', status: 'failed', detail: MOTIVO_RETOMADA_INTERROMPIDA },
      ]);
      expect(l.status).toBe('failed');
      expect(l.error_message).toBe(MOTIVO_RETOMADA_INTERROMPIDA);
      expect(l.desfecho).toBe('falhou');
      expect(l.finalizado_em).toEqual(expect.any(String));
    }
    // A retomada viva não ganhou nada.
    expect(log('log-viva')).toEqual(registro('log-viva'));
  });

  it('⚠️⚠️ NADA é re-executado: nenhum passo lido, nenhuma espera nova, nenhum envio, nada volta à fila', async () => {
    await recolherEsperasPresas(AGORA);

    expect(h.chamadas.some((c) => c.tabela === 'automation_steps')).toBe(false);
    expect(h.chamadas.some((c) => c.op === 'insert')).toBe(false);
    expect(h.rpcs).toEqual([]);
    for (const f of Object.values(envio)) expect(f).not.toHaveBeenCalled();
    expect(fila().filter((l) => ['velha', 'legado-velho'].includes(l.id as string)).map((l) => l.status)).toEqual([
      'failed',
      'failed',
    ]);
  });

  it('duas continuações presas da MESMA execução (dois ramos): uma linha só no registro', async () => {
    fila().push(espera({ id: 'velha-irma', log_id: 'log-velha', status: 'running', claimed_at: antes(40 * MIN), branch: 'yes', parent_step_id: 'cond' }));

    expect(await recolherEsperasPresas(AGORA)).toBe(3);
    const linhas = (log('log-velha').steps_executed as Linha[]).filter((p) => p.detail === MOTIVO_RETOMADA_INTERROMPIDA);
    expect(linhas).toHaveLength(1);
  });

  it('só ESTA continuação para: com a irmã ainda viva, o desfecho é gravado e a hora de fim espera por ela', async () => {
    fila().push(espera({ id: 'irma-viva', log_id: 'log-velha', status: 'pending', run_at: '2026-10-26T12:00:00.000Z' }));

    await recolherEsperasPresas(AGORA);

    expect(statusDa('irma-viva')).toBe('pending');
    expect(log('log-velha').desfecho).toBe('falhou');
    expect(log('log-velha').finalizado_em).toBeNull();
  });
});

describe('a escrita ATRASADA da retomada que foi recolhida (cerca de posse)', () => {
  it('a retomada que termina depois do recolhimento não vira `done` nem apaga o falhou', async () => {
    h.tabelas.automations = [
      { id: 'auto-1', account_id: 'acct-1', user_id: 'u-1', name: 'Lenta', trigger_type: 'new_message_received', trigger_config: {}, is_active: true },
    ];
    h.tabelas.automation_steps = [];
    await recolherEsperasPresas(AGORA);
    expect(statusDa('velha')).toBe('failed');

    // O processo "lento", que ainda estava vivo, termina a retomada agora.
    await resumePendingExecution({
      id: 'velha',
      automation_id: 'auto-1',
      account_id: 'acct-1',
      user_id: 'u-1',
      contact_id: 'c-1',
      log_id: 'log-velha',
      parent_step_id: null,
      branch: null,
      next_step_position: 2,
      context: {},
    });

    expect(statusDa('velha')).toBe('failed');
    expect(log('log-velha').desfecho).toBe('falhou');
    const fim = h.chamadas.filter(
      (c) => c.tabela === 'automation_pending_executions' && c.op === 'update' && (c.payload as Linha).status === 'done'
    );
    expect(fim).toHaveLength(1);
    expect(fim[0].filtros).toEqual([
      ['eq', 'id', 'velha'],
      ['eq', 'status', 'running'],
    ]);
  });
});

describe('o lugar no motor', () => {
  const motor = readFileSync(join(process.cwd(), 'src/lib/automations/engine.ts'), 'utf8');

  it('o recolhimento não chama a retomada nem estaciona espera (nada roda de novo)', () => {
    const inicio = motor.indexOf('export async function recolherEsperasPresas');
    const corpo = motor.slice(inicio, motor.indexOf('\n}\n', inicio));
    expect(inicio).toBeGreaterThan(-1);
    expect(corpo).not.toMatch(/resumePendingExecution\(|executeStepsFrom\(|cb_estacionar_espera|status: 'pending'/);
    expect(corpo).toMatch(/appendResults\(/);
    expect(corpo).toMatch(/fecharLog\(logId, 'falhou'\)/);
  });
});
