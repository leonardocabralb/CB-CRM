import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DIAS_NA_LIXEIRA,
  FICHAS_POR_CHAMADA,
  diasRestantes,
  fatiar,
  lerExclusaoDefinitiva,
  lerItem,
  lerMover,
  lerNegociosNaLixeira,
  lerPrevia,
  lerRessalvas,
  lerVolta,
  motivoDoCodigo,
  motivoDoErro,
  previaTemAviso,
  resolvidosDoMover,
  type PreviaDaFicha,
} from './lixeira';

// ============================================================
// A leitura do que as funções da Lixeira (1097) devolvem. Cada leitor tem
// três perguntas: a forma CERTA (copiada do `jsonb_build_object` da
// migration), a forma TORTA (nulo — a tela não afirma o que não leu) e os
// CAMPOS FALTANDO (o item sem identidade sai; o resto vira nulo/zero).
// ============================================================

const SQL = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'supabase',
    'migrations',
    '1097_cb_lixeira_de_contatos.sql'
  ),
  'utf8'
);

const FICHA = '11111111-1111-1111-1111-111111111111';
const OUTRA = '22222222-2222-2222-2222-222222222222';
const ITEM = '33333333-3333-3333-3333-333333333333';
const LOTE = '44444444-4444-4444-4444-444444444444';

describe('as constantes batem com o banco', () => {
  it('90 dias: o mesmo intervalo do `vence_em` da tabela', () => {
    expect(SQL).toMatch(
      new RegExp(
        `vence_em\\s+timestamptz\\s+NOT\\s+NULL\\s+DEFAULT\\s+now\\(\\)\\s*\\+\\s*interval\\s+'${DIAS_NA_LIXEIRA} days'`
      )
    );
  });

  it('a fatia cabe no teto da função (que recusa o lote acima dele)', () => {
    const teto = Number(
      SQL.match(
        /cardinality\(v_ids\)\s*>\s*(\d+)\s+THEN\s+RAISE\s+EXCEPTION\s+'lote_grande_demais'/
      )?.[1]
    );
    expect(teto).toBe(100);
    expect(FICHAS_POR_CHAMADA).toBeGreaterThan(0);
    expect(FICHAS_POR_CHAMADA).toBeLessThanOrEqual(teto);
  });
});

