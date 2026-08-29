// ============================================================
// Campos personalizados na API pública — o miolo PURO (Fase 6).
//
// Existe para o n8n do gestor: os campos de traqueamento (e os gerais)
// são endereçados pela CHAVE estável da 948 (`utm_source`,
// `ctwa_clid`, `data_da_proposta`…), nunca por UUID — o UUID continua
// sendo o endereço dos consumidores INTERNOS (automações, lembrete,
// broadcast), e a chave é o contrato EXTERNO.
//
// Este módulo não faz I/O: a rota resolve as linhas e delega aqui a
// serialização e a validação da escrita, que são o que merece teste.
// ============================================================

import { opcoesDoCampo } from '@/components/contacts/campo-personalizado-input';
import type { CustomField } from '@/types';

export interface ApiCustomFieldValue {
  key: string;
  name: string;
  /** 'text' | 'datetime' | 'select' | 'number' (CHECK da 948). */
  type: string;
  /** 'geral' | 'tracking' (949) — a aba de Traqueamento é a categoria. */
  category: string;
  /** Só em campos `select`; ausente nos demais. */
  options?: string[];
  /** TEXT cru do banco; null quando o contato não tem valor. */
  value: string | null;
}

/**
 * O payload do GET (e do PATCH, que devolve o estado pós-escrita):
 * `fields` traz o catálogo inteiro da conta com o valor do contato, e
 * `values` é o MESMO dado como mapa chave→valor — é o formato que uma
 * expressão de n8n indexa sem precisar varrer array.
 */
export function serializeCustomFields(
  fields: CustomField[],
  valuesByFieldId: Record<string, string>,
): { fields: ApiCustomFieldValue[]; values: Record<string, string | null> } {
  const lista = fields.map((f) => {
    const item: ApiCustomFieldValue = {
      key: f.field_key,
      name: f.field_name,
      type: f.field_type,
      category: f.categoria ?? 'geral',
      value: valuesByFieldId[f.id] ?? null,
    };
    if (f.field_type === 'select') item.options = opcoesDoCampo(f);
    return item;
  });
  return {
    fields: lista,
    values: Object.fromEntries(lista.map((f) => [f.key, f.value])),
  };
}

/**
 * Valida o corpo do PATCH e traduz chaves → ids de campo.
 *
 * Regras do contrato:
 * - valor `string` grava (aparado); `number`/`boolean` viram string —
 *   integrador manda `55` ou `true` sem cerimônia, o banco é TEXT mesmo;
 * - `""` e `null` LIMPAM o valor (viram `''`, que o
 *   `salvarValoresDoContato` traduz em DELETE da linha);
 * - chave desconhecida é ERRO (400 com a lista), nunca ignorada em
 *   silêncio — um typo de `utm_sorce` no n8n tem de aparecer na primeira
 *   chamada, não meses depois na auditoria;
 * - objeto/array como valor é erro de tipo.
 */
export function prepararEscritaPorChave(
  fields: Pick<CustomField, 'id' | 'field_key'>[],
  values: Record<string, unknown>,
):
  | { ok: true; porId: Record<string, string> }
  | { ok: false; desconhecidas: string[]; invalidas: string[] } {
  const porChave = new Map(fields.map((f) => [f.field_key, f.id]));
  const porId: Record<string, string> = {};
  const desconhecidas: string[] = [];
  const invalidas: string[] = [];

  for (const [chave, bruto] of Object.entries(values)) {
    const id = porChave.get(chave);
    if (!id) {
      desconhecidas.push(chave);
      continue;
    }
    if (bruto === null || bruto === '') {
      porId[id] = '';
    } else if (typeof bruto === 'string') {
      porId[id] = bruto.trim();
    } else if (typeof bruto === 'number' || typeof bruto === 'boolean') {
      porId[id] = String(bruto);
    } else {
      invalidas.push(chave);
    }
  }

  if (desconhecidas.length > 0 || invalidas.length > 0) {
    return { ok: false, desconhecidas, invalidas };
  }
  return { ok: true, porId };
}
