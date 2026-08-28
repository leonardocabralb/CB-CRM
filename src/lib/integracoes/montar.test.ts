import { describe, expect, it } from 'vitest';

import {
  montarCartoes,
  type CanalParaMontar,
  type ConfigParaMontar,
} from './montar';

const CANAIS: CanalParaMontar[] = [
  { id: 'canal-1', label: 'Comercial', radarEnabled: true },
  { id: 'canal-2', label: 'Pessoal', radarEnabled: false },
];

function config(parcial: Partial<ConfigParaMontar>): ConfigParaMontar {
  return {
    id: 'cfg-1',
    channelId: null,
    provider: 'gemini',
    model: 'gemini-3.5-flash',
    isActive: true,
    teste: { ok: true },
    temEmbeddings: false,
    ...parcial,
  };
}

function cartao(cartoes: ReturnType<typeof montarCartoes>, id: string) {
  const c = cartoes.find((x) => x.id === id);
  if (!c) throw new Error(`cartão ${id} não montado`);
  return c;
}

describe('montarCartoes', () => {
  it('sem nenhuma config, todos os provedores ficam não configurados', () => {
    const cartoes = montarCartoes([], CANAIS, null);
    for (const id of ['gemini', 'openai', 'anthropic', 'google_calendar']) {
      expect(cartao(cartoes, id).estado).toBe('nao_configurado');
    }
  });

  it('teste pendente vira "conferindo", não "erro" nem "ok"', () => {
    const cartoes = montarCartoes([config({ teste: null })], CANAIS, null);
    expect(cartao(cartoes, 'gemini').estado).toBe('conferindo');
  });

  it('um agente com falha derruba o cartão do provedor para "erro"', () => {
    const cartoes = montarCartoes(
      [
        config({ id: 'a', teste: { ok: true } }),
        config({
          id: 'b',
          channelId: 'canal-1',
          teste: { ok: false, motivo: 'invalid key' },
        }),
      ],
      CANAIS,
      null
    );
    expect(cartao(cartoes, 'gemini').estado).toBe('erro');
  });

  it('radar e transcrição seguem a resolução canal→config com queda no padrão', () => {
    // Padrão = gemini; canal-1 tem agente próprio openai. O Radar do
    // canal-1 (ligado) usa openai; o canal-2 (radar desligado) não
    // aparece no radar de ninguém, mas a transcrição dele resolve para
    // o padrão gemini.
    const cartoes = montarCartoes(
      [
        config({ id: 'padrao', provider: 'gemini' }),
        config({ id: 'c1', channelId: 'canal-1', provider: 'openai' }),
      ],
      CANAIS,
      null
    );
    expect(cartao(cartoes, 'openai').radar).toEqual(['Comercial']);
    expect(cartao(cartoes, 'gemini').radar).toEqual([]);
    // Transcrição é Gemini-only: canal-1 resolve para openai → fora.
    expect(cartao(cartoes, 'gemini').transcricao).toEqual(['Pessoal']);
    expect(cartao(cartoes, 'openai').transcricao).toEqual([]);
  });

  it('embeddings aparecem SÓ no cartão openai e contam no estado dele', () => {
    // Chave de embeddings numa config cujo provider de CHAT é gemini:
    // o RAG é OpenAI-only, então o uso (e a falha) pertence ao cartão
    // openai — mesmo sem nenhum agente de chat openai.
    const cartoes = montarCartoes(
      [config({ provider: 'gemini', temEmbeddings: true })],
      CANAIS,
      { ok: false, motivo: '401' }
    );
    const openai = cartao(cartoes, 'openai');
    expect(openai.rag).toBe(true);
    expect(openai.estado).toBe('erro');
    expect(cartao(cartoes, 'gemini').rag).toBe(false);
    // O cartão gemini não herda a falha do embeddings.
    expect(cartao(cartoes, 'gemini').estado).toBe('ok');
  });

  it('agente de canal carrega o rótulo do canal', () => {
    const cartoes = montarCartoes(
      [config({ channelId: 'canal-1' })],
      CANAIS,
      null
    );
    expect(cartao(cartoes, 'gemini').agentes[0]).toMatchObject({
      escopo: 'canal',
      canalLabel: 'Comercial',
    });
  });
});
