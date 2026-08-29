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

// ⚠️ Imports só de módulos PUROS. Este arquivo roda dentro de um route
// handler (layer RSC): importar de um arquivo "use client" transformaria a
// função num client-reference proxy que LANÇA ao ser chamado — com build,
// typecheck e vitest verdes (só a requisição real quebra; reproduzido no
// Next 16.2.12 em 2026-08-29, quando `opcoesDoCampo` ainda morava no
// componente).
import { opcoesDoCampo } from '@/lib/contacts/campo-opcoes';
import { TIPO_DATA } from '@/lib/contacts/campo-data';
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
  valuesByFieldId: Record<string, string>
): { fields: ApiCustomFieldValue[]; values: Record<string, string | null> } {
  const lista = fields.map((f) => {
    // `''` no banco (a automação `update_contact_field` grava variável que
    // resolveu vazia sem checar) sai como `null` no wire: a doc promete que
    // campo vazio é null, e um n8n testando `value === null` não pode errar
    // conforme QUEM escreveu o vazio.
    const bruto = valuesByFieldId[f.id];
    const item: ApiCustomFieldValue = {
      key: f.field_key,
      name: f.field_name,
      type: f.field_type,
      category: f.categoria ?? 'geral',
      value: bruto !== undefined && bruto.trim() !== '' ? bruto : null,
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
 * Teto de UM valor. Espelha o `MAX_DESCRICAO` das tarefas — a mesma
 * convenção "POST fora da tela não pode gravar um blob": sem teto, uma
 * string de megabytes vira linha TEXT que todo GET (e a ficha do contato)
 * arrasta para sempre.
 */
export const MAX_VALOR = 4000;

/**
 * Instante com OFFSET explícito (`Z` ou `±HH:MM`/`±HHMM`) — a regra da v1
 * para datas (CLAUDE.md): sem offset o Postgres/JS lê como UTC e o
 * lembrete erra 3h em silêncio.
 */
const COM_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Valida o corpo do PATCH e traduz chaves → ids de campo.
 *
 * Regras do contrato:
 * - valor `string` grava (aparado); `number`/`boolean` viram string —
 *   integrador manda `55` ou `true` sem cerimônia, o banco é TEXT mesmo;
 * - `""` e `null` LIMPAM o valor (viram `''`, que o
 *   `salvarValoresDoContato` traduz em DELETE da linha);
 * - campo `datetime` só aceita instante ISO-8601 COM offset, e grava
 *   NORMALIZADO em UTC (a forma que a tela grava e que `cb_para_timestamp`
 *   lê). Sem isso, um `"31/12/2026"` do n8n respondia 200, o input da
 *   ficha nascia vazio e o lembrete da 935 nunca disparava — dado morto
 *   sem erro em lugar nenhum. `select`/`number` continuam texto livre,
 *   como a UI (tolerância documentada);
 * - chave desconhecida é ERRO (400 com a lista), nunca ignorada em
 *   silêncio — um typo de `utm_sorce` no n8n tem de aparecer na primeira
 *   chamada, não meses depois na auditoria;
 * - objeto/array como valor é erro de tipo; valor acima de `MAX_VALOR` é
 *   erro de tamanho.
 */
export function prepararEscritaPorChave(
  fields: Pick<CustomField, 'id' | 'field_key' | 'field_type'>[],
  values: Record<string, unknown>
):
  | { ok: true; porId: Record<string, string> }
  | {
      ok: false;
      desconhecidas: string[];
      invalidas: string[];
      datasInvalidas: string[];
      longas: string[];
    } {
  const porChave = new Map(fields.map((f) => [f.field_key, f]));
  const porId: Record<string, string> = {};
  const desconhecidas: string[] = [];
  const invalidas: string[] = [];
  const datasInvalidas: string[] = [];
  const longas: string[] = [];

  for (const [chave, bruto] of Object.entries(values)) {
    const field = porChave.get(chave);
    if (!field) {
      desconhecidas.push(chave);
      continue;
    }

    let texto: string;
    if (bruto === null || bruto === '') {
      porId[field.id] = '';
      continue;
    } else if (typeof bruto === 'string') {
      texto = bruto.trim();
    } else if (typeof bruto === 'number' || typeof bruto === 'boolean') {
      texto = String(bruto);
    } else {
      invalidas.push(chave);
      continue;
    }

    // `"   "` também limpa (o trim acima já a esvaziou) — documentado.
    if (texto === '') {
      porId[field.id] = '';
      continue;
    }
    if (texto.length > MAX_VALOR) {
      longas.push(chave);
      continue;
    }
    if (field.field_type === TIPO_DATA) {
      const instante = Date.parse(texto);
      if (!COM_OFFSET.test(texto) || Number.isNaN(instante)) {
        datasInvalidas.push(chave);
        continue;
      }
      texto = new Date(instante).toISOString();
    }
    porId[field.id] = texto;
  }

  if (
    desconhecidas.length > 0 ||
    invalidas.length > 0 ||
    datasInvalidas.length > 0 ||
    longas.length > 0
  ) {
    return { ok: false, desconhecidas, invalidas, datasInvalidas, longas };
  }
  return { ok: true, porId };
}
