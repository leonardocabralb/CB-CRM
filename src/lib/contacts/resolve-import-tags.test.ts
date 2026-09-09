import { describe, expect, it } from 'vitest';

import { resolveImportTagIds } from './resolve-import-tags';

// ============================================================
// Este helper é a porta ÚNICA de criação de etiqueta: import de CSV,
// `PATCH /api/v1/contacts/{id}` e `POST .../tags` passam todos por aqui. Não
// tinha teste, e é onde a corrida do PR #150 morava.
// ============================================================

type Linha = { id: string; name: string };

/**
 * Client de mentira. `catalogos` é a sequência de respostas da leitura —
 * assim dá para observar a RELEITURA de depois da criação, e simular a
 * corrida (outra requisição criou a etiqueta primeiro).
 */
function bancoCom(catalogos: Linha[][], opts: { erroAoCriar?: string } = {}) {
  const registro = {
    leituras: 0,
    upserts: [] as { linhas: Record<string, unknown>[]; opcoes: unknown }[],
  };
  const db = {
    registro,
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => {
              const i = Math.min(registro.leituras++, catalogos.length - 1);
              return Promise.resolve({ data: catalogos[i], error: null });
            },
          }),
        }),
      }),
    }),
    // `upsert(...).select('id')`
    upsert: (linhas: Record<string, unknown>[], opcoes: unknown) => {
      registro.upserts.push({ linhas, opcoes });
      return {
        select: () =>
          Promise.resolve(
            opts.erroAoCriar
              ? { data: null, error: { message: opts.erroAoCriar } }
              : { data: [], error: null }
          ),
      };
    },
  };
  // `from()` devolve o mesmo objeto para select e upsert
  db.from = () =>
    ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => {
              const i = Math.min(registro.leituras++, catalogos.length - 1);
              return Promise.resolve({ data: catalogos[i], error: null });
            },
          }),
        }),
      }),
      upsert: db.upsert,
    }) as never;
  return db as never;
}

const args = (tagNames: string[], canCreateTags = true) => ({
  accountId: 'conta-1',
  userId: 'dono-1',
  tagNames,
  canCreateTags,
});

const CATALOGO: Linha[] = [
  { id: 'id-bancario', name: 'Bancário' },
  { id: 'id-typebot', name: 'Typebot' },
];

describe('resolveImportTagIds', () => {
  it('⚠️ casa SEM acento — não cria uma segunda "bancario"', async () => {
    const db = bancoCom([CATALOGO]);
    const r = await resolveImportTagIds(db, args(['bancario']));

    expect(r.tagIdByKey.get('bancario')).toBe('id-bancario');
    expect(r.skippedNames).toEqual([]);
    expect((db as unknown as { registro: { upserts: unknown[] } }).registro.upserts).toEqual([]);
  });

  it('casa ignorando caixa', async () => {
    const db = bancoCom([CATALOGO]);
    const r = await resolveImportTagIds(db, args(['TYPEBOT']));
    expect(r.tagIdByKey.get('typebot')).toBe('id-typebot');
  });

  it('deduplica a entrada pela mesma chave', async () => {
    const db = bancoCom([CATALOGO, CATALOGO]);
    await resolveImportTagIds(db, args(['Nova', 'NOVA', 'nóva']));
    const { registro } = db as unknown as {
      registro: { upserts: { linhas: Record<string, unknown>[] }[] };
    };
    // Um nome só chega à criação, não três.
    expect(registro.upserts[0].linhas).toHaveLength(1);
  });

  it('⚠️ cria com ON CONFLICT DO NOTHING sobre o índice único da 983', async () => {
    // Ler-então-inserir deixava duas requisições concorrentes criarem as
    // DUAS. O árbitro é a coluna GERADA `name_key` — índice sobre expressão
    // não serviria, porque o `on_conflict` do PostgREST aceita nome de
    // coluna.
    const db = bancoCom([CATALOGO, [...CATALOGO, { id: 'id-nova', name: 'Nova' }]]);
    await resolveImportTagIds(db, args(['Nova']));

    const { registro } = db as unknown as {
      registro: { upserts: { opcoes: unknown }[] };
    };
    expect(registro.upserts[0].opcoes).toEqual({
      onConflict: 'account_id,name_key',
      ignoreDuplicates: true,
    });
  });

  it('⚠️ o id sai da RELEITURA, não do retorno do insert — é o que faz a corrida convergir', async () => {
    // Com `ignoreDuplicates`, quem perde a corrida recebe ZERO linhas de
    // volta. Se o id viesse do retorno, essa requisição ficaria sem etiqueta;
    // vindo da releitura, ela enxerga a que a OUTRA criou e as duas terminam
    // no mesmo id — uma linha em `contact_tags`, um disparo de `tag_added`.
    const db = bancoCom([
      CATALOGO, // antes
      [...CATALOGO, { id: 'id-da-outra-requisicao', name: 'Nova' }], // depois
    ]);
    const r = await resolveImportTagIds(db, args(['Nova']));

    expect(r.tagIdByKey.get('nova')).toBe('id-da-outra-requisicao');
    expect(r.skippedNames).toEqual([]);
  });

  it('sem permissão de criar, o nome novo volta em skippedNames', async () => {
    const db = bancoCom([CATALOGO]);
    const r = await resolveImportTagIds(db, args(['Nova'], false));

    expect(r.skippedNames).toEqual(['Nova']);
    expect((db as unknown as { registro: { upserts: unknown[] } }).registro.upserts).toEqual([]);
  });

  it('⚠️ inserção barrada por RLS (0 linhas, sem erro) vira "pulado", não mapa incompleto', async () => {
    // RLS que recusa escrita devolve 0 linhas com `error: null`. Devolver um
    // mapa sem aquele nome, calado, faria o chamador atribuir menos
    // etiquetas do que pediu e não perceber.
    const db = bancoCom([CATALOGO, CATALOGO]); // a releitura não traz a nova
    const r = await resolveImportTagIds(db, args(['Nova']));

    expect(r.skippedNames).toEqual(['Nova']);
    expect(r.tagIdByKey.has('nova')).toBe(false);
  });

  it('erro de banco na criação ESTOURA', async () => {
    const db = bancoCom([CATALOGO], { erroAoCriar: 'timeout' });
    await expect(resolveImportTagIds(db, args(['Nova']))).rejects.toBeTruthy();
  });

  it('lista vazia não toca no banco', async () => {
    const db = bancoCom([CATALOGO]);
    const r = await resolveImportTagIds(db, args([]));
    expect(r.tagIdByKey.size).toBe(0);
    expect((db as unknown as { registro: { leituras: number } }).registro.leituras).toBe(0);
  });

  it('⚠️ na colisão de chave vence a MAIS ANTIGA (a leitura vem ordenada)', async () => {
    // Base anterior à 983 pode ter as duas: a migration RENOMEIA em vez de
    // apagar, para não quebrar referência em JSON de automação.
    const db = bancoCom([
      [
        { id: 'id-antiga', name: 'Bancário' },
        { id: 'id-nova', name: 'bancario' },
      ],
    ]);
    const r = await resolveImportTagIds(db, args(['BANCARIO']));
    expect(r.tagIdByKey.get('bancario')).toBe('id-antiga');
  });
});
