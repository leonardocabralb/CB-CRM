import type { SupabaseClient } from "@supabase/supabase-js";

import type { DealStatus } from "@/types";

import type { Achado, ChavesDoSignatario, Nivel } from "./casamento";

/**
 * As consultas do casamento — o I/O de `casamento.ts`. Toda consulta leva
 * `.eq('account_id', …)`: roda em service role, que ignora a RLS.
 *
 * ⚠️ Erro de banco NUNCA é "não achei": cada função devolve `{ ok: false }`,
 * e quem chama grava `recebido` (reprocessável) em vez de `sem_contato` — um
 * soluço do banco não pode dizer ao operador que o cliente não existe.
 */

export type Busca<T> = { ok: true; valor: T } | { ok: false; erro: string };

export interface NegocioAchado {
  id: string;
  contactId: string | null;
  status: DealStatus | null;
}

const STATUS: readonly string[] = ["open", "won", "lost"];

/** O negócio pelo id, SÓ desta conta. */
export async function negocioDaConta(admin: SupabaseClient, accountId: string, dealId: string): Promise<Busca<NegocioAchado | null>> {
  const { data, error } = await admin
    .from("deals")
    .select("id, contact_id, status")
    .eq("id", dealId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) return { ok: false, erro: `busca do negócio falhou: ${error.message}` };
  if (!data) return { ok: true, valor: null };
  const status = typeof data.status === "string" && STATUS.includes(data.status) ? (data.status as DealStatus) : null;
  return { ok: true, valor: { id: data.id as string, contactId: (data.contact_id as string | null) ?? null, status } };
}

/** O negócio que o CRM registrou para este documento (o passo "Gerar contrato", futuro). */
export async function negocioRegistrado(admin: SupabaseClient, accountId: string, docToken: string): Promise<Busca<string | null>> {
  const { data, error } = await admin
    .from("cb_zapsign_documentos")
    .select("deal_id")
    .eq("account_id", accountId)
    .eq("doc_token", docToken)
    .maybeSingle();
  if (error) return { ok: false, erro: `leitura do documento falhou: ${error.message}` };
  return { ok: true, valor: (data?.deal_id as string | null | undefined) ?? null };
}

/** Os números das conexões da conta — o escritório não casa como cliente. */
export async function telefonesDasConexoes(admin: SupabaseClient, accountId: string): Promise<Busca<string[]>> {
  const { data, error } = await admin.from("cb_channels").select("display_phone").eq("account_id", accountId);
  if (error) return { ok: false, erro: `leitura das conexões falhou: ${error.message}` };
  const telefones = ((data ?? []) as { display_phone: string | null }[])
    .map((c) => c.display_phone ?? "")
    .filter((t) => t !== "");
  return { ok: true, valor: telefones };
}

/** O campo personalizado `cpf` da conta, se existir (sem ele, o nível do CPF não roda). */
export async function campoDeCpf(admin: SupabaseClient, accountId: string): Promise<Busca<string | null>> {
  const { data, error } = await admin
    .from("custom_fields")
    .select("id")
    .eq("account_id", accountId)
    .eq("field_key", "cpf")
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, erro: `leitura do campo CPF falhou: ${error.message}` };
  return { ok: true, valor: (data?.id as string | undefined) ?? null };
}

/** `%`, `_` e `\` literais num padrão de LIKE. */
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Os contatos que casam com os signatários num nível. O filtro do banco é só
 * o PRÉ-filtro; quem decide é a conferência em JS (`=== alvo`), então um
 * padrão largo demais nunca casa errado — só traz candidato a mais.
 */
