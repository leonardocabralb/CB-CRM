import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Lixeira de anotações (1132): apagar MARCA e restaurar DESMARCA, pela rota
// (`DELETE /api/cb/notes/[id]` e `POST /api/cb/notes/[id]/restaurar`).
// ============================================================

const CONTA = '11111111-1111-1111-1111-111111111111';
const ANA = '22222222-2222-2222-2222-222222222222';
const BIA = '33333333-3333-3333-3333-333333333333';
const NOTA = '44444444-4444-4444-4444-444444444444';

type Filtro = { op: string; col: string; val: unknown };
type Linha = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  usuario: '',
  papel: 'agent',
  erroDoPerfil: false,
  erroDaLeitura: false,
  erroDoUpdate: false,
  nota: null as Linha | null,
  leituras: [] as Filtro[][],
  updates: [] as { valores: Linha; filtros: Filtro[] }[],
  /** Muda a nota entre a leitura e o UPDATE (a corrida). */
  antesDoUpdate: null as null | (() => void),
}));

function casa(linha: Linha, filtros: Filtro[]): boolean {
  return filtros.every((f) => {
    if (f.op === 'eq') return linha[f.col] === f.val;
    if (f.op === 'is') return f.val === null ? linha[f.col] == null : linha[f.col] === f.val;
    if (f.op === 'not-is-null') return linha[f.col] != null;
    return true;
  });
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: estado.usuario } }, error: null }) },
    from(tabela: string) {
      const filtros: Filtro[] = [];
      const b = {
        select: () => b,
        eq: (col: string, val: unknown) => (filtros.push({ op: 'eq', col, val }), b),
        maybeSingle: async () => {
          if (tabela === 'profiles') {
            if (estado.erroDoPerfil) return { data: null, error: { message: 'timeout' } };
            return {
              data: {
                account_id: CONTA,
                account_role: estado.papel,
                full_name: estado.usuario === ANA ? 'Ana Autora' : 'Bia Colega',
                email: null,
              },
              error: null,
            };
          }
          estado.leituras.push([...filtros]);
          if (estado.erroDaLeitura) return { data: null, error: { message: 'timeout' } };
          const n = estado.nota;
          return { data: n && casa(n, filtros) ? { ...n } : null, error: null };
        },
      };
      return b;
    },
  }),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update(valores: Linha) {
        const filtros: Filtro[] = [];
        const w = {
          eq: (col: string, val: unknown) => (filtros.push({ op: 'eq', col, val }), w),
          is: (col: string, val: unknown) => (filtros.push({ op: 'is', col, val }), w),
          not: (col: string) => (filtros.push({ op: 'not-is-null', col, val: null }), w),
          select: () => w,
          maybeSingle: async () => {
            estado.antesDoUpdate?.();
            estado.updates.push({ valores, filtros: [...filtros] });
            if (estado.erroDoUpdate) return { data: null, error: { message: 'deadlock' } };
            if (!estado.nota || !casa(estado.nota, filtros)) return { data: null, error: null };
            estado.nota = { ...estado.nota, ...valores };
            return { data: { ...estado.nota }, error: null };
          },
        };
        return w;
      },
    }),
  }),
}));

import { DELETE } from '@/app/api/cb/notes/[id]/route';
import { POST as RESTAURAR } from '@/app/api/cb/notes/[id]/restaurar/route';

