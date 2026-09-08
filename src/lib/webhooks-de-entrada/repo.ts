// ============================================================
// Leitura e escrita de `cb_webhooks`. Roda SEMPRE em service role: a
// tabela não dá nada a `authenticated` (982), então não existe caminho
// pelo navegador.
// ============================================================

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ehUrlAlcancavel } from "@/lib/cb-channels/webhook-url";
import { decrypt, encrypt } from "@/lib/whatsapp/encryption";

/**
 * Colunas que podem sair para a tela. `segredo` NÃO está aqui, nem
 * mascarado: quem o perdeu gera outro.
 */
export const COLUNAS_DO_WEBHOOK =
  "id, nome, token, sem_segredo, is_active, campo_telefone, campo_nome, campo_id, last_event_at, created_at";

export interface WebhookDeEntrada {
  id: string;
  nome: string;
  token: string;
  sem_segredo: boolean;
  is_active: boolean;
  campo_telefone: string | null;
  campo_nome: string | null;
  campo_id: string | null;
  last_event_at: string | null;
  created_at: string;
}

/**
 * Endereço, não credencial: identifica QUAL webhook na URL. 24 bytes
 * base64url — o mesmo tamanho do token do Calendly, e dentro do
 * `{16,64}` que a rota exige antes de tocar no banco.
 */
export function gerarToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * A credencial de verdade, conferida contra o cabeçalho de cada entrega.
 * Guardada CIFRADA; mostrada em claro uma única vez, na criação.
 */
export function gerarSegredo(): string {
  return randomBytes(32).toString("hex");
}

export function urlDoWebhook(origem: string, token: string): string {
  return `${origem.replace(/\/+$/, "")}/api/cb/entrada/${token}`;
}

/**
 * A origem pública do CRM, ou `null` quando ela não é alcançável de fora.
 *
 * ⚠️ Aqui isto é AVISO, não recusa — diferente do Calendly, onde a URL é
 * REGISTRADA na plataforma e uma origem local mataria a assinatura em
 * silêncio. Neste fluxo quem copia a URL é o operador, então uma origem
 * local só significa que a URL mostrada não serve fora da máquina dele,
 * e é isso que a tela precisa dizer.
 */
export function origemPublica(requestOrigin?: string | null): string | null {
  const origem =
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ||
    requestOrigin?.replace(/\/+$/, "") ||
    null;
  return origem && ehUrlAlcancavel(origem) ? origem : null;
}

/**
 * Compara o segredo recebido com o gravado, em tempo constante.
 *
 * ⚠️ `timingSafeEqual` ESTOURA quando os comprimentos diferem, e é por
 * isso que o tamanho é conferido antes — com a comparação de tamanho
 * feita em separado, de propósito: ela vaza só o comprimento do segredo,
 * que não ajuda quem tenta adivinhá-lo.
 */
export function segredoConfere(
  recebido: string | null,
  esperado: string
): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido, "utf8");
  const b = Buffer.from(esperado, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Cria o webhook. Devolve a linha e o segredo EM CLARO (uma única vez). */
export async function criarWebhook(
  admin: SupabaseClient,
  args: {
    accountId: string;
    nome: string;
    semSegredo: boolean;
    campoTelefone: string | null;
    campoNome: string | null;
    campoId: string | null;
    createdBy: string | null;
  }
): Promise<
  | { ok: true; webhook: WebhookDeEntrada; segredo: string | null }
  | { ok: false; erro: "nome_repetido" | "db_error" }
> {
  const segredo = args.semSegredo ? null : gerarSegredo();

  const { data, error } = await admin
    .from("cb_webhooks")
    .insert({
      account_id: args.accountId,
      nome: args.nome.trim(),
      token: gerarToken(),
      segredo: segredo ? encrypt(segredo) : null,
      sem_segredo: args.semSegredo,
      campo_telefone: args.campoTelefone,
      campo_nome: args.campoNome,
      campo_id: args.campoId,
      created_by: args.createdBy,
    })
    .select(COLUNAS_DO_WEBHOOK)
    .single();

  if (error) {
    // 23505 aqui é o índice de nome por conta: vira PERGUNTA na tela
    // ("já existe um webhook com esse nome"), não erro cru.
    if (error.code === "23505") return { ok: false, erro: "nome_repetido" };
    console.error("[webhooks-de-entrada] criar:", error);
    return { ok: false, erro: "db_error" };
  }
  return {
    ok: true,
    webhook: data as unknown as WebhookDeEntrada,
    segredo,
  };
}

/** Os webhooks da conta, mais novo primeiro. */
export async function listarWebhooks(
  admin: SupabaseClient,
  accountId: string
): Promise<WebhookDeEntrada[] | null> {
  const { data, error } = await admin
    .from("cb_webhooks")
    .select(COLUNAS_DO_WEBHOOK)
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[webhooks-de-entrada] listar:", error);
    return null;
  }
  return (data ?? []) as unknown as WebhookDeEntrada[];
}

/**
 * O segredo em claro de um webhook, para a conferência da entrega.
 * `null` quando o webhook é declaradamente aberto; lança quando a
 * `ENCRYPTION_KEY` não abre o que está gravado (chave rotacionada).
 */
export function segredoEmClaro(linha: {
  segredo: string | null;
  sem_segredo: boolean;
}): string | null {
  if (linha.sem_segredo) return null;
  if (!linha.segredo) {
    // O CHECK da 982 torna isto inalcançável; se chegou aqui, o banco foi
    // mexido por fora e a porta está destrancada — recusar é o certo.
    throw new Error("webhook sem segredo e sem se declarar aberto");
  }
  return decrypt(linha.segredo);
}

/** Colunas que o PATCH aceita. Fora daqui, salva e some no reload. */
export const CAMPOS_EDITAVEIS = [
  "nome",
  "is_active",
  "campo_telefone",
  "campo_nome",
  "campo_id",
] as const;
