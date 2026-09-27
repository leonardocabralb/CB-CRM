import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Um Supabase EM MEMÓRIA para os testes do ZapSign: tabelas como listas,
 * com os filtros que o módulo usa (`eq`, `in`, `is`, `or`, `like`, `ilike`,
 * `limit`) e as escritas (`insert`, `upsert` com `onConflict` e
 * `ignoreDuplicates`, `update`, `delete`). Como o PostgREST, o UPDATE e o
 * upsert só escrevem as colunas PRESENTES.
 *
 * ⚠️ É um dublê: imita a forma SUPOSTA. Forma nova de consulta se mede contra
 * o PostgREST real (CLAUDE.md, 8b).
 */

type Linha = Record<string, unknown>;
type Filtro = (l: Linha) => boolean;

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
    throw new Error(`or: operador ${op} não suportado no dublê`);
  });
  return (l) => partes.some((f) => f(l));
}

export function criarBanco(inicial: Record<string, Linha[]> = {}): Banco {
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
    let unico = false;

    function executar(): { data: unknown; error: { message: string } | null } {
      if (falhar.has(`${nome}:${op}`)) return { data: null, error: { message: `falha simulada em ${nome}:${op}` } };
      const t = tabelas[nome];
      const casa = (l: Linha) => filtros.every((f) => f(l));
      let afetadas: Linha[] = [];
      if (op === "select") afetadas = t.filter(casa);
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
      const copia = afetadas.map((l) => ({ ...l }));
      if (unico) return { data: copia[0] ?? null, error: null };
      return { data: copia, error: null };
    }

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (v: Linha | Linha[]) => ((op = "insert"), (valores = v), b),
      upsert: (v: Linha | Linha[], o: typeof opcoes = {}) => ((op = "upsert"), (valores = v), (opcoes = o), b),
      update: (v: Linha) => ((op = "update"), (valores = v), b),
      delete: () => ((op = "delete"), b),
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), b),
      in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.includes(l[c])), b),
      is: (c: string, v: null) => (filtros.push((l) => (l[c] ?? null) === v), b),
      or: (expr: string) => (filtros.push(filtroDoOr(expr)), b),
      like: (c: string, p: string) => (filtros.push((l) => typeof l[c] === "string" && padraoParaRegex(p, "").test(l[c] as string)), b),
      ilike: (c: string, p: string) => (filtros.push((l) => typeof l[c] === "string" && padraoParaRegex(p, "i").test(l[c] as string)), b),
      order: () => b,
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
