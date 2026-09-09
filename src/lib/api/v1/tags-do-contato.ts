// ============================================================
// Tags de um contato pela API pública (v1) — ADITIVO.
//
// `PATCH /api/v1/contacts/{id}` com `tags: []` SUBSTITUI o conjunto
// inteiro, e continua assim (é contrato publicado). Este módulo é o
// outro verbo: põe uma tag sem derrubar as demais, e tira uma tag
// específica.
//
// Nasceu da integração com o Typebot: o fluxo aplica "Typebot" no lead
// que acabou de chegar, e pelo caminho substitutivo isso apagaria
// "Bancário", "Cliente Fechado" e o que mais o escritório tivesse posto
// na ficha — em silêncio, porque a resposta seria 200.
//
// ⚠️ A régua de "mesma etiqueta" mora em `@/lib/contacts/chave-de-tag` —
// ela é compartilhada com o import de CSV e tem gêmeo em SQL (a coluna
// gerada `tags.name_key`, migration 983).
//
// ⚠️ Trabalha por NOME, não por id. Não existe `GET /api/v1/tags`
// desde sempre: quem integra não teria como descobrir um UUID de tag
// sem entrar no banco. Casa por `lower(trim(nome))`, a mesma régua do
// import de CSV (`resolveImportTagIds`).
//
// ⚠️ Toda escrita passa pelos helpers centrais
// (`addContactTagAndDispatch` / `removeContactTag`): eles conferem a
// posse do contato E da tag (a tabela `contact_tags` não tem
// `account_id`, então a RLS sozinha não separa contas), tratam o
// 23505 como no-op, e disparam o gatilho `tag_added` uma vez por
// aplicação REAL. Já existem três escritores no repo que furam esses
// helpers; não somar um quarto.
//
// A trilha de auditoria sai de graça: o trigger da 912 grava
// `tag_added`/`tag_removed` em `cb_lead_events` a cada INSERT/DELETE.
// Vindo daqui (service-role, sem `auth.uid()`) ele registra com
// `origin = 'sistema'`. Não escrever log à mão.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { chaveDeTag } from '@/lib/contacts/chave-de-tag';
import {
  lerCatalogoDeTags,
  resolveImportTagIds,
} from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import {
  ContactTagWriteError,
  removeContactTag,
} from '@/lib/contacts/tag-write';

/** Teto por chamada. Um corpo com centenas de nomes é engano, não uso. */
export const MAX_TAGS_POR_CHAMADA = 50;

export interface MudancaDeTags {
  /** Nomes a acrescentar, aparados e sem repetição (case-insensitive). */
  add: string[];
  /** Nomes a retirar, aparados e sem repetição. */
  remove: string[];
  /** Criar tag que ainda não existe na conta (só vale para `add`). */
  criarFaltantes: boolean;
}

export type LeituraDaMudanca =
  { ok: true; mudanca: MudancaDeTags } | { ok: false; erro: string };

function lerLista(valor: unknown, campo: string): string[] | string {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) return `'${campo}' must be an array of tag names`;

  const nomes: string[] = [];
  const vistos = new Set<string>();
  for (const cru of valor) {
    if (typeof cru !== 'string') {
      return `'${campo}' must contain only strings`;
    }
    const nome = cru.trim();
    if (!nome) return `'${campo}' must not contain empty tag names`;
    // ⚠️ A deduplicação usa `chaveDeTag`, a MESMA régua da resolução —
    // nunca `toLowerCase()` sozinho. Elas divergiram por uma revisão:
    // `add: ["Bancário", "bancario"]` sobrevivia como dois nomes porque a
    // validação só rebaixava a caixa, e a resolução (que também tira o
    // acento) mandava os dois para a MESMA etiqueta.
    const chave = chaveDeTag(nome);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    nomes.push(nome);
  }
  return nomes;
}

/**
 * Lê e valida o corpo de `POST /api/v1/contacts/{id}/tags`. Puro.
 *
 * ⚠️ O mesmo nome em `add` e em `remove` é RECUSADO, não resolvido por
 * ordem: qualquer ordem que escolhêssemos seria uma convenção invisível
 * para quem integra, e o resultado (tem ou não tem a tag no fim) mudaria
 * conforme a leitura de quem escreveu o fluxo.
 */
export function lerMudancaDeTags(corpo: unknown): LeituraDaMudanca {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) {
    return { ok: false, erro: 'Request body must be a JSON object' };
  }
  const c = corpo as Record<string, unknown>;

  const add = lerLista(c.add, 'add');
  if (typeof add === 'string') return { ok: false, erro: add };
  const remove = lerLista(c.remove, 'remove');
  if (typeof remove === 'string') return { ok: false, erro: remove };

  if (add.length === 0 && remove.length === 0) {
    return {
      ok: false,
      erro: "provide at least one tag name in 'add' or 'remove'",
    };
  }
  if (add.length + remove.length > MAX_TAGS_POR_CHAMADA) {
    return {
      ok: false,
      erro: `at most ${MAX_TAGS_POR_CHAMADA} tag names per request`,
    };
  }

  // ⚠️ `chaveDeTag`, e não `toLowerCase()`: com a régua fraca,
  // `{add:["Bancário"], remove:["bancario"]}` PASSAVA pela recusa e, na
  // aplicação, removia e reinseria a MESMA etiqueta — disparando o gatilho
  // `tag_added`, que pode mandar mensagem ao cliente por uma etiqueta que
  // ele já tinha antes e continua tendo depois. Toda comparação de nome de
  // etiqueta neste arquivo passa por `chaveDeTag`.
  const emAdd = new Set(add.map((n) => chaveDeTag(n)));
  const dosDois = remove.filter((n) => emAdd.has(chaveDeTag(n)));
  if (dosDois.length > 0) {
    return {
      ok: false,
      erro: `the same tag cannot be in both 'add' and 'remove': ${dosDois.join(', ')}`,
    };
  }

  if (c.create_missing !== undefined && typeof c.create_missing !== 'boolean') {
    return { ok: false, erro: "'create_missing' must be a boolean" };
  }

  return {
    ok: true,
    mudanca: {
      add,
      remove,
      // Padrão `true`: o caso de uso é um fluxo externo etiquetando lead
      // novo, e exigir que a tag já exista faria a integração falhar na
      // primeira execução, quando ninguém está olhando.
      criarFaltantes: c.create_missing !== false,
    },
  };
}

