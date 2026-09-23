import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CbAutomationEvent } from '@/types';

// A entrega em si (catálogo, limpeza com cerca) tem teste próprio. Aqui
// interessa O QUE a reentrega reivindica e manda entregar, e com que carimbo.
vi.mock('@/lib/webhooks/entregar-eventos-de-funil', () => ({
  entregarEventosDeFunil: vi.fn(async () => {}),
}));
// Fora de requisição `after()` lança; a reentrega cai no `await`, que é o
// caminho que o teste consegue observar. Um caso troca por um `after` que agenda.
const agendados: (() => Promise<void>)[] = [];
let afterAgenda = false;
vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => {
    if (!afterAgenda) throw new Error('`after` was called outside a request scope');
    agendados.push(fn);
  },
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => {
    throw new Error('o teste sempre passa o banco');
  },
}));

import { entregarEventosDeFunil } from './entregar-eventos-de-funil';
import {
  PRAZO_PARA_REENTREGAR_MS,
  reentregarEventosDeFunil,
  TETO_DE_REENTREGAS,
} from './reentregar-eventos-de-funil';

// ============================================================
// Banco falso da fila: o SELECT filtra DE VERDADE por lt/order/limit, e o
// UPDATE aplica a cerca (`eq`) — para o compare-and-swap ser testado, não
// suposto. Dados FICTÍCIOS.
// ============================================================

type Linha = Record<string, unknown>;

