import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  carregarReferenciasExistentes,
  problemasDasReferencias,
  referenciasDoRobo,
} from './referencias-do-robo';

// ============================================================
// Ativar o robô confere o arquivo do acervo e o campo da ficha que os nós
// apontam (26/09/2026) — o validador estrutural não tem banco, e um robô
// ativado sem ninguém abrir o nó falharia em toda execução.
// ============================================================

const ITEM = '11111111-1111-4111-8111-111111111111';
const CAMPO = '33333333-3333-4333-8333-333333333333';
const CAMPO_NUMERO = '44444444-4444-4444-8444-444444444444';

const SEM_FUNIL = { funis: new Set<string>(), etapas: new Map<string, string>() };

const NOS = [
  {
    node_key: 'audio',
    node_type: 'send_media',
    config: { media_type: 'audio', acervo_id: ITEM, next_node_key: 'nome' },
  },
  {
    node_key: 'nome',
    node_type: 'collect_input',
    config: { prompt_text: 'Seu nome?', var_key: 'nome', salvar_em: 'name' },
  },
  {
    node_key: 'encostado',
    node_type: 'send_buttons',
    config: { text: 'Ficou encostado?', salvar_em: `custom:${CAMPO}`, buttons: [] },
  },
  // O nó antigo (upload, sem acervo) não entra na conferência.
  {
    node_key: 'foto',
    node_type: 'send_media',
    config: { media_type: 'image', media_url: 'https://x/a.jpg' },
  },
];

describe('referenciasDoRobo', () => {
  it('colhe o acervo_id do "Enviar mídia" e o campo do "Salvar a resposta" (o nome não)', () => {
    expect(referenciasDoRobo(NOS)).toEqual({
      acervoIds: [ITEM],
      campoIds: [CAMPO],
      funilIds: [],
      etapaIds: [],
    });
  });

  it('id sem forma de UUID não vai à consulta (derrubaria a consulta inteira)', () => {
    const r = referenciasDoRobo([
      { node_key: 'a', node_type: 'send_media', config: { acervo_id: 'lixo' } },
    ]);
    expect(r.acervoIds).toEqual([]);
  });
});

describe('problemasDasReferencias', () => {
  it('tudo existe = nenhum problema', () => {
    expect(
      problemasDasReferencias(NOS, {
        acervo: new Set([ITEM]),
        campos: new Map([[CAMPO, { field_type: 'select' }]]),
        ...SEM_FUNIL,
      }),
    ).toEqual([]);
  });

  it('item apagado do acervo e campo apagado são ERRO, com o passo no texto', () => {
    const problemas = problemasDasReferencias(NOS, {
      acervo: new Set(),
      campos: new Map(),
      ...SEM_FUNIL,
    });
    expect(problemas.map((p) => [p.severity, p.node_key, p.field])).toEqual([
      ['error', 'audio', 'acervo_id'],
      ['error', 'encostado', 'salvar_em'],
    ]);
    expect(problemas[0].message).toContain('"audio"');
  });

  it('campo que existe mas não serve ao nó (NÚMERO num passo de botões) também é erro', () => {
    const nos = [
      {
        node_key: 'b',
        node_type: 'send_buttons',
        config: { salvar_em: `custom:${CAMPO_NUMERO}` },
      },
    ];
    expect(
      problemasDasReferencias(nos, {
        acervo: new Set(),
        campos: new Map([[CAMPO_NUMERO, { field_type: 'number' }]]),
        ...SEM_FUNIL,
      }),
    ).toHaveLength(1);
  });

  it('acervo_id sem forma de UUID nunca existe → erro', () => {
    const nos = [{ node_key: 'a', node_type: 'send_media', config: { acervo_id: 'lixo' } }];
    expect(
      problemasDasReferencias(nos, { acervo: new Set(), campos: new Map(), ...SEM_FUNIL }),
    ).toHaveLength(1);
  });
});

