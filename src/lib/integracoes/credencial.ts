import type { SupabaseClient } from "@supabase/supabase-js";

import { ambienteDoAtlas, noAmbiente } from "@/lib/atlas/enderecos";
import { decrypt } from "@/lib/whatsapp/encryption";

/**
 * A credencial de cada integração NA TELA (1127; pedido do operador,
 * 06/11/2026; plano em `docs/PLANO-credencial-das-integracoes.md`): QUAL
 * chave está guardada, QUANDO foi gravada, por QUEM e quando respondeu pela
 * última vez. É o que deixa o administrador comparar a chave do CRM com a do
 * painel do provedor sem desconectar nada.
 *
 * ⚠️ Da chave só saem os 4 ÚLTIMOS caracteres, calculados AQUI, no servidor
 * (decisão do operador, 06/11/2026 — antes nenhuma rota a devolvia, nem
 * mascarada). Chave curta (menos de 16) não mostra nem isso: 4 de 10 já
 * seriam uma fração grande dela. A chave inteira nunca sai do servidor.
 *
 * As tabelas de config são FECHADAS ao navegador: tudo aqui é lido com a
 * service role, por quem já passou pelo `requireRole('admin')`. As chaves de
 * IA moram em `cb_ia_chaves`, que só `src/lib/ia-chaves/repo.ts` toca (pino
 * `chaves.chamadores.test.ts`): o bloco delas vem de `credencialDoProvedor`.
 */

export const INTEGRACOES = ["tldv", "calendly", "meta_ads", "asaas", "zapsign", "atlas"] as const;
export type Integracao = (typeof INTEGRACOES)[number];

export function ehIntegracao(valor: unknown): valor is Integracao {
  return typeof valor === "string" && (INTEGRACOES as readonly string[]).includes(valor);
}

export interface Credencial {
  /** Os 4 últimos caracteres; `null` com a chave curta demais ou ilegível. */
  final: string | null;
  /** A chave existe e NÃO decifra (`ENCRYPTION_KEY` trocada): o saída é colar de novo. */
  ilegivel: boolean;
  /** Quando a chave ATUAL foi gravada; `null` = gravada antes da 1127. */
  gravadaEm: string | null;
  /** O nome de quem a gravou; `null` = não se sabe (autor apagado, perfil sem nome). */
  gravadaPor: string | null;
  /** A última vez que a chave guardada respondeu; `null` = nunca testada. Só das integrações. */
  conferidaEm: string | null;
}

export const CARACTERES_DO_FINAL = 4;
export const TAMANHO_MINIMO_PARA_O_FINAL = 16;

/** Puro: os 4 últimos caracteres, ou `null` quando a chave é curta demais. */
export function finalDaChave(chave: string): string | null {
  const limpa = chave.trim();
  return limpa.length >= TAMANHO_MINIMO_PARA_O_FINAL ? limpa.slice(-CARACTERES_DO_FINAL) : null;
}

/** Decifra só para tirar o final; a chave decifrada não sai daqui. */
export function finalDaCifrada(cifrada: unknown): { final: string | null; ilegivel: boolean } {
  if (typeof cifrada !== "string" || cifrada === "") return { final: null, ilegivel: true };
  try {
    return { final: finalDaChave(decrypt(cifrada)), ilegivel: false };
  } catch {
    return { final: null, ilegivel: true };
  }
}

/** Onde mora a chave de cada integração (todas com `conectado_em`, `conferido_em` e `created_by`). */
const FONTES: Record<Integracao, { tabela: string; coluna: string }> = {
  tldv: { tabela: "cb_tldv_config", coluna: "api_key" },
  calendly: { tabela: "cb_calendly_config", coluna: "access_token" },
  meta_ads: { tabela: "cb_meta_ads_config", coluna: "access_token" },
  asaas: { tabela: "cb_asaas_config", coluna: "api_key" },
  zapsign: { tabela: "cb_zapsign_config", coluna: "api_token" },
  atlas: { tabela: "cb_atlas_config", coluna: "api_key" },
};

/**
 * O nome de quem gravou, do perfil NESTA conta. Falha de leitura vira `null`
 * com log: o nome é a parte menos importante do bloco, e "não sei quem" não
 * afirma nada.
 */
