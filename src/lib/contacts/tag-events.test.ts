import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('./tag-write', () => ({
  addContactTagIfAbsent: mocks.add,
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.dispatch,
}));

import {
  addContactTagAndDispatch,
  getTagChainDepth,
  MAX_TAG_CHAIN_DEPTH,
} from './tag-events';

/**
 * Stub do cliente Supabase para a busca do canal do contato.
 *
 * `resposta` decide o que a consulta a `conversations` devolve; `chamadas`
 * conta quantas vezes ela foi feita, que é como se prova que quem já traz o
 * canal no contexto não paga a viagem ao banco.
 */
function dbFalso(resposta: {
  data?: { channel_id: string | null } | null;
  error?: unknown;
  lanca?: boolean;
}) {
  const chamadas: string[] = [];
  const encadeavel: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'not', 'order', 'limit']) {
    encadeavel[m] = () => encadeavel;
  }
  encadeavel.maybeSingle = async () => {
    if (resposta.lanca) throw new Error('conexão caiu no meio');
    return { data: resposta.data ?? null, error: resposta.error ?? null };
  };
  return {
    chamadas,
    db: {
      from: (tabela: string) => {
        chamadas.push(tabela);
        return encadeavel;
      },
    } as never,
  };
}

const base = {
  db: dbFalso({ data: null }).db,
  accountId: 'account-1',
  contactId: 'contact-1',
  tagId: 'tag-1',
};

beforeEach(() => {
  mocks.add.mockReset();
  mocks.dispatch.mockReset();
  mocks.dispatch.mockResolvedValue(undefined);
});

describe('addContactTagAndDispatch', () => {
  it('dispatches once for a newly inserted tag and propagates depth', async () => {
    mocks.add.mockResolvedValue(true);

    const result = await addContactTagAndDispatch({
      ...base,
      context: {
        channel_id: 'ch-1',
        vars: { source: 'flow', _tag_chain_depth: 1 },
      },
    });

    expect(result).toEqual({ added: true, dispatched: true });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      accountId: 'account-1',
      triggerType: 'tag_added',
      contactId: 'contact-1',
      context: {
        tag_id: 'tag-1',
        channel_id: 'ch-1',
        vars: { source: 'flow', _tag_chain_depth: 2 },
      },
    });
  });

  // ----------------------------------------------------------
  // Canal no disparo de `tag_added`.
  //
  // Etiqueta era o único gatilho que chegava ao motor sem canal. Como
  // `channelInScope` trata "sem canal" como passe livre, uma automação restrita
  // ao número Comercial disparava para cliente do número Pessoal — calada.
  // ----------------------------------------------------------

  it('CRÍTICO: carimba o canal da conversa quando quem chama não sabe qual é', async () => {
    mocks.add.mockResolvedValue(true);
    const { db, chamadas } = dbFalso({ data: { channel_id: 'ch-pessoal' } });

    await addContactTagAndDispatch({ ...base, db });

    expect(chamadas).toEqual(['conversations']);
    expect(mocks.dispatch.mock.calls[0][0].context.channel_id).toBe('ch-pessoal');
  });

  it('quem já traz o canal no contexto não vai ao banco', async () => {
    mocks.add.mockResolvedValue(true);
    const { db, chamadas } = dbFalso({ data: { channel_id: 'ch-da-conversa' } });

    // É o caso do fluxo e da automação: o canal da run/do disparo é mais
    // preciso que "a conversa mais recente", e sobrevive ao passo `wait`.
    await addContactTagAndDispatch({ ...base, db, context: { channel_id: 'ch-do-disparo' } });

    expect(chamadas).toEqual([]);
    expect(mocks.dispatch.mock.calls[0][0].context.channel_id).toBe('ch-do-disparo');
  });

  it('contato sem conversa com canal dispara com channel_id nulo', async () => {
    mocks.add.mockResolvedValue(true);
    const { db } = dbFalso({ data: null });

    await addContactTagAndDispatch({ ...base, db });

    expect(mocks.dispatch.mock.calls[0][0].context.channel_id).toBeNull();
  });

  it('falha ao buscar o canal NÃO derruba o disparo — a etiqueta já foi gravada', async () => {
    mocks.add.mockResolvedValue(true);
    const { db } = dbFalso({ lanca: true });

    await expect(addContactTagAndDispatch({ ...base, db })).resolves.toEqual({
      added: true,
      dispatched: true,
    });
    expect(mocks.dispatch.mock.calls[0][0].context.channel_id).toBeNull();
  });

  it('erro do PostgREST também é engolido, não vira exceção', async () => {
    mocks.add.mockResolvedValue(true);
    const { db } = dbFalso({ data: null, error: { message: 'boom' } });

    await expect(addContactTagAndDispatch({ ...base, db })).resolves.toEqual({
      added: true,
      dispatched: true,
    });
    expect(mocks.dispatch.mock.calls[0][0].context.channel_id).toBeNull();
  });

  it('does not dispatch when the tag already exists', async () => {
    mocks.add.mockResolvedValue(false);

    await expect(addContactTagAndDispatch(base)).resolves.toEqual({
      added: false,
      dispatched: false,
      reason: 'duplicate',
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('adds the tag but cuts a chain at the configured depth limit', async () => {
    mocks.add.mockResolvedValue(true);

    await expect(
      addContactTagAndDispatch({
        ...base,
        context: { vars: { _tag_chain_depth: MAX_TAG_CHAIN_DEPTH } },
      })
    ).resolves.toEqual({
      added: true,
      dispatched: false,
      reason: 'max_depth',
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('cuts an A-to-B-to-A tag chain before it can loop forever', async () => {
    mocks.add.mockResolvedValue(true);
    mocks.dispatch.mockImplementation(async (event) => {
      const nextTag = event.context.tag_id === 'tag-a' ? 'tag-b' : 'tag-a';
      await addContactTagAndDispatch({
        ...base,
        tagId: nextTag,
        context: event.context,
      });
    });

    await addContactTagAndDispatch({ ...base, tagId: 'tag-a' });

    expect(mocks.dispatch).toHaveBeenCalledTimes(MAX_TAG_CHAIN_DEPTH);
    expect(mocks.add).toHaveBeenCalledTimes(MAX_TAG_CHAIN_DEPTH + 1);
  });
});

describe('getTagChainDepth', () => {
  it('normalizes missing, invalid and fractional values', () => {
    expect(getTagChainDepth()).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: '3' } })).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: -1 } })).toBe(0);
    expect(getTagChainDepth({ vars: { _tag_chain_depth: 2.8 } })).toBe(2);
  });
});