describe('motivoDoCodigo — cada recusa que a 1097 produz', () => {
  // [código (SQLSTATE ou o `codigo` do item), texto (SQLERRM), motivo]
  const CASOS: [
    string | null,
    string | null,
    ReturnType<typeof motivoDoCodigo>,
  ][] = [
    // As portas: `RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501'`.
    ['42501', 'so_admin', 'so_admin'],
    // A suspensão vem com o MESMO SQLSTATE: o texto decide.
    ['42501', 'membro_suspenso', 'membro_suspenso'],
    // 42501 de outra origem (EXECUTE revogado, RLS) também é falta de papel.
    [
      '42501',
      'permission denied for function cb_mover_contatos_para_lixeira',
      'so_admin',
    ],
    [null, 'so_admin', 'so_admin'],
    // A trava (`lock_timeout` de 3 s) e o impasse: outra pessoa mexendo.
    ['55P03', 'canceling statement due to lock timeout', 'ocupada'],
    ['40P01', 'deadlock detected', 'ocupada'],
    // FK que prende a ficha.
    [
      '23503',
      'update or delete on table "contacts" violates foreign key constraint',
      'presa',
    ],
    // O teto de tempo do PostgREST.
    ['57014', 'canceling statement due to statement timeout', 'demorou'],
    // As regras (P0001), pelo prefixo do texto.
    ['P0001', 'lixeira_schema_mudou:contact_custom_values', 'esquema_mudou'],
    ['P0001', 'lixeira_sem_tratamento:cb_tabela_nova', 'sem_tratamento'],
    ['P0001', 'lixeira_sem_tratamento:deals.contact_id', 'sem_tratamento'],
    [
      'P0001',
      'lixeira_sem_tratamento:cb_tabela_nova:sem_chave',
      'sem_tratamento',
    ],
    [
      'P0001',
      'lixeira_sem_tratamento:gatilho:conversations.cb_gatilho_novo',
      'sem_tratamento',
    ],
    [
      'P0001',
      'lixeira_gatilho_sem_sinal:conversations.set_updated_at',
      'sem_tratamento',
    ],
    // A restauração devolve estes no próprio `codigo` do item.
    ['identidade_ocupada', null, 'identidade_ocupada'],
    ['em_processamento', null, 'em_processamento'],
    // P0001 sem frase própria na tela.
    ['P0001', 'lote_grande_demais', 'falhou'],
    ['P0001', 'contas_diferentes', 'falhou'],
    ['P0001', 'lixeira_fecho_sem_fim', 'falhou'],
    ['P0001', 'lixeira_ficha_nao_voltou', 'falhou'],
    // A restauração apanha `unique_violation` também: é a identidade tomada
    // entre a conferência da B2 e a reinserção — tentar de novo mostra quem.
    [
      '23505',
      'duplicate key value violates unique constraint "idx_contacts_account_telefone_canonico"',
      'ocupada',
    ],
    [null, null, 'falhou'],
    ['', '', 'falhou'],
  ];

  for (const [codigo, texto, esperado] of CASOS) {
    it(`${codigo ?? 'sem código'} · ${texto ?? 'sem texto'} → ${esperado}`, () => {
      expect(motivoDoCodigo(codigo, texto)).toBe(esperado);
    });
  }

  it('cada texto de recusa usado acima existe na migration (nenhum inventado)', () => {
    for (const texto of [
      'so_admin',
      'membro_suspenso',
      'lote_grande_demais',
      'contas_diferentes',
      'lixeira_fecho_sem_fim',
      'lixeira_ficha_nao_voltou',
      'lixeira_schema_mudou:%',
      'lixeira_sem_tratamento:%',
      'lixeira_sem_tratamento:%:sem_chave',
      'lixeira_sem_tratamento:gatilho:%.%',
      'lixeira_gatilho_sem_sinal:%.%',
    ]) {
      expect(SQL, texto).toContain(`RAISE EXCEPTION '${texto}'`);
    }
    for (const codigo of ['identidade_ocupada', 'em_processamento']) {
      expect(SQL, codigo).toContain(`'codigo', '${codigo}'`);
    }
  });

  it('motivoDoErro lê o erro inteiro do PostgREST', () => {
    expect(motivoDoErro({ code: '42501', message: 'membro_suspenso' })).toBe(
      'membro_suspenso'
    );
    expect(motivoDoErro({ code: '57014', message: null })).toBe('demorou');
    expect(motivoDoErro({})).toBe('falhou');
    expect(motivoDoErro(null)).toBe('falhou');
  });
});

describe('lerMover', () => {
  it('a forma certa: lote e uma linha por ficha, com o motivo só na recusada', () => {
    const r = lerMover({
      lote_id: LOTE,
      itens: [
        { id: FICHA, resultado: 'movida' },
        {
          id: OUTRA,
          resultado: 'recusada',
          codigo: '55P03',
          motivo: 'canceling statement due to lock timeout',
        },
        { id: ITEM, resultado: 'sumiu' },
      ],
    });
    expect(r).toEqual({
      loteId: LOTE,
      fichas: [
        { id: FICHA, resultado: 'movida', motivo: null },
        { id: OUTRA, resultado: 'recusada', motivo: 'ocupada' },
        { id: ITEM, resultado: 'sumiu', motivo: null },
      ],
    });
  });

  it('lote sem nada (ids vazios) é resposta, não ignorância', () => {
    expect(lerMover({ lote_id: LOTE, itens: [] })).toEqual({
      loteId: LOTE,
      fichas: [],
    });
  });

  it('forma torta → nulo', () => {
    for (const bruto of [
      null,
      undefined,
      'x',
      [],
      { itens: [] },
      { lote_id: LOTE },
      { lote_id: '', itens: [] },
      { lote_id: LOTE, itens: {} },
    ]) {
      expect(lerMover(bruto)).toBeNull();
    }
  });

  it('item sem id ou com resultado desconhecido sai; recusada sem código vira "falhou"', () => {
    const r = lerMover({
      lote_id: LOTE,
      itens: [
        null,
        'x',
        { resultado: 'movida' },
        { id: FICHA, resultado: 'apagada' },
        { id: OUTRA, resultado: 'recusada' },
      ],
    });
    expect(r?.fichas).toEqual([
      { id: OUTRA, resultado: 'recusada', motivo: 'falhou' },
    ]);
  });

  it('a recusa de regra chega com o texto do RAISE', () => {
    const r = lerMover({
      lote_id: LOTE,
      itens: [
        {
          id: FICHA,
          resultado: 'recusada',
          codigo: 'P0001',
          motivo: 'lixeira_sem_tratamento:cb_x',
        },
      ],
    });
    expect(r?.fichas[0].motivo).toBe('sem_tratamento');
  });
});

