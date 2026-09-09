import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setContactTags } from './contacts';

// ============================================================
// `PATCH /api/v1/contacts/{id}` com `tags: [...]` SUBSTITUI o conjunto. Este
// caminho não tinha teste, e escondia um defeito antigo: `resolveImportTagIds`
// devolve o CATÁLOGO INTEIRO chaveado por nome (o import de CSV consulta esse
// mapa linha a linha), e `setContactTags` tomava os `values()` como "as
// desejadas" — aplicando TODAS as etiquetas da conta ao contato.
//
// Só apareceu na verificação e2e da 983: até então `contact_tags` estava
// zerada em produção e não havia chave de API ativa, então o caminho nunca
// rodou com etiqueta de verdade.
// ============================================================

const resolveImportTagIds = vi.hoisted(() => vi.fn());
const addContactTagAndDispatch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/contacts/resolve-import-tags', () => ({ resolveImportTagIds }));
vi.mock('@/lib/contacts/tag-events', () => ({ addContactTagAndDispatch }));

/** Catálogo com QUATRO etiquetas; o teste pede uma. */
const CATALOGO = new Map([
  ['bancario', 'id-bancario'],
  ['trabalhista', 'id-trabalhista'],
  ['typebot', 'id-typebot'],
  ['demitida', 'id-demitida'],
]);

/** Client de mentira: a leitura dos vínculos atuais e as escritas. */
function bancoCom(atuais: string[]) {
  const registro = { apagados: [] as string[][] };
  const db = {
    registro,
    from: () => ({
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: atuais.map((tag_id) => ({ tag_id })),
            error: null,
          }),
      }),
      delete: () => ({
        eq: () => ({
          in: (_coluna: string, ids: string[]) => {
            registro.apagados.push(ids);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }),
  };
  return db as never;
}

describe('setContactTags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveImportTagIds.mockResolvedValue({
      tagIdByKey: CATALOGO,
      skippedNames: [],
    });
    addContactTagAndDispatch.mockResolvedValue({ added: true, dispatched: true });
  });

  it('⚠️ aplica SÓ as etiquetas pedidas, não o catálogo inteiro', async () => {
    const db = bancoCom([]);
    await setContactTags(db, 'conta-1', 'dono-1', 'contato-1', ['Bancário']);

    expect(addContactTagAndDispatch).toHaveBeenCalledTimes(1);
    expect(addContactTagAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ tagId: 'id-bancario' })
    );
  });

  it('casa SEM acento — "bancario" acha a "Bancário" do catálogo', async () => {
    const db = bancoCom([]);
    await setContactTags(db, 'conta-1', 'dono-1', 'contato-1', ['bancario']);

    expect(addContactTagAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ tagId: 'id-bancario' })
    );
  });

  it('SUBSTITUI: tira o que não foi pedido', async () => {
    const db = bancoCom(['id-typebot', 'id-demitida']);
    await setContactTags(db, 'conta-1', 'dono-1', 'contato-1', ['Bancário']);

    const { registro } = db as unknown as { registro: { apagados: string[][] } };
    expect(registro.apagados[0].sort()).toEqual(['id-demitida', 'id-typebot']);
    expect(addContactTagAndDispatch).toHaveBeenCalledTimes(1);
  });

  it('não mexe no que já estava certo', async () => {
    const db = bancoCom(['id-bancario']);
    await setContactTags(db, 'conta-1', 'dono-1', 'contato-1', ['Bancário']);

    const { registro } = db as unknown as { registro: { apagados: string[][] } };
    expect(registro.apagados).toEqual([]);
    // Já aplicada: nada a acrescentar, e nenhum `tag_added` a disparar.
    expect(addContactTagAndDispatch).not.toHaveBeenCalled();
  });

  it('lista vazia limpa tudo', async () => {
    resolveImportTagIds.mockResolvedValue({
      tagIdByKey: new Map(),
      skippedNames: [],
    });
    const db = bancoCom(['id-bancario', 'id-typebot']);
    await setContactTags(db, 'conta-1', 'dono-1', 'contato-1', []);

    const { registro } = db as unknown as { registro: { apagados: string[][] } };
    expect(registro.apagados[0].sort()).toEqual(['id-bancario', 'id-typebot']);
  });

  it('⚠️⚠️ nome pedido que não resolveu ESTOURA — senão apagaria a etiqueta pedida', async () => {
    // Este verbo SUBSTITUI: o que não entra em `desired` entra em
    // `toRemove`. Ignorar um nome irresolvido em silêncio não é "aplicar
    // menos" — é APAGAR do contato justamente a etiqueta que o chamador
    // acabou de pedir para manter. Um `PATCH {tags:["Bancário"]}` num
    // contato que TEM "Bancário" o deixaria sem nenhuma.
    // (Achado da revisão adversarial.)
    resolveImportTagIds.mockResolvedValue({
      tagIdByKey: CATALOGO,
      skippedNames: ['Bancário'],
    });
    const db = bancoCom(['id-bancario']);

    await expect(
      setContactTags(db, 'conta-1', 'dono-1', 'contato-1', ['Bancário'])
    ).rejects.toThrow(/Bancário/);

    // e nada foi apagado no caminho
    const { registro } = db as unknown as { registro: { apagados: string[][] } };
    expect(registro.apagados).toEqual([]);
  });
});
