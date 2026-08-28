// ============================================================
// Validação de forma dos campos da tarefa — funções PURAS (944).
//
// Usadas pelo POST e pelo PATCH. Não é sobre permissão (isso é
// `permissoes.ts`) nem sobre prazo (isso é `prazo.ts`): é só "este texto tem
// a forma que a coluna aceita".
//
// ⚠️ Existe porque as duas rotas escrevem as MESMAS colunas. Validar em duas
// cópias é como o PATCH acaba aceitando `2026-02-31` que o POST recusa — e o
// Postgres aceita a string na coluna `date`? Não: estoura 22008 e vira 500
// genérico, com o operador vendo "erro interno" ao corrigir uma data.
// ============================================================

/**
 * Teto do título. A coluna é `text` e não tem limite; sem isto um POST fora
 * da tela grava um parágrafo inteiro numa linha que a lista renderiza como
 * uma linha. 200 é folgado para "Ligar para o cliente sobre o contrato de
 * locação" e ainda cabe na largura da tela sem truncar no meio.
 */
export const MAX_TITULO = 200;

/** Teto da descrição — mesmo tamanho da anotação interna, pelo mesmo motivo. */
export const MAX_DESCRICAO = 4000;

/**
 * `YYYY-MM-DD` que existe de verdade no calendário.
 *
 * ⚠️ A regex sozinha não basta, e é o erro fácil: `2026-02-31` e `2026-13-01`
 * casam com `\d{4}-\d{2}-\d{2}` e são recusados pelo Postgres com 22008 —
 * que, sem tratamento, chega ao operador como "erro interno" enquanto ele
 * tenta corrigir uma data.
 *
 * A conferência é ida e volta: monta a data com os componentes e verifica que
 * eles sobreviveram. `new Date(2026, 1, 31)` vira 3 de março, e aí o mês que
 * volta (2) não é o que entrou (1).
 */
export function ehDataValida(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return false;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  // ⚠️ Construída com componentes LOCAIS de propósito. Isto é só uma conferência
  // de calendário — nada aqui vira valor guardado, e usar UTC daria o mesmo
  // resultado. O que importa é não deixar o `Date` "consertar" 31/02 em
  // silêncio, que é o que a comparação de volta pega.
  const d = new Date(ano, mes - 1, dia);
  return (
    d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia
  );
}

/**
 * Hora do dia, aceita como `HH:MM` (o que o `<input type="time">` manda) ou
 * `HH:MM:SS` (o que o Postgres devolve). Normaliza para `HH:MM:SS`, que é o
 * que a coluna `time` guarda.
 *
 * Devolve `null` para entrada ausente ou vazia — que é um valor legítimo aqui,
 * porque a hora é opcional por pedido do operador. Devolve `undefined` para
 * entrada malformada, que é erro de quem chamou.
 *
 * ⚠️ Os dois "vazios" são distintos e a rota precisa dos dois separados: `null`
 * significa "tarefa sem hora, o dia inteiro" e `undefined` significa "recuse
 * este pedido". Colapsá-los faria uma hora digitada errado virar,
 * silenciosamente, uma tarefa sem hora.
 */
export function normalizarHora(valor: unknown): string | null | undefined {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor !== 'string') return undefined;
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(valor);
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return undefined;
  return `${m[1]}:${m[2]}:${String(ss).padStart(2, '0')}`;
}

/**
 * Texto obrigatório já aparado, ou `undefined` se não serve.
 *
 * O `trim` acontece aqui e não na rota porque o CHECK do banco é
 * `btrim(titulo) <> ''`: um título com três espaços passaria por
 * `typeof === 'string' && valor` e estouraria no insert.
 */
export function normalizarTitulo(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const t = valor.trim();
  if (!t || t.length > MAX_TITULO) return undefined;
  return t;
}

/**
 * Descrição aparada, `null` quando não há.
 *
 * ⚠️ Não distingue ausente de malformado, ao contrário da hora: descrição é
 * campo livre e opcional, e o único jeito de errá-la é passando do teto —
 * caso em que `undefined` pede a recusa.
 */
export function normalizarDescricao(valor: unknown): string | null | undefined {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor !== 'string') return undefined;
  const t = valor.trim();
  if (!t) return null;
  if (t.length > MAX_DESCRICAO) return undefined;
  return t;
}

/** Forma de UUID — o que o Postgres aceita em `uuid`. Igual à rota de notas. */
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID.test(valor);
}
