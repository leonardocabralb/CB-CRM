import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  TRANSPORTES,
  ehEvolution,
  ehInstagram,
  ehMeta,
  ehWhatsApp,
  transporteDe,
  transporteValido,
} from './transporte';

describe('predicados de transporte', () => {
  it('aceitam a string, o objeto com kind e o objeto com provider', () => {
    expect(ehMeta('meta')).toBe(true);
    expect(ehMeta({ kind: 'meta' })).toBe(true);
    expect(ehMeta({ provider: 'meta' })).toBe(true);
    expect(ehEvolution({ kind: 'evolution' })).toBe(true);
    expect(ehEvolution({ provider: 'evolution' })).toBe(true);
    expect(ehInstagram({ kind: 'instagram' })).toBe(true);
    expect(ehInstagram({ provider: 'instagram' })).toBe(true);
  });

  it('cada predicado responde só ao seu transporte', () => {
    for (const t of TRANSPORTES) {
      expect(ehMeta(t)).toBe(t === 'meta');
      expect(ehEvolution(t)).toBe(t === 'evolution');
      expect(ehInstagram(t)).toBe(t === 'instagram');
      expect(ehWhatsApp(t)).toBe(t !== 'instagram');
    }
  });

  it('"sem canal" e valor desconhecido não são transporte nenhum', () => {
    // O `else` de antes tratava tudo isto como Meta. Aqui nada responde
    // `true` — quem precisa de um transporte para agir recebe `false` em
    // todos e cai no caminho de erro.
    for (const x of [
      null,
      undefined,
      '',
      'whatsapp',
      { kind: null },
      { provider: undefined },
    ]) {
      expect(ehMeta(x)).toBe(false);
      expect(ehEvolution(x)).toBe(false);
      expect(ehInstagram(x)).toBe(false);
      expect(ehWhatsApp(x)).toBe(false);
    }
  });

  it('transporteDe lança em valor desconhecido em vez de escolher um', () => {
    expect(transporteDe('instagram')).toBe('instagram');
    expect(() => transporteDe('whatsapp')).toThrow(/desconhecido/);
    expect(() => transporteDe(null)).toThrow(/desconhecido/);
    expect(transporteValido('meta')).toBe(true);
    expect(transporteValido('Meta')).toBe(false);
  });
});

// ============================================================
// Os rótulos do transporte são pedidos por chave MONTADA
// (`t(\`kind_${kind}\`)` em channel-badge.tsx e channel-health-indicator.tsx),
// fora do alcance do portão de i18n do CI — a mesma classe de
// `rotulo-do-gatilho.test.ts`. Sem este teste, o terceiro transporte
// entrava com `Channels.kind_instagram` cru na etiqueta.
// ============================================================

const NAMESPACES: { caminho: string[]; chave: (t: string) => string }[] = [
  { caminho: ['Channels'], chave: (t) => `kind_${t}` },
  { caminho: ['ChannelHealth'], chave: (t) => `kind_${t}` },
  {
    caminho: ['Settings', 'channels'],
    chave: (t) => `kind${t[0].toUpperCase()}${t.slice(1)}`,
  },
];

function namespace(
  arquivo: string,
  caminho: string[]
): Record<string, unknown> {
  let atual = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8'));
  for (const p of caminho) atual = atual[p];
  return atual as Record<string, unknown>;
}

describe.each(['pt-BR.json', 'en.json'])('rótulos em %s', (arquivo) => {
  for (const ns of NAMESPACES) {
    it(`${ns.caminho.join('.')} tem um rótulo por transporte, e nenhum órfão`, () => {
      const dicionario = namespace(arquivo, ns.caminho);
      const faltando = TRANSPORTES.filter(
        (t) => typeof dicionario[ns.chave(t)] !== 'string'
      );
      expect(faltando).toEqual([]);

      const esperadas = new Set(TRANSPORTES.map(ns.chave));
      const orfas = Object.keys(dicionario).filter(
        (k) => /^kind[_A-Z]/.test(k) && !esperadas.has(k)
      );
      expect(orfas).toEqual([]);
    });
  }
});
