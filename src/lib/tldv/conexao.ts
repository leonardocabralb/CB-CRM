import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ehUrlAlcancavel } from "@/lib/cb-channels/webhook-url";
import { encrypt } from "@/lib/whatsapp/encryption";

import { criarClienteTldv, TldvError, type ClienteTldv } from "./cliente";

/**
 * Conectar e desconectar o tl;dv — I/O. A chave é TESTADA na hora (uma
 * listagem de uma reunião), gravada cifrada, e a conta ganha o token de
 * webhook que o operador cola no painel do tl;dv. Reconectar (trocar a
 * chave) MANTÉM o token: a URL já colada lá continua valendo.
 */

export type CodigoDaConexao = "chave_invalida" | "sem_permissao" | "limite" | "rede" | "tldv_error" | "db_error" | "nao_conectado";

export type ResultadoDaConexao = { ok: true } | { ok: false; codigo: CodigoDaConexao };

type FabricaDeCliente = (chave: string) => ClienteTldv;

/** 24 bytes em base64url = 32 caracteres de `[A-Za-z0-9_-]`. */
export function gerarTokenDeWebhook(): string {
  return randomBytes(24).toString("base64url");
}

export function urlDoWebhook(origem: string, token: string): string {
  return `${origem.replace(/\/+$/, "")}/api/cb/tldv/webhook/${token}`;
}

/** A origem pública do CRM, ou `null` quando ela não é alcançável de fora. */
export function origemPublica(requestOrigin?: string | null): string | null {
  const origem = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") || requestOrigin?.replace(/\/+$/, "") || null;
  return origem && ehUrlAlcancavel(origem) ? origem : null;
}

export async function conectarTldv(
  admin: SupabaseClient,
  accountId: string,
  userId: string,
  chave: string,
  opcoes: { cliente?: FabricaDeCliente } = {},
): Promise<ResultadoDaConexao> {
  const cliente = (opcoes.cliente ?? criarClienteTldv)(chave);
  try {
    await cliente.listarReunioes({ porPagina: 1 });
  } catch (e) {
    const codigo = e instanceof TldvError ? e.codigo : "tldv_error";
    // `nao_encontrado` numa listagem é o tl;dv mudando de forma, não a chave.
    return { ok: false, codigo: codigo === "nao_encontrado" ? "tldv_error" : codigo };
  }

  const { data: existente, error: erroLeitura } = await admin
    .from("cb_tldv_config")
    .select("webhook_token")
    .eq("account_id", accountId)
    .maybeSingle();
  if (erroLeitura) return { ok: false, codigo: "db_error" };

  const agora = new Date().toISOString();
  const { error } = await admin.from("cb_tldv_config").upsert(
    {
      account_id: accountId,
      api_key: encrypt(chave),
      webhook_token: (existente?.webhook_token as string | undefined) ?? gerarTokenDeWebhook(),
      status: "conectado",
      last_error: null,
      created_by: userId,
      updated_at: agora,
    },
    { onConflict: "account_id" },
  );
  if (error) return { ok: false, codigo: "db_error" };
  return { ok: true };
}

/** Apaga a config. As reuniões já importadas FICAM — são histórico do cliente. */
export async function desconectarTldv(admin: SupabaseClient, accountId: string): Promise<ResultadoDaConexao> {
  const { error } = await admin.from("cb_tldv_config").delete().eq("account_id", accountId);
  if (error) return { ok: false, codigo: "db_error" };
  return { ok: true };
}
