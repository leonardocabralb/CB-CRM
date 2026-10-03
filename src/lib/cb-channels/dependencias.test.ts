import { describe, expect, it } from 'vitest';

import { codigoDoNumeroDaConexao } from '@/lib/automations/variaveis/conexao';

import { automacoesQueDependem, citaAConexao } from './dependencias';

// ============================================================
// O que depende de uma conexão (a tela de remover, 03/10/2026).
// ============================================================

const CANAL = '11111111-2222-4333-8444-555555555555';
const OUTRO = '66666666-7777-4888-9999-000000000000';

describe('citaAConexao', () => {
  it('pelo id gravado no passo e pela variável do número', () => {
    expect(citaAConexao({ text: 'oi', channel_id: CANAL }, CANAL)).toBe(true);
    expect(citaAConexao({ text: `Fale com {{${codigoDoNumeroDaConexao(CANAL)}}}` }, CANAL)).toBe(true);
    expect(citaAConexao({ text: 'oi', channel_id: OUTRO }, CANAL)).toBe(false);
    expect(citaAConexao(null, CANAL)).toBe(false);
  });
});

describe('automacoesQueDependem', () => {
  const a = (id: string, channel_ids: string[] | null, is_active = true) => ({
    id,
    name: `Automação ${id}`,
    is_active,
    channel_ids,
  });

  it('⚠️ escopo em DOIS números com passo que usa este: aparece nas duas linhas (continua rodando pelo outro, e o passo falha)', () => {
    const r = automacoesQueDependem(
      CANAL,
      [a('duas-com-passo', [OUTRO, CANAL])],
      [{ automation_id: 'duas-com-passo', step_config: { text: `Fale no {{${codigoDoNumeroDaConexao(CANAL)}}}` } }],
    );
    expect(r.automacoesPerdemONumero.map((x) => x.id)).toEqual(['duas-com-passo']);
    expect(r.automacoesComPasso.map((x) => x.id)).toEqual(['duas-com-passo']);
  });

  it('a que vai ser desligada não se repete em "com passo"', () => {
    const r = automacoesQueDependem(
      CANAL,
      [
        a('so', [CANAL]),
        a('duas', [CANAL, OUTRO]),
        a('passo', null),
        a('so-e-passo', [CANAL]),
        a('nada', [OUTRO]),
        a('desligada', [CANAL], false),
      ],
      [
        { automation_id: 'passo', step_config: { channel_id: CANAL } },
        { automation_id: 'so-e-passo', step_config: { channel_id: CANAL } },
        { automation_id: 'nada', step_config: { channel_id: OUTRO } },
      ],
    );
    // As LIGADAS primeiro (é o que quebra), depois pelo nome.
    expect(r.automacoesDesligadas.map((x) => x.id)).toEqual(['so', 'so-e-passo', 'desligada']);
    expect(r.automacoesDesligadas.find((x) => x.id === 'desligada')?.ativo).toBe(false);
    expect(r.automacoesPerdemONumero.map((x) => x.id)).toEqual(['duas']);
    expect(r.automacoesComPasso.map((x) => x.id)).toEqual(['passo']);
  });

  it('a régua do gatilho da 903: só desliga quando o escopo fica VAZIO', () => {
    const r = automacoesQueDependem(CANAL, [a('repetida', [CANAL, CANAL]), a('com-outra', [OUTRO, CANAL])], []);
    expect(r.automacoesDesligadas.map((x) => x.id)).toEqual(['repetida']);
    expect(r.automacoesPerdemONumero.map((x) => x.id)).toEqual(['com-outra']);
  });

  it('escopo vazio (todas as conexões) não depende desta — a não ser por passo', () => {
    const r = automacoesQueDependem(CANAL, [a('todas', []), a('nula', null)], []);
    expect(r.automacoesDesligadas).toEqual([]);
    expect(r.automacoesPerdemONumero).toEqual([]);
    expect(r.automacoesComPasso).toEqual([]);
  });
});
