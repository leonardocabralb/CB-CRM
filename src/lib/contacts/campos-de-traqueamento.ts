import type { CustomField } from "@/types";

/**
 * O catálogo PADRÃO da aba de Traqueamento (949).
 *
 * São os campos que um clique em anúncio da Meta produz e que a futura
 * integração com a API de Conversões vai precisar devolver: os cinco UTMs,
 * os dois click-ids (`fbclid` do tráfego comum, `ctwa_clid` do
 * click-to-WhatsApp) e os três nomes legíveis que o operador pediu por
 * extenso (campanha, conjunto, anúncio).
 *
 * ⚠️ As CHAVES são contrato. `utm_source`/`fbclid`/`ctwa_clid` têm o nome
 * do parâmetro real de propósito — quem for mapear webhook de entrada ou
 * exportar para a Meta procura por esses nomes, não por tradução. Por isso
 * os rótulos técnicos também NÃO se traduzem na tela (mesma regra dos
 * rótulos do painel da Meta no CLAUDE.md).
 *
 * O seed é feito PELA UI (botão na aba, admin), nunca por migration —
 * migration não cria dado por conta.
 */
export const CAMPOS_DE_TRAQUEAMENTO: ReadonlyArray<{
  key: string;
  nome: string;
}> = [
  { key: "nome_da_campanha", nome: "Nome da campanha" },
  { key: "nome_do_conjunto", nome: "Nome do conjunto" },
  { key: "nome_do_anuncio", nome: "Nome do anúncio" },
  { key: "utm_source", nome: "utm_source" },
  { key: "utm_medium", nome: "utm_medium" },
  { key: "utm_campaign", nome: "utm_campaign" },
  { key: "utm_term", nome: "utm_term" },
  { key: "utm_content", nome: "utm_content" },
  { key: "fbclid", nome: "fbclid" },
  { key: "ctwa_clid", nome: "ctwa_clid" },
];

/**
 * Quais campos do padrão ainda não existem na conta.
 *
 * Compara pela CHAVE contra o catálogo inteiro (qualquer categoria): a
 * chave é única por conta (948), então um campo `utm_source` já criado
 * como "geral" conta como existente — semear outro estouraria o índice
 * único, e o certo é o operador decidir o que fazer com o que já existe.
 */
export function camposFaltantes(
  existentes: Pick<CustomField, "field_key">[],
): Array<{ key: string; nome: string }> {
  const chaves = new Set(existentes.map((f) => f.field_key));
  return CAMPOS_DE_TRAQUEAMENTO.filter((c) => !chaves.has(c.key));
}

/** Recorte da aba: só os campos da categoria de traqueamento. */
export function camposDeTraqueamento(campos: CustomField[]): CustomField[] {
  return campos.filter((f) => f.categoria === "tracking");
}

/** Recorte da seção CAMPOS da aba Principal: tudo que NÃO é traqueamento. */
export function camposGerais(campos: CustomField[]): CustomField[] {
  return campos.filter((f) => f.categoria !== "tracking");
}
