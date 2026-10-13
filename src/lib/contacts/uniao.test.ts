import { describe, expect, it } from 'vitest';

import {
  aOutra,
  falhaDaUniao,
  lerContatosAntigos,
  lerDivergencias,
  lerPrevia,
  lerResultado,
} from './uniao';

// A forma é a que `cb_previa_da_uniao` devolveu na réplica do esquema de
// produção (13/10/2026), com dados fictícios.
const PREVIA = {
  cards: [
    {
      acao: 'apaga',
      etapa: 'Entrada',
      funil: 'Funil Dois',
      status: 'open',
      titulo: 'Maria Teste',
      deal_id: 'd-2',
      da_ficha: 'fica',
      pipeline_id: 'p-2',
      fica_no_lugar: 'd-12',
    },
    {
      acao: 'move',
      etapa: 'Proposta',
      funil: 'Funil Dois',
      status: 'open',
      titulo: 'Maria Teste Silva',
      deal_id: 'd-12',
      da_ficha: 'sai',
      pipeline_id: 'p-2',
      fica_no_lugar: null,
    },
  ],
  bloqueios: [],
  contagens: {
    tarefas: 1,
    agendadas: 1,
    anotacoes: 2,
    mensagens: 2,
    robos_parados: 1,
    etiquetas_novas: 1,
    campos_preenchidos: 2,
    automacoes_interrompidas: 2,
  },
  nome_final: 'Maria Teste Silva',
  divergencias: [
    {
      saiu: 'Maria Teste',
      campo: 'nome',
      ficou: 'Maria Teste Silva',
      rotulo: null,
      campo_id: null,
    },
    {
      saiu: '222',
      campo: 'campo',
      ficou: '111',
      rotulo: 'CPF',
      campo_id: 'f-1',
    },
  ],
  sugerida_fica: 'c-2',
  contatos_antigos: [
    { tipo: 'telefone', valor: '5583900000002' },
    { tipo: 'email', valor: 'maria.silva@exemplo.invalid' },
  ],
  motivo_da_sugestao: 'mensagem_do_cliente',
};

describe('lerPrevia', () => {
  it('lê a prévia do banco campo a campo', () => {
    const p = lerPrevia(PREVIA)!;
    expect(p.sugeridaFica).toBe('c-2');
    expect(p.motivoDaSugestao).toBe('mensagem_do_cliente');
    expect(p.bloqueios).toEqual([]);
    expect(p.nomeFinal).toBe('Maria Teste Silva');
    expect(p.cards).toEqual([
      {
        dealId: 'd-2',
        daFicha: 'fica',
        acao: 'apaga',
        ficaNoLugar: 'd-12',
        pipelineId: 'p-2',
        titulo: 'Maria Teste',
        status: 'open',
        funil: 'Funil Dois',
        etapa: 'Entrada',
      },
      {
        dealId: 'd-12',
        daFicha: 'sai',
        acao: 'move',
        ficaNoLugar: null,
        pipelineId: 'p-2',
        titulo: 'Maria Teste Silva',
        status: 'open',
        funil: 'Funil Dois',
        etapa: 'Proposta',
      },
    ]);
    expect(p.divergencias).toEqual([
      {
        campo: 'nome',
        rotulo: null,
        ficou: 'Maria Teste Silva',
        saiu: 'Maria Teste',
      },
      { campo: 'campo', rotulo: 'CPF', ficou: '111', saiu: '222' },
    ]);
    expect(p.contatosAntigos).toEqual([
      { tipo: 'telefone', valor: '5583900000002' },
      { tipo: 'email', valor: 'maria.silva@exemplo.invalid' },
    ]);
    expect(p.contagens).toEqual({
      mensagens: 2,
      anotacoes: 2,
      tarefas: 1,
      etiquetasNovas: 1,
      camposPreenchidos: 2,
      agendadas: 1,
      automacoesInterrompidas: 2,
      robosParados: 1,
    });
  });

  it('⚠️ bloqueio que o app não conhece BLOQUEIA (falha fechada), nunca some', () => {
    const p = lerPrevia({
      ...PREVIA,
      bloqueios: ['instagram', 'conta_paga_diferente'],
    })!;
    expect(p.bloqueios).toEqual(['instagram', 'desconhecido']);
  });

  it('forma inesperada é NULO — a tela não oferece unir sem saber o que vai acontecer', () => {
    expect(lerPrevia(null)).toBeNull();
    expect(lerPrevia([])).toBeNull();
    expect(lerPrevia({ ...PREVIA, cards: null })).toBeNull();
    expect(lerPrevia({ ...PREVIA, bloqueios: 'instagram' })).toBeNull();
  });

  it('card sem destino legível sai da lista; contagem torta vira zero; motivo desconhecido vira nulo', () => {
    const p = lerPrevia({
      ...PREVIA,
      cards: [
        { deal_id: 'd-9', da_ficha: 'sai', acao: 'teleporta' },
        null,
        PREVIA.cards[1],
      ],
      contagens: { mensagens: 'x', tarefas: -3, anotacoes: 2.6 },
      motivo_da_sugestao: 'sorteio',
    })!;
    expect(p.cards.map((c) => c.dealId)).toEqual(['d-12']);
    expect(p.contagens.mensagens).toBe(0);
    expect(p.contagens.tarefas).toBe(0);
    expect(p.contagens.anotacoes).toBe(3);
    expect(p.motivoDaSugestao).toBeNull();
  });
});

