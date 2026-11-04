// ============================================================
// A configuração da chave de API que o ADMIN escolhe (1120): validade,
// funcionário dono e funis. A régua das duas rotas de gestão
// (`POST /api/account/api-keys` e `PATCH /api/account/api-keys/[id]`).
//
// Puro na leitura do corpo (testado); as conferências contra a conta
// recebem o cliente da sessão do admin (RLS) e a conta.
//
// Decisões do operador (04/11/2026, `docs/PLANO-chave-por-funcionario.md`):
// validade padrão de 90 dias no formulário; a chave recortada por funil é
// SÓ DE LEITURA (o admin edita a chave depois, mas não lhe dá escrita).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { ehEscopoDeLeitura, type ApiScope } from '@/lib/api-keys/scopes';
import { ehUuid } from '@/lib/tasks/validar';

/**
 * As colunas que a tela lê da chave. `key_hash` NUNCA entra: o segredo não
 * sai do servidor.
 */
export const COLUNAS_DA_CHAVE =
  'id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at, membro_user_id, funis';

/** Teto da validade (1 ano), o mesmo do link de convite. */
export const VALIDADE_MAXIMA_DIAS = 365;
/** As opções do formulário; a 1ª é o padrão (decisão do operador: 90). */
export const OPCOES_DE_VALIDADE_DIAS = [90, 30, 180, 365] as const;
/** Teto de funis numa chave: a conta tem meia dúzia; o teto barra lixo. */
export const MAXIMO_DE_FUNIS = 50;

export type Leitura<T> = { ok: true; valor: T } | { ok: false; erro: string };

/**
 * `expiresInDays`: número > 0 = vence em N dias a partir de AGORA (com teto);
 * `null` = sem validade. Ausente (`undefined`) = não mexer (só no PATCH; no
 * POST, ausente = sem validade, o contrato de antes).
 */
export function lerValidade(
  bruto: unknown,
  agora: number
): Leitura<string | null | undefined> {
  if (bruto === undefined) return { ok: true, valor: undefined };
  if (bruto === null) return { ok: true, valor: null };
  if (typeof bruto !== 'number' || !Number.isFinite(bruto) || bruto <= 0) {
    return { ok: false, erro: "'expiresInDays' must be a positive number or null" };
  }
  const dias = Math.min(Math.floor(bruto), VALIDADE_MAXIMA_DIAS);
  return { ok: true, valor: new Date(agora + dias * 24 * 60 * 60 * 1000).toISOString() };
}

/** `membroUserId`: UUID do login do funcionário; `null` = chave da conta. */
export function lerMembro(bruto: unknown): Leitura<string | null | undefined> {
  if (bruto === undefined) return { ok: true, valor: undefined };
  if (bruto === null) return { ok: true, valor: null };
  if (!ehUuid(bruto)) return { ok: false, erro: "'membroUserId' must be a UUID or null" };
  return { ok: true, valor: bruto as string };
}

/**
 * `funis`: lista de UUIDs de funil, sem repetição; `null` = todos. ⚠️ Lista
 * VAZIA é recusada: "nenhum funil" não é uma chave útil, e "vazio = todos"
 * abriria a conta inteira por um clique errado.
 */
export function lerFunis(bruto: unknown): Leitura<string[] | null | undefined> {
  if (bruto === undefined) return { ok: true, valor: undefined };
  if (bruto === null) return { ok: true, valor: null };
  if (!Array.isArray(bruto)) return { ok: false, erro: "'funis' must be an array or null" };
  if (bruto.length === 0) {
    return { ok: false, erro: "'funis' must not be empty (use null for every pipeline)" };
  }
  const out: string[] = [];
  for (const item of bruto) {
    if (!ehUuid(item)) return { ok: false, erro: "'funis' must contain pipeline UUIDs" };
    const id = (item as string).toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  if (out.length > MAXIMO_DE_FUNIS) {
    return { ok: false, erro: `'funis' accepts at most ${MAXIMO_DE_FUNIS} pipelines` };
  }
  return { ok: true, valor: out };
}

/** Chave recortada só lê: devolve o primeiro escopo de escrita, se houver. */
export function escritaNaChaveRecortada(
  funis: string[] | null,
  scopes: readonly ApiScope[]
): ApiScope | null {
  if (!funis) return null;
  return scopes.find((s) => !ehEscopoDeLeitura(s)) ?? null;
}

/**
 * Todos os funis pedidos são DESTA conta? Erro de leitura LANÇA (a rota
 * responde 500, nunca "funil inválido").
 */
export async function funisSaoDaConta(
  db: SupabaseClient,
  accountId: string,
  funis: string[]
): Promise<boolean> {
  const { data, error } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .in('id', funis);
  if (error) throw new Error(`pipelines lookup failed: ${error.message}`);
  return (data ?? []).length === funis.length;
}

/**
 * O funcionário é membro ATIVO desta conta? Suspenso não ganha chave (ela
 * seria recusada a cada chamada). Erro de leitura LANÇA.
 */
export async function membroAtivoDaConta(
  db: SupabaseClient,
  accountId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('profiles')
    .select('id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .is('suspenso_em', null)
    .limit(1);
  if (error) throw new Error(`member lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}