export interface ResultadoDaMudanca {
  /** Nomes que passaram a valer agora. */
  adicionadas: string[];
  /** Nomes que deixaram de valer agora. */
  removidas: string[];
  /** Já estavam no estado pedido — nada foi escrito. */
  inalteradas: string[];
  /** Não existem como tag nesta conta (e não foram criadas). */
  desconhecidas: string[];
}

/**
 * Aplica a mudança. Faz I/O; a validação do corpo é o `lerMudancaDeTags`
 * acima.
 *
 * Remove antes de acrescentar. Não há sobreposição possível (o parse
 * recusa), então a ordem não muda o resultado — mas tirar primeiro é o
 * que deixa a conta no estado pedido mesmo se algo estourar no meio.
 */
export async function aplicarMudancaDeTags(
  db: SupabaseClient,
  args: {
    accountId: string;
    auditUserId: string;
    contactId: string;
    mudanca: MudancaDeTags;
  }
): Promise<ResultadoDaMudanca> {
  const { accountId, auditUserId, contactId, mudanca } = args;
  const r: ResultadoDaMudanca = {
    adicionadas: [],
    removidas: [],
    inalteradas: [],
    desconhecidas: [],
  };

  // O catálogo, pela MESMA leitura que a criação usa — paginada e ordenada.
  // Duas cópias divergiriam na primeira mudança, e a ordem é o que decide
  // quem vence uma colisão de chave.
  let porChave: Map<string, string>;
  try {
    porChave = await lerCatalogoDeTags(db, accountId);
  } catch {
    throw new ContactTagWriteError("Failed to read the account's tags");
  }

  // ── Retirar ────────────────────────────────────────────────
  // NUNCA cria: criar uma etiqueta para em seguida tentar removê-la do
  // contato é trabalho para produzir um no-op, e deixaria lixo no catálogo
  // do escritório a cada nome digitado errado.
  for (const nome of mudanca.remove) {
    const tagId = porChave.get(chaveDeTag(nome));
    if (!tagId) {
      r.desconhecidas.push(nome);
      continue;
    }
    const saiu = await removeContactTag(db, { accountId, contactId, tagId });
    (saiu ? r.removidas : r.inalteradas).push(nome);
  }

  // ── Acrescentar ────────────────────────────────────────────
  const faltantes = mudanca.add.filter((n) => !porChave.has(chaveDeTag(n)));
  if (faltantes.length > 0) {
    if (mudanca.criarFaltantes) {
      // A CRIAÇÃO continua no helper compartilhado: é ele que sabe a cor
      // padrão e o `user_id` de auditoria. Só o CASAMENTO é nosso.
      // A criação — e a CONVERGÊNCIA — moram no helper compartilhado desde
      // a 983: ele insere com `ON CONFLICT DO NOTHING` sobre o índice único
      // `(account_id, name_key)` e relê, então duas requisições concorrentes
      // com o mesmo nome novo terminam no MESMO id. O mapa que ele devolve
      // já é o catálogo inteiro depois da criação, chaveado por
      // `chaveDeTag` — a mesma chave usada aqui.
      const { tagIdByKey, skippedNames } = await resolveImportTagIds(db, {
        accountId,
        userId: auditUserId,
        tagNames: faltantes,
        canCreateTags: true,
      });
      porChave = tagIdByKey;
      // ⚠️ Nome que pediu criação e mesmo assim não resolveu precisa APARECER
      // na resposta. Sem isto ele não entrava em NENHUM dos quatro baldes: o
      // integrador recebia 200, via o nome ausente de `adicionadas`, de
      // `inalteradas` e de `desconhecidas`, e não tinha como saber que a
      // etiqueta não foi aplicada. (Achado da revisão adversarial.)
      r.desconhecidas.push(...skippedNames);
    } else {
      r.desconhecidas.push(...faltantes);
    }
  }

  for (const nome of mudanca.add) {
    const tagId = porChave.get(chaveDeTag(nome));
    // Já contabilizado em `desconhecidas` — pelo ramo do `create_missing:
    // false` acima, ou pelo `skippedNames` da criação.
    if (!tagId) continue;
    // `added: false` = o 23505 agiu: a etiqueta já estava aplicada. Não é
    // erro, e o helper garante que o gatilho `tag_added` NÃO dispara nesse
    // caso.
    const { added } = await addContactTagAndDispatch({
      db,
      accountId,
      contactId,
      tagId,
    });
    (added ? r.adicionadas : r.inalteradas).push(nome);
  }

  return r;
}