export async function acharNoNivel(
  admin: SupabaseClient,
  accountId: string,
  nivel: Nivel,
  chaves: readonly ChavesDoSignatario[],
  campoCpfId: string | null,
): Promise<Busca<Achado[]>> {
  const achados: Achado[] = [];

  if (nivel === "telefone") {
    const porCanonico = new Map<string, string>();
    for (const c of chaves) if (c.telefone && !porCanonico.has(c.telefone)) porCanonico.set(c.telefone, c.token);
    if (porCanonico.size === 0) return { ok: true, valor: [] };
    // A coluna gerada da 1024 (a chave ÚNICA por conta): as duas grafias do
    // nono dígito dão a mesma — nunca o casamento pelos 8 finais, que junta
    // pessoas de DDDs diferentes.
    const { data, error } = await admin
      .from("contacts")
      .select("id, telefone_canonico")
      .eq("account_id", accountId)
      .in("telefone_canonico", [...porCanonico.keys()]);
    if (error) return { ok: false, erro: `busca por telefone falhou: ${error.message}` };
    for (const l of (data ?? []) as { id: string; telefone_canonico: string | null }[]) {
      const token = l.telefone_canonico ? porCanonico.get(l.telefone_canonico) : undefined;
      if (token) achados.push({ contactId: l.id, signatarioToken: token });
    }
    return { ok: true, valor: achados };
  }

  if (nivel === "email") {
    const vistos = new Set<string>();
    for (const c of chaves) {
      if (!c.email || vistos.has(c.email)) continue;
      vistos.add(c.email);
      const { data, error } = await admin
        .from("contacts")
        .select("id, email")
        .eq("account_id", accountId)
        .ilike("email", escaparLike(c.email))
        .limit(20);
      if (error) return { ok: false, erro: `busca por e-mail falhou: ${error.message}` };
      for (const l of (data ?? []) as { id: string; email: string | null }[]) {
        if ((l.email ?? "").trim().toLowerCase() === c.email) achados.push({ contactId: l.id, signatarioToken: c.token });
      }
    }
    return { ok: true, valor: achados };
  }

  // CPF: só com o campo `cpf` da conta; os dígitos comparados em JS (o valor
  // pode estar gravado com ou sem pontuação). O LIKE com os dígitos em ordem
  // (`%5%2%9…`) é o pré-filtro que casa as duas grafias.
  if (!campoCpfId) return { ok: true, valor: [] };
  const vistos = new Set<string>();
  const candidatos: Achado[] = [];
  for (const c of chaves) {
    if (!c.cpf || vistos.has(c.cpf)) continue;
    vistos.add(c.cpf);
    const { data, error } = await admin
      .from("contact_custom_values")
      .select("contact_id, value")
      .eq("custom_field_id", campoCpfId)
      .like("value", `%${c.cpf.split("").join("%")}%`)
      .limit(20);
    if (error) return { ok: false, erro: `busca por CPF falhou: ${error.message}` };
    for (const l of (data ?? []) as { contact_id: string; value: string | null }[]) {
      if ((l.value ?? "").replace(/\D/g, "") === c.cpf) candidatos.push({ contactId: l.contact_id, signatarioToken: c.token });
    }
  }
  if (candidatos.length === 0) return { ok: true, valor: [] };
  // `contact_custom_values` não tem `account_id`: o contato é conferido na conta.
  const { data, error } = await admin
    .from("contacts")
    .select("id")
    .eq("account_id", accountId)
    .in("id", [...new Set(candidatos.map((a) => a.contactId))]);
  if (error) return { ok: false, erro: `conferência dos contatos do CPF falhou: ${error.message}` };
  const daConta = new Set(((data ?? []) as { id: string }[]).map((l) => l.id));
  return { ok: true, valor: candidatos.filter((a) => daConta.has(a.contactId)) };
}

/** A conversa do contato, se existir (única por conta, 036). Nunca cria. */
export async function conversaDoContato(
  admin: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<{ id: string; channelId: string | null } | null> {
  const { data, error } = await admin
    .from("conversations")
    .select("id, channel_id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Sem a conversa a automação ainda roda (o card se move); só os passos
    // que falam com o cliente ficam sem para onde mandar.
    console.warn("[zapsign] não foi possível ler a conversa do contato:", error.message);
    return null;
  }
  return data ? { id: data.id as string, channelId: (data.channel_id as string | null) ?? null } : null;
}