describe('carregarReferenciasExistentes', () => {
  function banco(opts: { erro?: boolean }) {
    const pedidos: Array<{ tabela: string; filtros: Array<[string, unknown]> }> = [];
    const db = {
      from(tabela: string) {
        const pedido = { tabela, filtros: [] as Array<[string, unknown]> };
        pedidos.push(pedido);
        const b = {
          select: () => b,
          eq: (c: string, v: unknown) => (pedido.filtros.push([c, v]), b),
          in: (c: string, v: unknown) => {
            pedido.filtros.push([c, v]);
            if (opts.erro) return Promise.resolve({ data: null, error: { message: 'timeout' } });
            return Promise.resolve({
              data:
                tabela === 'cb_media_library'
                  ? [{ id: ITEM }]
                  : [{ id: CAMPO, field_type: 'text', espelho: null }],
              error: null,
            });
          },
        };
        return b;
      },
    };
    return { db: db as unknown as SupabaseClient, pedidos };
  }

  it('lê só DESTA conta e devolve o que existe', async () => {
    const { db, pedidos } = banco({});
    const r = await carregarReferenciasExistentes(db, 'acc', NOS);
    expect(r?.acervo.has(ITEM)).toBe(true);
    expect(r?.campos.get(CAMPO)).toEqual({ field_type: 'text', espelho: null });
    for (const p of pedidos) expect(p.filtros).toContainEqual(['account_id', 'acc']);
  });

  it('leitura que falha = null (pula a conferência), nunca "tudo apagado"', async () => {
    const { db } = banco({ erro: true });
    expect(await carregarReferenciasExistentes(db, 'acc', NOS)).toBeNull();
  });

  it('robô sem acervo nem campo não consulta nada', async () => {
    const { db, pedidos } = banco({});
    const r = await carregarReferenciasExistentes(db, 'acc', [NOS[1], NOS[3]]);
    expect(pedidos).toHaveLength(0);
    expect(r).toEqual({ acervo: new Set(), campos: new Map(), funis: new Set(), etapas: new Map() });
  });
});

// ============================================================
// "Mover card" (1053): o funil e a etapa de destino existem NESTA conta, a
// etapa é DAQUELE funil, e as etapas de origem marcadas ainda existem.
// ============================================================

const FUNIL = '55555555-5555-4555-8555-555555555555';
const OUTRO_FUNIL = '66666666-6666-4666-8666-666666666666';
const ETAPA = '77777777-7777-4777-8777-777777777777';
const ORIGEM = '88888888-8888-4888-8888-888888888888';

const MOVER = {
  node_key: 'qualificado',
  node_type: 'move_deal_stage',
  config: { pipeline_id: FUNIL, stage_id: ETAPA, origem_stage_ids: [ORIGEM], next_node_key: 'fim' },
};

