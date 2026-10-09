import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Um Supabase EM MEMÓRIA para os testes do ZapSign: tabelas como listas,
 * com os filtros que o módulo usa (`eq`, `in`, `is`, `or`, `like`, `ilike`,
 * `lt`, `gt`, `not(…, 'is', null)`, `order`, `limit`) e as escritas (`insert`, `upsert` com
 * `onConflict` e `ignoreDuplicates`, `update`, `delete`). Como o PostgREST,
 * o UPDATE e o upsert só escrevem as colunas PRESENTES.
 *
 * Opcionais (o Atlas os usa): `select(cols, { count: 'exact', head: true })`
 * devolve `count`; `unicos` imita índices ÚNICOS no INSERT (23505), com o
 * nulo contando como valor (NULLS NOT DISTINCT) e um predicado de índice
 * parcial.
 *
 * ⚠️ É um dublê: imita a forma SUPOSTA. Forma nova de consulta se mede contra
 * o PostgREST real (CLAUDE.md, 8b).
 */

type Linha = Record<string, unknown>;
type Filtro = (l: Linha) => boolean;

/** Um índice único imitado: as colunas e, se parcial, o predicado. */
export interface Unico {
  colunas: string[];
  onde?: (l: Linha) => boolean;
}

export interface Banco {
  tabelas: Record<string, Linha[]>;
  /** "tabela:operação" (`select`, `insert`, `upsert`, `update`, `delete`) que devolve erro. */
  falhar: Set<string>;
  cliente: SupabaseClient;
}

function padraoParaRegex(padrao: string, flags: string): RegExp {
  let re = "";
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i];
    if (c === "\\" && i + 1 < padrao.length) {
      re += padrao[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, flags);
}

function filtroDoOr(expr: string): Filtro {
  const partes = expr.split(",").map((p) => {
    const [col, op, ...resto] = p.split(".");
    const valor = resto.join(".");
    if (op === "is") return (l: Linha) => l[col] === null || l[col] === undefined;
    if (op === "eq") return (l: Linha) => String(l[col]) === valor;
    if (op === "lt") return (l: Linha) => typeof l[col] === "string" && (l[col] as string) < valor;
    if (op === "gt") return (l: Linha) => typeof l[col] === "string" && (l[col] as string) > valor;
    throw new Error(`or: operador ${op} não suportado no dublê`);
  });
  return (l) => partes.some((f) => f(l));
}

