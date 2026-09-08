import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  aplicarMudancaDeTags,
  chaveDeTag,
  lerMudancaDeTags,
  MAX_TAGS_POR_CHAMADA,
} from './tags-do-contato';

const resolveImportTagIds = vi.hoisted(() => vi.fn());
const addContactTagAndDispatch = vi.hoisted(() => vi.fn());
const removeContactTag = vi.hoisted(() => vi.fn());

vi.mock('@/lib/contacts/resolve-import-tags', () => ({ resolveImportTagIds }));
vi.mock('@/lib/contacts/tag-events', () => ({ addContactTagAndDispatch }));
vi.mock('@/lib/contacts/tag-write', () => ({
  removeContactTag,
  // A classe de erro é usada pelo módulo sob teste; sem ela no mock, o
  // `throw` vira erro do vitest e o teste mede a coisa errada.
  ContactTagWriteError: class ContactTagWriteError extends Error {
    readonly status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.name = 'ContactTagWriteError';
      this.status = status;
    }
  },
}));

describe('lerMudancaDeTags', () => {
  it('aceita só add, só remove, e os dois juntos', () => {
    expect(lerMudancaDeTags({ add: ['VIP'] })).toEqual({
      ok: true,
      mudanca: { add: ['VIP'], remove: [], criarFaltantes: true },
    });
    expect(lerMudancaDeTags({ remove: ['VIP'] })).toEqual({
      ok: true,
      mudanca: { add: [], remove: ['VIP'], criarFaltantes: true },
    });
    const dois = lerMudancaDeTags({ add: ['A'], remove: ['B'] });
    expect(dois.ok).toBe(true);
  });

  it('apara e deduplica sem diferenciar maiúscula', () => {
    const r = lerMudancaDeTags({ add: ['  VIP  ', 'vip', 'Vip', 'Outra'] });
    expect(r.ok && r.mudanca.add).toEqual(['VIP', 'Outra']);
  });

  it('RECUSA o mesmo nome em add e remove — o resultado dependeria da ordem', () => {
    const r = lerMudancaDeTags({ add: ['VIP'], remove: ['vip'] });
    expect(r).toEqual({
      ok: false,
      erro: "the same tag cannot be in both 'add' and 'remove': vip",
    });
  });

  it('⚠️ a recusa usa a MESMA régua da resolução — acento incluído', () => {
    // Regressão: enquanto a validação usava só `toLowerCase()` e a
    // resolução usava `chaveDeTag()` (que também tira acento),
    // {add:["Bancário"], remove:["bancario"]} PASSAVA pela recusa. Na
    // aplicação, o remove tirava a etiqueta e o add reinseria a MESMA —
    // disparando `tag_added`, que pode mandar mensagem ao cliente por uma
    // etiqueta que ele já tinha antes e continua tendo depois.
    const r = lerMudancaDeTags({ add: ['Bancário'], remove: ['bancario'] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain('cannot be in both');
  });

  it('⚠️ a deduplicação também ignora acento', () => {
    // `["Bancário", "bancario"]` resolve para a MESMA etiqueta; sobreviver
    // como dois nomes fazia o segundo sair como "inalterada", relatando uma
    // mudança que não houve.
    const r = lerMudancaDeTags({ add: ['Bancário', 'bancario', 'BANCARIO'] });
    expect(r.ok && r.mudanca.add).toEqual(['Bancário']);
  });

  it('recusa corpo que não é objeto', () => {
    for (const cru of [null, 'x', 42, ['VIP']]) {
      expect(lerMudancaDeTags(cru).ok).toBe(false);
    }
  });

  it('recusa lista vazia dos dois lados — não haveria o que fazer', () => {
    expect(lerMudancaDeTags({}).ok).toBe(false);
    expect(lerMudancaDeTags({ add: [], remove: [] }).ok).toBe(false);
  });

  it('recusa nome vazio, elemento não-string e lista que não é array', () => {
    expect(lerMudancaDeTags({ add: ['  '] }).ok).toBe(false);
    expect(lerMudancaDeTags({ add: [1] }).ok).toBe(false);
    expect(lerMudancaDeTags({ add: 'VIP' }).ok).toBe(false);
  });

  it('recusa acima do teto', () => {
    const muitas = Array.from(
      { length: MAX_TAGS_POR_CHAMADA + 1 },
      (_, i) => `t${i}`
    );
    expect(lerMudancaDeTags({ add: muitas }).ok).toBe(false);
  });

  it('create_missing só aceita booleano, e o padrão é criar', () => {
    expect(lerMudancaDeTags({ add: ['A'], create_missing: 'sim' }).ok).toBe(
      false
    );
    const off = lerMudancaDeTags({ add: ['A'], create_missing: false });
    expect(off.ok && off.mudanca.criarFaltantes).toBe(false);
    const on = lerMudancaDeTags({ add: ['A'] });
    expect(on.ok && on.mudanca.criarFaltantes).toBe(true);
  });
});

describe('chaveDeTag', () => {
  it('casa ignorando maiúscula E acento', () => {
    // Medido em produção: sem tirar o acento, mandar "bancario" num contato
    // que já tinha "Bancário" CRIAVA uma segunda etiqueta, e o catálogo do
    // escritório ficava com as duas — sem erro nenhum.
    expect(chaveDeTag('Bancário')).toBe(chaveDeTag('bancario'));
    expect(chaveDeTag('  AÇÃO  ')).toBe(chaveDeTag('acao'));
  });

  it('não colapsa nomes de fato diferentes', () => {
    expect(chaveDeTag('Bancário')).not.toBe(chaveDeTag('Bancária'));
  });

  it('usa \\p{Mn}, não \\p{Diacritic} — o acento sozinho é caractere', () => {
    // `\p{Diacritic}` apagaria `^`, `´`, `~` isolados e tornaria iguais
    // nomes distintos.
    expect(chaveDeTag('a^b')).toBe('a^b');
    expect(chaveDeTag('a~b')).toBe('a~b');
  });
});

/**
 * Client de mentira: só a consulta do catálogo de etiquetas.
 *
 * `leituras` permite devolver catálogos DIFERENTES a cada chamada — é assim
 * que se observa a releitura de depois da criação.
 */
function bancoCom(
  tags: { id: string; name: string }[] | { id: string; name: string }[][],
  opts: { falha?: boolean } = {}
) {
  const paginas = Array.isArray(tags[0])
    ? (tags as { id: string; name: string }[][])
    : [tags as { id: string; name: string }[]];
  const chamadas = { n: 0 };
  const resposta = () => {
    if (opts.falha)
      return Promise.resolve({ data: null, error: { message: 'timeout' } });
    const i = Math.min(chamadas.n++, paginas.length - 1);
    return Promise.resolve({ data: paginas[i], error: null });
  };
  const db = {
    chamadas,
    from: () => ({
      select: () => ({
        eq: () => ({
          // duas ordens encadeadas: `created_at` e o desempate por `id`
          order: () => ({ order: resposta }),
        }),
      }),
    }),
  };
  return db as never;
}

describe('aplicarMudancaDeTags', () => {
  const base = {
    accountId: 'conta-1',
    auditUserId: 'dono-1',
    contactId: 'contato-1',
  };
  const CATALOGO = [
    { id: 'id-bancario', name: 'Bancário' },
    { id: 'id-typebot', name: 'Typebot' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('⚠️ nome SEM acento acha a etiqueta COM acento — não cria outra', () => {
    // O caso que motivou a régua própria. É assíncrono; a asserção vem no
    // teste seguinte, este só fixa o formato do catálogo.
    expect(chaveDeTag(CATALOGO[0].name)).toBe('bancario');
  });

  it('acrescenta sem tocar nas outras, e sem criar duplicata por acento', async () => {
    addContactTagAndDispatch.mockResolvedValue({
      added: true,
      dispatched: true,
    });

    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: ['bancario'], remove: [], criarFaltantes: true },
    });

    expect(r.adicionadas).toEqual(['bancario']);
    expect(r.desconhecidas).toEqual([]);
    // NADA foi criado: o casamento achou a etiqueta que já existia.
    expect(resolveImportTagIds).not.toHaveBeenCalled();
    expect(addContactTagAndDispatch).toHaveBeenCalledWith({
      db: expect.anything(),
      accountId: 'conta-1',
      contactId: 'contato-1',
      tagId: 'id-bancario',
    });
  });

  it('etiqueta já aplicada vira "inalterada" e NÃO dispara o gatilho', async () => {
    // `added: false` é o 23505 agindo dentro do helper.
    addContactTagAndDispatch.mockResolvedValue({
      added: false,
      dispatched: false,
      reason: 'duplicate',
    });

    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: ['Typebot'], remove: [], criarFaltantes: true },
    });

    expect(r.adicionadas).toEqual([]);
    expect(r.inalteradas).toEqual(['Typebot']);
  });

  it('⚠️ RELÊ o catálogo depois de criar — corrida converge na mais antiga', async () => {
    // `tags` não tem UNIQUE em `name`, e `resolveImportTagIds` faz
    // ler-então-inserir: duas chamadas concorrentes com o mesmo nome NOVO
    // criam duas linhas. Confiando no id que cada uma inseriu, o contato
    // ganharia AS DUAS etiquetas e o `tag_added` dispararia duas vezes.
    // Relendo, as duas convergem para a mais antiga.
    resolveImportTagIds.mockResolvedValue({
      tagIdByKey: new Map([['nova', 'id-que-EU-inseri']]),
      skippedNames: [],
    });
    addContactTagAndDispatch.mockResolvedValue({
      added: true,
      dispatched: true,
    });

    const db = bancoCom([
      CATALOGO, // antes de criar
      [{ id: 'id-da-outra-requisicao', name: 'Nova' }, ...CATALOGO], // depois
    ]);

    await aplicarMudancaDeTags(db, {
      ...base,
      mudanca: { add: ['Nova'], remove: [], criarFaltantes: true },
    });

    // O id que ESTA requisição inseriu é descartado em favor do que a
    // releitura ordenada devolveu.
    expect(addContactTagAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ tagId: 'id-da-outra-requisicao' })
    );
  });

  it('nome novo de verdade é criado pelo helper compartilhado', async () => {
    resolveImportTagIds.mockResolvedValue({
      tagIdByKey: new Map([['nova', 'id-nova']]),
      skippedNames: [],
    });
    addContactTagAndDispatch.mockResolvedValue({
      added: true,
      dispatched: true,
    });

    // Duas páginas: o catálogo ANTES da criação e o de DEPOIS, que é o que o
    // banco devolveria de verdade na releitura.
    const r = await aplicarMudancaDeTags(
      bancoCom([CATALOGO, [...CATALOGO, { id: 'id-nova', name: 'Nova' }]]),
      {
        ...base,
        mudanca: { add: ['Nova'], remove: [], criarFaltantes: true },
      }
    );

    expect(resolveImportTagIds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tagNames: ['Nova'], canCreateTags: true })
    );
    expect(r.adicionadas).toEqual(['Nova']);
  });

  it('create_missing:false não cria nada e reporta desconhecida', async () => {
    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: ['Nova'], remove: [], criarFaltantes: false },
    });

    expect(resolveImportTagIds).not.toHaveBeenCalled();
    expect(r.desconhecidas).toEqual(['Nova']);
    expect(addContactTagAndDispatch).not.toHaveBeenCalled();
  });

  it('distingue etiqueta retirada de etiqueta que não estava aplicada', async () => {
    removeContactTag.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: {
        add: [],
        remove: ['Typebot', 'bancario'],
        criarFaltantes: true,
      },
    });

    expect(r.removidas).toEqual(['Typebot']);
    expect(r.inalteradas).toEqual(['bancario']);
  });

  it('⚠️ REMOVER nunca cria etiqueta, mesmo com create_missing ligado', async () => {
    const r = await aplicarMudancaDeTags(bancoCom(CATALOGO), {
      ...base,
      mudanca: { add: [], remove: ['Fantasma'], criarFaltantes: true },
    });

    expect(resolveImportTagIds).not.toHaveBeenCalled();
    expect(removeContactTag).not.toHaveBeenCalled();
    expect(r.desconhecidas).toEqual(['Fantasma']);
  });

  it('⚠️ na colisão de chave vence a etiqueta MAIS ANTIGA', async () => {
    // O catálogo chega ordenado por `created_at`; a primeira ocorrência é a
    // que o escritório vem usando. Sem isso a escolha mudaria entre duas
    // chamadas iguais.
    addContactTagAndDispatch.mockResolvedValue({
      added: true,
      dispatched: true,
    });
    const comColisao = [
      { id: 'id-antiga', name: 'Bancário' },
      { id: 'id-nova', name: 'bancario' },
    ];

    await aplicarMudancaDeTags(bancoCom(comColisao), {
      ...base,
      mudanca: { add: ['BANCARIO'], remove: [], criarFaltantes: true },
    });

    expect(addContactTagAndDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ tagId: 'id-antiga' })
    );
  });

  it('falha ao ler o catálogo ESTOURA — não vira "desconhecida"', async () => {
    // Tratar erro de banco como "essa etiqueta não existe" faria a API
    // responder 200 dizendo que o nome é desconhecido, e o integrador
    // recriaria a etiqueta.
    await expect(
      aplicarMudancaDeTags(bancoCom([], { falha: true }), {
        ...base,
        mudanca: { add: ['Typebot'], remove: [], criarFaltantes: true },
      })
    ).rejects.toThrow(/tags/i);
  });
});