export async function nomeDoAutor(admin: SupabaseClient, accountId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await admin
    .from("profiles")
    .select("full_name, email")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[credencial] leitura do autor falhou:", error.message);
    return null;
  }
  const nome = typeof data?.full_name === "string" ? data.full_name.trim() : "";
  return nome || (typeof data?.email === "string" && data.email ? data.email : null);
}

/**
 * A credencial da integração, ou `null` quando ela não está conectada.
 * Erro de leitura é `db_error`, nunca "não conectada" (CLAUDE.md 8b).
 */
export async function lerCredencial(
  admin: SupabaseClient,
  accountId: string,
  de: Integracao,
): Promise<Credencial | null | "db_error"> {
  const fonte = FONTES[de];
  const consulta = admin
    .from(fonte.tabela)
    .select(`${fonte.coluna}, conectado_em, conferido_em, created_by`)
    .eq("account_id", accountId);
  // ⚠️ Atlas: só a conexão DESTE ambiente (`integracoes-atlas.md`, 1072): a
  // instância apontada para o staging não decifra a chave da produção nem para
  // mostrar o final.
  const { data, error } = await (de === "atlas" ? noAmbiente(consulta, ambienteDoAtlas()) : consulta).maybeSingle();
  if (error) return "db_error";
  if (!data) return null;
  const linha = data as unknown as Record<string, unknown>;
  const { final, ilegivel } = finalDaCifrada(linha[fonte.coluna]);
  return {
    final,
    ilegivel,
    gravadaEm: typeof linha.conectado_em === "string" ? linha.conectado_em : null,
    gravadaPor: await nomeDoAutor(admin, accountId, typeof linha.created_by === "string" ? linha.created_by : null),
    conferidaEm: typeof linha.conferido_em === "string" ? linha.conferido_em : null,
  };
}

export type ResultadoDoTeste = { ok: true } | { ok: false; codigo: string; faltando?: string[] };

/**
 * O que o "Testar agora" grava (tl;dv, Calendly, Meta Ads e Asaas; Atlas e
 * ZapSign têm o `registrarConferencia` deles, do mesmo molde):
 * - respondeu → carimba `conferido_em` e devolve a conexão a `conectado`
 *   SÓ se o erro gravado é um dos que este teste PROVA resolvidos (`limpa`):
 *   outro erro (rede numa sincronização, webhook recusado) é de outra coisa e
 *   não se apaga de carona — a próxima sincronização o reescreve ou limpa;
 * - recusou por causa da chave (`marca`) → a conexão vai a `erro` com o
 *   código, como a sincronização faria;
 * - rede, limite, erro do provedor → nada muda: não é resposta sobre a chave.
 * Nunca lança; falha de escrita fica no log (o resultado do teste já é a
 * resposta que a tela precisa).
 *
 * ⚠️ `cerca`: a coluna da chave e o texto cifrado que o teste LEU. Toda
 * escrita vai cercada por ele: trocada a chave no meio do teste, o 401 da
 * chave ANTIGA não marca a conexão NOVA em erro (e nem o sucesso dela carimba
 * a nova como testada) — a cerca de posse de sempre (CLAUDE.md 8e).
 */
export async function registrarTeste(
  admin: SupabaseClient,
  tabela: string,
  accountId: string,
  resultado: ResultadoDoTeste,
  codigos: { marca: readonly string[]; limpa: readonly string[] },
  cerca: { coluna: string; valor: string },
): Promise<void> {
  const agora = new Date().toISOString();
  const daChaveTestada = (patch: Record<string, unknown>) =>
    admin.from(tabela).update(patch).eq("account_id", accountId).eq(cerca.coluna, cerca.valor);
  if (resultado.ok) {
    const { error } = await daChaveTestada({ conferido_em: agora });
    if (error) console.error(`[credencial] ${tabela}: não foi possível carimbar o teste:`, error.message);
    const { error: erroLimpeza } = await daChaveTestada({ status: "conectado", last_error: null, updated_at: agora })
      .eq("status", "erro")
      .in("last_error", [...codigos.limpa]);
    if (erroLimpeza) console.error(`[credencial] ${tabela}: não foi possível limpar o erro da chave:`, erroLimpeza.message);
    return;
  }
  if (!codigos.marca.includes(resultado.codigo)) return;
  const { error } = await daChaveTestada({ status: "erro", last_error: resultado.codigo, updated_at: agora });
  if (error) console.error(`[credencial] ${tabela}: não foi possível marcar a chave recusada:`, error.message);
}