describe('lerDivergencias e lerContatosAntigos (também a trilha usa)', () => {
  it('descartam o que não é da forma', () => {
    expect(
      lerDivergencias([
        { campo: 'cpf', ficou: '1' },
        'x',
        { campo: 'empresa', ficou: 'A', saiu: 'B' },
      ])
    ).toEqual([{ campo: 'empresa', rotulo: null, ficou: 'A', saiu: 'B' }]);
    expect(
      lerContatosAntigos([
        { tipo: 'fax', valor: '1' },
        { tipo: 'email', valor: '' },
        { tipo: 'telefone', valor: '55' },
      ])
    ).toEqual([{ tipo: 'telefone', valor: '55' }]);
    expect(lerDivergencias(undefined)).toEqual([]);
    expect(lerContatosAntigos({})).toEqual([]);
  });
});

describe('lerResultado', () => {
  it('lê o retorno da união', () => {
    expect(
      lerResultado({
        fusao_id: 'u-1',
        ficha: 'c-1',
        conversa: 'v-1',
        resumo: {},
      })
    ).toEqual({
      fusaoId: 'u-1',
      ficha: 'c-1',
      conversa: 'v-1',
    });
    expect(
      lerResultado({ fusao_id: 'u-1', ficha: 'c-1', conversa: null })
    ).toEqual({
      fusaoId: 'u-1',
      ficha: 'c-1',
      conversa: null,
    });
    expect(lerResultado({ ficha: 'c-1' })).toBeNull();
    expect(lerResultado('ok')).toBeNull();
  });
});

describe('falhaDaUniao', () => {
  it('traduz a recusa do banco (SQLSTATE em code, o RAISE em message)', () => {
    expect(falhaDaUniao({ code: '42501', message: 'so_admin' })).toBe(
      'so_admin'
    );
    expect(
      falhaDaUniao({
        code: '42501',
        message: 'permission denied for function cb_unir_fichas',
      })
    ).toBe('so_admin');
    expect(falhaDaUniao({ code: '42501', message: 'membro_suspenso' })).toBe(
      'membro_suspenso'
    );
    expect(
      falhaDaUniao({ code: 'P0001', message: 'bloqueada:instagram' })
    ).toBe('bloqueada');
    expect(
      falhaDaUniao({
        code: 'P0001',
        message: 'uniao_sem_tratamento:tabela_nova',
      })
    ).toBe('sem_tratamento');
    expect(
      falhaDaUniao({ code: 'P0001', message: 'ficha_nao_encontrada' })
    ).toBe('ficha_nao_encontrada');
    expect(falhaDaUniao({ code: 'P0001', message: 'contas_diferentes' })).toBe(
      'contas_diferentes'
    );
    expect(falhaDaUniao({ code: 'P0001', message: 'mesma_ficha' })).toBe(
      'mesma_ficha'
    );
    expect(
      falhaDaUniao({
        code: '55P03',
        message: 'canceling statement due to lock timeout',
      })
    ).toBe('ocupada');
    expect(falhaDaUniao({ code: '40P01', message: 'deadlock detected' })).toBe(
      'ocupada'
    );
    expect(falhaDaUniao({ code: '08006', message: 'conexão caiu' })).toBe(
      'falhou'
    );
    expect(falhaDaUniao(null)).toBe('falhou');
  });
});

describe('aOutra', () => {
  it('devolve a outra ficha do par', () => {
    expect(aOutra(['a', 'b'], 'a')).toBe('b');
    expect(aOutra(['a', 'b'], 'b')).toBe('a');
  });
});
