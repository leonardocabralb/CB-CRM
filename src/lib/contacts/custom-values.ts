import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Salva os valores de campos personalizados de UM contato.
 *
 * ⚠️ UPSERT + delete só dos esvaziados — NUNCA delete-all + re-insert. A
 * versão antiga (contact-detail-view) apagava TODAS as linhas do contato e
 * reinseria as preenchidas: uma falha entre o delete e o insert perdia todos
 * os valores, sem volta. O upsert é o padrão que o motor de automações já usa
 * (`update_contact_field`, engine.ts) — o UNIQUE(contact_id, custom_field_id)
 * da 001 é total, então serve de alvo de ON CONFLICT (não é o caso dos
 * índices parciais da 903).
 *
 * `valores` é o mapa completo da tela: id do campo → texto. Vazio ("") quer
 * dizer "limpar" — vira DELETE daquela linha só. Campo ausente do mapa não é
 * tocado.
 *
 * Roda no NAVEGADOR sob RLS (`agent`+ modifica, via posse do contato) — o
 * mesmo regime da tela que já existia. Devolve `null` no sucesso ou a
 * mensagem de erro (quem chama mostra o toast; aqui não há UI).
 */
export async function salvarValoresDoContato(
  supabase: SupabaseClient,
  contactId: string,
  valores: Record<string, string>,
): Promise<string | null> {
  const preenchidos = Object.entries(valores)
    .filter(([, v]) => v.trim() !== "")
    .map(([fieldId, v]) => ({
      contact_id: contactId,
      custom_field_id: fieldId,
      value: v.trim(),
    }));
  const esvaziados = Object.entries(valores)
    .filter(([, v]) => v.trim() === "")
    .map(([fieldId]) => fieldId);

  if (preenchidos.length > 0) {
    const { error } = await supabase
      .from("contact_custom_values")
      .upsert(preenchidos, { onConflict: "contact_id,custom_field_id" });
    if (error) return error.message;
  }

  if (esvaziados.length > 0) {
    const { error } = await supabase
      .from("contact_custom_values")
      .delete()
      .eq("contact_id", contactId)
      .in("custom_field_id", esvaziados);
    if (error) return error.message;
  }

  return null;
}
