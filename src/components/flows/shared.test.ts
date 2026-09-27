import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  NODE_CATEGORIES,
  NODE_META,
  groupNodeTypesByCategory,
  summarizeNode,
  type NodeType,
} from './shared';

const ALL_TYPES = Object.keys(NODE_META) as NodeType[];

describe('node categories', () => {
  it('assigns every node type to a known category', () => {
    const known = new Set(NODE_CATEGORIES);
    for (const type of ALL_TYPES) {
      expect(known.has(NODE_META[type].category)).toBe(true);
    }
  });
});

describe('groupNodeTypesByCategory', () => {
  it('keeps the categories in NODE_CATEGORIES order and drops empty ones', () => {
    // Only messaging + flow types — the logic group must not appear.
    const groups = groupNodeTypesByCategory(['send_message', 'start', 'end']);
    expect(groups.map((g) => g.id)).toEqual(['messaging', 'flow']);
  });

  it('preserves the input order within a category', () => {
    const groups = groupNodeTypesByCategory([
      'send_media',
      'send_message',
      'send_buttons',
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].types).toEqual([
      'send_media',
      'send_message',
      'send_buttons',
    ]);
  });

  it('partitions the full type list without losing or duplicating a type', () => {
    const grouped = groupNodeTypesByCategory(ALL_TYPES).flatMap((g) => g.types);
    expect([...grouped].sort()).toEqual([...ALL_TYPES].sort());
  });
});

// CB (26/09/2026): o cartão do "Enviar mídia" com arquivo do ACERVO e o do nó
// que grava a resposta na ficha.
describe('summarizeNode — robô do previdenciário', () => {
  it('arquivo do acervo sem media_url NÃO diz "nenhum arquivo"', () => {
    const resumo = summarizeNode({
      node_key: 'audio',
      node_type: 'send_media',
      config: { media_type: 'audio', acervo_id: 'item-1', filename: 'boas-vindas.ogg' },
    });
    expect(resumo).toContain('boas-vindas.ogg');
    expect(resumo).not.toMatch(/no file/);
  });

  it('sem acervo e sem URL continua "nenhum arquivo"', () => {
    expect(
      summarizeNode({ node_key: 'm', node_type: 'send_media', config: { media_type: 'image' } }),
    ).toMatch(/no file/);
  });

  it('o nó que grava na ficha diz isso no cartão', () => {
    expect(
      summarizeNode({
        node_key: 'nome',
        node_type: 'collect_input',
        config: { prompt_text: 'Seu nome?', var_key: 'nome', salvar_em: 'name' },
      }),
    ).toMatch(/saves to profile$/);
  });
});

// CB (1053): o cartão do "Mover card" diz o NOME da etapa — nunca o UUID, que
// o operador leria como nome.
describe('summarizeNode — mover card de etapa', () => {
  const no = (config: Record<string, unknown>) => ({
    node_key: 'mover',
    node_type: 'move_deal_stage' as const,
    config,
  });
  const nomes = { etapa: (id: string) => (id === 'e-mql' ? 'Qualificado (MQL)' : null) };

  it('com o catálogo, mostra o nome da etapa de destino', () => {
    expect(summarizeNode(no({ pipeline_id: 'f', stage_id: 'e-mql' }), undefined, nomes)).toBe(
      'Move card to Qualificado (MQL)',
    );
  });

  it('com etapas de origem, diz de quantas', () => {
    expect(
      summarizeNode(
        no({ pipeline_id: 'f', stage_id: 'e-mql', origem_stage_ids: ['a', 'b'] }),
        undefined,
        nomes,
      ),
    ).toBe('Move card to Qualificado (MQL) · only from 2 stage(s)');
  });

  it('sem o nome (catálogo carregando, etapa apagada) NÃO mostra o UUID', () => {
    const resumo = summarizeNode(no({ pipeline_id: 'f', stage_id: '7777-uuid' }), undefined, nomes);
    expect(resumo).toBe('Move card to the chosen stage');
    expect(resumo).not.toContain('7777');
    expect(summarizeNode(no({ pipeline_id: 'f', stage_id: '7777-uuid' }))).not.toContain('7777');
  });

  it('sem etapa escolhida, diz isso', () => {
    expect(summarizeNode(no({ pipeline_id: '', stage_id: '' }))).toMatch(/no stage picked/);
  });

  it('usa o dicionário quando recebe o tradutor', () => {
    const t = (k: string, v?: Record<string, string | number>) => `${k}:${JSON.stringify(v ?? {})}`;
    expect(summarizeNode(no({ pipeline_id: 'f', stage_id: 'e-mql' }), t, nomes)).toBe(
      'moveTo:{"etapa":"Qualificado (MQL)"}',
    );
  });
});

// ⚠️ PINO de i18n: o rótulo do nó é chave MONTADA (`nodes.<tipo>.label` e
// `.blurb`), que o portão estático do CI não alcança — sem este teste, um tipo
// novo aparece no menu como `Flows.builder.nodes.move_deal_stage.label`, cru.
// E as chaves do cartão (`Flows.summary.move*`) nos DOIS dicionários.
describe('rótulos dos nós nos dois dicionários', () => {
  const dicionarios = {
    en: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../messages/en.json'), 'utf8')),
    'pt-BR': JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../messages/pt-BR.json'), 'utf8'),
    ),
  };

  for (const [loc, d] of Object.entries(dicionarios)) {
    it(`${loc}: todo tipo de nó tem label e blurb`, () => {
      for (const tipo of ALL_TYPES) {
        const n = d.Flows.builder.nodes[tipo];
        expect(typeof n?.label, `${loc} nodes.${tipo}.label`).toBe('string');
        expect(typeof n?.blurb, `${loc} nodes.${tipo}.blurb`).toBe('string');
      }
    });

    it(`${loc}: as chaves do cartão do "Mover card"`, () => {
      for (const k of ['moveNone', 'moveTo', 'movePicked', 'moveFromOnly']) {
        expect(typeof d.Flows.summary[k], `${loc} summary.${k}`).toBe('string');
      }
    });
  }
});