describe('Mover card — referências', () => {
  it('colhe o funil, a etapa de destino e as de origem', () => {
    const r = referenciasDoRobo([MOVER]);
    expect(r.funilIds).toEqual([FUNIL]);
    expect(r.etapaIds.sort()).toEqual([ETAPA, ORIGEM].sort());
  });

  const tudoExiste = {
    acervo: new Set<string>(),
    campos: new Map(),
    funis: new Set([FUNIL]),
    etapas: new Map([
      [ETAPA, FUNIL],
      [ORIGEM, OUTRO_FUNIL],
    ]),
  };

  it('tudo existe (a origem pode ser de OUTRO funil) = nenhum problema', () => {
    expect(problemasDasReferencias([MOVER], tudoExiste)).toEqual([]);
  });

  it('funil apagado → erro no funil', () => {
    const p = problemasDasReferencias([MOVER], { ...tudoExiste, funis: new Set() });
    expect(p.map((x) => x.field)).toEqual(['pipeline_id']);
  });

  it('etapa apagada → erro na etapa', () => {
    const p = problemasDasReferencias([MOVER], {
      ...tudoExiste,
      etapas: new Map([[ORIGEM, OUTRO_FUNIL]]),
    });
    expect(p.map((x) => x.field)).toEqual(['stage_id']);
    expect(p[0].message).toContain('não existe mais');
  });

  it('etapa de OUTRO funil que o escolhido → erro na etapa', () => {
    const p = problemasDasReferencias([MOVER], {
      ...tudoExiste,
      etapas: new Map([
        [ETAPA, OUTRO_FUNIL],
        [ORIGEM, OUTRO_FUNIL],
      ]),
    });
    expect(p.map((x) => x.field)).toEqual(['stage_id']);
    expect(p[0].message).toContain('não é do funil escolhido');
  });

  it('etapa de origem apagada → erro nas origens, apontando o botão do passo', () => {
    const p = problemasDasReferencias([MOVER], {
      ...tudoExiste,
      etapas: new Map([[ETAPA, FUNIL]]),
    });
    expect(p.map((x) => x.field)).toEqual(['origem_stage_ids']);
    // A frase manda usar o botão que EXISTE no formulário (as caixas são do
    // catálogo: a apagada não tem o que desmarcar).
    expect(p[0].message).toContain('"Tirar a etapa apagada"');
    expect(p[0].message).toContain('não existe mais');
  });

  it('duas origens apagadas: plural na frase e no nome do botão', () => {
    const OUTRA = '99999999-9999-4999-8999-999999999999';
    const p = problemasDasReferencias(
      [{ ...MOVER, config: { ...MOVER.config, origem_stage_ids: [ORIGEM, OUTRA] } }],
      { ...tudoExiste, etapas: new Map([[ETAPA, FUNIL]]) },
    );
    expect(p[0].message).toMatch(/^2 etapas de origem marcadas .* não existem mais/);
    expect(p[0].message).toContain('"Tirar as 2 etapas apagadas"');
  });

  it('funil ou etapa vazios ficam com o validador estrutural (não duplica o erro)', () => {
    const vazio = { ...MOVER, config: { pipeline_id: '', stage_id: '', next_node_key: 'fim' } };
    expect(problemasDasReferencias([vazio], tudoExiste)).toEqual([]);
  });

  it('carrega a etapa com o funil dela e só aceita funil DESTA conta', async () => {
    const pedidos: Array<{ tabela: string; filtros: Array<[string, unknown]> }> = [];
    const db = {
      from(tabela: string) {
        const pedido = { tabela, filtros: [] as Array<[string, unknown]> };
        pedidos.push(pedido);
        const b = {
          select: () => b,
          eq: (c: string, v: unknown) => (pedido.filtros.push([c, v]), b),
          in: (c: string, v: unknown) => {
            pedido.filtros.push([c, v]);
            if (tabela === 'pipeline_stages') {
              return Promise.resolve({
                data: [
                  { id: ETAPA, pipeline_id: FUNIL },
                  { id: ORIGEM, pipeline_id: 'funil-de-outra-conta' },
                ],
                error: null,
              });
            }
            // pipelines: só o FUNIL é desta conta.
            return Promise.resolve({ data: [{ id: FUNIL }], error: null });
          },
        };
        return b;
      },
    } as unknown as SupabaseClient;

    const r = await carregarReferenciasExistentes(db, 'acc', [MOVER]);
    expect(r?.funis).toEqual(new Set([FUNIL]));
    // A etapa de origem é de um funil que não é desta conta: fica de fora,
    // e o nó é recusado como "origem apagada".
    expect(r?.etapas).toEqual(new Map([[ETAPA, FUNIL]]));
    const funis = pedidos.find((p) => p.tabela === 'pipelines');
    expect(funis?.filtros).toContainEqual(['account_id', 'acc']);
    expect(problemasDasReferencias([MOVER], r!).map((x) => x.field)).toEqual(['origem_stage_ids']);
  });
});