export function criarBanco(inicial: Record<string, Linha[]> = {}, opcoesDoBanco: { unicos?: Record<string, Unico[]> } = {}): Banco {
  const tabelas: Record<string, Linha[]> = {};
  for (const [k, v] of Object.entries(inicial)) tabelas[k] = v.map((l) => ({ ...l }));
  const falhar = new Set<string>();
  let seq = 0;

  function from(nome: string) {
    tabelas[nome] ??= [];
    const filtros: Filtro[] = [];
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let valores: Linha | Linha[] | null = null;
    let opcoes: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let limite: number | null = null;
    /** As ordens do SELECT, na ordem das chamadas (a primeira manda). */
    const ordens: { coluna: string; asc: boolean; nulosPrimeiro: boolean }[] = [];
    let unico = false;
    let contar = false;
    let cabeca = false;

    function violaUnico(v: Linha): boolean {
      for (const u of opcoesDoBanco.unicos?.[nome] ?? []) {
        if (u.onde && !u.onde(v)) continue;
        const igual = (l: Linha) => (!u.onde || u.onde(l)) && u.colunas.every((c) => (l[c] ?? null) === (v[c] ?? null));
        if (tabelas[nome].some(igual)) return true;
      }
      return false;
    }

    function executar(): { data: unknown; error: { message: string; code?: string } | null; count?: number } {
      if (falhar.has(`${nome}:${op}`)) return { data: null, error: { message: `falha simulada em ${nome}:${op}` } };
      if (op === "insert") {
        for (const v of Array.isArray(valores) ? valores : [valores as Linha]) {
          if (violaUnico(v)) return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        }
      }
      const t = tabelas[nome];
      const casa = (l: Linha) => filtros.every((f) => f(l));
      let afetadas: Linha[] = [];
      if (op === "select") {
        afetadas = t.filter(casa);
        // Como o Postgres: nulo é o MAIOR valor (vem por último no crescente,
        // primeiro no decrescente), salvo `nullsFirst` explícito. Estável.
        if (ordens.length > 0) {
          afetadas = [...afetadas].sort((a, b) => {
            for (const o of ordens) {
              const va = a[o.coluna] ?? null;
              const vb = b[o.coluna] ?? null;
              if (va === vb) continue;
              if (va === null) return o.nulosPrimeiro ? -1 : 1;
              if (vb === null) return o.nulosPrimeiro ? 1 : -1;
              const cmp = (va as string | number) < (vb as string | number) ? -1 : 1;
              return o.asc ? cmp : -cmp;
            }
            return 0;
          });
        }
      }
      if (op === "update") {
        afetadas = t.filter(casa);
        for (const l of afetadas) Object.assign(l, valores);
      }
      if (op === "delete") {
        afetadas = t.filter(casa);
        tabelas[nome] = t.filter((l) => !casa(l));
      }
      if (op === "insert" || op === "upsert") {
        const chave = opcoes.onConflict?.split(",").map((c) => c.trim()) ?? null;
        for (const v of Array.isArray(valores) ? valores : [valores as Linha]) {
          const existente = chave ? t.find((l) => chave.every((c) => l[c] === v[c])) : undefined;
          if (existente) {
            if (op === "upsert" && !opcoes.ignoreDuplicates) {
              Object.assign(existente, v);
              afetadas.push(existente);
            }
            continue;
          }
          const nova = { id: `id-${nome}-${++seq}`, ...v };
          t.push(nova);
          afetadas.push(nova);
        }
      }
      if (limite !== null) afetadas = afetadas.slice(0, limite);
      if (contar) return { data: cabeca ? null : afetadas.map((l) => ({ ...l })), count: afetadas.length, error: null };
      const copia = afetadas.map((l) => ({ ...l }));
      if (unico) return { data: copia[0] ?? null, error: null };
      return { data: copia, error: null };
    }

    const b: Record<string, unknown> = {
      select: (_colunas?: string, o?: { count?: string; head?: boolean }) => ((contar = !!o?.count), (cabeca = o?.head === true), b),
      insert: (v: Linha | Linha[]) => ((op = "insert"), (valores = v), b),
      upsert: (v: Linha | Linha[], o: typeof opcoes = {}) => ((op = "upsert"), (valores = v), (opcoes = o), b),
      update: (v: Linha) => ((op = "update"), (valores = v), b),
      delete: () => ((op = "delete"), b),
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), b),
      neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), b),
      in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.includes(l[c])), b),
      is: (c: string, v: null) => (filtros.push((l) => (l[c] ?? null) === v), b),
      not: (c: string, operador: string, v: null) => {
        if (operador !== "is" || v !== null) throw new Error(`not: só (coluna, 'is', null) no dublê`);
        filtros.push((l) => (l[c] ?? null) !== null);
        return b;
      },
      lt: (c: string, v: string) => (filtros.push((l) => typeof l[c] === "string" && (l[c] as string) < v), b),
      gt: (c: string, v: string) => (filtros.push((l) => typeof l[c] === "string" && (l[c] as string) > v), b),
      gte: (c: string, v: string) => (filtros.push((l) => typeof l[c] === "string" && (l[c] as string) >= v), b),
      lte: (c: string, v: string) => (filtros.push((l) => typeof l[c] === "string" && (l[c] as string) <= v), b),
      or: (expr: string) => (filtros.push(filtroDoOr(expr)), b),
      like: (c: string, p: string) => (filtros.push((l) => typeof l[c] === "string" && padraoParaRegex(p, "").test(l[c] as string)), b),
      ilike: (c: string, p: string) => (filtros.push((l) => typeof l[c] === "string" && padraoParaRegex(p, "i").test(l[c] as string)), b),
      order: (c: string, o: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string; foreignTable?: string } = {}) => {
        // A ordem de uma tabela EMBUTIDA não reordena as linhas de cima.
        if (o.referencedTable || o.foreignTable) return b;
        const asc = o.ascending !== false;
        ordens.push({ coluna: c, asc, nulosPrimeiro: o.nullsFirst ?? !asc });
        return b;
      },
      range: () => b,
      limit: (n: number) => ((limite = n), b),
      maybeSingle: async () => ((unico = true), executar()),
      single: async () => ((unico = true), executar()),
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, erro),
    };
    return b;
  }

  return { tabelas, falhar, cliente: { from } as unknown as SupabaseClient };
}