const apagar = (id = NOTA) =>
  DELETE(new Request(`http://localhost/api/cb/notes/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
const restaurar = (id = NOTA) =>
  RESTAURAR(new Request(`http://localhost/api/cb/notes/${id}/restaurar`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  estado.usuario = ANA;
  estado.papel = 'agent';
  estado.erroDoPerfil = false;
  estado.erroDaLeitura = false;
  estado.erroDoUpdate = false;
  estado.leituras = [];
  estado.updates = [];
  estado.antesDoUpdate = null;
  estado.nota = {
    id: NOTA,
    account_id: CONTA,
    author_user_id: ANA,
    texto: 'Ligar para o banco',
    fixada_em: '2026-11-09T10:00:00Z',
    apagada_em: null,
    apagada_por: null,
    apagada_por_nome: null,
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('apagar = mandar para a lixeira (1132)', () => {
  it('o AUTOR apaga: marca quem e quando, DESAFIXA, e a linha continua (devolvida para a lixeira da tela)', async () => {
    const res = await apagar();
    expect(res.status).toBe(200);
    const { note } = await res.json();
    expect(note.apagada_em).toEqual(expect.any(String));
    expect(note.apagada_por).toBe(ANA);
    expect(note.apagada_por_nome).toBe('Ana Autora');
    expect(note.fixada_em).toBeNull();
    // Cercado: só marca a que está VIVA, desta conta.
    expect(estado.updates[0].filtros).toEqual([
      { op: 'eq', col: 'id', val: NOTA },
      { op: 'eq', col: 'account_id', val: CONTA },
      { op: 'is', col: 'apagada_em', val: null },
    ]);
  });

  it('a leitura é sob RLS, na conta de quem pede (o suspenso e a outra conta não acham a linha)', async () => {
    await apagar();
    expect(estado.leituras[0]).toEqual([
      { op: 'eq', col: 'id', val: NOTA },
      { op: 'eq', col: 'account_id', val: CONTA },
    ]);
  });

  it('quem não é o autor nem admin: 403 NOT_THE_AUTHOR, sem escrever', async () => {
    estado.usuario = BIA;
    const res = await apagar();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'NOT_THE_AUTHOR' });
    expect(estado.updates).toEqual([]);
  });

  it('admin (e dono) apaga a de qualquer um — e a de automação/IA, sem autor', async () => {
    estado.usuario = BIA;
    estado.papel = 'admin';
    expect((await apagar()).status).toBe(200);
    estado.nota = { ...estado.nota!, author_user_id: null, apagada_em: null };
    estado.papel = 'owner';
    expect((await apagar()).status).toBe(200);
  });

  it('já estava na lixeira: 200 com a linha, sem escrever de novo (dois cliques, duas abas)', async () => {
    estado.nota = { ...estado.nota!, apagada_em: '2026-11-10T10:00:00Z', fixada_em: null };
    const res = await apagar();
    expect(res.status).toBe(200);
    expect(estado.updates).toEqual([]);
  });

  it('não existe (venceu, ou a ficha foi para a Lixeira de contatos): 404 NOTE_GONE', async () => {
    estado.nota = null;
    const res = await apagar();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOTE_GONE' });
  });

  it('erro de leitura é 500, nunca 404 (raiz, 8b)', async () => {
    estado.erroDaLeitura = true;
    expect((await apagar()).status).toBe(500);
    estado.erroDaLeitura = false;
    estado.erroDoPerfil = true;
    expect((await apagar()).status).toBe(500);
  });

  it('UPDATE que falhou é 500', async () => {
    estado.erroDoUpdate = true;
    expect((await apagar()).status).toBe(500);
  });

  it('apagada por OUTRO no meio (zero linhas): mede relendo — já na lixeira = 200', async () => {
    estado.antesDoUpdate = () => {
      estado.nota = { ...estado.nota!, apagada_em: '2026-11-10T10:00:00Z', fixada_em: null };
    };
    const res = await apagar();
    expect(res.status).toBe(200);
    expect((await res.json()).note.apagada_em).toBe('2026-11-10T10:00:00Z');
  });

  it('id que não é UUID é 400 antes do banco', async () => {
    expect((await apagar('nao-e-uuid')).status).toBe(400);
    expect(estado.leituras).toEqual([]);
  });
});

describe('restaurar (1132)', () => {
  beforeEach(() => {
    estado.nota = {
      ...estado.nota!,
      fixada_em: null,
      apagada_em: '2026-11-10T10:00:00Z',
      apagada_por: BIA,
      apagada_por_nome: 'Bia Colega',
    };
  });

  it('o AUTOR restaura: tira a marca inteira, sem refixar', async () => {
    const res = await restaurar();
    expect(res.status).toBe(200);
    const { note } = await res.json();
    expect(note).toMatchObject({ apagada_em: null, apagada_por: null, apagada_por_nome: null, fixada_em: null });
    expect(estado.updates[0].filtros).toContainEqual({ op: 'not-is-null', col: 'apagada_em', val: null });
  });

  it('a mesma régua de quem apaga: outro membro não restaura; admin restaura', async () => {
    estado.usuario = BIA;
    expect((await restaurar()).status).toBe(403);
    estado.papel = 'admin';
    expect((await restaurar()).status).toBe(200);
  });

  it('já viva: 200 sem escrever', async () => {
    estado.nota = { ...estado.nota!, apagada_em: null };
    const res = await restaurar();
    expect(res.status).toBe(200);
    expect(estado.updates).toEqual([]);
  });

  it('venceu (a linha saiu de vez): 404 NOTE_GONE', async () => {
    estado.nota = null;
    expect((await restaurar()).status).toBe(404);
  });
});