function bancoFalso(fila: Linha[], opcoes: { falhaLeitura?: boolean; antesDoUpdate?: (id: string) => void } = {}) {
  const updates: { valores: Linha; eq: [string, unknown][] }[] = [];
  const from = (tabela: string) => {
    expect(tabela).toBe('cb_automation_events');
    const c = { lt: [] as [string, string | number][], eq: [] as [string, unknown][], limite: Infinity, update: null as Linha | null, ordem: '' };
    const casa = (l: Linha) =>
      c.lt.every(([k, v]) => l[k] !== null && l[k] !== undefined && (l[k] as string | number) < v) &&
      c.eq.every(([k, v]) => l[k] === v);
    const b = {
      select: () => b,
      update: (v: Linha) => ((c.update = v), b),
      lt: (k: string, v: string | number) => (c.lt.push([k, v]), b),
      eq: (k: string, v: unknown) => (c.eq.push([k, v]), b),
      order: (k: string) => ((c.ordem = k), b),
      limit: (n: number) => ((c.limite = n), b),
      maybeSingle: () => {
        // Só o UPDATE usa maybeSingle aqui.
        const id = c.eq.find(([k]) => k === 'id')?.[1] as string;
        opcoes.antesDoUpdate?.(id);
        updates.push({ valores: c.update!, eq: [...c.eq] });
        const alvo = fila.find(casa);
        if (!alvo) return Promise.resolve({ data: null, error: null });
        Object.assign(alvo, c.update);
        return Promise.resolve({ data: { ...alvo }, error: null });
      },
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => {
        if (opcoes.falhaLeitura) return Promise.resolve({ data: null, error: { message: 'caiu' } }).then(ok, erro);
        const linhas = fila
          .filter(casa)
          .sort((a, b2) => String(a[c.ordem]).localeCompare(String(b2[c.ordem])))
          .slice(0, c.limite)
          .map((l) => ({ ...l }));
        return Promise.resolve({ data: linhas, error: null }).then(ok, erro);
      },
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, updates };
}

const AGORA = Date.parse('2026-09-23T15:00:00.000Z');
const VELHO = new Date(AGORA - PRAZO_PARA_REENTREGAR_MS - 60_000).toISOString(); // pendente há 11 min
const RECENTE = new Date(AGORA - 60_000).toISOString(); // pendente há 1 min: a entrega original ainda pode estar correndo

function linha(id: string, parcial: Partial<CbAutomationEvent> = {}): Linha {
  return {
    id,
    account_id: 'conta-1',
    tipo: 'deal_stage_changed',
    criado_em: '2026-09-23T14:00:00.000Z',
    processado_em: '2026-09-23T14:00:01.000Z',
    webhooks_pendente_desde: VELHO,
    webhooks_tentativas: 0,
    ...parcial,
  };
}

const entregas = () => vi.mocked(entregarEventosDeFunil).mock.calls;

beforeEach(() => {
  vi.mocked(entregarEventosDeFunil).mockReset();
  agendados.length = 0;
  afterAgenda = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('reentregarEventosDeFunil', () => {
  it('só retoma o que está pendente há MAIS que o prazo, e abaixo do teto', async () => {
    const fila = [
      linha('velho'),
      linha('recente', { webhooks_pendente_desde: RECENTE }),
      linha('entregue', { webhooks_pendente_desde: null }),
      linha('no-teto', { webhooks_tentativas: TETO_DE_REENTREGAS }),
    ];
    const { db } = bancoFalso(fila);
    const r = await reentregarEventosDeFunil(db, AGORA);

    expect(r).toEqual({ reentregues: 1, falhas: 0 });
    expect(entregas()).toHaveLength(1);
    expect(entregas()[0][1].map((l) => l.id)).toEqual(['velho']);
  });

  it('reivindica por compare-and-swap no carimbo LIDO, recarimba e conta a tentativa', async () => {
    const fila = [linha('a', { webhooks_tentativas: 2 })];
    const { db, updates } = bancoFalso(fila);
    await reentregarEventosDeFunil(db, AGORA);

    const carimboNovo = new Date(AGORA).toISOString();
    expect(updates).toEqual([
      {
        valores: { webhooks_pendente_desde: carimboNovo, webhooks_tentativas: 3 },
        eq: [
          ['id', 'a'],
          ['webhooks_pendente_desde', VELHO],
        ],
      },
    ]);
    expect(fila[0]).toMatchObject({ webhooks_pendente_desde: carimboNovo, webhooks_tentativas: 3 });
  });

  it('entrega com o MESMO id da linha e o carimbo NOVO (a cerca da limpeza)', async () => {
    const { db } = bancoFalso([linha('evt-1'), linha('evt-2', { criado_em: '2026-09-23T14:05:00.000Z' })]);
    await reentregarEventosDeFunil(db, AGORA);

    const [, linhas, carimbo] = entregas()[0];
    expect(linhas.map((l) => l.id)).toEqual(['evt-1', 'evt-2']);
    // A hora do fato viaja intacta (é ela que vira `occurred_at`).
    expect(linhas.map((l) => l.criado_em)).toEqual(['2026-09-23T14:00:00.000Z', '2026-09-23T14:05:00.000Z']);
    expect(carimbo).toBe(new Date(AGORA).toISOString());
  });

  it('⚠️ quem PERDE o compare-and-swap não entrega (outro ciclo levou a linha)', async () => {
    const fila = [linha('disputada'), linha('livre')];
    const { db } = bancoFalso(fila, {
      // Entre o SELECT e o UPDATE, o outro ciclo do cron recarimbou.
      antesDoUpdate: (id) => {
        if (id === 'disputada') fila[0].webhooks_pendente_desde = '2026-09-23T14:59:59.000Z';
      },
    });
    const r = await reentregarEventosDeFunil(db, AGORA);
    expect(r.reentregues).toBe(1);
    expect(entregas()[0][1].map((l) => l.id)).toEqual(['livre']);
  });

  it('ordena pela hora do FATO e respeita o lote de 50', async () => {
    const fila = Array.from({ length: 60 }, (_, i) =>
      linha(`evt-${String(59 - i).padStart(2, '0')}`, {
        criado_em: `2026-09-23T13:${String(59 - i).padStart(2, '0')}:00.000Z`,
      })
    );
    const { db } = bancoFalso(fila);
    const r = await reentregarEventosDeFunil(db, AGORA);
    expect(r.reentregues).toBe(50);
    const ids = entregas()[0][1].map((l) => l.id);
    expect(ids[0]).toBe('evt-00');
    expect(ids[49]).toBe('evt-49');
  });

  it('nada pendente: não chama a entrega', async () => {
    const { db } = bancoFalso([linha('x', { webhooks_pendente_desde: null })]);
    expect(await reentregarEventosDeFunil(db, AGORA)).toEqual({ reentregues: 0, falhas: 0 });
    expect(entregas()).toHaveLength(0);
  });

  it('leitura que falha: não lança, não entrega', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = bancoFalso([linha('x')], { falhaLeitura: true });
    await expect(reentregarEventosDeFunil(db, AGORA)).resolves.toEqual({ reentregues: 0, falhas: 0 });
    expect(entregas()).toHaveLength(0);
    expect(erro).toHaveBeenCalled();
  });

  it('a última tentativa é anunciada no log com o id (é o que fica marcado se falhar)', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = bancoFalso([linha('ultima', { webhooks_tentativas: TETO_DE_REENTREGAS - 1 })]);
    await reentregarEventosDeFunil(db, AGORA);
    expect(String(aviso.mock.calls[0][0])).toMatch(/última tentativa.*ultima/);
  });

  it('dentro de requisição, a entrega é AGENDADA com after() — não aguardada no ciclo do cron', async () => {
    afterAgenda = true;
    const { db } = bancoFalso([linha('evt-1')]);
    await reentregarEventosDeFunil(db, AGORA);
    expect(entregas()).toHaveLength(0);
    expect(agendados).toHaveLength(1);
    await agendados[0]();
    expect(entregas()).toHaveLength(1);
  });
});