describe('fatiar e resolvidosDoMover', () => {
  it('fatias na ordem pedida, sem repetir, no tamanho da chamada', () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    const fatias = fatiar([...ids, 'id-3', 'id-0']);
    expect(fatias.map((f) => f.length)).toEqual([25, 25, 1]);
    expect(fatias.flat()).toEqual(ids);
  });

  it('vazio → nenhuma fatia; tamanho explícito', () => {
    expect(fatiar([])).toEqual([]);
    expect(fatiar(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    expect(fatiar(['a', 'a'], 25)).toEqual([['a']]);
  });

  it('resolvidos = movidas e sumidas; a recusada continua marcada', () => {
    expect(
      resolvidosDoMover([
        { id: 'a', resultado: 'movida', motivo: null },
        { id: 'b', resultado: 'recusada', motivo: 'ocupada' },
        { id: 'c', resultado: 'sumiu', motivo: null },
      ])
    ).toEqual(['a', 'c']);
  });
});

describe('lerPrevia', () => {
  const certa = {
    id: FICHA,
    nome: 'Fulana',
    mensagens: 120,
    agendadas: [{ autor: 'Ana', quando: '2026-10-24T12:00:00+00:00' }],
    esperas: 2,
    robos: 1,
    tarefas: [{ titulo: 'Ligar', responsavel: 'Bia', vence_em: '2026-10-25' }],
    negocios: [{ titulo: 'Fulana', funil: 'Bancário', etapa: 'Proposta' }],
    conversa: { status: 'open', responsavel: 'Ana' },
  };

  it('a forma certa (a do `jsonb_build_object` da prévia)', () => {
    expect(lerPrevia([certa])).toEqual([
      {
        id: FICHA,
        nome: 'Fulana',
        mensagens: 120,
        agendadas: [{ autor: 'Ana', quando: '2026-10-24T12:00:00+00:00' }],
        esperas: 2,
        robos: 1,
        tarefas: [
          { titulo: 'Ligar', responsavel: 'Bia', venceEm: '2026-10-25' },
        ],
        negocios: [{ titulo: 'Fulana', funil: 'Bancário', etapa: 'Proposta' }],
        conversa: { status: 'open', responsavel: 'Ana' },
      },
    ]);
  });

  it('forma torta → nulo; lista vazia é resposta', () => {
    for (const bruto of [null, undefined, {}, 'x', 1])
      expect(lerPrevia(bruto)).toBeNull();
    expect(lerPrevia([])).toEqual([]);
  });

  it('campos faltando: sem id sai; contagens tortas viram 0; sem conversa é nulo', () => {
    const r = lerPrevia([
      { nome: 'sem id' },
      {
        id: OUTRA,
        mensagens: '7',
        esperas: -1,
        robos: 'x',
        agendadas: 'x',
        tarefas: [null, {}],
        negocios: null,
        conversa: [],
      },
    ]);
    expect(r).toEqual([
      {
        id: OUTRA,
        nome: null,
        mensagens: 7,
        agendadas: [],
        esperas: 0,
        robos: 0,
        tarefas: [{ titulo: null, responsavel: null, venceEm: null }],
        negocios: [],
        conversa: null,
      },
    ]);
  });

  it('previaTemAviso: só o que se cancela de COLEGAS', () => {
    const vazia: PreviaDaFicha = {
      id: FICHA,
      nome: null,
      mensagens: 300,
      agendadas: [],
      esperas: 0,
      robos: 0,
      tarefas: [],
      negocios: [],
      conversa: null,
    };
    expect(previaTemAviso(vazia)).toBe(false);
    expect(
      previaTemAviso({
        ...vazia,
        conversa: { status: 'closed', responsavel: 'Ana' },
      })
    ).toBe(false);
    expect(
      previaTemAviso({
        ...vazia,
        conversa: { status: 'open', responsavel: null },
      })
    ).toBe(false);
    expect(
      previaTemAviso({
        ...vazia,
        conversa: { status: 'open', responsavel: 'Ana' },
      })
    ).toBe(true);
    expect(
      previaTemAviso({ ...vazia, agendadas: [{ autor: null, quando: null }] })
    ).toBe(true);
    expect(previaTemAviso({ ...vazia, esperas: 1 })).toBe(true);
    expect(previaTemAviso({ ...vazia, robos: 1 })).toBe(true);
    expect(
      previaTemAviso({
        ...vazia,
        tarefas: [{ titulo: null, responsavel: null, venceEm: null }],
      })
    ).toBe(true);
    expect(
      previaTemAviso({
        ...vazia,
        negocios: [{ titulo: null, funil: null, etapa: null }],
      })
    ).toBe(true);
  });
});

describe('lerItem (uma linha de cb_lixeira_da_conta)', () => {
  const linha = {
    id: ITEM,
    account_id: '55555555-5555-5555-5555-555555555555',
    contact_id: FICHA,
    lote_id: LOTE,
    nome: 'Fulana',
    telefone: '+55 83 98000-0000',
    email: 'fulana@exemplo.com',
    instagram_username: null,
    wa_username: '',
    movida_em: '2026-10-23T12:00:00+00:00',
    movida_por_nome: 'Ana',
    vence_em: '2027-01-21T12:00:00+00:00',
    contagens: { contacts: 1, messages: 120, cb_tasks: '2', lixo: 'x' },
    ocupada_por: OUTRA,
    ocupada_por_nome: 'Fulana (nova)',
    lote_total: 3,
  };

  it('a forma certa', () => {
    expect(lerItem(linha)).toEqual({
      id: ITEM,
      contactId: FICHA,
      loteId: LOTE,
      nome: 'Fulana',
      telefone: '+55 83 98000-0000',
      email: 'fulana@exemplo.com',
      instagramUsername: null,
      waUsername: null,
      movidaEm: '2026-10-23T12:00:00+00:00',
      movidaPorNome: 'Ana',
      venceEm: '2027-01-21T12:00:00+00:00',
      contagens: { contacts: 1, messages: 120, cb_tasks: 2, lixo: 0 },
      ocupadaPor: OUTRA,
      ocupadaPorNome: 'Fulana (nova)',
      loteTotal: 3,
    });
  });

  it('o tamanho do lote vem do banco (fora da busca); ausente ou torto vira 1 — o botão some', () => {
    for (const lote_total of [undefined, null, 0, -2, 'x']) {
      expect(lerItem({ ...linha, lote_total })?.loteTotal, String(lote_total)).toBe(1);
    }
    expect(lerItem({ ...linha, lote_total: '25' })?.loteTotal).toBe(25);
  });

  it('forma torta → nulo', () => {
    for (const bruto of [null, 'x', [], 1]) expect(lerItem(bruto)).toBeNull();
  });

  it('sem uma das chaves da identidade do item (id, ficha, lote, datas) → nulo', () => {
    for (const campo of [
      'id',
      'contact_id',
      'lote_id',
      'movida_em',
      'vence_em',
    ]) {
      expect(lerItem({ ...linha, [campo]: null }), campo).toBeNull();
    }
  });

  it('o resto faltando vira nulo; contagens ausentes viram {}', () => {
    const r = lerItem({
      id: ITEM,
      contact_id: FICHA,
      lote_id: LOTE,
      movida_em: 'a',
      vence_em: 'b',
    });
    expect(r).toMatchObject({
      nome: null,
      telefone: null,
      ocupadaPor: null,
      contagens: {},
    });
  });
});

describe('diasRestantes', () => {
  const vence = '2027-01-21T12:00:00.000Z';
  const fim = Date.parse(vence);
  const DIA = 86_400_000;

  it('arredonda para CIMA: faltando 1 ms ou 1 dia exato, "1 dia"', () => {
    expect(diasRestantes(vence, fim - 1)).toBe(1);
    expect(diasRestantes(vence, fim - DIA)).toBe(1);
    expect(diasRestantes(vence, fim - DIA - 1)).toBe(2);
  });

  it('na hora e depois: 0 (vencida, esperando a limpeza do servidor)', () => {
    expect(diasRestantes(vence, fim)).toBe(0);
    expect(diasRestantes(vence, fim + DIA)).toBe(0);
  });

  it('recém-movida: os 90 dias inteiros', () => {
    expect(diasRestantes(vence, fim - DIAS_NA_LIXEIRA * DIA)).toBe(
      DIAS_NA_LIXEIRA
    );
  });

  it('data ilegível → 0, nunca NaN', () => {
    expect(diasRestantes('ontem', fim)).toBe(0);
    expect(diasRestantes('', fim)).toBe(0);
  });
});

describe('lerVolta e lerRessalvas', () => {
  // A forma do `relatorio` de `cb_lixeira_restaurar_um`: `tabelas` (o que
  // `cb_lixeira_reinserir` devolveu por tabela, mais `tabela_sumiu` e
  // `fora_da_volta`), `ponteiros` e os extras da B4.
  const RELATORIO = {
    tabelas: {
      contacts: { total: 1, inseridas: 1 },
      conversations: { total: 1, inseridas: 1 },
      messages: { total: 120, inseridas: 120 },
      contact_tags: {
        total: 3,
        inseridas: 2,
        fks: {
          contact_tags_tag_id_fkey: { acao: 'descartada', n: 1, alvo: 'tags' },
        },
      },
      contact_custom_values: {
        total: 5,
        inseridas: 5,
        colunas_sumidas: ['campo_que_saiu'],
      },
      cb_scheduled_messages: {
        total: 2,
        inseridas: 1,
        fks: {
          cb_scheduled_messages_channel_id_fkey: {
            acao: 'restrita',
            n: 1,
            alvo: 'cb_channels',
          },
        },
      },
      // Anulada é a SET NULL fazendo o que faria: não é linha perdida.
      cb_tasks: {
        total: 2,
        inseridas: 2,
        fks: { cb_tasks_responsavel_user_id_fkey: { acao: 'anulada', n: 1 } },
      },
      cb_contatos_antigos: { tabela_sumiu: true },
      cb_tabela_que_saiu_da_ordem: { fora_da_volta: 4 },
    },
    ponteiros: { 'deals.contact_id': { total: 2, reapontados: 2 } },
    cancelamentos_religados: 1,
    movimentos_sem_automacao: 3,
    zapsign_sem_contato: 0,
    agendadas_em_falha: 2,
    pares_para_a_lixeira: 1,
  };

  it('o relatório cheio vira as ressalvas, na ordem da tela, sem o que deu zero', () => {
    expect(lerRessalvas(RELATORIO)).toEqual([
      { tipo: 'linhas_descartadas', n: 1 + 1 + 1 + 4 },
      { tipo: 'agendadas_em_falha', n: 2 },
      { tipo: 'movimentos_sem_automacao', n: 3 },
      { tipo: 'pares_para_a_lixeira', n: 1 },
      { tipo: 'colunas_sumidas', n: 1 },
    ]);
  });

  it('a linha que o ON CONFLICT engoliu (sem FK) também é ressalva', () => {
    expect(
      lerRessalvas({
        tabelas: {
          contacts: { total: 1, inseridas: 1 },
          // O mesmo telefone antigo gravado por outra união durante a Lixeira.
          cb_contatos_antigos: { total: 2, inseridas: 1 },
          // Uma pela FK e uma pelo conflito: duas, nunca três.
          cb_contatos_relacionados: {
            total: 3,
            inseridas: 1,
            fks: { x_fkey: { acao: 'descartada', n: 1 } },
          },
        },
      })
    ).toEqual([{ tipo: 'linhas_descartadas', n: 1 + 2 }]);
  });

  it('volta limpa (só os extras zerados) → nenhuma ressalva', () => {
    expect(
      lerRessalvas({
        tabelas: { contacts: { total: 1, inseridas: 1 } },
        ponteiros: {},
        movimentos_sem_automacao: 0,
        zapsign_sem_contato: 0,
        agendadas_em_falha: 0,
        pares_para_a_lixeira: 0,
      })
    ).toEqual([]);
  });

  it('relatório torto → nenhuma ressalva (nada afirmado)', () => {
    for (const r of [
      null,
      'x',
      [],
      { tabelas: 'x' },
      { tabelas: { a: null, b: 'x' } },
    ]) {
      expect(lerRessalvas(r)).toEqual([]);
    }
  });

  it('a forma certa de cb_restaurar_da_lixeira: restaurada, recusada (B2), em processamento, sumiu', () => {
    const r = lerVolta({
      itens: [
        {
          item_id: ITEM,
          contact_id: FICHA,
          resultado: 'restaurada',
          relatorio: RELATORIO,
        },
        {
          item_id: 'i2',
          contact_id: OUTRA,
          resultado: 'recusada',
          codigo: 'identidade_ocupada',
          ocupada_por: FICHA,
          ocupada_por_nome: 'Fulana',
        },
        { item_id: 'i3', resultado: 'recusada', codigo: 'em_processamento' },
        {
          item_id: 'i4',
          resultado: 'recusada',
          codigo: 'P0001',
          motivo: 'lixeira_schema_mudou:contacts',
        },
        { item_id: 'i5', resultado: 'sumiu' },
      ],
    });
    expect(r).toEqual([
      {
        itemId: ITEM,
        contactId: FICHA,
        resultado: 'restaurada',
        motivo: null,
        ocupadaPor: null,
        ocupadaPorNome: null,
        ressalvas: lerRessalvas(RELATORIO),
      },
      {
        itemId: 'i2',
        contactId: OUTRA,
        resultado: 'recusada',
        motivo: 'identidade_ocupada',
        ocupadaPor: FICHA,
        ocupadaPorNome: 'Fulana',
        ressalvas: [],
      },
      {
        itemId: 'i3',
        contactId: null,
        resultado: 'recusada',
        motivo: 'em_processamento',
        ocupadaPor: null,
        ocupadaPorNome: null,
        ressalvas: [],
      },
      {
        itemId: 'i4',
        contactId: null,
        resultado: 'recusada',
        motivo: 'esquema_mudou',
        ocupadaPor: null,
        ocupadaPorNome: null,
        ressalvas: [],
      },
      {
        itemId: 'i5',
        contactId: null,
        resultado: 'sumiu',
        motivo: null,
        ocupadaPor: null,
        ocupadaPorNome: null,
        ressalvas: [],
      },
    ]);
  });

  it('forma torta → nulo; item sem id ou resultado desconhecido sai', () => {
    for (const bruto of [null, [], 'x', {}, { itens: 'x' }])
      expect(lerVolta(bruto)).toBeNull();
    expect(
      lerVolta({
        itens: [
          { resultado: 'restaurada' },
          { item_id: ITEM, resultado: 'voltou' },
          null,
        ],
      })
    ).toEqual([]);
  });

  it('a recusada não carrega ressalva mesmo com relatório (só a restaurada voltou)', () => {
    const r = lerVolta({
      itens: [
        {
          item_id: ITEM,
          resultado: 'recusada',
          codigo: '40P01',
          relatorio: RELATORIO,
        },
      ],
    });
    expect(r?.[0]).toMatchObject({ motivo: 'ocupada', ressalvas: [] });
  });
});

describe('lerExclusaoDefinitiva', () => {
  it('a forma certa de cb_excluir_da_lixeira (e do item de cb_vencer_lixeira)', () => {
    expect(
      lerExclusaoDefinitiva({
        itens: [
          {
            item_id: ITEM,
            contact_id: FICHA,
            resultado: 'excluida',
            arquivos: 4,
            pedido_exclusao: true,
          },
          { item_id: 'i2', resultado: 'recusada', codigo: 'em_processamento' },
          { item_id: 'i3', resultado: 'sumiu' },
        ],
      })
    ).toEqual([
      { itemId: ITEM, resultado: 'excluida', motivo: null, arquivos: 4 },
      {
        itemId: 'i2',
        resultado: 'recusada',
        motivo: 'em_processamento',
        arquivos: 0,
      },
      { itemId: 'i3', resultado: 'sumiu', motivo: null, arquivos: 0 },
    ]);
  });

  it('forma torta → nulo; campos faltando: sem id sai, arquivos torto vira 0', () => {
    for (const bruto of [null, [], 'x', { itens: null }])
      expect(lerExclusaoDefinitiva(bruto)).toBeNull();
    expect(
      lerExclusaoDefinitiva({
        itens: [
          { resultado: 'excluida' },
          { item_id: ITEM, resultado: 'excluida', arquivos: 'x' },
        ],
      })
    ).toEqual([
      { itemId: ITEM, resultado: 'excluida', motivo: null, arquivos: 0 },
    ]);
  });
});

describe('lerNegociosNaLixeira', () => {
  it('a forma certa: negócio → nome da ficha (nome nulo é nome desconhecido, não ausência)', () => {
    const mapa = lerNegociosNaLixeira([
      { deal_id: 'd1', item_id: ITEM, nome: 'Fulana' },
      { deal_id: 'd2', item_id: ITEM, nome: null },
    ]);
    expect([...mapa]).toEqual([
      ['d1', 'Fulana'],
      ['d2', null],
    ]);
  });

  it('forma torta → mapa vazio; linha sem negócio sai', () => {
    expect(lerNegociosNaLixeira(null).size).toBe(0);
    expect(lerNegociosNaLixeira({ deal_id: 'd1' }).size).toBe(0);
    expect(
      lerNegociosNaLixeira([{ item_id: ITEM, nome: 'x' }, null, 'x']).size
    ).toBe(0);
  });
});
